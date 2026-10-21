#!/usr/bin/env python3
"""Create one upload-sized Hike/Run review archive from validated CORE and VISUAL ZIPs."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

from package_hike_run_closure import add_manifest, sha256, validate_zip, write_json, write_text, zip_root


EXPERIMENT_BASE = "084a34e6de853d077ba8c24b2d5b9ae288144c21"
TESTED_HEAD = "ab76e4195373e1372d689ab651451faba2320b2c"
NAME = "Cairn_Hike_Run_Closure_ALL_IN_ONE_SMALL_20261021"


def safe_extract(archive_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            relative = Path(info.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"Unsafe archive path: {info.filename}")
        archive.extractall(destination)
    roots = [path for path in destination.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one archive root in {archive_path}")
    return roots[0]


def remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def prune_core(repo: Path, root: Path) -> None:
    remove_path(root / "MANIFEST.sha256")
    remove_path(root / "attempt-history")
    for pattern in [
        "prior-evidence/contract/prior_review/*.png",
        "prior-evidence/failures/**/*.png",
        "route-correction/**/*.png",
        "q08/run/**/QA_ACTIVITY.json",
        "q08/run/**/SIMULATOR_DIAGNOSTICS.jsonl",
    ]:
        for path in root.glob(pattern):
            remove_path(path)

    tested_tree = root / "source/tested-tree"
    compact_tree = root / "source/changed-and-algorithm-tree"
    changed = subprocess.check_output(
        ["git", "diff", "--name-only", f"{EXPERIMENT_BASE}..{TESTED_HEAD}"],
        cwd=repo,
        text=True,
    ).splitlines()
    always = {
        "app/package.json",
        "app/tsconfig.json",
        "app/src/features/activity/activityFinalArtifact.ts",
        "app/src/features/activity/realGpsContinuity.ts",
        "app/src/services/routing/pedestrianFinalRoute.ts",
        "app/src/services/routing/snapTrack.ts",
        "app/src/services/backgroundLocationTask.ts",
        "app/src/store/useTrackingStore.ts",
    }
    included = []
    for relative in sorted(set(changed) | always):
        source = tested_tree / relative
        if source.is_file():
            target = compact_tree / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            included.append(relative)
    remove_path(tested_tree)
    write_json(
        root / "source/SMALL_SOURCE_SELECTION.json",
        {
            "testedHead": TESTED_HEAD,
            "selection": "Complete final files changed from the experiment baseline through closure, plus named unchanged algorithm dependencies. Full patches remain in identity/.",
            "includedFiles": included,
        },
    )


def convert_visuals(repo: Path, visual_root: Path, output: Path) -> list[dict[str, object]]:
    records = []
    jobs = []
    for source in sorted(visual_root.rglob("*.png")):
        relative = source.relative_to(visual_root)
        target = output / relative.with_suffix(".webp")
        target.parent.mkdir(parents=True, exist_ok=True)
        jobs.append({"source": str(source), "target": str(target)})
    node_program = """
const fs = require('node:fs');
const sharp = require('sharp');
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  for (const job of jobs) {
    await sharp(job.source).webp({ quality: 90, effort: 6 }).toFile(job.target);
  }
})().catch(error => { console.error(error); process.exit(1); });
"""
    subprocess.run(
        ["node", "-e", node_program],
        cwd=repo / "app",
        input=json.dumps(jobs),
        text=True,
        check=True,
    )
    for job in jobs:
        source = Path(job["source"])
        target = Path(job["target"])
        relative = source.relative_to(visual_root)
        records.append(
            {
                "viewingCopy": (Path("visual") / relative.with_suffix(".webp")).as_posix(),
                "sourceArchivePath": relative.as_posix(),
                "sourceSha256": sha256(source),
                "sourceBytes": source.stat().st_size,
                "viewingCopySha256": sha256(target),
                "viewingCopyBytes": target.stat().st_size,
                "codec": "WebP quality 90, unchanged dimensions",
            }
        )
    return records


def build(args: argparse.Namespace, stage: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="cairn-small-core-") as core_tmp, tempfile.TemporaryDirectory(prefix="cairn-small-visual-") as visual_tmp:
        core_root = safe_extract(args.core, Path(core_tmp))
        visual_root = safe_extract(args.visual, Path(visual_tmp))
        prune_core(args.repo, core_root)
        for path in sorted(core_root.iterdir()):
            shutil.move(str(path), stage / path.name)

        visual_output = stage / "visual"
        records = convert_visuals(args.repo, visual_root, visual_output)
        for relative in [
            "README.md",
            "CLOSURE_IMAGE_INDEX.tsv",
            "prior-candidate/IMAGE_INDEX.tsv",
            "prior-candidate/IMAGE_TECHNICAL_INDEX.tsv",
            "prior-candidate/metadata/VISUAL_REVIEW.md",
            "prior-candidate/metadata/GRADES.json",
            "prior-candidate/metadata/route-correction-result.json",
            "prior-candidate/metadata/mapbox-request-ledger.json",
        ]:
            source = visual_root / relative
            if source.is_file():
                target = visual_output / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        write_json(
            visual_output / "VIEWING_COPY_PROVENANCE.json",
            {
                "schema": "cairn.hike-run.small-visual-provenance.v1",
                "originalVisualZip": {
                    "bytes": args.visual.stat().st_size,
                    "sha256": sha256(args.visual),
                },
                "policy": "Full-resolution high-quality WebP viewing copies. Route geometry, UI state and dimensions were not edited. SHA-256 values bind every copy to its original PNG.",
                "images": records,
            },
        )
        cards = "\n".join(
            f'<figure><a href="{html.escape(record["viewingCopy"].removeprefix("visual/"))}"><img loading="lazy" src="{html.escape(record["viewingCopy"].removeprefix("visual/"))}"></a><figcaption>{html.escape(record["sourceArchivePath"])}</figcaption></figure>'
            for record in records
        )
        write_text(
            visual_output / "index.html",
            "<!doctype html><meta charset=\"utf-8\"><title>Cairn Hike/Run evidence</title>"
            "<style>body{font-family:system-ui;background:#111;color:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0;background:#222;padding:10px}img{width:100%;height:auto}figcaption{overflow-wrap:anywhere;margin-top:8px}</style>"
            "<h1>Cairn Hike/Run visual evidence</h1><p>Full-resolution WebP viewing copies; see VIEWING_COPY_PROVENANCE.json for original hashes.</p><main>"
            + cards + "</main>",
        )

    write_text(
        stage / "START_HERE.md",
        "# Cairn Hike/Run — small all-in-one review package\n\n"
        "Start with `reports/CLOSURE_REPORT_CN.md`, `reports/CLOSURE_ISSUE_LEDGER.md`, and "
        "`reports/CLOSURE_EVIDENCE_INDEX.md`; open `visual/index.html` for images. Overall disposition: HOLD.\n\n"
        "This package keeps all 18 diagnostic exports, frozen inputs/truth/evaluator material, per-case metrics, "
        "raw-only replay receipts, exact patches and changed algorithm source, backend/Plant/Q08 results, test logs, "
        "negative Route attempts, provider accounting, and full-resolution visual viewing copies. It removes browser "
        "profiles, repeated wrapper JSON, repeated smoke attempts, the large composite atlas, and unrelated source files.\n",
    )
    write_json(
        stage / "PACKAGE_PROVENANCE.json",
        {
            "schema": "cairn.hike-run.all-in-one-small.v1",
            "sourceCore": {"bytes": args.core.stat().st_size, "sha256": sha256(args.core)},
            "sourceVisual": {"bytes": args.visual.stat().st_size, "sha256": sha256(args.visual)},
            "testedSourceHead": TESTED_HEAD,
            "disposition": "HOLD",
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--visual", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    args.core = args.core.resolve()
    args.visual = args.visual.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cairn-hike-run-small-") as temporary:
        stage = Path(temporary) / NAME
        stage.mkdir()
        build(args, stage)
        add_manifest(stage)
        archive = args.output / f"{NAME}.zip"
        zip_root(stage, archive)
    result = validate_zip(archive)
    write_json(args.output / f"{NAME}.validation.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
