async function authenticate() {
  const token = patToken.value.trim();
  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }

  if (rememberToken && rememberToken.checked) {
    try { localStorage.setItem("trademate_pat", token); } catch (e) {}
  }

  accountStatus.textContent = "Authorizing...";

  // Classic Deriv WebSocket authorize (most reliable in browser)
  const APP = (typeof APP_ID !== "undefined" && APP_ID && /^\d+$/.test(String(APP_ID)))
    ? APP_ID
    : "1089";

  try {
    if (authSocket) {
      try { authSocket.close(); } catch (e) {}
    }

    authSocket = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=" + APP);

    authSocket.onopen = function () {
      authSocket.send(JSON.stringify({ authorize: token }));
    };

    authSocket.onerror = function () {
      accountStatus.textContent = "Trading connection error — check token & internet";
    };

    authSocket.onclose = function (event) {
      if (accountStatus.textContent.indexOf("Trading ready") === -1) {
        accountStatus.textContent = "Connection closed (" + event.code + "). Try Authenticate again.";
      }
      isAutoTrading = false;
    };

    authSocket.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        accountStatus.textContent = "Bad response from server";
        return;
      }
      console.log("Auth message:", data);

      if (data.error) {
        accountStatus.textContent = "Auth error: " + data.error.message;
        if (tradeStatus) tradeStatus.textContent = "Error: " + data.error.message;
        return;
      }

      if (data.msg_type === "authorize" && data.authorize) {
        const auth = data.authorize;
        const loginid = auth.loginid || "";
        const isVirtual = auth.is_virtual === 1 || (loginid + "").indexOf("VR") === 0;
        accountStatus.textContent = "Trading ready (" + (isVirtual ? "demo" : "real") + ") · " + loginid;

        // Request balance
        authSocket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        return;
      }

      if (data.msg_type === "balance" && data.balance) {
        if (balanceDisplay) {
          balanceDisplay.textContent = data.balance.balance + " " + (data.balance.currency || "USD");
        }
        return;
      }

      if (data.error) {
        if (tradeStatus) tradeStatus.textContent = "Error: " + data.error.message;
        awaitingSettlement = false;
        return;
      }

      // Buy confirmation
      if (data.msg_type === "buy" && data.buy) {
        if (tradeStatus) tradeStatus.textContent = "Contract opened · ID " + (data.buy.contract_id || "");
        if (typeof lastPlacedContractId !== "undefined") lastPlacedContractId = data.buy.contract_id;
        // Subscribe to contract updates
        if (data.buy.contract_id) {
          authSocket.send(JSON.stringify({
            proposal_open_contract: 1,
            contract_id: data.buy.contract_id,
            subscribe: 1
          }));
        }
        return;
      }

      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
        const poc = data.proposal_open_contract;
        if (poc.is_sold || poc.status === "sold") {
          const profit = poc.profit;
          if (tradeStatus) {
            tradeStatus.textContent = profit >= 0
              ? "Won +" + profit
              : "Lost " + profit;
          }
          if (typeof handleTradeSettled === "function") handleTradeSettled();
          awaitingSettlement = false;
        }
        return;
      }

      // Keep any extra handlers that were in the original message loop
      if (data.msg_type === "cashier" && walletStatus) {
        walletStatus.textContent = data.cashier || "Cashier response received";
      }
    };
  } catch (e) {
    accountStatus.textContent = "Auth failed: " + e.message;
  }
}

// Kept for compatibility — now authorize handles everything
async function connectAuthSocket() {
  await authenticate();
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
          
