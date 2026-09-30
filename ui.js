/* ===== Extra UI logic for new design ===== */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = document.getElementById("tab-" + btn.dataset.tab);
    if (panel) panel.classList.add("active");
  });
});

/* AI button opens Scanner tab */
document.querySelector(".ai-fab")?.addEventListener("click", function () {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="scanner"]')?.classList.add("active");
  document.getElementById("tab-scanner")?.classList.add("active");
});

/* Update digit circles from stats */
function updateDigitCircles(counts, total, lastDigit) {
  if (!total || total < 1) return;
  for (let d = 0; d <= 9; d++) {
    const pct = ((counts[d] || 0) / total * 100).toFixed(1);
    const el = document.getElementById("pct" + d);
    if (el) el.textContent = pct + "%";
    const item = document.querySelector('.digit-item[data-d="' + d + '"]');
    if (item) {
      const circle = item.querySelector(".digit-circle");
      if (circle) {
        circle.classList.toggle("active", d === lastDigit);
      }
      item.classList.toggle("hot", d === lastDigit);
    }
  }
  updateAnalysisHint();
}

/* Sequence display — follows the selected trade type */
function updateDigitSeq(history) {
  const seq = document.getElementById("digitSeq");
  if (!seq || !history || !history.length) return;

  const typeEl = document.getElementById("analysisTradeType");
  const type = typeEl ? typeEl.value : "evenodd";
  const barrierEl = document.getElementById("analysisBarrier");
  const barrier = barrierEl ? parseInt(barrierEl.value, 10) : 5;
  const last = history.slice(-8);

  seq.innerHTML = last.map(d => {
    let letter, cls;
    if (type === "overunder") {
      if (d > barrier) { letter = "O"; cls = "even"; }
      else if (d < barrier) { letter = "U"; cls = "odd"; }
      else { letter = "="; cls = "tie"; }
    } else if (type === "matchdiff") {
      if (d === barrier) { letter = "M"; cls = "even"; }
      else { letter = "D"; cls = "odd"; }
    } else {
      if (d % 2 === 0) { letter = "E"; cls = "even"; }
      else { letter = "O"; cls = "odd"; }
    }
    return '<div class="seq-box ' + cls + '">' + letter + '</div>';
  }).join("");
}

/* Analysis Trade Type → update buttons + hint */
function refreshAnalysisUI() {
  const typeEl = document.getElementById("analysisTradeType");
  const type = typeEl ? typeEl.value : "evenodd";
  const btnA = document.getElementById("btnSideA");
  const btnB = document.getElementById("btnSideB");
  const barrierRow = document.getElementById("analysisBarrierRow");

  if (!btnA || !btnB) return;

  if (type === "evenodd") {
    btnA.textContent = "Even";
    btnB.textContent = "Odd";
    btnA.className = "btn btn-teal";
    btnB.className = "btn btn-red";
    if (barrierRow) barrierRow.style.display = "none";
  } else if (type === "overunder") {
    btnA.textContent = "Over";
    btnB.textContent = "Under";
    btnA.className = "btn btn-teal";
    btnB.className = "btn btn-red";
    if (barrierRow) barrierRow.style.display = "block";
  } else {
    btnA.textContent = "Match";
    btnB.textContent = "Differ";
    btnA.className = "btn btn-teal";
    btnB.className = "btn btn-red";
    if (barrierRow) barrierRow.style.display = "block";
  }
  updateAnalysisHint();
  if (typeof digitHistory !== "undefined") updateDigitSeq(digitHistory);
}

function updateAnalysisHint() {
  const hint = document.getElementById("analysisHint");
  const btnA = document.getElementById("btnSideA");
  const btnB = document.getElementById("btnSideB");
  const typeEl = document.getElementById("analysisTradeType");
  const type = typeEl ? typeEl.value : "evenodd";
  const barrierEl = document.getElementById("analysisBarrier");
  const barrier = barrierEl ? parseInt(barrierEl.value, 10) : 5;

  if (typeof digitHistory === "undefined" || !digitHistory || digitHistory.length < 10) {
    if (hint) hint.textContent = "Waiting for ticks...";
    if (btnA) {
      if (type === "evenodd") btnA.textContent = "Even";
      else if (type === "overunder") btnA.textContent = "Over";
      else btnA.textContent = "Match";
    }
    if (btnB) {
      if (type === "evenodd") btnB.textContent = "Odd";
      else if (type === "overunder") btnB.textContent = "Under";
      else btnB.textContent = "Differ";
    }
    return;
  }

  const total = digitHistory.length;
  let pctA = 0, pctB = 0, labelA = "", labelB = "";

  if (type === "evenodd") {
    const even = digitHistory.filter(d => d % 2 === 0).length;
    pctA = (even / total) * 100;
    pctB = 100 - pctA;
    labelA = "Even";
    labelB = "Odd";
  } else if (type === "overunder") {
    const over = digitHistory.filter(d => d > barrier).length;
    const under = digitHistory.filter(d => d < barrier).length;
    pctA = (over / total) * 100;
    pctB = (under / total) * 100;
    labelA = "Over " + barrier;
    labelB = "Under " + barrier;
  } else {
    const match = digitHistory.filter(d => d === barrier).length;
    pctA = (match / total) * 100;
    pctB = 100 - pctA;
    labelA = "Match " + barrier;
    labelB = "Differ " + barrier;
  }

  if (btnA) btnA.textContent = labelA + "  " + pctA.toFixed(1) + "%";
  if (btnB) btnB.textContent = labelB + "  " + pctB.toFixed(1) + "%";
  if (hint) hint.textContent = "Based on last " + total + " ticks";
}

document.getElementById("analysisTradeType")?.addEventListener("change", refreshAnalysisUI);
document.getElementById("analysisBarrier")?.addEventListener("input", function () {
  updateAnalysisHint();
  if (typeof digitHistory !== "undefined") updateDigitSeq(digitHistory);
});

refreshAnalysisUI();

/* Scanner result display helper */
function showScanResult(marketName, side, pct) {
  const box = document.getElementById("scanResult");
  const old = document.getElementById("scanResultOld");
  if (box) {
    box.style.display = "block";
    document.getElementById("scanBestMarket").textContent = marketName;
    const sideEl = document.getElementById("scanBestSide");
    sideEl.textContent = side;
    sideEl.className = "best-side " + (side.toLowerCase() === "even" || side.toLowerCase() === "over" || side.toLowerCase().indexOf("match") === 0 ? "even" : "odd");
    document.getElementById("scanBestPct").textContent = "Probability: " + pct + "%";
  }
  if (old) old.style.display = "none";
  const loadBtn = document.getElementById("loadScanBtn");
  if (loadBtn) loadBtn.style.display = "block";
}

/* Analysis buttons → PLACE TRADE */
function placeAnalysisTrade(side) {
  const statusEl = document.getElementById("tradeStatus");

  if (typeof authSocket === "undefined" || !authSocket || authSocket.readyState !== WebSocket.OPEN) {
    if (statusEl) statusEl.textContent = "Authenticate first (Dashboard → token → Authenticate)";
    return;
  }

  const typeEl = document.getElementById("analysisTradeType");
  const type = typeEl ? typeEl.value : "evenodd";
  const barrierEl = document.getElementById("analysisBarrier");
  const barrier = barrierEl ? barrierEl.value : "5";
  const symbol = document.getElementById("market")?.value || "R_100";
  const stake = parseFloat(document.getElementById("stakeAmount")?.value || "0.5");
  const ticks = parseInt(document.getElementById("ticksDuration")?.value || "1", 10);

  let contractType = "DIGITEVEN";
  let needsBarrier = false;
  let label = "";

  if (type === "evenodd") {
    contractType = side === "A" ? "DIGITEVEN" : "DIGITODD";
    label = side === "A" ? "Even" : "Odd";
  } else if (type === "overunder") {
    contractType = side === "A" ? "DIGITOVER" : "DIGITUNDER";
    needsBarrier = true;
    label = (side === "A" ? "Over " : "Under ") + barrier;
  } else {
    contractType = side === "A" ? "DIGITMATCH" : "DIGITDIFF";
    needsBarrier = true;
    label = (side === "A" ? "Match " : "Differ ") + barrier;
  }

  const parameters = {
    amount: stake,
    basis: "stake",
    contract_type: contractType,
    currency: "USD",
    duration: ticks,
    duration_unit: "t",
    underlying_symbol: symbol
  };
  if (needsBarrier) parameters.barrier = barrier;

  if (typeof pendingTrade !== "undefined") {
    pendingTrade = { contract_type: contractType, barrier: needsBarrier ? barrier : null };
  }

  authSocket.send(JSON.stringify({
    buy: "1",
    price: stake.toString(),
    parameters: parameters
  }));

  if (statusEl) statusEl.textContent = "Trade placed: " + label + " · $" + stake + " · " + ticks + " tick(s)";
  const dot = document.getElementById("botStatusDot");
  if (dot) dot.classList.add("live");
}

document.getElementById("btnSideA")?.addEventListener("click", function () {
  placeAnalysisTrade("A");
});
document.getElementById("btnSideB")?.addEventListener("click", function () {
  placeAnalysisTrade("B");
});
  
