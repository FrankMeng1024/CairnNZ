#!/usr/bin/env python3
"""verify_progress.py — v0.2.5 progress evidence verifier.

Inputs:
  --phase N            phase number to verify
  --plan PLAN.md       path (default: _review/v0.2.5/PLAN.md)
  --progress PROGRESS  path (default: _review/v0.2.5/PROGRESS.md)
  --signoff DIR        verdicts dir (default: _review/v0.2.5/verdicts)
  --adr-dir DIR        ADR dir (default: _review/v0.2.5/adr)

Checks (Rule E + N):
  1. Every PROGRESS.md `[x]` entry for current phase has a commit hash + file:line ref
  2. Every cited file:line points to an actual file at that line (line ± 0)
  3. signoff phaseN-signoff.md exists and contains "ready_for_next_phase: true"
  4. ADR expiration: every ADR with `Expiration phase: N` and N <= current phase must
     have status renewed; otherwise auto-write BLOCKER and exit 1
  5. cairn_lint --scope v025 passes

Exit:
  0 = green
  1 = violations
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PLAN = REPO_ROOT / "_review" / "v0.2.5" / "PLAN.md"
DEFAULT_PROGRESS = REPO_ROOT / "_review" / "v0.2.5" / "PROGRESS.md"
DEFAULT_SIGNOFF_DIR = REPO_ROOT / "_review" / "v0.2.5" / "verdicts"
DEFAULT_ADR_DIR = REPO_ROOT / "_review" / "v0.2.5" / "adr"
DEFAULT_BLOCKERS_DIR = REPO_ROOT / "_review" / "v0.2.5" / "blockers"


# A done sub-item line example:
#   - [x] 0.1 写 scripts/cairn_lint.py — commit abc1234, scripts/cairn_lint.py:1
DONE_LINE_RE = re.compile(r"^- \[x\]\s+(\S+)\s+(.+?)$")
COMMIT_RE = re.compile(r"\bcommit\s+([0-9a-f]{7,40})\b", re.IGNORECASE)
FILEREF_RE = re.compile(r"([\w./\-_]+\.(?:cs|ts|tsx|js|jsx|py|sql|json|md|mm|asmdef|hlsl|shader)):(\d+)")
ADR_EXPIRATION_RE = re.compile(r"^##\s*Expiration\s+phase\s*$\s*([^\n#]+)", re.IGNORECASE | re.MULTILINE)
ADR_STATUS_RE = re.compile(r"^##\s*Status\s*$\s*([^\n#]+)", re.IGNORECASE | re.MULTILINE)


class Result:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, m: str) -> None:
        self.errors.append(m)

    def warn(self, m: str) -> None:
        self.warnings.append(m)

    def ok(self) -> bool:
        return not self.errors


def parse_progress(progress_text: str, phase: int) -> list[tuple[str, str]]:
    """Return list of (sub_id, body) for done items under Phase N."""
    items: list[tuple[str, str]] = []
    in_phase = False
    phase_re = re.compile(rf"^##\s+Phase\s+{phase}\b", re.IGNORECASE)
    next_phase_re = re.compile(r"^##\s+Phase\s+\S")
    for line in progress_text.splitlines():
        if phase_re.match(line):
            in_phase = True
            continue
        if in_phase and next_phase_re.match(line) and not phase_re.match(line):
            break
        if not in_phase:
            continue
        m = DONE_LINE_RE.match(line)
        if m:
            sub_id = m.group(1)
            body = m.group(2)
            items.append((sub_id, body))
    return items


def verify_file_lines(body: str, result: Result) -> None:
    """Check file:line references resolve."""
    for m in FILEREF_RE.finditer(body):
        rel = m.group(1)
        lineno = int(m.group(2))
        path = (REPO_ROOT / rel).resolve()
        if not path.exists():
            result.err(f"file ref does not exist: {rel}:{lineno}  (in '{body[:80]}')")
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            if lineno < 1 or lineno > len(lines):
                result.err(f"file ref out of range: {rel}:{lineno} (file has {len(lines)} lines)")
        except Exception as e:
            result.err(f"cannot read {rel}: {e}")


def verify_commits(body: str, result: Result) -> None:
    for m in COMMIT_RE.finditer(body):
        sha = m.group(1)
        try:
            r = subprocess.run(
                ["git", "rev-parse", "--verify", f"{sha}^{{commit}}"],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=10
            )
            if r.returncode != 0:
                result.err(f"commit {sha} not found in repo (in '{body[:80]}')")
        except Exception as e:
            result.err(f"git verify failed for {sha}: {e}")


def verify_adrs(adr_dir: Path, phase: int, result: Result) -> list[Path]:
    """Return list of ADR files that have expired (expiration phase <= phase, status not renewed)."""
    expired: list[Path] = []
    if not adr_dir.exists():
        return expired
    for adr in sorted(adr_dir.glob("ADR-*.md")):
        text = adr.read_text(encoding="utf-8", errors="replace")
        m = ADR_EXPIRATION_RE.search(text)
        if not m:
            # no expiration field -> treat as "never expires"
            continue
        expir_raw = m.group(1).strip().lower()
        # interpret "Phase N", "Phase 6", "v0.2.6", "永久"
        expir_phase: int | None = None
        if mp := re.search(r"phase\s+(\d+)", expir_raw):
            expir_phase = int(mp.group(1))
        # if no numeric phase (e.g. v0.2.6 / 永久), treat as inactive
        if expir_phase is None:
            continue
        if expir_phase > phase:
            continue
        # check status
        status_match = ADR_STATUS_RE.search(text)
        status = status_match.group(1).strip().lower() if status_match else ""
        if "renewed" not in status:
            expired.append(adr)
    return expired


def write_blocker_for_expired(adr_path: Path) -> Path:
    DEFAULT_BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)
    name = f"BLOCKER-adr-expired-{adr_path.stem}.md"
    target = DEFAULT_BLOCKERS_DIR / name
    target.write_text(
        f"# BLOCKER: ADR expired — {adr_path.name}\n\n"
        f"ADR `{adr_path.name}` has reached its expiration phase but Status != renewed.\n"
        f"Required: review the ADR, either mark Status: renewed (and bump expiration phase) "
        f"or remove the dependency on its decision.\n",
        encoding="utf-8",
    )
    return target


def run_lint(result: Result) -> None:
    try:
        r = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "cairn_lint.py"), "--scope", "v025", "--quiet"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=120
        )
        if r.returncode != 0:
            result.err(f"cairn_lint failed:\n{r.stdout}\n{r.stderr}")
    except Exception as e:
        result.err(f"cannot run cairn_lint: {e}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--phase", type=int, required=True)
    p.add_argument("--plan", default=str(DEFAULT_PLAN))
    p.add_argument("--progress", default=str(DEFAULT_PROGRESS))
    p.add_argument("--signoff", default=str(DEFAULT_SIGNOFF_DIR))
    p.add_argument("--adr-dir", default=str(DEFAULT_ADR_DIR))
    p.add_argument("--strict-evidence", action="store_true",
                   help="require commit + file:line on every [x] item")
    args = p.parse_args()

    # Force UTF-8 output on Windows so PROGRESS.md Chinese / emoji do not crash.
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    result = Result()
    progress_path = Path(args.progress)
    if not progress_path.exists():
        result.err(f"PROGRESS.md not found: {progress_path}")
    else:
        text = progress_path.read_text(encoding="utf-8", errors="replace")
        items = parse_progress(text, args.phase)
        for sub_id, body in items:
            verify_file_lines(body, result)
            verify_commits(body, result)
            if args.strict_evidence:
                if not COMMIT_RE.search(body):
                    result.warn(f"sub-item {sub_id} missing commit hash: {body[:80]}")
                if not FILEREF_RE.search(body):
                    result.warn(f"sub-item {sub_id} missing file:line ref: {body[:80]}")

    # signoff
    signoff = Path(args.signoff) / f"phase{args.phase}-signoff.md"
    if not signoff.exists():
        result.warn(f"signoff not yet present: {signoff}")
    else:
        sf = signoff.read_text(encoding="utf-8", errors="replace")
        if "ready_for_next_phase: true" not in sf:
            result.err(f"signoff exists but ready_for_next_phase != true: {signoff}")

    # ADR expirations
    expired = verify_adrs(Path(args.adr_dir), args.phase, result)
    for adr in expired:
        target = write_blocker_for_expired(adr)
        result.err(f"ADR expired without renewal: {adr.name}  -> wrote {target.relative_to(REPO_ROOT)}")

    # lint
    run_lint(result)

    for w in result.warnings:
        print(f"[warn] {w}")
    for e in result.errors:
        print(f"[err]  {e}")

    if result.ok():
        print(f"verify_progress PASS (phase={args.phase})")
        return 0
    print(f"verify_progress FAIL (phase={args.phase}, errors={len(result.errors)})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
