#!/usr/bin/env python3
"""
fetch-from-backend.py — pull Cairn telemetry sessions from the backend MySQL.

Usage:
    python fetch-from-backend.py --backend https://server --api-key KEY --output ./sessions/
    python fetch-from-backend.py --backend https://server --api-key KEY --since 2026-05-19

Behavior:
    - Lists all sessions newer than --since
    - Downloads each session's raw_jsonl into ./sessions/{session_id}.jsonl
    - Skips already-downloaded sessions unless --force is given
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install -r scripts/requirements.txt")
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", required=True, help="Backend base URL (e.g. https://api.example)")
    parser.add_argument("--api-key", required=True, help="X-API-Key value")
    parser.add_argument("--since", help="ISO date (YYYY-MM-DD) — only sessions newer")
    parser.add_argument("--output", default="./sessions", help="Output directory")
    parser.add_argument("--limit", type=int, default=50, help="Max sessions per request")
    parser.add_argument("--force", action="store_true", help="Re-download even if file exists")
    args = parser.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    base = args.backend.rstrip("/") + "/api/telemetry"
    headers = {"X-API-Key": args.api_key}
    params = {"limit": args.limit}
    if args.since:
        params["since"] = args.since

    # 1. List
    print(f"→ Listing sessions from {base}/sessions ...")
    resp = requests.get(f"{base}/sessions", headers=headers, params=params, timeout=30)
    if resp.status_code != 200:
        print(f"ERROR: list failed {resp.status_code}: {resp.text}", file=sys.stderr)
        return 1
    data = resp.json()
    sessions = data.get("sessions", [])
    print(f"  Found {len(sessions)} sessions.")

    # 2. Download each
    downloaded = 0
    skipped = 0
    for s in sessions:
        session_id = s["session_id"]
        target = out / f"{session_id}.jsonl"
        if target.exists() and not args.force:
            skipped += 1
            continue

        print(f"  ↓ {session_id} ({s.get('events_count', '?')} events) ...")
        r = requests.get(f"{base}/sessions/{session_id}", headers=headers, timeout=60)
        if r.status_code != 200:
            print(f"    FAILED: {r.status_code}", file=sys.stderr)
            continue
        body = r.json()
        sess = body.get("session", {})
        raw = sess.get("raw_jsonl") or ""
        target.write_text(raw, encoding="utf-8")
        downloaded += 1

    print(f"\nDone. Downloaded {downloaded}, skipped {skipped} (already present).")
    print(f"Output dir: {out.resolve()}")

    # 3. Print summary
    print("\nNext steps:")
    print(f"  python scripts/analyze-session.py --session {out / 'SESSION_ID.jsonl'} --plot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
