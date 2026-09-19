// Trade Mate — Live Deriv Synthetic Indices

const DERIV_WS =
  "wss://ws.binaryws.com/websockets/v3?app_id=34qc7VTA0116XjqsL06jn";

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.querySelector(".card select");

let socket = null;

function setStatus(message) {
  if (status) {
    status.textContent = message;
  }
}

function connectDeriv() {
  // Close any previous connection
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
  }

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
    try {
      const data = JSON.parse(event.data);

      console.log("Deriv response:", data);

      if (data.error) {
        setStatus("API Error");
        console.error(data.error);
        return;
      }

      if (data.msg_type === "active_symbols") {
        loadSyntheticIndices(data.active_symbols);
      }
    } catch (error) {
      console.error("Response error:", error);
      setStatus("Response error");
    }
  };

  socket.onerror = function (error) {
    console.error("WebSocket error:", error);
    setStatus("Connection error");
  };

  socket.onclose = function (event) {
    console.log(
      "WebSocket closed. Code:",
      event.code,
      "Reason:",
      event.reason
    );

    setStatus("Disconnected");
  };
}

function loadSyntheticIndices(symbols) {
  if (!marketSelect) return;

  marketSelect.innerHTML = "";

  const syntheticIndices = symbols
    .filter(function (item) {
      const market = String(item.market || "").toLowerCase();

      const name = String(
        item.display_name ||
        item.underlying_symbol_name ||
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
    .sort(function (a, b) {
      const nameA =
        a.display_name ||
        a.underlying_symbol_name ||
        "";

      const nameB =
        b.display_name ||
        b.underlying_symbol_name ||
        "";

      return nameA.localeCompare(nameB);
    });

  syntheticIndices.forEach(function (item) {
    const option = document.createElement("option");

    option.value =
      item.symbol ||
      item.underlying_symbol ||
      "";

    option.textContent =
      item.display_name ||
      item.underlying_symbol_name ||
      item.symbol ||
      "Unknown";

    marketSelect.appendChild(option);
  });

  setStatus(
    "Connected • " +
    syntheticIndices.length +
    " indices"
  );
}

if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();
    connectDeriv();
  });
}

setStatus("Not connected");
