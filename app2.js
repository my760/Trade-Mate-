const status = document.getElementById("status");
const connect = document.getElementById("connect");

let socket = null;

function connectDeriv() {
  setStatus("Connecting...");

  socket = new WebSocket(
    "wss://ws.binaryws.com/websockets/v3?app_id=1089"
  );

  socket.onopen = function () {
    setStatus("Connected");
  };

  socket.onerror = function () {
    setStatus("WebSocket error");
  };

  socket.onclose = function (event) {
    setStatus("Disconnected");
    console.log("WebSocket closed:", event.code, event.reason);
  };
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

setStatus("Not connected");
