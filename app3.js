async function authenticate() {
  const token = patToken.value.trim();
  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }

  if (rememberToken && rememberToken.checked) {
    try { localStorage.setItem("trademate_pat", token); } catch (e) {}
  }

  accountStatus.textContent = "Fetching accounts...";

  try {
    const res = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: {
        "Authorization": "Bearer " + token,
        "Deriv-App-ID": APP_ID
      }
    });
    const data = await res.json();

    if (!res.ok) {
      accountStatus.textContent = "Auth error: " + (data.errors ? data.errors[0].message : res.status);
      return;
    }

    accounts = {};
    (data.data || []).forEach(acc => {
      accounts[acc.account_type] = acc.account_id;
    });

    accountStatus.textContent = "Found: " + Object.keys(accounts).join(", ");
    await connectAuthSocket();
  } catch (e) {
    accountStatus.textContent = "Auth failed: " + e.message;
  }
}

async function connectAuthSocket() {
  const type = accountType.value;
  const accId = accounts[type];

  if (!accId) {
    accountStatus.textContent = "No " + type + " account found on your login";
    return;
  }

  const token = patToken.value.trim();

  try {
    const otpRes = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts/" + accId + "/otp",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Deriv-App-ID": APP_ID
        }
      }
    );
    const otpData = await otpRes.json();

    if (!otpRes.ok) {
      accountStatus.textContent = "OTP error: " + (otpData.errors ? otpData.errors[0].message : otpRes.status);
      return;
    }

    const wsUrl = otpData.data.url;

    if (authSocket) authSocket.close();
    authSocket = new WebSocket(wsUrl);

    authSocket.onopen = function () {
      accountStatus.textContent = "Trading ready (" + type + ")";
      authSocket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    };

    authSocket.onerror = function () {
      accountStatus.textContent = "Trading connection error";
    };

    authSocket.onclose = function (event) {
      accountStatus.textContent = "Trading connection closed (" + event.code + ")";
      isAutoTrading = false;
    };

    authSocket.onmessage = function (event) {
      const data = JSON.parse(event.data);
      console.log("Auth message:", data);

      if (data.error) {
        tradeStatus.textContent = "Error: " + data.error.message;
        if (walletStatus) walletStatus.textContent = "Error: " + data.error.message;
        awaitingSettlement = false;
        return;
      }

      if (data.msg_type === "balance" && data.balance) {
        balanceDisplay.textContent = data.balance.balance + " " + data.balance.currency;
      }

      if (data.msg_type === "cashier" && data.cashier) {
        walletStatus.textContent = "Opening cashier...";
        window.open(data.cashier, "_blank");
      }

      if (data.msg_type === "topup_virtual") {
        if (data.topup_virtual && data.topup_virtual.amount) {
          walletStatus.textContent = "Topped up: +" + data.topup_virtual.amount;
        } else {
          walletStatus.textContent = "Top-up not available right now";
        }
      }

      if (data.msg_type === "buy" && data.buy) {
        const contractId = data.buy.contract_id;
        lastPlacedContractId = contractId;
        const trade = pendingTrade || { contract_type: "UNKNOWN", barrier: null };

        trades.unshift({
          contractId: contractId,
          symbol: marketSelect.value,
          contractType: trade.contract_type,
          barrier: trade.barrier,
          stake: parseFloat(stakeAmount.value),
          status: "open",
          profit: null,
          exitDigit: null
        });
        renderTradeHistory();
        pendingTrade = null;

        authSocket.send(JSON.stringify({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1
        }));
      }

      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        const trade = trades.find(t => t.contractId === contract.contract_id);
        if (trade) {
          const profit = parseFloat(contract.profit);
          trade.profit = profit;

          if (contract.is_sold) {
            trade.status = profit >= 0 ? "won" : "lost";
            if (contract.exit_spot !== undefined) {
              trade.exitDigit = lastDigitOf(contract.exit_spot);
            }
            renderTradeHistory();

            if (awaitingSettlement && trade.contractId === lastPlacedContractId) {
              awaitingSettlement = false;
              handleTradeSettled();
            }
          } else {
            trade.status = "open";
            renderTradeHistory();
          }
        }
      }
    };
  } catch (e) {
    accountStatus.textContent = "Connection failed: " + e.message;
  }
}

function outcomeExplanation(t) {
  if (t.exitDigit === null || t.exitDigit === undefined) return "";
  const d = t.exitDigit;
  const b = t.barrier !== null ? parseInt(t.barrier, 10) : null;
  switch (t.contractType) {
    case "DIGITOVER": return "digit " + d + (d > b ? " > " : " <= ") + b;
    case "DIGITUNDER": return "digit " + d + (d < b ? " < " : " >= ") + b;
    case "DIGITMATCH": return "digit " + d + (d === b ? " = " : " ≠ ") + b;
    case "DIGITDIFF": return "digit " + d + (d !== b ? " ≠ " : " = ") + b;
    case "DIGITEVEN": return "digit " + d + (d % 2 === 0 ? " (even)" : " (odd)");
    case "DIGITODD": return "digit " + d + (d % 2 !== 0 ? " (odd)" : " (even)");
    default: return "digit " + d;
  }
}

function renderTradeHistory() {
  if (!tradeHistoryDisplay) return;

  if (trades.length === 0) {
    tradeHistoryDisplay.textContent = "No trades yet";
    return;
  }

  tradeHistoryDisplay.innerHTML = trades.slice(0, 30).map(t => {
    const label = t.status === "open" ? "OPEN" : (t.status === "won" ? "WON" : "LOST");
    const profitText = t.profit !== null ? (t.profit >= 0 ? "+" : "") + t.profit.toFixed(2) : "—";
    const reason = t.status !== "open" ? outcomeExplanation(t) : "";
    return "<div class='hist-row'><span>" +
      t.symbol + " " + t.contractType + (t.barrier !== null ? " (" + t.barrier + ")" : "") +
      " | $" + t.stake + "</span><span class='tag " + (t.status === "open" ? "open" : t.status === "won" ? "win" : "loss") + "'>" + label + " (" + profitText + ")</span></div>" +
      (reason ? "<div class='muted' style='margin:-4px 0 6px'>" + reason + "</div>" : "");
  }).join("");
}

function requestCashier(action) {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    walletStatus.textContent = "Authenticate first";
    return;
  }
  walletStatus.textContent = "Opening " + action + " page...";
  authSocket.send(JSON.stringify({ cashier: action }));
}

function topUpDemo() {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    walletStatus.textContent = "Authenticate first";
    return;
  }
  walletStatus.textContent = "Requesting top-up...";
  authSocket.send(JSON.stringify({ topup_virtual: 1 }));
}

function placeTrade() {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    tradeStatus.textContent = "Not authenticated yet";
    stopBot();
    return;
  }

  const preset = BOT_PRESETS[selectedBot];
  const symbol = marketSelect.value;
  const stake = parseFloat(stakeAmount.value);
  const ticks = parseInt(ticksDuration.value, 10);
  const barrier = preset.needsBarrier ? botBarrier.value : null;

  const parameters = {
    amount: stake,
    basis: "stake",
    contract_type: preset.contract_type,
    currency: "USD",
    duration: ticks,
    duration_unit: "t",
    underlying_symbol: symbol
  };

  if (barrier !== null) {
    parameters.barrier = barrier;
  }

  pendingTrade = { contract_type: preset.contract_type, barrier: barrier };

  const request = {
    buy: "1",
    price: stake.toString(),
    parameters: parameters
  };

  tradeStatus.textContent = "Trade " + (tradesPlacedCount + 1) + " of " + maxTrades.value + " (" + preset.label + (barrier !== null ? " " + barrier : "") + ")";
  awaitingSettlement = true;
  authSocket.send(JSON.stringify(request));
}

function placeManualTrade() {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    tradeStatus.textContent = "Authenticate first";
    return;
  }

  const contractType = manualContract.value;
  const symbol = marketSelect.value;
  const stake = parseFloat(stakeAmount.value);
  const ticks = parseInt(ticksDuration.value, 10);
  const needsBarrier = ["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(contractType);
  const barrier = needsBarrier ? manualBarrier.value : null;

  const parameters = {
    amount: stake,
    basis: "stake",
    contract_type: contractType,
    currency: "USD",
    duration: ticks,
    duration_unit: "t",
    underlying_symbol: symbol
  };

  if (needsBarrier) {
    parameters.barrier = barrier;
  }

  pendingTrade = { contract_type: contractType, barrier: barrier };

  const request = {
    buy: "1",
    price: stake.toString(),
    parameters: parameters
  };

  tradeStatus.textContent = "Manual trade placed (" + contractType + ")";
  authSocket.send(JSON.stringify(request));
}

function handleTradeSettled() {
  tradesPlacedCount++;

  if (!isAutoTrading) return;

  const limit = parseInt(maxTrades.value, 10);
  if (tradesPlacedCount >= limit) {
    tradeStatus.textContent = "Stopped: reached " + limit + " trades";
    stopBot();
    return;
  }

  setTimeout(function () {
    if (isAutoTrading) {
      placeTrade();
    }
  }, 1500);
}

function startBot() {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    tradeStatus.textContent = "Authenticate first";
    return;
  }
  if (isAutoTrading) return;

  isAutoTrading = true;
  tradesPlacedCount = 0;
  tradeStatus.textContent = "Starting...";
  placeTrade();
}

function stopBot() {
  isAutoTrading = false;
  awaitingSettlement = false;
  if (tradeStatus.textContent.indexOf("Stopped") === -1) {
    tradeStatus.textContent = "Stopped";
  }
}

if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();
    connectDeriv();
  });
}

if (marketSelect) {
  marketSelect.addEventListener("change", function () {
    if (marketBotsSelect) marketBotsSelect.value = marketSelect.value;
    if (socket && socket.readyState === WebSocket.OPEN) {
      subscribeToTicks(marketSelect.value);
    }
  });
}

if (marketBotsSelect) {
  marketBotsSelect.addEventListener("change", function () {
    marketSelect.value = marketBotsSelect.value;
    if (socket && socket.readyState === WebSocket.OPEN) {
      subscribeToTicks(marketSelect.value);
    }
  });
}

if (authBtn) {
  authBtn.addEventListener("click", function (event) {
    event.preventDefault();
    authenticate();
  });
}

if (accountType) {
  accountType.addEventListener("change", function () {
    if (Object.keys(accounts).length > 0) {
      connectAuthSocket();
    }
  });
}

if (startBtn) {
  startBtn.addEventListener("click", function (event) {
    event.preventDefault();
    startBot();
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", function (event) {
    event.preventDefault();
    stopBot();
  });
}

if (manualBuyBtn) {
  manualBuyBtn.addEventListener("click", function (event) {
    event.preventDefault();
    placeManualTrade();
  });
}

if (analysisDigit) {
  analysisDigit.addEventListener("input", renderAnalysis);
}

if (depositBtn) {
  depositBtn.addEventListener("click", function (event) {
    event.preventDefault();
    requestCashier("deposit");
  });
}

if (withdrawBtn) {
  withdrawBtn.addEventListener("click", function (event) {
    event.preventDefault();
    requestCashier("withdraw");
  });
}

if (topupBtn) {
  topupBtn.addEventListener("click", function (event) {
    event.preventDefault();
    topUpDemo();
  });
}

if (scanBtn) {
  scanBtn.addEventListener("click", function (event) {
    event.preventDefault();
    scanMarkets();
  });
}

if (loadScanBtn) {
  loadScanBtn.addEventListener("click", function (event) {
    event.preventDefault();
    loadScanResult();
  });
}

setStatus("Not connected");
connectDeriv();
