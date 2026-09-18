// Trade Mate — frontend starter

const status = document.getElementById("status");
const connect = document.getElementById("connect");

if (connect) {
  connect.addEventListener("click", function (event) {
    event.preventDefault();

    alert(
      "Trade Mate is ready for the Deriv connection. " +
      "The secure OAuth connection will be activated after the website is published."
    );
  });
}

// Starter dashboard status
if (status) {
  status.textContent = "Not connected";
    }
