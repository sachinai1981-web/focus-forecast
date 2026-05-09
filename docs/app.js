/* Focus Forecast — pure-static app. State in localStorage. Baseline forecast in JS. */
const HIST_KEY = "focus.history.v1";
const TIMER_KEY = "focus.timer.v1";
const ONBOARDED_KEY = "focus.onboarded.v1";
const GOAL_KEY = "focus.goal.v1";
const PUSH_SUB_KEY = "focus.push.sub.v1";
const PUSH_WORKER_URL = ""; // set this to your deployed Cloudflare Worker URL to enable push
const CATEGORIES = [
  { id: "deep", name: "Deep work", color: "#FF805D" },
  { id: "coding", name: "Coding", color: "#332B24" },
  { id: "reading", name: "Reading", color: "#FFC84A" },
  { id: "writing", name: "Writing", color: "#B09E8E" },
  { id: "meetings", name: "Meetings", color: "#C9B59A" },
  { id: "other", name: "Other", color: "#5C4F45" },
];
const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const HISTORY_TARGET = 14;
const HORIZON = 7;
const STREAK_FOIL_THRESHOLD = 7;

const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const round = (n) => Math.round(n);
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayOfWeek = (iso) => new Date(iso + "T00:00:00").getDay();
const isFiniteNum = (n) => Number.isFinite(n);
const reduceMotion = () =>
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* tweenNumber — smooth digit roll. Updates the FIRST text node so unit spans stay intact. */
function tweenNumber(el, to, duration = 600) {
  if (!el) return;
  const node =
    el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el;
  const fromText = String(node.textContent || "0").replace(/[^\d.\-]/g, "");
  const from = parseFloat(fromText) || 0;
  to = Number(to) || 0;
  if (reduceMotion() || Math.abs(to - from) < 0.5 || duration <= 0) {
    node.textContent = String(round(to));
    return;
  }
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // cubic-out
    node.textContent = String(round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* triggerBurst — coral particle ring + card pulse. Used on goal-met. */
function triggerBurst(card) {
  if (!card || reduceMotion()) return;
  card.classList.remove("burst");
  void card.offsetWidth;
  card.classList.add("burst");
  const burst = document.createElement("div");
  burst.className = "particles";
  for (let i = 0; i < 10; i++) {
    const p = document.createElement("span");
    p.style.setProperty("--angle", (i / 10) * 360 + "deg");
    p.style.setProperty("--dist", 40 + Math.random() * 28 + "px");
    p.style.animationDelay = Math.random() * 80 + "ms";
    burst.appendChild(p);
  }
  card.appendChild(burst);
  setTimeout(() => {
    card.classList.remove("burst");
    burst.remove();
  }, 1400);
}

/* ── Storage ────────────────────────────────── */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHistory(rows) {
  localStorage.setItem(HIST_KEY, JSON.stringify(rows));
}
function addMinutes(date, minutes, category) {
  const rows = loadHistory();
  rows.push({
    date,
    minutes: round(minutes * 100) / 100,
    category: category || "deep",
  });
  saveHistory(rows);
}
function setMinutes(date, minutes, category) {
  let rows = loadHistory().filter(
    (r) => !(r.date === date && r.category === (category || "deep")),
  );
  rows.push({
    date,
    minutes: round(minutes * 100) / 100,
    category: category || "deep",
  });
  saveHistory(rows);
}
function clearAll() {
  [HIST_KEY, TIMER_KEY, ONBOARDED_KEY, GOAL_KEY, PUSH_SUB_KEY].forEach((k) =>
    localStorage.removeItem(k),
  );
}
function getGoal() {
  return parseInt(localStorage.getItem(GOAL_KEY) || "240", 10);
}
function setGoal(v) {
  localStorage.setItem(GOAL_KEY, String(v));
}

/* ── Aggregations ────────────────────────────────── */
function aggregateByDate(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.date, (map.get(r.date) || 0) + r.minutes);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, minutes]) => ({ date, minutes }));
}
function aggregateByCategory(rows, fromIso) {
  const map = new Map(CATEGORIES.map((c) => [c.id, 0]));
  for (const r of rows)
    if (!fromIso || r.date >= fromIso)
      map.set(r.category, (map.get(r.category) || 0) + r.minutes);
  return CATEGORIES.map((c) => ({ ...c, minutes: map.get(c.id) || 0 }));
}
function todayTotal(rows) {
  return rows
    .filter((r) => r.date === todayISO())
    .reduce((s, r) => s + r.minutes, 0);
}

/* ── Forecast (weekday-mean baseline) ──────────────────────────── */
function baselineForecast(daily, horizon = HORIZON) {
  const last = daily.length ? daily[daily.length - 1].date : todayISO();
  const dates = Array.from({ length: horizon }, (_, i) => addDays(last, i + 1));
  if (daily.length === 0) {
    return {
      mode: "baseline",
      dates,
      p10: dates.map((_) => 0),
      p50: dates.map((_) => 0),
      p90: dates.map((_) => 0),
    };
  }
  const minutes = daily.map((d) => d.minutes);
  const globalMean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const stddev =
    Math.sqrt(
      minutes.reduce((s, m) => s + (m - globalMean) ** 2, 0) / minutes.length,
    ) || 15;
  const pad = Math.max(15, stddev);
  const recent = daily.slice(-28);
  const byDow = new Map();
  for (const r of recent) {
    const k = dayOfWeek(r.date);
    if (!byDow.has(k)) byDow.set(k, []);
    byDow.get(k).push(r.minutes);
  }
  const dowMean = (k) => {
    const arr = byDow.get(k);
    if (!arr || arr.length < 1) return globalMean;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  };
  const p50 = dates.map((d) => dowMean(dayOfWeek(d)));
  const p10 = p50.map((v) => Math.max(0, v - pad));
  const p90 = p50.map((v) => v + pad);
  return { mode: "baseline", dates, p10, p50, p90 };
}

/* ── Streak / Personal best ──────────────────────────── */
function expectedForDate(daily, dateIso) {
  // Same logic as baseline but for an arbitrary historical date — use the prior 28-day window of THAT date.
  const priorWindow = daily.filter((r) => r.date < dateIso).slice(-28);
  if (priorWindow.length === 0) return null;
  const sameDow = priorWindow.filter(
    (r) => dayOfWeek(r.date) === dayOfWeek(dateIso),
  );
  if (sameDow.length >= 1)
    return sameDow.reduce((s, r) => s + r.minutes, 0) / sameDow.length;
  return priorWindow.reduce((s, r) => s + r.minutes, 0) / priorWindow.length;
}

function computeStreak(daily) {
  // Walk backwards from yesterday. Count consecutive days where actual >= expected.
  // Today counts only if it already meets the bar (otherwise we don't punish a day in progress).
  let streak = 0;
  const dates = daily.map((r) => r.date);
  // Build a quick map
  const map = new Map(daily.map((r) => [r.date, r.minutes]));
  let cursor = todayISO();
  // Skip today if not yet meeting expected — keep yesterday's streak alive
  const todayActual = map.get(cursor) || 0;
  const todayExp = expectedForDate(daily, cursor);
  if (todayExp !== null && todayActual >= todayExp) {
    streak += 1;
  }
  cursor = addDays(cursor, -1);

  for (let i = 0; i < 366; i++) {
    if (!map.has(cursor)) break;
    const exp = expectedForDate(daily, cursor);
    if (exp === null) break;
    if (map.get(cursor) >= exp) streak += 1;
    else break;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function computePersonalBest(rows, daily) {
  if (!rows.length) return { bestBlock: null, bestDay: null };
  const bestBlockRow = rows.slice().sort((a, b) => b.minutes - a.minutes)[0];
  const bestDayRow = daily.slice().sort((a, b) => b.minutes - a.minutes)[0];
  return {
    bestBlock: bestBlockRow
      ? {
          minutes: bestBlockRow.minutes,
          date: bestBlockRow.date,
          category: bestBlockRow.category,
        }
      : null,
    bestDay: bestDayRow
      ? { minutes: bestDayRow.minutes, date: bestDayRow.date }
      : null,
  };
}

/* ── Render ────────────────────────────────── */
let chart;
function paintMode(daily) {
  const pill = $("modePill");
  if (daily.length >= HISTORY_TARGET) {
    pill.textContent = "Baseline";
    pill.className = "pill";
  } else {
    pill.textContent = `Day ${daily.length} / ${HISTORY_TARGET}`;
    pill.className = "pill warn";
  }
}
function paintKPIs(daily, fc) {
  const today = {
    p50: fc.p50[0],
    p10: fc.p10[0],
    p90: fc.p90[0],
    date: fc.dates[0],
  };
  tweenNumber($("kpiToday"), today.p50);
  $("kpiTodayDate").textContent =
    fmtDate(today.date) +
    " · 80% band " +
    round(today.p10) +
    "–" +
    round(today.p90);
  const total = fc.p50.reduce((s, v) => s + v, 0);
  tweenNumber($("kpiTotal"), total);
  $("kpiTotalHours").textContent = (total / 60).toFixed(1);
  if (daily.length === 0) {
    tweenNumber($("kpiPrior"), 0, 0);
    $("kpiPriorDelta").textContent = "no history yet";
  } else {
    const last7 = daily.slice(-7).reduce((s, r) => s + r.minutes, 0);
    tweenNumber($("kpiPrior"), last7);
    const delta = total - last7;
    $("kpiPriorDelta").innerHTML =
      'vs 7-day forecast: <b style="color:' +
      (delta >= 0 ? "#2D8F4E" : "#B73E2A") +
      '">' +
      (delta >= 0 ? "+" : "") +
      round(delta) +
      " min</b>";
  }
}
function paintStreakAndPB(rows, daily) {
  const streak = computeStreak(daily);
  const sNum = $("streakNum");
  const sCard = $("streakCard");
  const sFoot = $("streakFoot");
  const sValue = sNum.parentElement;
  const oldStreak = parseInt(sNum.textContent || "0", 10) || 0;
  // Flip animation only on actual change (not on initial paint or when unchanged)
  if (oldStreak !== streak && oldStreak > 0 && !reduceMotion()) {
    sValue.classList.remove("flip");
    void sValue.offsetWidth;
    sValue.classList.add("flip");
  }
  tweenNumber(sNum, streak, 800);
  if (streak >= STREAK_FOIL_THRESHOLD) {
    sCard.classList.add("foil");
    sFoot.textContent = `${streak} days unbroken — copper-foil tier`;
  } else {
    sCard.classList.remove("foil");
    if (daily.length === 0) sFoot.textContent = "log a session to start";
    else if (streak === 0) sFoot.textContent = "start a new chain today";
    else
      sFoot.textContent = `${streak} day${streak === 1 ? "" : "s"} and counting — beat today's line to extend`;
  }
  const pb = computePersonalBest(rows, daily);
  if (pb.bestBlock) {
    tweenNumber($("pbBlock"), pb.bestBlock.minutes);
    tweenNumber($("pbDay"), pb.bestDay ? pb.bestDay.minutes : 0);
    const cat = CAT_BY_ID[pb.bestBlock.category]?.name || "session";
    $("pbFoot").textContent = `${cat} · ${fmtDate(pb.bestBlock.date)}`;
  } else {
    $("pbBlock").textContent = "—";
    $("pbDay").textContent = "—";
    $("pbFoot").textContent = "no records yet";
  }
}
function paintGoal(rows) {
  const goal = getGoal();
  $("goalMin").value = goal;
  const today = todayTotal(rows);
  const pct = goal > 0 ? Math.min(100, (today / goal) * 100) : 0;
  $("goalBar").style.width = pct + "%";
  const bar = $("goalBar").parentElement;
  if (today >= goal && goal > 0) {
    bar.classList.add("met");
    $("goalFoot").innerHTML =
      `<b>met</b> · ${round(today)} of ${goal} min today`;
    // Burst once per day, only when crossing the threshold for the first time today
    const burstKey = `focus.goal-burst.${todayISO()}`;
    if (!localStorage.getItem(burstKey)) {
      localStorage.setItem(burstKey, "1");
      const card = $("goalMin").closest(".card");
      triggerBurst(card);
      try {
        navigator.vibrate && navigator.vibrate([120, 60, 120]);
      } catch {}
    }
  } else {
    bar.classList.remove("met");
    $("goalFoot").textContent =
      goal > 0
        ? `${round(today)} of ${goal} min · ${round(goal - today)} to go`
        : "set a target";
  }
}
function paintCategories(rows) {
  const fromIso = addDays(todayISO(), -6);
  const cats = aggregateByCategory(rows, fromIso);
  const total = cats.reduce((s, c) => s + c.minutes, 0);
  const grid = $("catBreakdown");
  if (total === 0) {
    grid.innerHTML =
      '<p class="muted">No focus blocks logged in the last 7 days yet. Hit start.</p>';
    return;
  }
  grid.innerHTML = cats
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .map((c) => {
      const pct = total > 0 ? Math.round((c.minutes / total) * 100) : 0;
      return `<div class="cat-tile" style="--cat-color:${c.color}">
        <span class="sub">${c.name}</span>
        <span class="num">${round(c.minutes)}<span class="unit"> min</span></span>
        <span class="sub" style="color:${c.color}">${pct}% · last 7 days</span>
      </div>`;
    })
    .join("");
}
function paintChart(daily, fc) {
  const labels = daily.map((r) => r.date).concat(fc.dates);
  const histLen = daily.length;
  let histY, p50Y, p10Y, p90Y;
  if (histLen === 0) {
    histY = [];
    p50Y = fc.p50;
    p10Y = fc.p10;
    p90Y = fc.p90;
  } else {
    const pad = Array(histLen - 1).fill(null);
    const last = daily[histLen - 1].minutes;
    histY = daily
      .map((r) => r.minutes)
      .concat(Array(fc.dates.length).fill(null));
    p50Y = pad.concat([last]).concat(fc.p50);
    p10Y = pad.concat([last]).concat(fc.p10);
    p90Y = pad.concat([last]).concat(fc.p90);
  }
  const cs = getComputedStyle(document.documentElement);
  const coral = cs.getPropertyValue("--coral").trim();
  const warmGrey = cs.getPropertyValue("--warm-grey").trim();
  const ruleC = "#5C4F45";
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "p10",
          data: p10Y,
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          tension: 0.25,
        },
        {
          label: "80% band",
          data: p90Y,
          borderWidth: 0,
          pointRadius: 0,
          backgroundColor: "rgba(255, 128, 93, 0.18)",
          fill: "-1",
          tension: 0.25,
        },
        {
          label: "history",
          data: histY,
          borderColor: warmGrey,
          borderWidth: 1.6,
          pointRadius: 2,
          pointBackgroundColor: warmGrey,
          tension: 0.25,
          fill: false,
        },
        {
          label: "forecast (p50)",
          data: p50Y,
          borderColor: coral,
          borderWidth: 2.6,
          pointRadius: 3,
          pointBackgroundColor: coral,
          tension: 0.25,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 600 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            filter: (i) => i.text !== "p10",
            color: warmGrey,
            font: { family: "Inter", size: 12 },
            boxWidth: 14,
          },
          position: "top",
          align: "end",
        },
        tooltip: {
          callbacks: {
            title: (ctx) => fmtDate(ctx[0].label),
            label: (ctx) =>
              ctx.dataset.label === "p10"
                ? null
                : `${ctx.dataset.label}: ${round(ctx.parsed.y)} min`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: ruleC, drawTicks: false },
          ticks: {
            color: warmGrey,
            autoSkipPadding: 22,
            callback: function (v) {
              return fmtDate(this.getLabelForValue(v));
            },
          },
        },
        y: {
          grid: { color: ruleC },
          ticks: { color: warmGrey, callback: (v) => v + "m" },
          beginAtZero: true,
        },
      },
    },
  });
}

function refreshAll() {
  const rows = loadHistory();
  const daily = aggregateByDate(rows);
  const fc = baselineForecast(daily);
  paintMode(daily);
  paintKPIs(daily, fc);
  paintStreakAndPB(rows, daily);
  paintGoal(rows);
  paintCategories(rows);
  paintChart(daily, fc);
  $("tToday").textContent = `${round(todayTotal(rows))} min`;
}

/* ── Theme color (status bar) ────────────────────────── */
function setThemeColor(c) {
  const el = $("metaThemeColor");
  if (el) el.setAttribute("content", c);
}

/* ── Timer state machine ────────────────────────────────── */
const T = (() => {
  const ARC_LEN = 2 * Math.PI * 92;
  const LH_ARC_LEN = 2 * Math.PI * 18;
  let state = {
    phase: "focus",
    status: "idle",
    session: 1,
    focusMs: 25 * 60 * 1000,
    breakMs: 5 * 60 * 1000,
    longBreakMs: 15 * 60 * 1000,
    total: 25 * 60 * 1000,
    remaining: 25 * 60 * 1000,
    lastTick: 0,
    category: "deep",
    completedFocus: 0,
    longBreaksOn: true,
  };
  let wakeLock = null;

  function save() {
    localStorage.setItem(TIMER_KEY, JSON.stringify(state));
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(TIMER_KEY) || "null");
      if (s) state = { ...state, ...s };
    } catch {}
    if (state.status === "running") {
      const now = Date.now();
      state.remaining = Math.max(0, state.remaining - (now - state.lastTick));
      state.lastTick = now;
      if (state.remaining === 0) state.status = "paused";
    }
  }
  const fmtTime = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  function nextBreakMs() {
    return state.longBreaksOn &&
      state.completedFocus > 0 &&
      state.completedFocus % 4 === 0
      ? state.longBreakMs
      : state.breakMs;
  }

  function paint() {
    $("tTime").textContent = fmtTime(state.remaining);
    $("tPhase").textContent =
      state.phase === "focus"
        ? "Focus"
        : state.total === state.longBreakMs
          ? "Long break"
          : "Break";
    $("tPhase").className = "phase " + state.phase;
    $("tRing").classList.toggle("break", state.phase === "break");
    $("tSession").textContent =
      state.phase === "focus"
        ? `Session ${state.session} · ${state.status === "running" ? "in progress" : state.status === "paused" ? "paused" : "ready when you are"}`
        : `Break · session ${state.completedFocus} done${state.total === state.longBreakMs ? " · long break" : ""}`;
    $("tSub").textContent =
      state.status === "running"
        ? "running"
        : state.status === "paused"
          ? "paused"
          : "tap start";
    $("tStart").textContent =
      state.status === "running"
        ? "Pause"
        : state.status === "paused"
          ? "Resume"
          : "Start";
    const pct = state.total > 0 ? state.remaining / state.total : 0;
    $("tArc").setAttribute("stroke-dasharray", ARC_LEN);
    $("tArc").setAttribute("stroke-dashoffset", ARC_LEN * (1 - pct));
    $("tCategory").value = state.category;
    if ($("tLongBreaks")) $("tLongBreaks").checked = state.longBreaksOn;

    // Live header
    const lh = $("liveHeader");
    if (state.status === "running") {
      lh.classList.add("show");
      lh.setAttribute("aria-hidden", "false");
      $("lhTime").textContent = fmtTime(state.remaining);
      $("lhPhase").textContent =
        state.phase === "focus"
          ? "Focus"
          : state.total === state.longBreakMs
            ? "Long break"
            : "Break";
      $("lhCat").textContent = CAT_BY_ID[state.category]?.name || "Focus";
      $("lhArc").setAttribute("stroke-dashoffset", LH_ARC_LEN * (1 - pct));
      $("lhArc").setAttribute(
        "stroke",
        state.phase === "focus" ? "#FF805D" : "#7BC4A0",
      );
    } else {
      lh.classList.remove("show");
      lh.setAttribute("aria-hidden", "true");
    }

    // Theme color follows phase
    if (state.status === "running") {
      setThemeColor(state.phase === "focus" ? "#FF805D" : "#7BC4A0");
    } else {
      setThemeColor("#332B24");
    }

    document.title =
      state.status === "running"
        ? `${fmtTime(state.remaining)} · ${state.phase} · Focus Forecast`
        : "Focus, measured with meaning — Focus Forecast";
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.6);
    } catch {}
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch {}
  }

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch {}
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function notify(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      try {
        new Notification(title, {
          body,
          icon: "icon-192.png",
          tag: "focus-forecast",
        });
      } catch {}
    }
  }
  function maybeRequestNotificationPerm() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default")
      Notification.requestPermission().catch(() => {});
  }

  function logSession(minutes) {
    if (minutes < 0.5) return;
    addMinutes(todayISO(), minutes, state.category);
    refreshAll();
  }

  function complete() {
    state.status = "idle";
    if (state.phase === "focus") {
      logSession(state.focusMs / 60000);
      state.completedFocus += 1;
      notify(
        "Focus block done",
        `${state.focusMs / 60000} min logged · ${CAT_BY_ID[state.category]?.name || "Focus"}`,
      );
      vibrate([180, 80, 180]);
      const breakDur = nextBreakMs();
      state.phase = "break";
      state.total = breakDur;
      state.remaining = breakDur;
    } else {
      notify("Break over", "Ready for the next focus block.");
      vibrate([120]);
      state.phase = "focus";
      state.session += 1;
      state.total = state.focusMs;
      state.remaining = state.focusMs;
    }
    releaseWakeLock();
    beep();
    save();
    paint();
    // Ring flash on completion (white pulse + glow, 0.9s)
    const ring = $("tRing");
    if (ring && !reduceMotion()) {
      ring.classList.remove("flash");
      void ring.offsetWidth;
      ring.classList.add("flash");
      setTimeout(() => ring.classList.remove("flash"), 1000);
    }
  }

  let tickHandle = null;
  function tick() {
    if (state.status !== "running") return;
    const now = Date.now();
    state.remaining = Math.max(0, state.remaining - (now - state.lastTick));
    state.lastTick = now;
    if (state.remaining === 0) {
      complete();
      return;
    }
    save();
    paint();
  }
  function startTicker() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(tick, 250);
  }

  function start() {
    if (state.status === "running") {
      state.status = "paused";
      releaseWakeLock();
    } else {
      state.lastTick = Date.now();
      state.status = "running";
      startTicker();
      acquireWakeLock();
      maybeRequestNotificationPerm();
    }
    save();
    paint();
  }
  function skip() {
    if (state.phase === "focus" && state.status !== "idle") {
      const elapsedMs = state.total - state.remaining;
      logSession(elapsedMs / 60000);
      state.completedFocus += 1;
    }
    state.status = "idle";
    releaseWakeLock();
    if (state.phase === "focus") {
      const breakDur = nextBreakMs();
      state.phase = "break";
      state.total = breakDur;
      state.remaining = breakDur;
    } else {
      state.phase = "focus";
      state.session += 1;
      state.total = state.focusMs;
      state.remaining = state.focusMs;
    }
    save();
    paint();
  }
  function reset() {
    state.status = "idle";
    releaseWakeLock();
    state.total = state.phase === "focus" ? state.focusMs : nextBreakMs();
    state.remaining = state.total;
    save();
    paint();
  }
  function applySettings() {
    const f =
      Math.max(1, Math.min(120, parseInt($("tFocusMin").value, 10) || 25)) *
      60000;
    const b =
      Math.max(1, Math.min(60, parseInt($("tBreakMin").value, 10) || 5)) *
      60000;
    state.focusMs = f;
    state.breakMs = b;
    state.longBreaksOn = $("tLongBreaks") ? $("tLongBreaks").checked : true;
    if (state.status === "idle") {
      state.total = state.phase === "focus" ? f : nextBreakMs();
      state.remaining = state.total;
    }
    save();
    paint();
  }
  function setCategory(id) {
    state.category = id;
    save();
    paint();
  }

  function bind() {
    $("tStart").addEventListener("click", start);
    $("tSkip").addEventListener("click", skip);
    $("tReset").addEventListener("click", reset);
    $("tFocusMin").addEventListener("change", applySettings);
    $("tBreakMin").addEventListener("change", applySettings);
    $("tLongBreaks").addEventListener("change", applySettings);
    $("tCategory").addEventListener("change", (e) =>
      setCategory(e.target.value),
    );
    if ($("lhPause")) $("lhPause").addEventListener("click", start);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.status === "running")
        acquireWakeLock();
    });
  }

  return {
    init: () => {
      load();
      bind();
      paint();
      if (state.status === "running") {
        startTicker();
        acquireWakeLock();
      }
    },
  };
})();

/* ── Manual log + import/export ────────────────────────────────── */
function bindLog() {
  $("logDate").valueAsDate = new Date();
  $("logSaveBtn").addEventListener("click", () => {
    const m = parseFloat($("logMinutes").value);
    const d = $("logDate").value || todayISO();
    const cat = $("tCategory").value;
    if (!isFiniteNum(m) || m < 0) return;
    setMinutes(d, m, cat);
    $("logMinutes").value = "";
    refreshAll();
  });
  $("exportBtn").addEventListener("click", () => {
    const rows = loadHistory();
    const csv = [
      "date,minutes,category",
      ...rows.map((r) => `${r.date},${r.minutes},${r.category}`),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `focus-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = text
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => {
        const [date, minutes, category] = line.split(",");
        return {
          date,
          minutes: parseFloat(minutes),
          category: category || "deep",
        };
      })
      .filter((r) => r.date && isFiniteNum(r.minutes));
    saveHistory(rows);
    refreshAll();
  });
  $("clearBtn").addEventListener("click", () => {
    if (confirm("Clear all logged history? This cannot be undone.")) {
      clearAll();
      location.reload();
    }
  });
  $("goalMin").addEventListener("change", () => {
    const v = Math.max(0, Math.min(720, parseInt($("goalMin").value, 10) || 0));
    setGoal(v);
    refreshAll();
  });
}

/* ── Onboarding ────────────────────────────────── */
function maybeRunOnboarding() {
  if (localStorage.getItem(ONBOARDED_KEY) === "1") return;
  const ob = $("onboarding");
  ob.classList.add("show");
  ob.setAttribute("aria-hidden", "false");
  let step = 1;
  const dots = document.querySelectorAll(".ob-dots .dot");
  const steps = document.querySelectorAll(".ob-step");
  function show(s, dir = 1) {
    steps.forEach((el) => {
      const n = parseInt(el.dataset.step, 10);
      if (n === s) {
        el.classList.add("active");
        el.classList.remove("exit-left");
      } else if (n < s) {
        el.classList.remove("active");
        el.classList.add("exit-left");
      } else {
        el.classList.remove("active", "exit-left");
      }
    });
    dots.forEach((d, i) => d.classList.toggle("active", i === s - 1));
    $("obNext").textContent = s === 3 ? "Start focusing" : "Next";
  }
  function done() {
    localStorage.setItem(ONBOARDED_KEY, "1");
    ob.classList.remove("show");
    ob.setAttribute("aria-hidden", "true");
  }
  $("obSkip").addEventListener("click", done);
  $("obNext").addEventListener("click", () => {
    if (step >= 3) done();
    else {
      step += 1;
      show(step, 1);
    }
  });
  // Touch swipe — left to advance, right to go back
  let touchStartX = 0;
  ob.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
    },
    { passive: true },
  );
  ob.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) < 40) return;
      if (dx < 0 && step < 3) {
        step += 1;
        show(step, 1);
      } else if (dx > 0 && step > 1) {
        step -= 1;
        show(step, -1);
      }
    },
    { passive: true },
  );
  show(1);
}

/* ── Pull-to-refresh (mobile-only, fires when at scrollY=0 and dragged > 80px) ─ */
function bindPullToRefresh() {
  const ind = $("ptrIndicator");
  if (!ind || !("ontouchstart" in window)) return;
  let startY = 0,
    pulling = false,
    dy = 0;
  document.body.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY <= 1) {
        startY = e.touches[0].clientY;
        pulling = true;
        dy = 0;
      }
    },
    { passive: true },
  );
  document.body.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0 && dy < 200) {
        const progress = Math.min(1, dy / 100);
        ind.style.opacity = String(progress);
        ind.style.transform = `translateY(${Math.min(64, dy * 0.6)}px) scale(${0.6 + progress * 0.4}) rotate(${dy * 2}deg)`;
      }
    },
    { passive: true },
  );
  document.body.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;
    if (dy > 80) {
      ind.classList.add("refreshing");
      ind.style.opacity = "1";
      refreshAll();
      setTimeout(() => {
        ind.classList.remove("refreshing");
        ind.style.opacity = "";
        ind.style.transform = "";
      }, 700);
    } else {
      ind.style.opacity = "";
      ind.style.transform = "";
    }
  });
}

/* ── Push subscription (graceful — no-op if PUSH_WORKER_URL is empty) ────────────── */
async function bindPush() {
  if (
    !PUSH_WORKER_URL ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return;
  $("pushBtn").hidden = false;
  $("pushBtn").addEventListener("click", async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyRes = await fetch(`${PUSH_WORKER_URL}/vapid-public-key`);
        const { key } = await keyRes.json();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }
      await fetch(`${PUSH_WORKER_URL}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      localStorage.setItem(PUSH_SUB_KEY, "1");
      $("pushBtn").textContent = "Push enabled";
      $("pushBtn").disabled = true;
    } catch (e) {
      console.warn("push subscribe failed", e);
    }
  });
}
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* ── Boot ────────────────────────────────── */
window.addEventListener("DOMContentLoaded", () => {
  const boot = () => {
    refreshAll();
    T.init();
    bindLog();
    bindPush();
    bindPullToRefresh();
    maybeRunOnboarding();
    // Drop the .booting class to release skeleton-shimmer styling
    requestAnimationFrame(() => document.body.classList.remove("booting"));
  };
  if (window.Chart) boot();
  else window.addEventListener("load", boot);
});
