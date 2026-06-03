#!/usr/bin/env python3
"""
analyze-session.py -- produce a human-readable report from a Cairn debug session.

Input: a JSONL file (one event per line) produced by the Cairn debug logger.
Output: a multi-section report comparing observed values against PRD2 NFR targets.

Usage:
    python analyze-session.py --session path/to/session.jsonl
    python analyze-session.py --session path/to/session.jsonl --output report.txt
    python analyze-session.py --session path/to/session.jsonl --plot

Sections:
    [Session]            metadata
    [GPS Quality]        accuracy stats vs NFR (<10m open / <25m forest)
    [Kalman Filter]      jitter reduction vs raw
    [Battery]            consumption rate vs NFR (<8%/h hiking, <5%/h running)
    [Background]         tracking continuity over lock-screen
    [Route Deviation]    counts, false-positive identification
    [Broadcasts]         latency vs NFR (<2s)
    [Network]            offline duration / state changes
    [User Annotations]   L4 tags cross-referenced with L2 events
    [Critical Issues]    auto-detected
    [NFR Compliance]     summary checklist
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy not installed. Run: pip install -r scripts/requirements.txt")
    sys.exit(1)


# -- NFR Targets (from PRD2 §Non-Functional Requirements) ------------------
NFR = {
    "gps_accuracy_open_m":       10.0,    # < 10m in open terrain
    "battery_pct_per_hour_hike":  8.0,    # < 8 %/h
    "battery_pct_per_hour_run":   5.0,    # < 5 %/h
    "broadcast_latency_ms":     2000.0,   # < 2s trigger to play
    "cold_start_s":               3.0,    # not measurable from session log
}


# -- Data classes ----------------------------------------------------------
@dataclass
class SessionStats:
    session_id: str
    started_at: int
    ended_at: Optional[int]
    duration_min: float

    # GPS
    gps_count: int = 0
    gps_acc_avg: Optional[float] = None
    gps_acc_p50: Optional[float] = None
    gps_acc_p95: Optional[float] = None
    gps_acc_max: Optional[float] = None
    gps_high_inacc_pct: float = 0.0
    gps_lost_seconds: int = 0
    gps_foreground: int = 0
    gps_background: int = 0

    # Kalman
    kalman_count: int = 0
    kalman_rejected: int = 0
    kalman_avg_correction_m: Optional[float] = None
    kalman_max_correction_m: Optional[float] = None

    # Battery
    battery_start_pct: Optional[int] = None
    battery_end_pct: Optional[int] = None
    battery_drop_pct_per_hour: Optional[float] = None
    was_charging: bool = False

    # Background tracking
    bg_total_seconds: int = 0
    bg_max_gap_seconds: int = 0
    bg_session_count: int = 0

    # Deviations
    deviation_starts: int = 0
    deviation_ends: int = 0
    deviation_alerts: int = 0
    deviation_max_distance_m: float = 0.0

    # Broadcasts
    broadcasts_count: int = 0
    broadcasts_avg_latency_ms: Optional[float] = None
    broadcasts_max_latency_ms: Optional[float] = None
    broadcasts_by_priority: Dict[str, int] = field(default_factory=lambda: {"P0": 0, "P1": 0, "P2": 0})

    # Network
    network_changes: int = 0
    offline_seconds: int = 0

    # Annotations
    annotations: List[Dict[str, Any]] = field(default_factory=list)

    # Errors
    errors_count: int = 0
    errors_fatal: int = 0

    # Activity
    activity_mode: Optional[str] = None


# -- Loading ----------------------------------------------------------------
def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    events = []
    with path.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"WARN: skipping malformed line {line_num}: {e}", file=sys.stderr)
    return events


# -- Analysis --------------------------------------------------------------─
def analyze(events: List[Dict[str, Any]]) -> SessionStats:
    if not events:
        raise ValueError("No events in session")

    # Basic metadata
    session_id = events[0].get("session_id", "unknown")
    started_at = min(e["ts"] for e in events)
    ended_at = max(e["ts"] for e in events)
    duration_ms = ended_at - started_at
    duration_min = duration_ms / 60_000

    stats = SessionStats(
        session_id=session_id,
        started_at=started_at,
        ended_at=ended_at,
        duration_min=round(duration_min, 1),
    )

    # GPS accuracies
    gps_events = [e for e in events if e["event"] == "gps_fix"]
    if gps_events:
        stats.gps_count = len(gps_events)
        stats.gps_foreground = sum(1 for e in gps_events if e.get("source") == "foreground")
        stats.gps_background = sum(1 for e in gps_events if e.get("source") == "background")
        accs = [e["accuracy_m"] for e in gps_events if e.get("accuracy_m") is not None]
        if accs:
            arr = np.array(accs)
            stats.gps_acc_avg = round(float(arr.mean()), 2)
            stats.gps_acc_p50 = round(float(np.percentile(arr, 50)), 2)
            stats.gps_acc_p95 = round(float(np.percentile(arr, 95)), 2)
            stats.gps_acc_max = round(float(arr.max()), 2)
            stats.gps_high_inacc_pct = round(float((arr > 20).sum() / len(arr) * 100), 1)

    # GPS gap detection (background continuity)
    if len(gps_events) >= 2:
        ts_sorted = sorted(e["ts"] for e in gps_events)
        gaps = np.diff(ts_sorted)
        # gap > 30s = potential background interruption
        big_gaps = gaps[gaps > 30_000]
        stats.bg_max_gap_seconds = int(big_gaps.max() / 1000) if len(big_gaps) > 0 else 0
        # Total background time approximated from app_state events
    bg_events = [e for e in events if e["event"] == "app_state_change"]
    bg_periods = []
    bg_start: Optional[int] = None
    for e in bg_events:
        if e.get("to") == "background" and bg_start is None:
            bg_start = e["ts"]
        elif e.get("from") == "background" and bg_start is not None:
            bg_periods.append((bg_start, e["ts"]))
            bg_start = None
    if bg_start is not None:
        bg_periods.append((bg_start, ended_at))
    stats.bg_total_seconds = int(sum((b - a) / 1000 for a, b in bg_periods))
    stats.bg_session_count = len(bg_periods)

    # Kalman
    kalman_events = [e for e in events if e["event"] == "kalman_output"]
    stats.kalman_count = len(kalman_events)
    stats.kalman_rejected = sum(1 for e in kalman_events if e.get("rejected"))
    corrections = []
    for e in kalman_events:
        if e.get("rejected"):
            continue
        inp = e.get("input", {})
        out = e.get("output", {})
        if "lat" in inp and "lat" in out:
            # Equirectangular approximation: account for cos(lat) so east-west
            # distance isn't overstated. ~111km per degree lat; lng scaled by cos.
            mid_lat_rad = (inp["lat"] + out["lat"]) / 2 * 3.14159265 / 180
            dlat_m = (out["lat"] - inp["lat"]) * 111000
            dlon_m = (out["lon"] - inp["lon"]) * 111000 * abs(np.cos(mid_lat_rad))
            corrections.append((dlat_m ** 2 + dlon_m ** 2) ** 0.5)
    if corrections:
        stats.kalman_avg_correction_m = round(float(np.mean(corrections)), 2)
        stats.kalman_max_correction_m = round(float(np.max(corrections)), 2)

    # Battery
    battery_events = [e for e in events if e["event"] == "battery_sample"]
    if battery_events:
        first = battery_events[0]
        last = battery_events[-1]
        stats.battery_start_pct = first.get("level_pct")
        stats.battery_end_pct = last.get("level_pct")
        if (
            stats.battery_start_pct is not None
            and stats.battery_end_pct is not None
            and duration_min > 1
        ):
            drop = stats.battery_start_pct - stats.battery_end_pct
            # Per-hour rate; could be negative if charged during session
            stats.battery_drop_pct_per_hour = round(drop / duration_min * 60, 2)
        stats.was_charging = any(e.get("is_charging") for e in battery_events)

    # Deviations
    stats.deviation_starts = sum(1 for e in events if e["event"] == "deviation_start")
    stats.deviation_ends = sum(1 for e in events if e["event"] == "deviation_end")
    stats.deviation_alerts = sum(1 for e in events if e["event"] == "deviation_alert")
    dev_distances = [
        e.get("distance_m", 0)
        for e in events
        if e["event"] in ("deviation_start", "deviation_alert")
    ]
    if dev_distances:
        stats.deviation_max_distance_m = round(max(dev_distances), 1)

    # Broadcasts
    bcast_events = [e for e in events if e["event"] == "broadcast_played"]
    stats.broadcasts_count = len(bcast_events)
    if bcast_events:
        latencies = [e.get("trigger_to_play_latency_ms", 0) for e in bcast_events]
        stats.broadcasts_avg_latency_ms = round(float(np.mean(latencies)), 0)
        stats.broadcasts_max_latency_ms = round(float(np.max(latencies)), 0)
        for e in bcast_events:
            p = e.get("priority", "P2")
            if p in stats.broadcasts_by_priority:
                stats.broadcasts_by_priority[p] += 1

    # Network
    net_events = [e for e in events if e["event"] == "network_change"]
    stats.network_changes = len(net_events)
    offline_periods = []
    offline_start: Optional[int] = None
    for e in net_events:
        if e.get("state") == "offline" and offline_start is None:
            offline_start = e["ts"]
        elif e.get("state") == "online" and offline_start is not None:
            offline_periods.append((offline_start, e["ts"]))
            offline_start = None
    if offline_start is not None:
        offline_periods.append((offline_start, ended_at))
    stats.offline_seconds = int(sum((b - a) / 1000 for a, b in offline_periods))

    # Annotations (L4)
    stats.annotations = [
        {
            "ts": e["ts"],
            "tag": e.get("tag"),
            "lat": e.get("lat"),
            "lon": e.get("lon"),
            "note": e.get("note"),
        }
        for e in events
        if e["event"] == "user_annotation"
    ]

    # Errors
    err_events = [e for e in events if e["event"] == "error"]
    stats.errors_count = len(err_events)
    stats.errors_fatal = sum(1 for e in err_events if e.get("fatal"))

    # Activity mode (from minute_snapshot or first known)
    return stats


# -- Reporting --------------------------------------------------------------
def render_report(stats: SessionStats) -> str:
    lines: List[str] = []
    sep = "=" * 60

    lines.append(sep)
    lines.append(f"=== Cairn Session Analysis Report ===")
    lines.append(sep)
    lines.append(f"Session ID:   {stats.session_id}")
    lines.append(f"Started at:   {fmt_ts(stats.started_at)}")
    lines.append(f"Ended at:     {fmt_ts(stats.ended_at) if stats.ended_at else 'still active'}")
    lines.append(f"Duration:     {stats.duration_min:.1f} min")
    if stats.activity_mode:
        lines.append(f"Activity:     {stats.activity_mode}")
    lines.append("")

    # GPS
    lines.append("[GPS Quality]")
    lines.append(f"  Total points:    {stats.gps_count}")
    lines.append(f"  Foreground:      {stats.gps_foreground}")
    lines.append(f"  Background:      {stats.gps_background}")
    if stats.gps_acc_avg is not None:
        lines.append(f"  Avg accuracy:    {stats.gps_acc_avg} m")
        lines.append(f"  P50 accuracy:    {stats.gps_acc_p50} m")
        lines.append(f"  P95 accuracy:    {stats.gps_acc_p95} m")
        lines.append(f"  Max accuracy:    {stats.gps_acc_max} m")
        lines.append(f"  >20m points:     {stats.gps_high_inacc_pct}%")
        nfr_pass = stats.gps_acc_p95 <= NFR["gps_accuracy_open_m"]
        lines.append(
            f"  NFR (P95 < {NFR['gps_accuracy_open_m']}m open): "
            f"{'PASS' if nfr_pass else 'FAIL'}"
        )
    else:
        lines.append("  (no accuracy data)")
    lines.append("")

    # Kalman
    lines.append("[Kalman Filter]")
    lines.append(f"  Filtered points: {stats.kalman_count}")
    lines.append(f"  Rejected:        {stats.kalman_rejected}")
    if stats.kalman_avg_correction_m is not None:
        lines.append(f"  Avg correction:  {stats.kalman_avg_correction_m} m")
        lines.append(f"  Max correction:  {stats.kalman_max_correction_m} m")
    lines.append("")

    # Battery
    lines.append("[Battery]")
    if stats.battery_start_pct is not None:
        lines.append(f"  Start:           {stats.battery_start_pct}%")
        lines.append(f"  End:             {stats.battery_end_pct}%")
        lines.append(f"  Was charging:    {stats.was_charging}")
        if stats.battery_drop_pct_per_hour is not None:
            rate = stats.battery_drop_pct_per_hour
            lines.append(f"  Rate:            {rate:+.2f} %/h")
            target = NFR["battery_pct_per_hour_hike"]
            verdict = "PASS" if rate <= target else "FAIL"
            lines.append(f"  NFR hike <{target}%/h: {verdict}")
    else:
        lines.append("  (no battery data -- expo-battery may be unavailable)")
    lines.append("")

    # Background tracking
    lines.append("[Background Tracking]")
    lines.append(f"  Background sessions: {stats.bg_session_count}")
    lines.append(f"  Total background:    {stats.bg_total_seconds // 60} min "
                 f"{stats.bg_total_seconds % 60} s")
    lines.append(f"  Largest GPS gap:     {stats.bg_max_gap_seconds} s")
    if stats.bg_max_gap_seconds > 60:
        lines.append("  WARNING: large GPS gap may indicate background tracking issue")
    lines.append("")

    # Deviations
    lines.append("[Route Deviation]")
    lines.append(f"  Deviation starts: {stats.deviation_starts}")
    lines.append(f"  Deviation ends:   {stats.deviation_ends}")
    lines.append(f"  Alerts triggered: {stats.deviation_alerts}")
    lines.append(f"  Max distance:     {stats.deviation_max_distance_m} m")
    fp_count = sum(1 for a in stats.annotations if a["tag"] == "deviation_false_positive")
    missed_count = sum(1 for a in stats.annotations if a["tag"] == "deviation_missed")
    if fp_count or missed_count:
        lines.append(f"  False positives (user marked): {fp_count}")
        lines.append(f"  Missed (user marked):          {missed_count}")
        if stats.deviation_starts > 0:
            fp_rate = fp_count / stats.deviation_starts * 100
            lines.append(f"  FP rate:                       {fp_rate:.1f}%")
    lines.append("")

    # Broadcasts
    lines.append("[Broadcasts]")
    lines.append(f"  Total played:     {stats.broadcasts_count}")
    lines.append(
        f"  By priority:      "
        f"P0={stats.broadcasts_by_priority['P0']} "
        f"P1={stats.broadcasts_by_priority['P1']} "
        f"P2={stats.broadcasts_by_priority['P2']}"
    )
    if stats.broadcasts_avg_latency_ms is not None:
        lines.append(f"  Avg latency:      {stats.broadcasts_avg_latency_ms:.0f} ms")
        lines.append(f"  Max latency:      {stats.broadcasts_max_latency_ms:.0f} ms")
        nfr_pass = stats.broadcasts_avg_latency_ms <= NFR["broadcast_latency_ms"]
        lines.append(
            f"  NFR (<{int(NFR['broadcast_latency_ms'])}ms): "
            f"{'PASS' if nfr_pass else 'FAIL'}"
        )
    lines.append("")

    # Network
    lines.append("[Network]")
    lines.append(f"  State changes:   {stats.network_changes}")
    lines.append(f"  Offline time:    {stats.offline_seconds // 60} min "
                 f"{stats.offline_seconds % 60} s "
                 f"({stats.offline_seconds / max(1, stats.duration_min * 60) * 100:.0f}%)")
    lines.append("")

    # Annotations
    if stats.annotations:
        lines.append("[User Annotations] (L4)")
        for a in stats.annotations:
            lines.append(
                f"  {fmt_ts(a['ts'], short=True)}  "
                f"{a['tag']:30s}  "
                f"lat={a['lat']}  lon={a['lon']}"
                + (f"  note: {a['note']}" if a.get("note") else "")
            )
        lines.append("")

    # Errors
    if stats.errors_count:
        lines.append("[Errors]")
        lines.append(f"  Total: {stats.errors_count}")
        lines.append(f"  Fatal: {stats.errors_fatal}")
        lines.append("")

    # NFR Compliance summary
    lines.append("[NFR Compliance Summary]")
    nfr_status = check_nfr(stats)
    for name, passed, detail in nfr_status:
        lines.append(f"  {'PASS' if passed else 'FAIL':4s}  {name}: {detail}")
    lines.append("")

    # Critical issues auto-detection
    issues = detect_issues(stats)
    if issues:
        lines.append("[Critical Issues]")
        for issue in issues:
            lines.append(f"  - {issue}")
        lines.append("")

    lines.append(sep)
    return "\n".join(lines)


def check_nfr(stats: SessionStats) -> List[Tuple[str, bool, str]]:
    out: List[Tuple[str, bool, str]] = []

    if stats.gps_acc_p95 is not None:
        passed = stats.gps_acc_p95 <= NFR["gps_accuracy_open_m"]
        out.append((
            "GPS P95 accuracy < 10m (open terrain)",
            passed,
            f"{stats.gps_acc_p95}m",
        ))

    if stats.battery_drop_pct_per_hour is not None and not stats.was_charging:
        target = NFR["battery_pct_per_hour_hike"]
        passed = stats.battery_drop_pct_per_hour <= target
        out.append((
            f"Battery drop < {target}%/h (hiking)",
            passed,
            f"{stats.battery_drop_pct_per_hour:+.2f}%/h",
        ))

    if stats.broadcasts_avg_latency_ms is not None:
        passed = stats.broadcasts_avg_latency_ms <= NFR["broadcast_latency_ms"]
        out.append((
            f"Broadcast avg latency < {int(NFR['broadcast_latency_ms'])}ms",
            passed,
            f"{stats.broadcasts_avg_latency_ms:.0f}ms",
        ))

    if stats.bg_max_gap_seconds is not None:
        passed = stats.bg_max_gap_seconds < 30
        out.append((
            "Background tracking continuity (gap < 30s)",
            passed,
            f"max gap {stats.bg_max_gap_seconds}s",
        ))

    return out


def detect_issues(stats: SessionStats) -> List[str]:
    issues: List[str] = []
    if stats.gps_acc_p95 is not None and stats.gps_acc_p95 > NFR["gps_accuracy_open_m"]:
        issues.append(
            f"GPS P95 accuracy {stats.gps_acc_p95}m exceeds NFR ({NFR['gps_accuracy_open_m']}m). "
            f"Likely tree cover or dense urban canyon."
        )

    if (
        stats.battery_drop_pct_per_hour is not None
        and not stats.was_charging
        and stats.battery_drop_pct_per_hour > NFR["battery_pct_per_hour_hike"]
    ):
        issues.append(
            f"Battery drain {stats.battery_drop_pct_per_hour:.1f}%/h exceeds hiking NFR "
            f"({NFR['battery_pct_per_hour_hike']}%/h). Investigate background work."
        )

    if stats.bg_max_gap_seconds > 60:
        issues.append(
            f"GPS gap of {stats.bg_max_gap_seconds}s detected. "
            f"Background tracking may be killed by iOS -- verify foreground service notification."
        )

    if stats.deviation_starts > 0:
        fp = sum(1 for a in stats.annotations if a["tag"] == "deviation_false_positive")
        fp_rate = fp / stats.deviation_starts * 100
        if fp_rate > 30:
            issues.append(
                f"{fp_rate:.0f}% of deviations marked false positive ({fp}/{stats.deviation_starts}). "
                f"Consider raising threshold or duration filter."
            )

    if stats.kalman_rejected > stats.kalman_count * 0.1 and stats.kalman_count > 50:
        rate = stats.kalman_rejected / stats.kalman_count * 100
        issues.append(
            f"Kalman rejected {rate:.0f}% of points ({stats.kalman_rejected}/{stats.kalman_count}). "
            f"Possibly too strict consistency check."
        )

    if stats.errors_fatal > 0:
        issues.append(f"{stats.errors_fatal} fatal errors logged -- review error events.")

    return issues


# -- Helpers ----------------------------------------------------------------
def fmt_ts(ms: Optional[int], short: bool = False) -> str:
    if ms is None:
        return "--"
    from datetime import datetime
    dt = datetime.fromtimestamp(ms / 1000)
    return dt.strftime("%H:%M:%S" if short else "%Y-%m-%d %H:%M:%S")


def maybe_plot(events: List[Dict[str, Any]], stats: SessionStats, out_dir: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("WARN: matplotlib not installed -- skipping plots", file=sys.stderr)
        return

    out_dir.mkdir(parents=True, exist_ok=True)

    # GPS accuracy over time
    gps = [e for e in events if e["event"] == "gps_fix" and e.get("accuracy_m") is not None]
    if gps:
        ts = [(e["ts"] - stats.started_at) / 60_000 for e in gps]  # minutes
        acc = [e["accuracy_m"] for e in gps]
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.plot(ts, acc, ".", markersize=2, alpha=0.5)
        ax.axhline(NFR["gps_accuracy_open_m"], color="red", linestyle="--",
                   label=f"NFR {NFR['gps_accuracy_open_m']}m")
        ax.set_xlabel("Time (min)")
        ax.set_ylabel("GPS accuracy (m)")
        ax.set_title(f"GPS accuracy -- session {stats.session_id[:12]}")
        ax.legend()
        plt.tight_layout()
        plt.savefig(out_dir / "gps_accuracy.png", dpi=120)
        plt.close()
        print(f"  Saved: {out_dir / 'gps_accuracy.png'}")

    # GPS scatter (track)
    if gps:
        lats = [e["lat"] for e in gps]
        lons = [e["lon"] for e in gps]
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.plot(lons, lats, "-", linewidth=0.5)
        ax.plot(lons, lats, ".", markersize=2, alpha=0.4)
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        ax.set_aspect("equal")
        ax.set_title(f"GPS track -- session {stats.session_id[:12]}")
        plt.tight_layout()
        plt.savefig(out_dir / "gps_track.png", dpi=120)
        plt.close()
        print(f"  Saved: {out_dir / 'gps_track.png'}")


# -- Main ------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze Cairn debug session log")
    parser.add_argument("--session", required=True, help="Path to JSONL session file")
    parser.add_argument("--output", help="Write report to this file (else stdout)")
    parser.add_argument("--plot", action="store_true", help="Generate matplotlib plots")
    parser.add_argument("--plot-dir", default="./session-plots",
                        help="Directory for plot output (default ./session-plots)")
    args = parser.parse_args()

    session_path = Path(args.session)
    if not session_path.exists():
        print(f"ERROR: file not found: {session_path}", file=sys.stderr)
        return 1

    events = load_jsonl(session_path)
    print(f"Loaded {len(events)} events from {session_path}")

    if not events:
        print("ERROR: empty session -- no events to analyze", file=sys.stderr)
        return 1

    stats = analyze(events)
    report = render_report(stats)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"Report written to: {args.output}")
    else:
        print(report)

    if args.plot:
        maybe_plot(events, stats, Path(args.plot_dir) / stats.session_id[:12])

    return 0


if __name__ == "__main__":
    sys.exit(main())
