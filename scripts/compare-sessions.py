#!/usr/bin/env python3
"""
compare-sessions.py -- diff two Cairn debug sessions side by side.

Useful for:
  - Before/after a parameter tweak (e.g. Kalman process_noise change)
  - Comparing static vs walking session
  - A/B'ing two GPS pipeline implementations

Usage:
    python compare-sessions.py --before before.jsonl --after after.jsonl
"""

import argparse
import sys
from pathlib import Path

# Reuse analyze-session for stats extraction
sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module
analyze = import_module("analyze-session")


def fmt_delta(a, b, suffix=""):
    """Format a->b with diff."""
    if a is None and b is None:
        return "--"
    if a is None:
        return f"(none) -> {b}{suffix}"
    if b is None:
        return f"{a}{suffix} -> (none)"
    diff = b - a
    sign = "+" if diff > 0 else ""
    return f"{a}{suffix} -> {b}{suffix}  ({sign}{round(diff, 2)}{suffix})"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True, help="Path to baseline JSONL")
    parser.add_argument("--after", required=True, help="Path to comparison JSONL")
    args = parser.parse_args()

    before_path = Path(args.before)
    after_path = Path(args.after)
    if not before_path.exists():
        print(f"ERROR: not found: {before_path}", file=sys.stderr)
        return 1
    if not after_path.exists():
        print(f"ERROR: not found: {after_path}", file=sys.stderr)
        return 1

    before_events = analyze.load_jsonl(before_path)
    after_events = analyze.load_jsonl(after_path)

    if not before_events or not after_events:
        print("ERROR: empty session(s)", file=sys.stderr)
        return 1

    a = analyze.analyze(before_events)
    b = analyze.analyze(after_events)

    sep = "=" * 72
    print(sep)
    print(f"=== Cairn Session Comparison ===")
    print(sep)
    print(f"Before: {a.session_id}  ({a.duration_min:.1f} min, {a.gps_count} fixes)")
    print(f"After:  {b.session_id}  ({b.duration_min:.1f} min, {b.gps_count} fixes)")
    print()

    print("[GPS Quality]")
    print(f"  Avg accuracy:  {fmt_delta(a.gps_acc_avg, b.gps_acc_avg, 'm')}")
    print(f"  P95 accuracy:  {fmt_delta(a.gps_acc_p95, b.gps_acc_p95, 'm')}")
    print(f"  >20m points:   {fmt_delta(a.gps_high_inacc_pct, b.gps_high_inacc_pct, '%')}")
    print()

    print("[Kalman Filter]")
    print(f"  Avg correction: {fmt_delta(a.kalman_avg_correction_m, b.kalman_avg_correction_m, 'm')}")
    print(f"  Max correction: {fmt_delta(a.kalman_max_correction_m, b.kalman_max_correction_m, 'm')}")
    print(f"  Rejected:       {fmt_delta(a.kalman_rejected, b.kalman_rejected)}")
    print()

    print("[Battery]")
    print(f"  Drop rate:    {fmt_delta(a.battery_drop_pct_per_hour, b.battery_drop_pct_per_hour, '%/h')}")
    print()

    print("[Background Tracking]")
    print(f"  Max GPS gap:    {fmt_delta(a.bg_max_gap_seconds, b.bg_max_gap_seconds, 's')}")
    print(f"  Background time:{fmt_delta(a.bg_total_seconds, b.bg_total_seconds, 's')}")
    print()

    print("[Route Deviation]")
    print(f"  Deviations:     {fmt_delta(a.deviation_starts, b.deviation_starts)}")
    print(f"  Max distance:   {fmt_delta(a.deviation_max_distance_m, b.deviation_max_distance_m, 'm')}")
    print()

    print("[Broadcasts]")
    print(f"  Count:          {fmt_delta(a.broadcasts_count, b.broadcasts_count)}")
    print(f"  Avg latency:    {fmt_delta(a.broadcasts_avg_latency_ms, b.broadcasts_avg_latency_ms, 'ms')}")
    print()

    # Verdict heuristic
    print("[Verdict]")
    improvements = []
    regressions = []

    if a.gps_acc_p95 is not None and b.gps_acc_p95 is not None:
        if b.gps_acc_p95 < a.gps_acc_p95 * 0.9:
            improvements.append(f"GPS P95 improved by {round((1 - b.gps_acc_p95/a.gps_acc_p95) * 100, 1)}%")
        elif b.gps_acc_p95 > a.gps_acc_p95 * 1.1:
            regressions.append(f"GPS P95 degraded by {round((b.gps_acc_p95/a.gps_acc_p95 - 1) * 100, 1)}%")

    if a.battery_drop_pct_per_hour is not None and b.battery_drop_pct_per_hour is not None:
        if b.battery_drop_pct_per_hour < a.battery_drop_pct_per_hour - 0.5:
            improvements.append(f"Battery drain reduced by {round(a.battery_drop_pct_per_hour - b.battery_drop_pct_per_hour, 2)}%/h")
        elif b.battery_drop_pct_per_hour > a.battery_drop_pct_per_hour + 0.5:
            regressions.append(f"Battery drain increased by {round(b.battery_drop_pct_per_hour - a.battery_drop_pct_per_hour, 2)}%/h")

    if improvements:
        print("  Improvements:")
        for x in improvements:
            print(f"    + {x}")
    if regressions:
        print("  Regressions:")
        for x in regressions:
            print(f"    - {x}")
    if not improvements and not regressions:
        print("  No significant changes detected (sessions may be too short or differ in scope).")

    print(sep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
