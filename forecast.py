"""Focus forecast — TimesFM 2.5 with cold-start baseline."""
import argparse, json
from datetime import timedelta, date as date_t
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")  # Flask runs from worker threads — non-GUI backend required

TIMESFM_THRESHOLD = 14   # days of history required before switching from baseline
HISTORY_TARGET    = 14   # day-counter target shown in UI

# ----- model cache (so Flask reuses a compiled model across requests) -----
_model = None

def _load_model():
    global _model
    if _model is None:
        import torch, timesfm
        torch.set_float32_matmul_precision("high")
        m = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
        m.compile(timesfm.ForecastConfig(
            max_context=1024, max_horizon=64,
            normalize_inputs=True, use_continuous_quantile_head=True,
            force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=True,
        ))
        _model = m
    return _model


def _baseline(df: pd.DataFrame, horizon: int, fdates):
    """Weekday-mean baseline used while history < TIMESFM_THRESHOLD."""
    if df.empty:
        return [0.0]*horizon, [0.0]*horizon, [0.0]*horizon
    by_dow = df.groupby(df["date"].dt.weekday)["minutes"].mean()
    global_mean = float(df["minutes"].mean())
    sd = float(df["minutes"].std() or 15.0)
    pad = max(15.0, sd)
    p50 = [float(by_dow.get(d.weekday(), global_mean)) for d in fdates]
    p10 = [max(0.0, x - pad) for x in p50]
    p90 = [x + pad for x in p50]
    return p50, p10, p90


def _timesfm(series: np.ndarray, horizon: int):
    point, q = _load_model().forecast(horizon=horizon, inputs=[series.astype(np.float32)])
    return point[0].tolist(), q[0, :, 1].tolist(), q[0, :, 9].tolist()


def make_forecast(df: pd.DataFrame, horizon: int = 7) -> dict:
    df = df.sort_values("date").reset_index(drop=True)
    last = df["date"].iloc[-1] if not df.empty else pd.Timestamp(date_t.today())
    fdates = [last + timedelta(days=i + 1) for i in range(horizon)]

    if len(df) >= TIMESFM_THRESHOLD:
        mode = "timesfm"
        p50, p10, p90 = _timesfm(df["minutes"].to_numpy(), horizon)
    else:
        mode = "baseline"
        p50, p10, p90 = _baseline(df, horizon, fdates)

    return {
        "mode": mode,
        "history_count": int(len(df)),
        "history_target": HISTORY_TARGET,
        "history": [{"date": d.strftime("%Y-%m-%d"), "minutes": float(m)}
                    for d, m in zip(df["date"], df["minutes"])],
        "forecast": [{"date": d.strftime("%Y-%m-%d"),
                      "p10": float(p10[i]), "p50": float(p50[i]), "p90": float(p90[i])}
                     for i, d in enumerate(fdates)],
    }


def write_png(payload: dict, out_path: Path):
    import matplotlib.pyplot as plt
    df_h = pd.DataFrame(payload["history"])
    if not df_h.empty: df_h["date"] = pd.to_datetime(df_h["date"])
    df_f = pd.DataFrame(payload["forecast"])
    df_f["date"] = pd.to_datetime(df_f["date"])

    fig, ax = plt.subplots(figsize=(11, 5))
    if not df_h.empty:
        ax.plot(df_h["date"], df_h["minutes"], color="#4b5563", lw=1.4, label="history")
    ax.plot(df_f["date"], df_f["p50"], color="#2563eb", lw=2.2, marker="o",
            label=f"forecast · {payload['mode']}")
    ax.fill_between(df_f["date"], df_f["p10"], df_f["p90"], color="#2563eb", alpha=0.18, label="80% band")
    ax.set_title(f"Focus forecast — next {len(df_f)} days  ({payload['mode']})", fontsize=13, weight="bold")
    ax.set_ylabel("minutes/day"); ax.grid(alpha=0.25)
    ax.legend(loc="upper left", frameon=False); fig.autofmt_xdate(); fig.tight_layout()
    fig.savefig(out_path, dpi=140); plt.close(fig)


def run(csv_path: Path, horizon: int, out_dir: Path) -> dict:
    df = pd.read_csv(csv_path, parse_dates=["date"]) if csv_path.exists() else pd.DataFrame(columns=["date","minutes"])
    payload = make_forecast(df, horizon)
    (out_dir / "forecast.json").write_text(json.dumps(payload, indent=2))
    write_png(payload, out_dir / "forecast.png")
    return payload


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", type=Path)
    ap.add_argument("--horizon", type=int, default=7)
    ap.add_argument("--out", type=Path, default=Path("."))
    args = ap.parse_args()
    p = run(args.csv, args.horizon, args.out)
    print(f"mode={p['mode']} · history={p['history_count']}/{p['history_target']} · wrote forecast.png + forecast.json")
