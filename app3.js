async function authenticate() {
  // Always read fresh from the input (ignore stale localStorage during this click)
  const raw = patToken ? patToken.value : "";
  const token = String(raw || "").trim().replace(/\s+/g, "");

  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }
  if (token.length < 15) {
    accountStatus.textContent = "Token too short. Paste the FULL token (usually starts with a1-)";
    return;
  }

  // Save only after basic checks
  if (rememberToken && rememberToken.checked) {
    try { localStorage.setItem("trademate_pat", token); } catch (e) {}
  } else {
    try { localStorage.removeItem("trademate_pat"); } catch (e) {}
  }

  let APP = "1089";
  try {
    const el = document.getElementById("appId");
    if (el && el.value && String(el.value).trim()) APP = String(el.value).trim();
    else if (typeof APP_ID !== "undefined" && APP_ID) APP = String(APP_ID);
  } catch (e) {}

  const mask = token.slice(0, 4) + "…" + token.slice(-4);
  accountStatus.textContent = "Authorizing token " + mask + " …";

  function openAndAuthorize(url) {
    return new Promise(function (resolve) {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        resolve({ ok: false, error: e.message });
        return;
      }

      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) {}
        resolve({ ok: false, error: "timeout connecting to " + url });
      }, 12000);

      ws.onopen = function () {
        ws.send(JSON.stringify({ authorize: token }));
      };

      ws.onmessage = function (ev) {
        let data;
        try { data = JSON.parse(ev.data); } catch (e) { return; }

        if (data.error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const msg = data.error.message || "authorize failed";
          try { ws.close(); } catch (e) {}
          resolve({ ok: false, error: msg });
          return;
        }

        if (data.msg_type === "authorize" && data.authorize) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, ws: ws, auth: data.authorize });
        }
      };

      ws.onerror = function () {
        // wait for onclose / timeout
      };

      ws.onclose = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: "connection closed before authorize" });
      };
    });
  }

  function attachTradingSocket(ws) {
    authSocket = ws;

    if (authSocket._ping) clearInterval(authSocket._ping);
    authSocket._ping = setInterval(function () {
      if (authSocket && authSocket.readyState === WebSocket.OPEN) {
        try { authSocket.send(JSON.stringify({ ping: 1 })); } catch (e) {}
      }
    }, 30000);

    authSocket.onmessage = function (event) {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      console.log("Auth message:", data);

      if (data.error) {
        if (tradeStatus) tradeStatus.textContent = "Error: " + data.error.message;
        awaitingSettlement = false;
        return;
      }
      if (data.msg_type === "balance" && data.balance && balanceDisplay) {
        balanceDisplay.textContent = data.balance.balance + " " + (data.balance.currency || "USD");
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
          if (tradeStatus) tradeStatus.textContent = profit >= 0 ? "Won +" + profit : "Lost " + profit;
          if (typeof handleTradeSettled === "function") handleTradeSettled();
          awaitingSettlement = false;
        }
      }
    };

    authSocket.onclose = function (event) {
      if (authSocket && authSocket._ping) clearInterval(authSocket._ping);
      accountStatus.textContent = "Trading connection closed (" + event.code + "). Press Authenticate again.";
      isAutoTrading = false;
    };
  }

  // Only use classic Deriv v3 endpoints (do NOT authorize on the public market socket)
  const urls = [
    "wss://ws.derivws.com/websockets/v3?app_id=" + encodeURIComponent(APP),
    "wss://ws.binaryws.com/websockets/v3?app_id=" + encodeURIComponent(APP)
  ];

  let lastError = "";
  for (let i = 0; i < urls.length; i++) {
    accountStatus.textContent = "Authorizing " + mask + " (" + (i + 1) + "/" + urls.length + ")…";
    const result = await openAndAuthorize(urls[i]);
    if (result.ok) {
      attachTradingSocket(result.ws);
      const auth = result.auth;
      const loginid = auth.loginid || "";
      const isVirtual = auth.is_virtual === 1 || (loginid + "").toUpperCase().indexOf("VR") === 0;
      accountStatus.textContent = "Trading ready (" + (isVirtual ? "demo" : "real") + ") · " + loginid;
      result.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      return;
    }
    lastError = result.error || "unknown";
    console.warn("Auth failed:", lastError);
  }

  accountStatus.textContent = "Auth failed: " + lastError +
    " | Token used: " + mask +
    " | Create token at app.deriv.com/account/api-token with Read+Trade. App ID: " + APP;
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
  
