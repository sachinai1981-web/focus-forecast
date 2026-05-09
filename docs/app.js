/* Focus Forecast — pure-static app. State in localStorage. Baseline forecast in JS. */
const HIST_KEY = 'focus.history.v1';
const TIMER_KEY = 'focus.timer.v1';
const CATEGORIES = [
  { id: 'deep',     name: 'Deep work', color: '#FF805D' },
  { id: 'coding',   name: 'Coding',    color: '#332B24' },
  { id: 'reading',  name: 'Reading',   color: '#FFC84A' },
  { id: 'writing',  name: 'Writing',   color: '#B09E8E' },
  { id: 'meetings', name: 'Meetings',  color: '#C9B59A' },
  { id: 'other',    name: 'Other',     color: '#5C4F45' },
];
const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const HISTORY_TARGET = 14;
const HORIZON = 7;

const $ = id => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const round = n => Math.round(n);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dayOfWeek = iso => new Date(iso + 'T00:00:00').getDay(); // 0=Sun
const isFiniteNum = n => Number.isFinite(n);

/* ── Storage ────────────────────────────────── */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch { return []; }
}
function saveHistory(rows) { localStorage.setItem(HIST_KEY, JSON.stringify(rows)); }

function addMinutes(date, minutes, category) {
  const rows = loadHistory();
  rows.push({ date, minutes: round(minutes * 100) / 100, category: category || 'deep' });
  saveHistory(rows);
}
function setMinutes(date, minutes, category) {
  let rows = loadHistory().filter(r => !(r.date === date && r.category === (category || 'deep')));
  rows.push({ date, minutes: round(minutes * 100) / 100, category: category || 'deep' });
  saveHistory(rows);
}
function clearAll() { localStorage.removeItem(HIST_KEY); localStorage.removeItem(TIMER_KEY); }

/* ── Aggregations ────────────────────────────────── */
function aggregateByDate(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.date, (map.get(r.date) || 0) + r.minutes);
  return [...map.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([date, minutes]) => ({ date, minutes }));
}
function aggregateByCategory(rows, fromIso) {
  const map = new Map(CATEGORIES.map(c => [c.id, 0]));
  for (const r of rows) if (!fromIso || r.date >= fromIso) map.set(r.category, (map.get(r.category) || 0) + r.minutes);
  return CATEGORIES.map(c => ({ ...c, minutes: map.get(c.id) || 0 }));
}
function todayTotal(rows) { return rows.filter(r => r.date === todayISO()).reduce((s, r) => s + r.minutes, 0); }

/* ── Baseline forecast ──────────────────────────────
   Per-day p50 = mean of same weekday across last 4 weeks (or all available if fewer).
   p10/p90 = ±max(15, stddev) on top.
   When fewer than 7 days exist, use the global mean. Empty history = zeros.
*/
function baselineForecast(daily, horizon = HORIZON) {
  const last = daily.length ? daily[daily.length - 1].date : todayISO();
  const dates = Array.from({ length: horizon }, (_, i) => addDays(last, i + 1));
  if (daily.length === 0) {
    return { mode: 'baseline', dates, p10: dates.map(_ => 0), p50: dates.map(_ => 0), p90: dates.map(_ => 0) };
  }
  const minutes = daily.map(d => d.minutes);
  const globalMean = minutes.reduce((a,b)=>a+b,0) / minutes.length;
  const stddev = Math.sqrt(minutes.reduce((s,m)=> s + (m - globalMean)**2, 0) / minutes.length) || 15;
  const pad = Math.max(15, stddev);

  // weekday lookup of last 28 days
  const recent = daily.slice(-28);
  const byDow = new Map();
  for (const r of recent) {
    const k = dayOfWeek(r.date);
    if (!byDow.has(k)) byDow.set(k, []);
    byDow.get(k).push(r.minutes);
  }
  const dowMean = k => {
    const arr = byDow.get(k);
    if (!arr || arr.length < 1) return globalMean;
    return arr.reduce((a,b)=>a+b,0) / arr.length;
  };
  const p50 = dates.map(d => dowMean(dayOfWeek(d)));
  const p10 = p50.map(v => Math.max(0, v - pad));
  const p90 = p50.map(v => v + pad);
  return { mode: 'baseline', dates, p10, p50, p90 };
}

/* ── Render ────────────────────────────────── */
let chart;
function paintMode(daily) {
  const pill = $('modePill');
  if (daily.length >= HISTORY_TARGET) { pill.textContent = 'Baseline'; pill.className = 'pill'; }
  else { pill.textContent = `Day ${daily.length} / ${HISTORY_TARGET}`; pill.className = 'pill warn'; }
}
function paintKPIs(daily, fc) {
  const today = { p50: fc.p50[0], p10: fc.p10[0], p90: fc.p90[0], date: fc.dates[0] };
  $('kpiToday').firstChild.textContent = round(today.p50);
  $('kpiTodayDate').textContent = fmtDate(today.date) + ' · 80% band ' + round(today.p10) + '–' + round(today.p90);
  const total = fc.p50.reduce((s, v) => s + v, 0);
  $('kpiTotal').firstChild.textContent = round(total);
  $('kpiTotalHours').textContent = (total/60).toFixed(1);
  if (daily.length === 0) {
    $('kpiPrior').firstChild.textContent = '0';
    $('kpiPriorDelta').textContent = 'no history yet';
  } else {
    const last7 = daily.slice(-7).reduce((s, r) => s + r.minutes, 0);
    $('kpiPrior').firstChild.textContent = round(last7);
    const delta = total - last7;
    $('kpiPriorDelta').innerHTML = 'vs 7-day forecast: <b style="color:' + (delta>=0?'#2D8F4E':'#B73E2A') + '">' + (delta>=0?'+':'') + round(delta) + ' min</b>';
  }
}
function paintCategories(rows) {
  const fromIso = addDays(todayISO(), -6);
  const cats = aggregateByCategory(rows, fromIso);
  const total = cats.reduce((s, c) => s + c.minutes, 0);
  const grid = $('catBreakdown');
  if (total === 0) { grid.innerHTML = '<p class="muted">No focus blocks logged in the last 7 days yet. Hit start.</p>'; return; }
  grid.innerHTML = cats
    .filter(c => c.minutes > 0)
    .sort((a,b) => b.minutes - a.minutes)
    .map(c => {
      const pct = total > 0 ? Math.round((c.minutes / total) * 100) : 0;
      return `<div class="cat-tile" style="--cat-color:${c.color}">
        <span class="sub">${c.name}</span>
        <span class="num">${round(c.minutes)}<span class="unit"> min</span></span>
        <span class="sub" style="color:${c.color}">${pct}% · last 7 days</span>
      </div>`;
    }).join('');
}
function paintChart(daily, fc) {
  const labels = daily.map(r => r.date).concat(fc.dates);
  const histLen = daily.length;
  let histY, p50Y, p10Y, p90Y;
  if (histLen === 0) {
    histY = []; p50Y = fc.p50; p10Y = fc.p10; p90Y = fc.p90;
  } else {
    const pad = Array(histLen - 1).fill(null);
    const last = daily[histLen - 1].minutes;
    histY = daily.map(r => r.minutes).concat(Array(fc.dates.length).fill(null));
    p50Y = pad.concat([last]).concat(fc.p50);
    p10Y = pad.concat([last]).concat(fc.p10);
    p90Y = pad.concat([last]).concat(fc.p90);
  }
  const cs = getComputedStyle(document.documentElement);
  const coral = cs.getPropertyValue('--coral').trim();
  const warmGrey = cs.getPropertyValue('--warm-grey').trim();
  const ruleC = '#5C4F45';
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'p10', data: p10Y, borderWidth: 0, pointRadius: 0, fill: false, tension: 0.25 },
      { label: '80% band', data: p90Y, borderWidth: 0, pointRadius: 0,
        backgroundColor: 'rgba(255, 128, 93, 0.18)', fill: '-1', tension: 0.25 },
      { label: 'history', data: histY, borderColor: warmGrey, borderWidth: 1.6, pointRadius: 2, pointBackgroundColor: warmGrey, tension: 0.25, fill: false },
      { label: 'forecast (p50)', data: p50Y, borderColor: coral, borderWidth: 2.6, pointRadius: 3, pointBackgroundColor: coral, tension: 0.25, fill: false },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { filter: i => i.text !== 'p10', color: warmGrey, font: { family: 'Inter', size: 12 }, boxWidth: 14 }, position: 'top', align: 'end' },
        tooltip: { callbacks: { title: ctx => fmtDate(ctx[0].label), label: ctx => ctx.dataset.label === 'p10' ? null : `${ctx.dataset.label}: ${round(ctx.parsed.y)} min` } }
      },
      scales: {
        x: { grid: { color: ruleC, drawTicks: false }, ticks: { color: warmGrey, autoSkipPadding: 22, callback: function(v) { return fmtDate(this.getLabelForValue(v)); } } },
        y: { grid: { color: ruleC }, ticks: { color: warmGrey, callback: v => v + 'm' }, beginAtZero: true }
      }
    }
  });
}

function refreshAll() {
  const rows = loadHistory();
  const daily = aggregateByDate(rows);
  const fc = baselineForecast(daily);
  paintMode(daily);
  paintKPIs(daily, fc);
  paintCategories(rows);
  paintChart(daily, fc);
  $('tToday').textContent = `${round(todayTotal(rows))} min`;
}

/* ── Timer state machine ────────────────────────────────── */
const T = (() => {
  const ARC_LEN = 2 * Math.PI * 92;
  let state = {
    phase: 'focus', status: 'idle', session: 1,
    focusMs: 25*60*1000, breakMs: 5*60*1000,
    total: 25*60*1000, remaining: 25*60*1000, lastTick: 0,
    category: 'deep',
  };
  let wakeLock = null;

  function save() { localStorage.setItem(TIMER_KEY, JSON.stringify(state)); }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); if (s) state = { ...state, ...s }; } catch {}
    if (state.status === 'running') {
      const now = Date.now();
      state.remaining = Math.max(0, state.remaining - (now - state.lastTick));
      state.lastTick = now;
      if (state.remaining === 0) state.status = 'paused'; // never auto-complete on restore
    }
  }
  const fmtTime = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  };

  function paint() {
    $('tTime').textContent = fmtTime(state.remaining);
    $('tPhase').textContent = state.phase === 'focus' ? 'Focus' : 'Break';
    $('tPhase').className = 'phase ' + state.phase;
    $('tRing').classList.toggle('break', state.phase === 'break');
    $('tSession').textContent = state.phase === 'focus'
      ? `Session ${state.session} · ${state.status === 'running' ? 'in progress' : state.status === 'paused' ? 'paused' : 'ready when you are'}`
      : `Break · session ${state.session} done`;
    $('tSub').textContent = state.status === 'running' ? 'running' : state.status === 'paused' ? 'paused' : 'tap start';
    $('tStart').textContent = state.status === 'running' ? 'Pause' : (state.status === 'paused' ? 'Resume' : 'Start');
    const pct = state.total > 0 ? state.remaining / state.total : 0;
    $('tArc').setAttribute('stroke-dasharray', ARC_LEN);
    $('tArc').setAttribute('stroke-dashoffset', ARC_LEN * (1 - pct));
    $('tCategory').value = state.category;
    document.title = state.status === 'running'
      ? `${fmtTime(state.remaining)} · ${state.phase} · Focus Forecast`
      : 'Focus, measured with meaning — Focus Forecast';
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.6);
    } catch {}
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }

  function notify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: 'icon-192.png', tag: 'focus-forecast' }); } catch {}
    }
  }
  function maybeRequestNotificationPerm() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }

  function logSession(minutes) {
    if (minutes < 0.5) return;
    addMinutes(todayISO(), minutes, state.category);
    refreshAll();
  }

  function complete() {
    state.status = 'idle';
    if (state.phase === 'focus') {
      logSession(state.focusMs / 60000);
      notify('Focus block done', `${state.focusMs/60000} min logged · ${CAT_BY_ID[state.category]?.name || 'Focus'}`);
      state.phase = 'break'; state.total = state.breakMs; state.remaining = state.breakMs;
    } else {
      notify('Break over', 'Ready for the next focus block.');
      state.phase = 'focus'; state.session += 1; state.total = state.focusMs; state.remaining = state.focusMs;
    }
    releaseWakeLock();
    beep(); save(); paint();
  }

  let tickHandle = null;
  function tick() {
    if (state.status !== 'running') return;
    const now = Date.now();
    state.remaining = Math.max(0, state.remaining - (now - state.lastTick));
    state.lastTick = now;
    if (state.remaining === 0) { complete(); return; }
    save(); paint();
  }
  function startTicker() { if (tickHandle) clearInterval(tickHandle); tickHandle = setInterval(tick, 250); }

  function start() {
    if (state.status === 'running') {
      state.status = 'paused';
      releaseWakeLock();
    } else {
      state.lastTick = Date.now();
      state.status = 'running';
      startTicker();
      acquireWakeLock();
      maybeRequestNotificationPerm();
    }
    save(); paint();
  }
  function skip() {
    if (state.phase === 'focus' && state.status !== 'idle') {
      const elapsedMs = state.total - state.remaining;
      logSession(elapsedMs / 60000);
    }
    state.status = 'idle';
    releaseWakeLock();
    if (state.phase === 'focus') {
      state.phase = 'break'; state.total = state.breakMs; state.remaining = state.breakMs;
    } else {
      state.phase = 'focus'; state.session += 1; state.total = state.focusMs; state.remaining = state.focusMs;
    }
    save(); paint();
  }
  function reset() {
    state.status = 'idle';
    releaseWakeLock();
    state.total = state.phase === 'focus' ? state.focusMs : state.breakMs;
    state.remaining = state.total;
    save(); paint();
  }
  function applySettings() {
    const f = Math.max(1, Math.min(120, parseInt($('tFocusMin').value, 10) || 25)) * 60000;
    const b = Math.max(1, Math.min(60,  parseInt($('tBreakMin').value, 10) || 5))  * 60000;
    state.focusMs = f; state.breakMs = b;
    if (state.status === 'idle') {
      state.total = state.phase === 'focus' ? f : b;
      state.remaining = state.total;
    }
    save(); paint();
  }
  function setCategory(id) { state.category = id; save(); paint(); }

  function bind() {
    $('tStart').addEventListener('click', start);
    $('tSkip').addEventListener('click', skip);
    $('tReset').addEventListener('click', reset);
    $('tFocusMin').addEventListener('change', applySettings);
    $('tBreakMin').addEventListener('change', applySettings);
    $('tCategory').addEventListener('change', e => setCategory(e.target.value));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.status === 'running') {
        // re-acquire wake lock if browser dropped it
        acquireWakeLock();
      }
    });
  }

  return { init: () => { load(); bind(); paint(); if (state.status === 'running') { startTicker(); acquireWakeLock(); } } };
})();

/* ── Manual log + import/export ────────────────────────────────── */
function bindLog() {
  $('logDate').valueAsDate = new Date();
  $('logSaveBtn').addEventListener('click', () => {
    const m = parseFloat($('logMinutes').value);
    const d = $('logDate').value || todayISO();
    const cat = $('tCategory').value;
    if (!isFiniteNum(m) || m < 0) return;
    setMinutes(d, m, cat);
    $('logMinutes').value = '';
    refreshAll();
  });
  $('exportBtn').addEventListener('click', () => {
    const rows = loadHistory();
    const csv = ['date,minutes,category', ...rows.map(r => `${r.date},${r.minutes},${r.category}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `focus-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    const rows = text.trim().split(/\r?\n/).slice(1).map(line => {
      const [date, minutes, category] = line.split(',');
      return { date, minutes: parseFloat(minutes), category: category || 'deep' };
    }).filter(r => r.date && isFiniteNum(r.minutes));
    saveHistory(rows);
    refreshAll();
  });
  $('clearBtn').addEventListener('click', () => {
    if (confirm('Clear all logged history? This cannot be undone.')) { clearAll(); refreshAll(); location.reload(); }
  });
}

/* ── Boot ────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // wait for Chart.js (loaded with defer)
  const boot = () => { refreshAll(); T.init(); bindLog(); };
  if (window.Chart) boot(); else window.addEventListener('load', boot);
});
