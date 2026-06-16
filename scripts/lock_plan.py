#!/usr/bin/env python3
"""lock_plan.py — v0.2.5 Constitution + tooling SHA-256 lock (Rule K).

Locks (default `--mode check`):
  - PLAN.md sections starting with `## 🔒 Constitution v3` (until next top-level `##`)
  - PLAN.md every `### Phase N` section (until next `###` or `---`)
  - scripts/cairn_lint.py
  - scripts/verify_progress.py
  - scripts/lock_plan.py     (self-lock)
  - scripts/visual_compare.py
  - .git/hooks/pre-commit

Output: _review/v0.2.5/.plan_locks.json

Modes:
  --mode write   write current SHA into .plan_locks.json (used after authorized plan edits)
  --mode check   compare current SHA to .plan_locks.json; exit 1 on mismatch (default)

Pre-commit hook calls `--mode check`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PLAN = REPO_ROOT / "_review" / "v0.2.5" / "PLAN.md"
LOCKFILE = REPO_ROOT / "_review" / "v0.2.5" / ".plan_locks.json"


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sha256_path(p: Path) -> str:
    if not p.exists():
        return "MISSING"
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _strip_code_fences(text: str) -> str:
    """Replace contents of ```...``` fenced blocks with blanks of the same length so that
    line numbers and total length are preserved but '##' headers inside fences cannot
    confuse extract_constitution / extract_phases regexes.
    """
    out = []
    i = 0
    in_fence = False
    while i < len(text):
        if text.startswith("```", i):
            # toggle fence state, keep the marker itself unchanged
            out.append(text[i:i+3])
            i += 3
            in_fence = not in_fence
            continue
        ch = text[i]
        if in_fence and ch != "\n":
            out.append(" ")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def extract_constitution(plan_text: str) -> str:
    cleaned = _strip_code_fences(plan_text)
    m = re.search(r"^## 🔒 Constitution v3\b", cleaned, re.MULTILINE)
    if not m:
        return ""
    start = m.start()
    rest = cleaned[m.end():]
    next_h2 = re.search(r"^## (?!🔒)", rest, re.MULTILINE)
    end = m.end() + (next_h2.start() if next_h2 else len(rest))
    # hash the ORIGINAL text in [start:end] so SHA still ties to the real content,
    # but the boundary was decided using the fence-stripped version
    return plan_text[start:end]


def extract_phases(plan_text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    cleaned = _strip_code_fences(plan_text)
    matches = list(re.finditer(r"^### Phase ([\w.]+)\b.*$", cleaned, re.MULTILINE))
    for i, m in enumerate(matches):
        name = m.group(1)
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(cleaned)
        body = plan_text[start:end]
        out[f"phase_{name}"] = sha256_text(body)
    return out


def compute_locks() -> dict[str, str]:
    plan_text = PLAN.read_text(encoding="utf-8", errors="replace") if PLAN.exists() else ""
    locks: dict[str, str] = {}
    locks["plan_constitution_v3"] = sha256_text(extract_constitution(plan_text))
    locks.update(extract_phases(plan_text))
    locks["scripts/cairn_lint.py"] = sha256_path(REPO_ROOT / "scripts" / "cairn_lint.py")
    locks["scripts/verify_progress.py"] = sha256_path(REPO_ROOT / "scripts" / "verify_progress.py")
    locks["scripts/lock_plan.py"] = sha256_path(REPO_ROOT / "scripts" / "lock_plan.py")
    locks["scripts/visual_compare.py"] = sha256_path(REPO_ROOT / "scripts" / "visual_compare.py")
    locks[".git/hooks/pre-commit"] = sha256_path(REPO_ROOT / ".git" / "hooks" / "pre-commit")
    return locks


def cmd_write() -> int:
    locks = compute_locks()
    LOCKFILE.parent.mkdir(parents=True, exist_ok=True)
    LOCKFILE.write_text(json.dumps(locks, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"lock_plan WRITE: {len(locks)} locks -> {LOCKFILE.relative_to(REPO_ROOT)}")
    return 0


def cmd_check() -> int:
    if not LOCKFILE.exists():
        print(f"lock_plan ERR: {LOCKFILE} missing — run with --mode write first")
        return 1
    expected = json.loads(LOCKFILE.read_text(encoding="utf-8"))
    actual = compute_locks()
    diffs: list[str] = []
    for k, v in expected.items():
        a = actual.get(k, "MISSING")
        if a != v:
            diffs.append(f"  {k}\n    expected: {v}\n    actual:   {a}")
    # also check keys present in actual but not expected (new phases etc.)
    for k in actual:
        if k not in expected:
            diffs.append(f"  {k}: NEW (not in lockfile)")
    if diffs:
        print("lock_plan FAIL: SHA mismatch")
        print("\n".join(diffs))
        return 1
    print(f"lock_plan PASS: {len(expected)} locks match")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["write", "check"], default="check")
    args = p.parse_args()
    if args.mode == "write":
        return cmd_write()
    return cmd_check()


if __name__ == "__main__":
    sys.exit(main())
