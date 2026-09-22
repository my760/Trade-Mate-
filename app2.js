window.onerror = function (msg) {
  document.getElementById("status").textContent = "JS Error: " + msg;
};

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.getElementById("market");
const contractSelect = document.getElementById("contract");
const digitDisplay = document.getElementById("digit");
const signalDisplay = document.getElementById("signal");

let socket = null;
let currentSymbol = null;

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
  socket.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
}

function updateDigit(quote) {
  const quoteStr = quote.toString();
  const lastDigit = quoteStr[quoteStr.length - 1];
  digitDisplay.textContent = lastDigit;
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
