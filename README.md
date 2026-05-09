# Focus Forecast

> A Pomodoro tracker that forecasts how much you'll focus tomorrow — then dares you to beat the line.

**Live app:** [sachinai1981-web.github.io/focus-forecast](https://sachinai1981-web.github.io/focus-forecast/)

Two modes, one CSV format:

- **Web mode** — pure-static PWA. Installable to iPhone/Android home screen, runs offline, browser-local storage. Weekday-mean baseline forecast in JS. *This is what the public URL serves.*
- **Deep mode** — local Python + Flask + Google TimesFM 2.5 (200M-param decoder transformer). Same dashboard shape, smarter forecast. Runs on your laptop.

---

## Web mode (the public app)

What's in the box:

- Pomodoro timer — focus / break, configurable lengths, persists across refresh
- Per-category logging — deep work, coding, reading, writing, meetings, other
- 7-day baseline forecast with 80% confidence band
- Per-category breakdown (last 7 days)
- "Beat the forecast" KPIs — today's predicted minutes, 7-day total, trailing actual
- CSV import/export
- PWA — install to home screen, works offline, screen Wake Lock when timer is running, completion notifications when permission granted

Design system: **Verretta** (Glossy Coral on Dark Taupe + Inter + Cormorant Garamond italic accents).

### Run web mode locally
```bash
cd docs
python3 -m http.server 8765
open http://localhost:8765
```

---

## Deep mode (local, with TimesFM)

When you want the full Google TimesFM 2.5 forecast on your accumulated history:

```bash
# one-time setup
python3.12 -m venv .venv
source .venv/bin/activate
pip install "git+https://github.com/google-research/timesfm.git" pandas matplotlib flask torch

# daily start
./run.sh                      # boots Flask + opens local dashboard at http://localhost:8765
```

Or as a CLI:
```bash
python forecast.py focus.csv --horizon 7   # writes forecast.png + forecast.json
```

Deep mode auto-switches between baseline (days 1–13) and TimesFM (day 14+).

---

## CSV format

```
date,minutes,category
2026-05-08,95,deep
2026-05-08,30,coding
2026-05-09,60,reading
```

Web mode tracks per-category rows. Deep mode aggregates by date.

---

## Architecture

```
focus-forecast/
├── docs/                    pure-static deploy → GitHub Pages
│   ├── index.html         brand: Verretta. mobile-first. PWA wired.
│   ├── style.css          design tokens
│   ├── app.js             timer + forecast + storage + categories
│   ├── manifest.webmanifest
│   ├── service-worker.js  offline cache
│   ├── icon-192.png       PWA icons
│   ├── icon-512.png
│   ├── llms.txt           AI agent discoverability
│   └── .well-known/agent.json
│
├── app.py                 deep-mode Flask backend
├── forecast.py            deep-mode forecast (baseline + TimesFM)
├── index.html             deep-mode dashboard (Flask serves this)
├── run.sh                 deep-mode one-command start
├── focus.sample.csv       60-day synthetic demo data
└── CLAUDE.md              project doc for Claude Code agents
```

---

## Why this exists

I wanted to know how much focus I'd actually get tomorrow before the day started — and turn it into a number to beat. Same psychology as Google Maps' ETA. Once a number's on screen, falling short feels like a loss, not a missed bonus. Loss aversion stacked on anchoring.

The deep mode uses **Google TimesFM 2.5** — a foundation model trained on 100B+ time-series data points. Zero-shot forecasting: it pattern-matches your daily focus minutes against the millions of weekly cycles, trends, and seasonal shapes it saw in pretraining. No fine-tuning required.

---

## Brand: Verretta

The visual system is adapted from a brand identity studied via [@denny.kurien on TikTok](https://www.tiktok.com/@denny.kurien) — Verretta's columned-temple mark, coral-on-taupe hero combo, vertical stripe motif, circled-number section markers. The mark in this repo uses the *grammar* (three columns + base) but is not Verretta's actual trademarked icon.

Palette: Glossy Coral `#FF805D` · Dark Taupe `#332B24` · Warm Grey `#E1DBD6` · Golden Yellow `#FFC84A`.

---

## License

MIT. Use it, fork it, ship it.
