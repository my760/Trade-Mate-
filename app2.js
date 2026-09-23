window.onerror = function (msg) {
  document.getElementById("status").textContent = "JS Error: " + msg;
};

const APP_ID = "34qc7VTAO1l6XjqsL06jn";

const BOT_PRESETS = {
  over1: { label: "Digit Over 1", contract_type: "DIGITOVER", barrier: "1" },
  over2: { label: "Digit Over 2", contract_type: "DIGITOVER", barrier: "2" },
  under8: { label: "Digit Under 8", contract_type: "DIGITUNDER", barrier: "8" },
  under7: { label: "Digit Under 7", contract_type: "DIGITUNDER", barrier: "7" },
  even: { label: "Digit Even", contract_type: "DIGITEVEN", barrier: null },
  odd: { label: "Digit Odd", contract_type: "DIGITODD", barrier: null },
  match5: { label: "Digit Matches 5", contract_type: "DIGITMATCH", barrier: "5" },
  diff5: { label: "Digit Differs 5", contract_type: "DIGITDIFF", barrier: "5" }
};

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.getElementById("market");
const marketBotsSelect = document.getElementById("marketBots");
const digitDisplay = document.getElementById("digit");
const digitStatsDisplay = document.getElementById("digitStats");
const digitLive = document.getElementById("digitLive");
const digitStatsLive = document.getElementById("digitStatsLive");
const analysisDigit = document.getElementById("analysisDigit");
const analysisResult = document.getElementById("analysisResult");
const botGrid = document.getElementById("botGrid");

const patToken = document.getElementById("patToken");
const accountType = document.getElementById("accountType");
const authBtn = document.getElementById("authBtn");
const accountStatus = document.getElementById("accountStatus");
const balanceDisplay = document.getElementById("balance");
const stakeAmount = document.getElementById("stakeAmount");
const ticksDuration = document.getElementById("ticksDuration");
const maxTrades = document.getElementById("maxTrades");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const tradeStatus = document.getElementById("tradeStatus");
const tradeHistoryDisplay = document.getElementById("tradeHistory");
const manualContract = document.getElementById("manualContract");
const manualBarrier = document.getElementById("manualBarrier");
const manualBuyBtn = document.getElementById("manualBuyBtn");

let socket = null;
let authSocket = null;
let currentSymbol = null;
let digitHistory = [];
let accounts = {};
let trades = [];
let isAutoTrading = false;
let tradesPlacedCount = 0;
let awaitingSettlement = false;
let lastPlacedContractId = null;
let selectedBot = "over1";
let pendingTrade = null;
const HISTORY_LENGTH = 500;

// ---------- Tab switching ----------

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------- Bot tile selection ----------

function selectBot(botKey) {
  selectedBot = botKey;
  document.querySelectorAll(".bot-tile").forEach(tile => {
    tile.classList.toggle("selected", tile.dataset.bot === botKey);
  });
}

if (botGrid) {
  botGrid.querySelectorAll(".bot-tile").forEach(tile => {
    tile.addEventListener("click", function () {
      selectBot(tile.dataset.bot);
    });
  });
  selectBot(selectedBot);
}

// ---------- Public tick socket ----------

function connectDeriv() {
  setStatus("Connecting...");

  socket = new WebSocket(
    "wss://api.derivws.com/trading/v1/options/ws/public"
  );

  socket.onopen = function () {
    setStatus("Connected");
    loadSymbols();
    subscribeToTicks(marketSelect.value);
  };

  socket.onerror = function () {
    setStatus("WebSocket error");
  };

  socket.onclose = function (event) {
    setStatus("Disconnected (code: " + event.code + ", reason: " + event.reason + ")");
  };

  socket.onmessage = function (event) {
    const data = JSON.parse(event.data);
    console.log("Message:", data);

    if (data.error) {
      setStatus("API Error: " + data.error.message);
    }

    if (data.msg_type === "active_symbols") {
      const options = data.active_symbols
        .filter(s => s.market === "synthetic_index")
        .map(s => "<option value='" + s.underlying_symbol + "'>" + s.underlying_symbol_name + "</option>")
        .join("");
      marketSelect.innerHTML = options;
      if (marketBotsSelect) marketBotsSelect.innerHTML = options;
    }

    if (data.msg_type === "history" && data.history) {
      digitHistory = data.history.prices.map(p => lastDigitOf(p));
      renderDigitStats();
    }

    if (data.msg_type === "tick" && data.tick) {
      updateDigit(data.tick.quote);
    }
  };
}

function loadSymbols() {
  socket.send(JSON.stringify({ active_symbols: "brief" }));
}

function subscribeToTicks(symbol) {
  if (currentSymbol) {
    socket.send(JSON.stringify({ forget_all: "ticks" }));
  }
  currentSymbol = symbol;
  digitHistory = [];
  renderDigitStats();

  socket.send(JSON.stringify({
    ticks_history: symbol,
    end: "latest",
    count: HISTORY_LENGTH,
    style: "ticks"
  }));

  socket.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
}

function lastDigitOf(price) {
  const str = price.toString();
  return parseInt(str[str.length - 1], 10);
}

function updateDigit(quote) {
  const lastDigit = lastDigitOf(quote);
  digitDisplay.textContent = lastDigit;
  if (digitLive) digitLive.textContent = lastDigit;

  digitHistory.push(lastDigit);
  if (digitHistory.length > HISTORY_LENGTH) {
    digitHistory.shift();
  }
  renderDigitStats();
}

function renderDigitStats() {
  if (!digitStatsDisplay) return;

  if (digitHistory.length === 0) {
    digitStatsDisplay.textContent = "Waiting for ticks...";
    if (digitStatsLive) digitStatsLive.textContent = "Waiting for ticks...";
    renderAnalysis();
    return;
  }

  const counts = new Array(10).fill(0);
  digitHistory.forEach(d => counts[d]++);

  const line = counts
    .map((c, digit) => digit + ":" + c)
    .join("  ");

  digitStatsDisplay.textContent = "(" + digitHistory.length + " ticks) " + line;
  if (digitStatsLive) digitStatsLive.textContent = "(" + digitHistory.length + " ticks) " + line;

  renderAnalysis();
}

function renderAnalysis() {
  if (!analysisResult) return;

  if (digitHistory.length === 0) {
    analysisResult.textContent = "Waiting for ticks...";
    return;
  }

  const target = parseInt(analysisDigit.value, 10);
  if (isNaN(target) || target < 0 || target > 9) {
    analysisResult.textContent = "Enter a digit 0-9";
    return;
  }

  const total = digitHistory.length;
  let matchCount = 0, overCount = 0, underCount = 0, evenCount = 0, oddCount = 0;

  digitHistory.forEach(d => {
    if (d === target) matchCount++;
    if (d > target) overCount++;
    if (d < target) underCount++;
    if (d % 2 === 0) evenCount++;
    else oddCount++;
  });

  const pct = n => ((n / total) * 100).toFixed(1) + "%";

  analysisResult.innerHTML =
    "Matches " + target + ": " + pct(matchCount) + "<br>" +
    "Differs " + target + ": " + pct(total - matchCount) + "<br>" +
    "Over " + target + ": " + pct(overCount) + "<br>" +
    "Under " + target + ": " + pct(underCount) + "<br>" +
    "Even: " + pct(evenCount) + " | Odd: " + pct(oddCount) +
    "<br><span style='opacity:0.6'>(based on last " + total + " ticks)</span>";
}

function setStatus(message) {
  if (status) {
    status.textContent = message;
  }
}

// ---------- Authenticated account ----------

async function authenticate() {
  const token = patToken.value.trim();
  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
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
        awaitingSettlement = false;
        return;
      }

      if (data.msg_type === "balance" && data.balance) {
        balanceDisplay.textContent = data.balance.balance + " " + data.balance.currency;
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
    return "<div style='margin-bottom:6px; border-bottom:1px solid #333; padding-bottom:6px;'>" +
      t.symbol + " " + t.contractType + (t.barrier !== null ? " (" + t.barrier + ")" : "") +
      " | stake " + t.stake + " | <b>" + label + "</b> (" + profitText + ")" +
      (reason ? "<br><span class='muted'>" + reason + "</span>" : "") +
      "</div>";
  }).join("");
}

// ---------- Bot control (manual start/stop) ----------

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

  const parameters = {
    amount: stake,
    basis: "stake",
    contract_type: preset.contract_type,
    currency: "USD",
    duration: ticks,
    duration_unit: "t",
    underlying_symbol: symbol
  };

  if (preset.barrier !== null) {
    parameters.barrier = preset.barrier;
  }

  pendingTrade = { contract_type: preset.contract_type, barrier: preset.barrier };

  const request = {
    buy: "1",
    price: stake.toString(),
    parameters: parameters
  };

  tradeStatus.textContent = "Trade " + (tradesPlacedCount + 1) + " of " + maxTrades.value + " (" + preset.label + ")";
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

// ---------- Event listeners ----------

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

setStatus("Not connected");
