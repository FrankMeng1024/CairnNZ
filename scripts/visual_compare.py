#!/usr/bin/env python3
"""visual_compare.py — v0.2.5 SSIM compare (Rule M).

Baseline: HTML demo Playwright screenshots from
  http://localhost:8766/design_v2026-06_variant_C_3D.html?v=22day10
Capture timepoints: 0s / 0.5s / 1s / 1.5s after spawn

Workflow:
  1. capture-baseline:
       playwright chromium opens URL, waits for spawn marker (data-cairn-state=spawned),
       then takes screenshots at +0/0.5/1.0/1.5 s.
       outputs: _review/v0.2.5/visual/baseline/t<ms>.png

  2. compare:
       takes Unity Editor capture pngs (passed via --editor-dir) and aligns to baseline by
       filename (t000.png ↔ t000.png) ; computes SSIM ; threshold default 0.65.

CLI:
  visual_compare.py capture-baseline [--url URL]
  visual_compare.py compare --editor-dir DIR [--threshold 0.65]
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = REPO_ROOT / "_review" / "v0.2.5" / "visual" / "baseline"
DEFAULT_URL = "http://localhost:8766/design_v2026-06_variant_C_3D.html?v=22day10"
DEFAULT_THRESHOLD = 0.65
TIMEPOINTS_MS = [0, 500, 1000, 1500]


async def capture_baseline_async(url: str) -> int:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("[err] playwright not installed; pip install playwright && playwright install chromium")
        return 1

    BASELINE_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1080, "height": 1920})
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30000)
        # wait for any cairn-shaped element (page-specific selector; fall back to body)
        try:
            await page.wait_for_selector("[data-cairn-spawn], .cairn, body", timeout=15000)
        except Exception:
            pass

        for ms in TIMEPOINTS_MS:
            if ms > 0:
                await asyncio.sleep(ms / 1000.0)
            target = BASELINE_DIR / f"t{ms:04d}.png"
            await page.screenshot(path=str(target), full_page=False)
            print(f"  baseline saved: {target.relative_to(REPO_ROOT)}")

        await browser.close()
    return 0


def cmd_capture_baseline(args: argparse.Namespace) -> int:
    return asyncio.run(capture_baseline_async(args.url))


def cmd_compare(args: argparse.Namespace) -> int:
    try:
        import numpy as np
        from PIL import Image
        from skimage.metrics import structural_similarity as ssim
    except ImportError as e:
        print(f"[err] missing dep: {e}; pip install -r scripts/requirements.txt")
        return 1

    editor_dir = Path(args.editor_dir).resolve()
    if not editor_dir.exists():
        print(f"[err] editor dir not found: {editor_dir}")
        return 1
    if not BASELINE_DIR.exists():
        print(f"[err] baseline dir missing: {BASELINE_DIR} ; run `capture-baseline` first")
        return 1

    pairs = []
    for ms in TIMEPOINTS_MS:
        b = BASELINE_DIR / f"t{ms:04d}.png"
        e = editor_dir / f"t{ms:04d}.png"
        if not b.exists():
            print(f"[err] baseline missing: {b.relative_to(REPO_ROOT)}")
            return 1
        if not e.exists():
            print(f"[err] editor capture missing: {e.relative_to(REPO_ROOT)}")
            return 1
        pairs.append((ms, b, e))

    threshold = args.threshold
    failures = 0
    for ms, b_path, e_path in pairs:
        bi = np.array(Image.open(b_path).convert("L"))
        ei = np.array(Image.open(e_path).convert("L"))
        # resize to common shape (use baseline shape)
        if bi.shape != ei.shape:
            ei = np.array(Image.open(e_path).convert("L").resize((bi.shape[1], bi.shape[0])))
        score = float(ssim(bi, ei, data_range=255))
        verdict = "PASS" if score >= threshold else "FAIL"
        print(f"  t{ms:04d}: SSIM={score:.4f}  threshold={threshold:.2f}  {verdict}")
        if score < threshold:
            failures += 1
    if failures:
        print(f"visual_compare FAIL: {failures}/{len(pairs)} below threshold")
        return 1
    print(f"visual_compare PASS: {len(pairs)} timepoints all above threshold")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    pb = sub.add_parser("capture-baseline")
    pb.add_argument("--url", default=DEFAULT_URL)
    pb.set_defaults(fn=cmd_capture_baseline)
    pc = sub.add_parser("compare")
    pc.add_argument("--editor-dir", required=True)
    pc.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    pc.set_defaults(fn=cmd_compare)
    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
