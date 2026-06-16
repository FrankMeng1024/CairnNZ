#!/usr/bin/env python3
"""cairn_lint.py — v0.2.5 Constitution lint

Three rules (PLAN.md Rule C.1 / C.2 / Rule P):
  1. C.1 forbidden phrases (escape comments)
  2. C.2 catch type strictness (catch (Exception) banned in v025 scope)
  3. Rule P Monitor mitigation: classes ending Monitor/Validator/Observer must contain a method
     whose name starts with "Mitigate" or "Recover" or "Resolve"

Scope:
  --scope v025   : UnityARLib/Assets/Scripts/v025/ + app/src/services/v025/ +
                   app/src/store/v025/ + app/src/screens/v025/ + backend/src/routes/v025/
  --scope all    : whole repo (used by Phase 0.22 retrofit scan; expects already clean)
  --paths a b c  : explicit paths

Exit:
  0 = clean
  1 = violations found (printed)
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Rule C.1 — forbidden phrases
# ---------------------------------------------------------------------------
# matched as substring (case-insensitive) inside comments only
C1_FORBIDDEN = [
    "trust arkit", "信任 arkit", "trust the system",
    "only telemetry", "只 emit log", "只emit log", "monitor-only", "monitor only",
    "todo defer", "todo v0.2.6", "todo 后续", "todo later",
    "will fix later", "之后修", "暂时", "暂缓",
    "for now", "先这样", "for the moment",
    "等数据", "等真机", "等 eas build", "等eas build", "pending data",
    "fallback to bare coords", "裸坐标兜底", "bare position fallback",
    "safe to ignore", "可以忽略", "safely ignore",
    "not ideal but", "不理想但", "imperfect but",
    "// per adr", "// see adr", "// ref adr", "// according to adr",
    "pending validation", "awaiting validation",
    "behavior intentional",
]

# legitimate ADR reference must match: 见 ADR-NNN(...)  with a non-empty parenthesised reason
ADR_LEGIT_RE = re.compile(r"见\s+ADR-\d{3}\(([^)]+)\)")

# ---------------------------------------------------------------------------
# C# / TS / JS comment extraction
# ---------------------------------------------------------------------------
LINE_COMMENT_RE = re.compile(r"//(.*)$")
BLOCK_COMMENT_RE = re.compile(r"/\*([\s\S]*?)\*/")

# ---------------------------------------------------------------------------
# Rule C.2 — catch type strictness (C# only; v025 scope)
# ---------------------------------------------------------------------------
# matches catch | catch (Exception) | catch (System.Exception) | catch(Exception e)
CATCH_BARE_RE = re.compile(r"\bcatch\s*(?:\(\s*(System\.)?Exception(\s+\w+)?\s*\))?\s*\{")
CATCH_TYPED_RE = re.compile(r"\bcatch\s*\(\s*(\w+(?:\.\w+)*)(\s+\w+)?\s*\)")

# ---------------------------------------------------------------------------
# Rule P — Monitor / Validator / Observer must include mitigation
# ---------------------------------------------------------------------------
CLASS_RE = re.compile(r"\b(?:public|internal|private|sealed|static|partial|\s)+class\s+(\w+)")
MITIGATION_METHOD_RE = re.compile(r"\b(?:public|private|internal|protected|static|virtual|override|async|\s)+\w[\w<>,?\s]*\s+(Mitigate|Recover|Resolve)\w*\s*\(")


@dataclass
class Violation:
    rule: str
    file: str
    line: int
    snippet: str

    def fmt(self) -> str:
        return f"[{self.rule}] {self.file}:{self.line}  {self.snippet.strip()[:120]}"


def iter_files(scope: str, explicit: list[str] | None) -> Iterable[Path]:
    if explicit:
        for p in explicit:
            pp = (REPO_ROOT / p).resolve()
            if pp.is_file():
                yield pp
            elif pp.is_dir():
                yield from _walk(pp)
        return
    if scope == "v025":
        roots = [
            REPO_ROOT / "UnityARLib" / "Assets" / "Scripts" / "v025",
            REPO_ROOT / "app" / "src" / "services" / "v025",
            REPO_ROOT / "app" / "src" / "store" / "v025",
            REPO_ROOT / "app" / "src" / "screens" / "v025",
            REPO_ROOT / "backend" / "src" / "routes" / "v025",
            REPO_ROOT / "UnityARLib" / "Assets" / "Plugins" / "iOS",
        ]
        for r in roots:
            if r.exists():
                yield from _walk(r)
    elif scope == "all":
        yield from _walk(REPO_ROOT / "UnityARLib" / "Assets" / "Scripts")
        yield from _walk(REPO_ROOT / "app" / "src")
        yield from _walk(REPO_ROOT / "backend" / "src")
    else:
        raise SystemExit(f"unknown scope: {scope}")


def _walk(d: Path) -> Iterable[Path]:
    for p in d.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in {".cs", ".ts", ".tsx", ".js", ".jsx", ".mm"}:
            continue
        # skip auto-generated meta and node_modules
        parts = set(p.parts)
        if "node_modules" in parts or "__tests__snapshots__" in parts:
            continue
        if p.name.endswith(".g.cs") or p.name.endswith(".designer.cs"):
            continue
        yield p


def extract_comments(text: str) -> list[tuple[int, str]]:
    """Return list of (1-indexed line, comment_body)."""
    out: list[tuple[int, str]] = []
    for i, line in enumerate(text.splitlines(), start=1):
        m = LINE_COMMENT_RE.search(line)
        if m:
            out.append((i, m.group(1)))
    # block comments: emit one entry per starting line for simplicity
    for m in BLOCK_COMMENT_RE.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        out.append((line_no, m.group(1)))
    return out


def check_c1(path: Path, text: str) -> list[Violation]:
    v: list[Violation] = []
    for line_no, body in extract_comments(text):
        lower = body.lower()
        for phrase in C1_FORBIDDEN:
            if phrase in lower:
                # whitelist legit ADR ref
                if phrase.startswith("// ") and phrase.endswith("adr"):
                    if ADR_LEGIT_RE.search(body):
                        continue
                v.append(Violation("C.1", str(path.relative_to(REPO_ROOT)), line_no,
                                   f"forbidden phrase '{phrase}' in comment: {body}"))
                break
    return v


def _strip_comments_for_code_scan(text: str) -> str:
    """Replace contents of // line comments and /* */ block comments with blanks of the
    same length, preserving newlines and total length so line numbers stay correct.
    Naive: does not respect string literals containing `//` (rare in C#).
    """
    out = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] == '/' and i + 1 < n:
            if text[i + 1] == '/':
                out.append("  ")
                i += 2
                while i < n and text[i] != '\n':
                    out.append(' ')
                    i += 1
                continue
            if text[i + 1] == '*':
                out.append("  ")
                i += 2
                while i + 1 < n and not (text[i] == '*' and text[i + 1] == '/'):
                    out.append(' ' if text[i] != '\n' else '\n')
                    i += 1
                if i + 1 < n:
                    out.append("  ")
                    i += 2
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def check_c2(path: Path, text: str) -> list[Violation]:
    """Only applies to C# files in v025 scope. Strips comments first to avoid false
    positives from `// catch (Exception)` doc comments. Also handles multi-line catch."""
    if path.suffix != ".cs":
        return []
    code_only = _strip_comments_for_code_scan(text)
    v: list[Violation] = []
    # collapse to lines for reporting line numbers, but use code_only for matching
    code_lines = code_only.splitlines()
    raw_lines = text.splitlines()
    # Multi-line catch detection: scan whole text with re.DOTALL for catch( ... ).
    # Single-line happy path first.
    for i, line in enumerate(code_lines, start=1):
        if "catch" not in line:
            continue
        if re.search(r"\bcatch\s*\{", line):
            v.append(Violation("C.2", str(path.relative_to(REPO_ROOT)), i,
                               f"bare `catch` block, must specify exception type: {raw_lines[i-1] if i-1 < len(raw_lines) else line}"))
            continue
        m = CATCH_TYPED_RE.search(line)
        if m:
            t = m.group(1)
            if t in {"Exception", "System.Exception"}:
                v.append(Violation("C.2", str(path.relative_to(REPO_ROOT)), i,
                                   f"catch ({t}) is forbidden, use specific type: {raw_lines[i-1] if i-1 < len(raw_lines) else line}"))
    # Multi-line catch: catch(\n    Exception ex\n)
    for m in re.finditer(r"\bcatch\s*\(\s*(System\.)?Exception\b", code_only):
        # if already captured by single-line scan, skip
        line_no = code_only.count("\n", 0, m.start()) + 1
        already = any(vv.line == line_no and vv.rule == "C.2" for vv in v)
        if already:
            continue
        # check if the match itself is on a single line of code_lines we already scanned
        line_text = code_lines[line_no - 1] if line_no - 1 < len(code_lines) else ""
        if "catch" in line_text and "Exception" in line_text:
            # would have been caught above — skip
            continue
        v.append(Violation("C.2", str(path.relative_to(REPO_ROOT)), line_no,
                           f"multi-line catch (Exception) is forbidden, use specific type"))
    return v


def _find_class_body(text: str, class_decl_end: int) -> str:
    """Given the position right after `class Foo` declaration, find the `{ ... }` body
    by brace counting. Returns the body string (excluding outer braces). If braces are
    unbalanced, returns "" (no false positive)."""
    n = len(text)
    i = class_decl_end
    # scan to first `{`
    while i < n and text[i] != '{':
        i += 1
    if i >= n:
        return ""
    depth = 0
    start = i
    while i < n:
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
        i += 1
    return ""


def check_rule_p(path: Path, text: str) -> list[Violation]:
    """Classes ending Monitor/Validator/Observer must contain Mitigate*/Recover*/Resolve* method
    in THEIR OWN body (brace-matched, not relative to next class)."""
    if path.suffix != ".cs":
        return []
    code_only = _strip_comments_for_code_scan(text)
    v: list[Violation] = []
    for m in CLASS_RE.finditer(code_only):
        cname = m.group(1)
        if not (cname.endswith("Monitor") or cname.endswith("Validator") or cname.endswith("Observer")):
            continue
        body = _find_class_body(code_only, m.end())
        if not MITIGATION_METHOD_RE.search(body):
            line_no = code_only.count("\n", 0, m.start()) + 1
            v.append(Violation("P", str(path.relative_to(REPO_ROOT)), line_no,
                               f"class {cname} ends with Monitor/Validator/Observer but has no Mitigate*/Recover*/Resolve* method in its own body"))
    return v


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--scope", choices=["v025", "all"], default="v025")
    p.add_argument("--paths", nargs="*", default=None,
                   help="explicit file/dir paths (overrides --scope)")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args()

    # Force UTF-8 output on Windows
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    violations: list[Violation] = []
    files = list(iter_files(args.scope, args.paths))
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"[error] cannot read {f}: {e}", file=sys.stderr)
            continue
        violations.extend(check_c1(f, text))
        violations.extend(check_c2(f, text))
        violations.extend(check_rule_p(f, text))

    if violations:
        for v in violations:
            print(v.fmt())
        print(f"\ncairn_lint FAIL: {len(violations)} violations across {len(files)} files (scope={args.scope})")
        return 1

    if not args.quiet:
        print(f"cairn_lint PASS: {len(files)} files clean (scope={args.scope})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
