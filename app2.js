// Trade Mate — Live Deriv Synthetic Indices

const DERIV_WS = "wss://ws.binaryws.com/websockets/v3";

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.querySelector(".card select");

let socket;

function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}

function connectDeriv() {
  setStatus("Connecting...");

  socket = new WebSocket(DERIV_WS);

  socket.onopen = function () {
    setStatus("Connected");

    socket.send(JSON.stringify({
      active_symbols: "brief",
      product_type: "basic",
      req_id: 1
    }));
  };

  socket.onmessage = function (event) {
    const data = JSON.parse(event.data);

    if (data.error) {
      console.error(data.error);
      setStatus("API error");
      return;
    }

    if (data.msg_type === "active_symbols") {
      loadSyntheticIndices(data.active_symbols);
    }
  };

  socket.onerror = function () {
    setStatus("Connection error");
  };

  socket.onclose = function () {
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
        symbol.display_name ||
        symbol.underlying_symbol_name ||
        ""
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
    .sort((a, b) => {
      const nameA = a.display_name || a.underlying_symbol_name || "";
      const nameB = b.display_name || b.underlying_symbol_name || "";
      return nameA.localeCompare(nameB);
    });

  syntheticSymbols.forEach(symbol => {
    const option = document.createElement("option");

    option.value =
      symbol.symbol ||
      symbol.underlying_symbol;

    option.textContent =
      symbol.display_name ||
      symbol.underlying_symbol_name;

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
