// Trade Mate — Deriv Live Market Data

const DERIV_WS = "wss://ws.binaryws.com/websockets/v3";

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
    console.log("DERIV:", event.data);

    const data = JSON.parse(event.data);

    if (data.error) {
      setStatus("API: " + data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      const symbols = data.active_symbols || [];

      marketSelect.innerHTML = "";

      const synthetic = symbols.filter(function (item) {
        const name = String(
          item.display_name ||
          item.underlying_symbol_name ||
          ""
        ).toLowerCase();

        const market = String(
          item.market || ""
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
      });

      synthetic.sort(function (a, b) {
        return String(
          a.display_name ||
          a.underlying_symbol_name ||
          ""
        ).localeCompare(
          String(
            b.display_name ||
            b.underlying_symbol_name ||
            ""
          )
        );
      });

      synthetic.forEach(function (item) {
        const option = document.createElement("option");

        option.value =
          item.symbol ||
          item.underlying_symbol ||
          "";

        option.textContent =
          item.display_name ||
          item.underlying_symbol_name ||
          "";

        marketSelect.appendChild(option);
      });

      setStatus("Connected • " + synthetic.length + " indices");
    }
  };

  socket.onerror = function () {
    setStatus("WebSocket error");
  };

  socket.onclose = function (event) {
    setStatus(
      "Closed: " +
      event.code +
      (event.reason ? " • " + event.reason : "")
    );
  };
}

if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();
    connectDeriv();
  });
}

setStatus("Not connected");
