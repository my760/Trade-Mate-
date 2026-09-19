const DERIV_WS = "wss://ws.binaryws.com/websockets/v3";

const status = document.getElementById("status");
const connect = document.getElementById("connect");

function setStatus(text) {
  if (status) status.textContent = text;
}

function connectDeriv() {
  setStatus("Connecting...");

  const socket = new WebSocket(DERIV_WS);

  socket.onopen = () => {
    setStatus("Connected");

    socket.send(JSON.stringify({
      active_symbols: "brief",
      product_type: "basic",
      req_id: 1
    }));
  };

  socket.onmessage = (event) => {
    console.log("DERIV RESPONSE:", event.data);

    const data = JSON.parse(event.data);

    if (data.error) {
      setStatus("API ERROR: " + data.error.message);
      return;
    }

    if (data.msg_type === "active_symbols") {
      setStatus(
        "CONNECTED — " +
        data.active_symbols.length +
        " symbols"
      );

      console.log("ACTIVE SYMBOLS:", data.active_symbols);
    }
  };

  socket.onerror = (event) => {
    console.error("WEBSOCKET ERROR:", event);
    setStatus("WebSocket error");
  };

  socket.onclose = (event) => {
    console.log(
      "WEBSOCKET CLOSED:",
      event.code,
      event.reason
    );

    setStatus(
      "Disconnected (" +
      event.code +
      ")"
    );
  };
}

if (connect) {
  connect.addEventListener("click", (event) => {
    event.preventDefault();
    connectDeriv();
  });
}

setStatus("Not connected");
