// Trade Mate — Live Deriv Synthetic Indices

const DERIV_WS =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.querySelector(".card select");

let socket;

function setStatus(text) {
  if (status) status.textContent = text;
}

function connectDeriv() {
  setStatus("Connecting...");

  socket = new WebSocket(DERIV_WS);

  socket.onopen = function () {
    setStatus("Connected");

    socket.send(JSON.stringify({
      active_symbols: "brief",
      req_id: 1
    }));
  };

  socket.onmessage = function (event) {
    const data = JSON.parse(event.data);

    console.log("Deriv:", data);

    if (data.error) {
      setStatus("API error");
      console.error(data.error);
      return;
    }

    if (data.msg_type === "active_symbols") {
      loadSyntheticIndices(data.active_symbols);
    }
  };

  socket.onerror = function (event) {
    console.error("WebSocket error:", event);
    setStatus("Connection error");
  };

  socket.onclose = function (event) {
    console.log("WebSocket closed:", event.code, event.reason);
    setStatus("Disconnected");
  };
}

function loadSyntheticIndices(symbols) {
  if (!marketSelect) return;

  marketSelect.innerHTML = "";

  const syntheticSymbols = symbols
    .filter(symbol => {
      const market = (symbol.market || "").toLowerCase();
      const name = (
        symbol.underlying_symbol_name || ""
      ).toLowerCase();

      return (
        market === "synthetic_index" ||
        name.includes("volatility") ||
        name.includes("jump") ||
        name.includes("step") ||
        name.includes("drift") ||
        name.includes("range break") ||
        name.includes("crash") ||
        name.includes("boom")
      );
    })
    .sort((a, b) =>
      (a.underlying_symbol_name || "").localeCompare(
        b.underlying_symbol_name || ""
      )
    );

  syntheticSymbols.forEach(symbol => {
    const option = document.createElement("option");

    option.value = symbol.underlying_symbol;
    option.textContent = symbol.underlying_symbol_name;

    marketSelect.appendChild(option);
  });

  setStatus(`Connected • ${syntheticSymbols.length} indices`);
}

if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectDeriv();
    }
  });
}

setStatus("Not connected");
