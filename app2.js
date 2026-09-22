window.onerror = function (msg) {
  document.getElementById("status").textContent = "JS Error: " + msg;
};

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.getElementById("market");
const contractSelect = document.getElementById("contract");
const digitDisplay = document.getElementById("digit");
const signalDisplay = document.getElementById("signal");
const digitStatsDisplay = document.getElementById("digitStats");

let socket = null;
let currentSymbol = null;
let digitHistory = [];
const HISTORY_LENGTH = 500;

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
      marketSelect.innerHTML = "";
      data.active_symbols
        .filter(s => s.market === "synthetic_index")
        .forEach(s => {
          const opt = document.createElement("option");
          opt.value = s.underlying_symbol;
          opt.textContent = s.underlying_symbol_name;
          marketSelect.appendChild(opt);
        });
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

  // one-time backfill of the last 500 ticks
  socket.send(JSON.stringify({
    ticks_history: symbol,
    end: "latest",
    count: HISTORY_LENGTH,
    style: "ticks",
    subscribe: 0
  }));

  // then start the live stream
  socket.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
}

function lastDigitOf(price) {
  const str = price.toString();
  return parseInt(str[str.length - 1], 10);
}

function updateDigit(quote) {
  const lastDigit = lastDigitOf(quote);
  digitDisplay.textContent = lastDigit;

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
    return;
  }

  const counts = new Array(10).fill(0);
  digitHistory.forEach(d => counts[d]++);

  const line = counts
    .map((c, digit) => digit + ":" + c)
    .join("  ");

  digitStatsDisplay.textContent = "(" + digitHistory.length + " ticks) " + line;
}

function setStatus(message) {
  if (status) {
    status.textContent = message;
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
    if (socket && socket.readyState === WebSocket.OPEN) {
      subscribeToTicks(marketSelect.value);
    }
  });
}

setStatus("Not connected");
