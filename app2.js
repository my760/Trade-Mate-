window.onerror = function (msg) {
  document.getElementById("status").textContent = "JS Error: " + msg;
};

const APP_ID = "34qc7VTAO1l6XjqsL06jn";

const status = document.getElementById("status");
const connect = document.getElementById("connect");
const marketSelect = document.getElementById("market");
const contractSelect = document.getElementById("contract");
const digitDisplay = document.getElementById("digit");
const signalDisplay = document.getElementById("signal");
const digitStatsDisplay = document.getElementById("digitStats");

const patToken = document.getElementById("patToken");
const accountType = document.getElementById("accountType");
const authBtn = document.getElementById("authBtn");
const accountStatus = document.getElementById("accountStatus");
const balanceDisplay = document.getElementById("balance");
const stakeAmount = document.getElementById("stakeAmount");
const barrierDigit = document.getElementById("barrierDigit");
const ticksDuration = document.getElementById("ticksDuration");
const buyBtn = document.getElementById("buyBtn");
const tradeStatus = document.getElementById("tradeStatus");
const tradeHistoryDisplay = document.getElementById("tradeHistory");

let socket = null;
let authSocket = null;
let currentSymbol = null;
let digitHistory = [];
let accounts = {};
let trades = []; // { contractId, symbol, contractType, stake, barrier, status, profit }
const HISTORY_LENGTH = 500;

// ---------- Public tick socket ----------

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

  socket.send(JSON.stringify({
    ticks_history: symbol,
    end: "latest",
    count: HISTORY_LENGTH,
    style: "ticks"
  }));

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

// ---------- Authenticated account + trading ----------

async function authenticate() {
  const token = patToken.value.trim();
  if (!token) {
    accountStatus.textContent = "Enter your API token first";
    return;
  }

  accountStatus.textContent = "Fetching accounts...";

  try {
    const res = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: {
        "Authorization": "Bearer " + token,
        "Deriv-App-ID": APP_ID
      }
    });
    const data = await res.json();

    if (!res.ok) {
      accountStatus.textContent = "Auth error: " + (data.errors ? data.errors[0].message : res.status);
      return;
    }

    accounts = {};
    (data.data || []).forEach(acc => {
      accounts[acc.account_type] = acc.account_id;
    });

    accountStatus.textContent = "Found: " + Object.keys(accounts).join(", ");
    await connectAuthSocket();
  } catch (e) {
    accountStatus.textContent = "Auth failed: " + e.message;
  }
}

async function connectAuthSocket() {
  const type = accountType.value;
  const accId = accounts[type];

  if (!accId) {
    accountStatus.textContent = "No " + type + " account found on your login";
    return;
  }

  const token = patToken.value.trim();

  try {
    const otpRes = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts/" + accId + "/otp",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Deriv-App-ID": APP_ID
        }
      }
    );
    const otpData = await otpRes.json();

    if (!otpRes.ok) {
      accountStatus.textContent = "OTP error: " + (otpData.errors ? otpData.errors[0].message : otpRes.status);
      return;
    }

    const wsUrl = otpData.data.url;

    if (authSocket) authSocket.close();
    authSocket = new WebSocket(wsUrl);

    authSocket.onopen = function () {
      accountStatus.textContent = "Trading ready (" + type + ")";
      authSocket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    };

    authSocket.onerror = function () {
      accountStatus.textContent = "Trading connection error";
    };

    authSocket.onclose = function (event) {
      accountStatus.textContent = "Trading connection closed (" + event.code + ")";
    };

    authSocket.onmessage = function (event) {
      const data = JSON.parse(event.data);
      console.log("Auth message:", data);

      if (data.error) {
        tradeStatus.textContent = "Error: " + data.error.message;
        return;
      }

      if (data.msg_type === "balance" && data.balance) {
        balanceDisplay.textContent = data.balance.balance + " " + data.balance.currency;
      }

      if (data.msg_type === "buy" && data.buy) {
        const contractId = data.buy.contract_id;
        tradeStatus.textContent = "Bought! Contract ID: " + contractId;

        trades.unshift({
          contractId: contractId,
          symbol: marketSelect.value,
          contractType: contractSelect.value,
          stake: parseFloat(stakeAmount.value),
          status: "open",
          profit: null
        });
        renderTradeHistory();

        authSocket.send(JSON.stringify({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1
        }));
      }

      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        const trade = trades.find(t => t.contractId === contract.contract_id);
        if (trade) {
          const profit = parseFloat(contract.profit);
          trade.profit = profit;
          if (contract.is_sold) {
            trade.status = profit >= 0 ? "won" : "lost";
          } else {
            trade.status = "open";
          }
          renderTradeHistory();
        }
      }
    };
  } catch (e) {
    accountStatus.textContent = "Connection failed: " + e.message;
  }
}

function renderTradeHistory() {
  if (!tradeHistoryDisplay) return;

  if (trades.length === 0) {
    tradeHistoryDisplay.textContent = "No trades yet";
    return;
  }

  tradeHistoryDisplay.innerHTML = trades.slice(0, 20).map(t => {
    const label = t.status === "open" ? "OPEN" : (t.status === "won" ? "WON" : "LOST");
    const profitText = t.profit !== null ? (t.profit >= 0 ? "+" : "") + t.profit.toFixed(2) : "—";
    return "<div>" + t.symbol + " " + t.contractType + " | stake " + t.stake + " | " + label + " (" + profitText + ")</div>";
  }).join("");
}

function placeTrade() {
  if (!authSocket || authSocket.readyState !== WebSocket.OPEN) {
    tradeStatus.textContent = "Not authenticated yet";
    return;
  }

  const contractType = contractSelect.value;
  const symbol = marketSelect.value;
  const stake = parseFloat(stakeAmount.value);
  const ticks = parseInt(ticksDuration.value, 10);

  const parameters = {
    amount: stake,
    basis: "stake",
    contract_type: contractType,
    currency: "USD",
    duration: ticks,
    duration_unit: "t",
    underlying_symbol: symbol
  };

  if (["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(contractType)) {
    parameters.barrier = barrierDigit.value;
  }

  const request = {
    buy: "1",
    price: stake.toString(),
    parameters: parameters
  };

  tradeStatus.textContent = "Placing trade...";
  authSocket.send(JSON.stringify(request));
}

// ---------- Event listeners ----------

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

if (authBtn) {
  authBtn.addEventListener("click", function (event) {
    event.preventDefault();
    authenticate();
  });
}

if (accountType) {
  accountType.addEventListener("change", function () {
    if (Object.keys(accounts).length > 0) {
      connectAuthSocket();
    }
  });
}

if (buyBtn) {
  buyBtn.addEventListener("click", function (event) {
    event.preventDefault();
    placeTrade();
  });
}

setStatus("Not connected");
