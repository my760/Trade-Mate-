async function authenticate() {
  const token = patToken.value.trim();
  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }

  // Basic token shape check (Deriv tokens usually start with a1- or similar)
  if (token.length < 10) {
    accountStatus.textContent = "Token looks too short — paste the full API token";
    return;
  }

  if (rememberToken && rememberToken.checked) {
    try { localStorage.setItem("trademate_pat", token); } catch (e) {}
  }

  accountStatus.textContent = "Connecting to Deriv...";

  const APP = (typeof APP_ID !== "undefined" && APP_ID && /^\d+$/.test(String(APP_ID)))
    ? String(APP_ID)
    : "1089";

  const endpoints = [
    "wss://ws.derivws.com/websockets/v3?app_id=" + APP,
    "wss://ws.binaryws.com/websockets/v3?app_id=" + APP
  ];

  let authorized = false;
  let tried = 0;

  function wireSocket(url) {
    tried++;
    accountStatus.textContent = "Connecting... (" + tried + "/" + endpoints.length + ")";

    try {
      if (authSocket) {
        try { authSocket.onclose = null; authSocket.close(); } catch (e) {}
      }
    } catch (e) {}

    authSocket = new WebSocket(url);

    const connectTimeout = setTimeout(function () {
      if (!authorized && authSocket && authSocket.readyState !== WebSocket.OPEN) {
        try { authSocket.close(); } catch (e) {}
      }
    }, 12000);

    authSocket.onopen = function () {
      clearTimeout(connectTimeout);
      accountStatus.textContent = "Authorizing...";
      authSocket.send(JSON.stringify({ authorize: token }));
      // keepalive
      try {
        authSocket._ping = setInterval(function () {
          if (authSocket && authSocket.readyState === WebSocket.OPEN) {
            authSocket.send(JSON.stringify({ ping: 1 }));
          }
        }, 30000);
      } catch (e) {}
    };

    authSocket.onerror = function () {
      console.warn("Auth WS error on", url);
    };

    authSocket.onclose = function (event) {
      clearTimeout(connectTimeout);
      if (authSocket && authSocket._ping) {
        clearInterval(authSocket._ping);
      }
      if (authorized) {
        accountStatus.textContent = "Trading connection closed (" + event.code + "). Press Authenticate again.";
        isAutoTrading = false;
        return;
      }
      // Try next endpoint
      if (tried < endpoints.length) {
        wireSocket(endpoints[tried]);
        return;
      }
      accountStatus.textContent =
        "Connection closed (" + event.code + "). Check: 1) token is valid 2) token has Trade scope 3) try again";
      isAutoTrading = false;
    };

    authSocket.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      console.log("Auth message:", data);

      if (data.error) {
        const msg = data.error.message || "Unknown error";
        accountStatus.textContent = "Auth error: " + msg;
        if (tradeStatus) tradeStatus.textContent = "Error: " + msg;
        // Invalid token — don't keep retrying forever
        if (String(msg).toLowerCase().indexOf("token") !== -1) {
          authorized = false;
          tried = endpoints.length;
        }
        return;
      }

      if (data.msg_type === "authorize" && data.authorize) {
        authorized = true;
        const auth = data.authorize;
        const loginid = auth.loginid || "";
        const isVirtual = auth.is_virtual === 1 || (loginid + "").toUpperCase().indexOf("VR") === 0;
        accountStatus.textContent = "Trading ready (" + (isVirtual ? "demo" : "real") + ") · " + loginid;
        authSocket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        return;
      }

      if (data.msg_type === "balance" && data.balance) {
        if (balanceDisplay) {
          balanceDisplay.textContent = data.balance.balance + " " + (data.balance.currency || "USD");
        }
        return;
      }

      if (data.msg_type === "buy" && data.buy) {
        if (tradeStatus) tradeStatus.textContent = "Contract opened · ID " + (data.buy.contract_id || "");
        if (typeof lastPlacedContractId !== "undefined") lastPlacedContractId = data.buy.contract_id;
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
            tradeStatus.textContent = profit >= 0 ? "Won +" + profit : "Lost " + profit;
          }
          if (typeof handleTradeSettled === "function") handleTradeSettled();
          awaitingSettlement = false;
        }
        return;
      }

      if (data.msg_type === "ping") return;
    };
  }

  wireSocket(endpoints[0]);
}

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
          
