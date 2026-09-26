window.onerror = function (msg) {
  document.getElementById("status").textContent = "JS Error: " + msg;
};

const APP_ID = "34qc7VTAO1l6XjqsL06jn";

const BOT_PRESETS = {
  over: { label: "Digit Over", contract_type: "DIGITOVER", needsBarrier: true },
  under: { label: "Digit Under", contract_type: "DIGITUNDER", needsBarrier: true },
  match: { label: "Digit Matches", contract_type: "DIGITMATCH", needsBarrier: true },
  diff: { label: "Digit Differs", contract_type: "DIGITDIFF", needsBarrier: true },
  even: { label: "Digit Even", contract_type: "DIGITEVEN", needsBarrier: false },
  odd: { label: "Digit Odd", contract_type: "DIGITODD", needsBarrier: false }
};

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.getElementById("market");
const marketBotsSelect = document.getElementById("marketBots");
const digitDisplay = document.getElementById("digit");
const signalDisplay = document.getElementById("signal");
const digitStatsDisplay = document.getElementById("digitStats");
const digitLive = document.getElementById("digitLive");
const digitStatsLive = document.getElementById("digitStatsLive");
const analysisDigit = document.getElementById("analysisDigit");
const analysisResult = document.getElementById("analysisResult");
const botGrid = document.getElementById("botGrid");
const botBarrier = document.getElementById("botBarrier");
const scanBtn = document.getElementById("scanBtn");
const scanResult = document.getElementById("scanResult");
const loadScanBtn = document.getElementById("loadScanBtn");

const patToken = document.getElementById("patToken");
const rememberToken = document.getElementById("rememberToken");
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
const depositBtn = document.getElementById("depositBtn");
const withdrawBtn = document.getElementById("withdrawBtn");
const topupBtn = document.getElementById("topupBtn");
const walletStatus = document.getElementById("walletStatus");

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
let selectedBot = "over";
let pendingTrade = null;
let scanBestResult = null;
let scanReqCounter = 1000;
const scanPending = {};
const ALL_SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"];
const HISTORY_LENGTH = 500;

try {
  const savedToken = localStorage.getItem("trademate_pat");
  if (savedToken && patToken) {
    patToken.value = savedToken;
  }
} catch (e) {
  console.log("localStorage not available:", e);
}

if (rememberToken) {
  rememberToken.addEventListener("change", function () {
    if (!rememberToken.checked) {
      try { localStorage.removeItem("trademate_pat"); } catch (e) {}
    }
  });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

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
      return;
    }

    if (data.req_id && scanPending[data.req_id]) {
      const resolve = scanPending[data.req_id];
      delete scanPending[data.req_id];
      const digits = data.history ? data.history.prices.map(p => lastDigitOf(p)) : [];
      resolve(digits);
      return;
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
    renderSignal();
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
  renderSignal();
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

function findBestSignal(digits) {
  const total = digits.length;
  if (total === 0) return { type: null, barrier: null, label: "WAIT", pct: 0, deviation: 0 };

  const counts = new Array(10).fill(0);
  digits.forEach(d => counts[d]++);

  let best = { type: null, barrier: null, label: "WAIT", pct: 0, deviation: 0 };

  for (let d = 0; d <= 8; d++) {
    const actual = digits.filter(x => x > d).length / total;
    const dev = Math.abs(actual - (9 - d) / 10);
    if (dev > best.deviation) best = { type: "over", barrier: d, label: "OVER " + d, pct: actual, deviation: dev };
  }
  for (let d = 1; d <= 9; d++) {
    const actual = digits.filter(x => x < d).length / total;
    const dev = Math.abs(actual - d / 10);
    if (dev > best.deviation) best = { type: "under", barrier: d, label: "UNDER " + d, pct: actual, deviation: dev };
  }
  for (let d = 0; d <= 9; d++) {
    const actual = counts[d] / total;
    const dev = Math.abs(actual - 0.1);
    if (dev > best.deviation) best = { type: "match", barrier: d, label: "MATCH " + d, pct: actual, deviation: dev };
  }
  const evenActual = digits.filter(d => d % 2 === 0).length / total;
  if (Math.abs(evenActual - 0.5) > best.deviation) best = { type: "even", barrier: null, label: "EVEN", pct: evenActual, deviation: Math.abs(evenActual - 0.5) };
  const oddActual = 1 - evenActual;
  if (Math.abs(oddActual - 0.5) > best.deviation) best = { type: "odd", barrier: null, label: "ODD", pct: oddActual, deviation: Math.abs(oddActual - 0.5) };

  return best;
}

function renderSignal() {
  if (!signalDisplay) return;

  if (digitHistory.length < 20) {
    signalDisplay.textContent = "WAIT";
    return;
  }

  const best = findBestSignal(digitHistory);
  signalDisplay.textContent = best.deviation > 0.05 ? best.label + " (" + (best.pct * 100).toFixed(0) + "%)" : "WAIT";
}

function setStatus(message) {
  if (status) {
    status.textContent = message;
  }
}

function fetchHistoryFor(symbol) {
  return new Promise((resolve) => {
    const reqId = scanReqCounter++;
    scanPending[reqId] = resolve;
    socket.send(JSON.stringify({
      ticks_history: symbol,
      end: "latest",
      count: HISTORY_LENGTH,
      style: "ticks",
      req_id: reqId
    }));
  });
}

async function scanMarkets() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    scanResult.textContent = "Connect first";
    return;
  }

  scanBtn.disabled = true;
  loadScanBtn.style.display = "none";
  scanResult.textContent = "Scanning...";

  let overallBest = null;

  for (const sym of ALL_SYMBOLS) {
    scanResult.textContent = "Scanning " + sym + "...";
    const digits = await fetchHistoryFor(sym);
    const signal = findBestSignal(digits);
    if (!overallBest || signal.deviation > overallBest.signal.deviation) {
      overallBest = { symbol: sym, signal: signal };
    }
  }

  scanBestResult = overallBest;
  scanBtn.disabled = false;

  if (overallBest && overallBest.signal.deviation > 0.05) {
    scanResult.innerHTML = "Best: <b>" + overallBest.symbol + "</b> — " +
      overallBest.signal.label + " (" + (overallBest.signal.pct * 100).toFixed(0) + "%)";
    loadScanBtn.style.display = "block";
  } else {
    scanResult.textContent = "Nothing strong right now across any market";
  }
}

function loadScanResult() {
  if (!scanBestResult) return;

  marketSelect.value = scanBestResult.symbol;
  if (marketBotsSelect) marketBotsSelect.value = scanBestResult.symbol;
  subscribeToTicks(scanBestResult.symbol);

  selectBot(scanBestResult.signal.type);

  if (scanBestResult.signal.barrier !== null && botBarrier) {
    botBarrier.value = scanBestResult.signal.barrier;
  }

  const botsTab = document.querySelector('.tab-btn[data-tab="bots"]');
  if (botsTab) botsTab.click();
  }
