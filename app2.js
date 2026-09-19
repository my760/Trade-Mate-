// Trade Mate — Live Deriv Synthetic Indices

const DERIV_APP_ID = "34qc7VTA0116XjqsL06jn";
const DERIV_WS = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.querySelector(".card select");

let socket;

// Show connection status
function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}

// Connect to Deriv
function connectDeriv() {
  setStatus("Connecting...");

  socket = new WebSocket(DERIV_WS);

  socket.onopen = function () {
    setStatus("Connected");

    // Ask Deriv for all available symbols
    socket.send(JSON.stringify({
      active_symbols: "brief",
      product_type: "basic"
    }));
  };

  socket.onmessage = function (event) {
    const data = JSON.parse(event.data);

    if (data.error) {
      console.error(data.error);
      setStatus("Connection error");
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

// Put live symbols into the dropdown
function loadSyntheticIndices(symbols) {
  if (!marketSelect) return;

  marketSelect.innerHTML = "";

  const syntheticSymbols = symbols
    .filter(symbol => {
      const market = (symbol.market || "").toLowerCase();
      const display = (symbol.display_name || "").toLowerCase();

      return (
        market === "synthetic_index" ||
        display.includes("volatility") ||
        display.includes("jump") ||
        display.includes("step") ||
        display.includes("drift") ||
        display.includes("range break")
      );
    })
    .sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );

  syntheticSymbols.forEach(symbol => {
    const option = document.createElement("option");

    option.value = symbol.symbol;
    option.textContent = symbol.display_name;

    marketSelect.appendChild(option);
  });

  if (syntheticSymbols.length > 0) {
    setStatus(`Connected • ${syntheticSymbols.length} indices`);
  } else {
    setStatus("No indices found");
  }
}

// Connect button
if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectDeriv();
    }
  });
}

// Initial status
setStatus("Not connected");
