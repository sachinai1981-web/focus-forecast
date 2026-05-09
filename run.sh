#!/usr/bin/env bash
# One-command daily start.
set -e
cd "$(dirname "$0")"
source .venv/bin/activate
python app.py &
APP_PID=$!
sleep 1
open "http://localhost:8765"
trap "kill $APP_PID 2>/dev/null" EXIT
wait $APP_PID
