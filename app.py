"""Daily focus app — log minutes, get forecast, beat it."""
from datetime import date, datetime
from pathlib import Path

import pandas as pd
from flask import Flask, request, jsonify, send_from_directory

import forecast as fc

ROOT = Path(__file__).parent
CSV  = ROOT / "focus.csv"

app = Flask(__name__, static_folder=None)


def _read() -> pd.DataFrame:
    if not CSV.exists() or CSV.stat().st_size == 0:
        return pd.DataFrame(columns=["date", "minutes"])
    return pd.read_csv(CSV, parse_dates=["date"])


def _write(df: pd.DataFrame):
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df = df.sort_values("date").reset_index(drop=True)
    df.to_csv(CSV, index=False, date_format="%Y-%m-%d")


def _refresh() -> dict:
    return fc.run(CSV, horizon=7, out_dir=ROOT)


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:fname>")
def static_file(fname):
    if (ROOT / fname).is_file():
        return send_from_directory(ROOT, fname)
    return ("not found", 404)


@app.post("/log")
def log_entry():
    body = request.get_json(force=True)
    minutes = float(body.get("minutes", 0))
    if minutes < 0 or minutes > 1440:
        return jsonify(error="minutes must be 0..1440"), 400
    d = pd.Timestamp(body.get("date") or date.today().isoformat())

    df = _read()
    if body.get("add"):
        existing = float(df.loc[df["date"] == d, "minutes"].sum()) if not df.empty else 0.0
        minutes = existing + minutes
    df = df[df["date"] != d]                      # upsert by date
    df = pd.concat([df, pd.DataFrame([{"date": d, "minutes": minutes}])], ignore_index=True)
    _write(df)

    payload = _refresh()
    return jsonify(ok=True, logged={"date": d.strftime("%Y-%m-%d"), "minutes": minutes}, **payload)


@app.get("/data")
def data():
    return jsonify(_refresh())


if __name__ == "__main__":
    if not CSV.exists():
        CSV.write_text("date,minutes\n")
    _refresh()                                    # warm forecast.json/png on boot
    print(f"\nFocus forecast → http://localhost:8765\n")
    app.run(host="127.0.0.1", port=8765, debug=False)
