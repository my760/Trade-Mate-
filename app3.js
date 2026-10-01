
function updateLiveTrade(poc) {
  const st = document.getElementById("liveStatus");
  const cid = document.getElementById("liveContract");
  const entry = document.getElementById("liveEntry");
  const spot = document.getElementById("liveSpot");
  const pl = document.getElementById("livePL");
  if (!st) return;

  if (!poc) {
    st.textContent = "—";
    if (cid) cid.textContent = "—";
    if (entry) entry.textContent = "—";
    if (spot) spot.textContent = "—";
    if (pl) { pl.textContent = "—"; pl.style.color = ""; }
    return;
  }

  const open = !(poc.is_sold || poc.status === "sold");
  st.textContent = open ? "OPEN" : "CLOSED";
  st.style.color = open ? "var(--yellow)" : "var(--muted)";

  if (cid) cid.textContent = poc.contract_id || "—";
  if (entry) entry.textContent = (poc.buy_price != null ? poc.buy_price : "—") +
    (poc.contract_type ? " · " + poc.contract_type : "");
  if (spot) spot.textContent = poc.current_spot != null ? poc.current_spot :
    (poc.exit_tick != null ? poc.exit_tick : "—");

  if (pl) {
    const profit = poc.profit;
    if (profit == null) {
      pl.textContent = open ? "…" : "—";
      pl.style.color = "";
    } else {
      const n = parseFloat(profit);
      pl.textContent = (n >= 0 ? "+" : "") + n;
      pl.style.color = n >= 0 ? "var(--green)" : "var(--red)";
    }
  }
}

function pushLiveTradeRow(label, profit) {
  const list = document.getElementById("liveTradeList");
  if (!list) return;
  if (list.textContent === "No trades yet") list.innerHTML = "";
  const n = parseFloat(profit);
  const color = n >= 0 ? "var(--green)" : "var(--red)";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)";
  row.innerHTML = "<span>" + label + "</span><span style='color:" + color + ";font-weight:700'>" +
    (n >= 0 ? "+" : "") + n + "</span>";
  list.insertBefore(row, list.firstChild);
}


async function authenticate() {
  const raw = patToken ? patToken.value : "";
  const token = String(raw || "").trim().replace(/\s+/g, "");

  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }
  if (token.length < 10) {
    accountStatus.textContent = "Token too short — paste the full token";
    return;
  }

  if (rememberToken && rememberToken.checked) {
    try { localStorage.setItem("trademate_pat", token); } catch (e) {}
  } else {
    try { localStorage.removeItem("trademate_pat"); } catch (e) {}
  }

  let APP = "34ya3MjzHm3sUbSFXKCeN";
  try {
    const el = document.getElementById("appId");
    if (el && el.value && String(el.value).trim()) APP = String(el.value).trim();
    else if (typeof APP_ID !== "undefined" && APP_ID) APP = String(APP_ID);
  } catch (e) {}

  const mask = token.slice(0, 4) + "…" + token.slice(-4);
  const isPat = token.toLowerCase().indexOf("pat_") === 0 || token.toLowerCase().indexOf("pat-") === 0;

  accountStatus.textContent = "Authorizing " + mask + (isPat ? " (PAT)" : " (classic)") + "…";

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
        const scanStatus = document.getElementById("scanTradeStatus");
        if (scanStatus) scanStatus.textContent = "Contract opened · " + (data.buy.contract_id || "");
        if (typeof lastPlacedContractId !== "undefined") lastPlacedContractId = data.buy.contract_id;
        updateLiveTrade({
          contract_id: data.buy.contract_id,
          buy_price: data.buy.buy_price || data.buy.purchase_price,
          contract_type: (pendingTrade && pendingTrade.contract_type) || "",
          is_sold: 0,
          profit: null
        });
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
        updateLiveTrade(poc);
        if (poc.is_sold || poc.status === "sold") {
          const profit = poc.profit;
          if (tradeStatus) tradeStatus.textContent = profit >= 0 ? "Won +" + profit : "Lost " + profit;
          const scanStatus = document.getElementById("scanTradeStatus");
          if (scanStatus && typeof runningFromScan !== "undefined" && runningFromScan) {
            scanStatus.textContent = (profit >= 0 ? "Won +" : "Lost ") + profit;
          }
          pushLiveTradeRow(
            (poc.contract_type || "Trade") + " #" + (poc.contract_id || ""),
            profit
          );
          if (typeof window._scanOnSettled === "function") window._scanOnSettled(profit);
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

  // ---------- PAT token flow (pat_...) ----------
  if (isPat) {
    try {
      accountStatus.textContent = "PAT: fetching accounts…";
      const accRes = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
        headers: {
          "Authorization": "Bearer " + token,
          "Deriv-App-ID": APP,
          "Accept": "application/json"
        }
      });
      const accText = await accRes.text();
      let accData;
      try { accData = JSON.parse(accText); } catch (e) {
        accountStatus.textContent = "PAT accounts failed (" + accRes.status + "): not JSON. Check App ID. Body: " + accText.slice(0, 80);
        return;
      }
      if (!accRes.ok) {
        const errMsg = (accData.errors && accData.errors[0] && accData.errors[0].message)
          || accData.message
          || ("HTTP " + accRes.status);
        accountStatus.textContent = "PAT error: " + errMsg + " | App ID used: " + APP;
        return;
      }

      const list = accData.data || accData.accounts || [];
      accounts = {};
      list.forEach(function (acc) {
        const t = (acc.account_type || acc.type || "").toLowerCase();
        const id = acc.account_id || acc.id || acc.loginid;
        if (id) accounts[t || "demo"] = id;
        // also map virtual/real
        if (acc.is_virtual || t.indexOf("demo") >= 0 || t.indexOf("virtual") >= 0) accounts["demo"] = id;
        else accounts["real"] = id;
      });

      const preferred = (accountType && accountType.value) || "demo";
      let accId = accounts[preferred] || accounts["demo"] || accounts["real"] || Object.values(accounts)[0];
      if (!accId && list[0]) accId = list[0].account_id || list[0].id;

      if (!accId) {
        accountStatus.textContent = "PAT: no trading accounts found on this token";
        return;
      }

      accountStatus.textContent = "PAT: requesting OTP for " + accId + "…";
      const otpRes = await fetch(
        "https://api.derivws.com/trading/v1/options/accounts/" + encodeURIComponent(accId) + "/otp",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Deriv-App-ID": APP,
            "Accept": "application/json"
          }
        }
      );
      const otpText = await otpRes.text();
      let otpData;
      try { otpData = JSON.parse(otpText); } catch (e) {
        accountStatus.textContent = "PAT OTP failed (" + otpRes.status + "): " + otpText.slice(0, 100);
        return;
      }
      if (!otpRes.ok) {
        const errMsg = (otpData.errors && otpData.errors[0] && otpData.errors[0].message)
          || otpData.message
          || ("HTTP " + otpRes.status);
        accountStatus.textContent = "PAT OTP error: " + errMsg;
        return;
      }

      const wsUrl = (otpData.data && otpData.data.url) || otpData.url;
      if (!wsUrl) {
        accountStatus.textContent = "PAT: no WebSocket URL in OTP response";
        return;
      }

      accountStatus.textContent = "PAT: opening trading socket…";
      const ws = new WebSocket(wsUrl);
      ws.onopen = function () {
        attachTradingSocket(ws);
        accountStatus.textContent = "Trading ready (PAT) · " + accId;
        try { ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); } catch (e) {}
      };
      ws.onerror = function () {
        accountStatus.textContent = "PAT trading socket error";
      };
      ws.onclose = function (ev) {
        if (accountStatus.textContent.indexOf("Trading ready") === -1) {
          accountStatus.textContent = "PAT socket closed (" + ev.code + ")";
        }
      };
      return;
    } catch (e) {
      accountStatus.textContent = "PAT auth failed: " + e.message;
      return;
    }
  }

  // ---------- Classic token flow (a1-...) ----------
  function openAndAuthorize(url) {
    return new Promise(function (resolve) {
      let settled = false;
      let ws;
      try { ws = new WebSocket(url); } catch (e) {
        resolve({ ok: false, error: e.message });
        return;
      }
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) {}
        resolve({ ok: false, error: "timeout" });
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
          try { ws.close(); } catch (e) {}
          resolve({ ok: false, error: data.error.message || "authorize failed" });
          return;
        }
        if (data.msg_type === "authorize" && data.authorize) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, ws: ws, auth: data.authorize });
        }
      };
      ws.onclose = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: "connection closed before authorize" });
      };
      ws.onerror = function () {};
    });
  }

  const urls = [
    "wss://ws.derivws.com/websockets/v3?app_id=" + encodeURIComponent(APP),
    "wss://ws.binaryws.com/websockets/v3?app_id=" + encodeURIComponent(APP)
  ];

  let lastError = "";
  for (let i = 0; i < urls.length; i++) {
    accountStatus.textContent = "Classic auth " + mask + " (" + (i + 1) + "/" + urls.length + ")…";
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
  }

  accountStatus.textContent = "Auth failed: " + lastError +
    " | Token: " + mask +
    " | If token starts with pat_, add your PAT App ID from api.deriv.com. If a1-, use Read+Trade token from app.deriv.com/account/api-token.";
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
    const scanStatus = document.getElementById("scanTradeStatus");
    if (scanStatus) scanStatus.textContent = "Stopped: reached " + limit + " trades";
    if (typeof runningFromScan !== "undefined") runningFromScan = false;
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
