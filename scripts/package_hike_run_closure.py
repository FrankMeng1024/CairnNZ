#!/usr/bin/env python3
"""Build and independently validate compact Hike/Run closure evidence archives."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import zipfile


TESTED_HEAD = "ab76e4195373e1372d689ab651451faba2320b2c"
TESTED_TREE = "5457ef40a95d0f00d39727a49b24bf297890ff65"
REVIEW_BASE = "81574c0d2264abb1c1520834d36f4f1dad6124aa"
EXPERIMENT_BASE = "084a34e6de853d077ba8c24b2d5b9ae288144c21"
MAIN_BASE = "79b99a2b4b48f99658d4dc7cc564579d50603486"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(args, cwd=repo)


def copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise RuntimeError(f"Refusing symlink: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def copy_tree(source: Path, destination: Path, *, excluded_parts: set[str] | None = None) -> None:
    excluded_parts = excluded_parts or set()
    for item in sorted(source.rglob("*")):
        relative = item.relative_to(source)
        if any(part in excluded_parts for part in relative.parts):
            continue
        if item.is_symlink():
            raise RuntimeError(f"Refusing symlink: {item}")
        if item.is_file():
            copy_file(item, destination / relative)


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def write_json(path: Path, value: object) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def add_manifest(root: Path) -> int:
    manifest = root / "MANIFEST.sha256"
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path != manifest:
            rows.append(f"{sha256(path)}  {path.relative_to(root).as_posix()}")
    write_text(manifest, "\n".join(rows) + "\n")
    return len(rows)


def zip_root(root: Path, output: Path) -> None:
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(
        output,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, (Path(root.name) / path.relative_to(root)).as_posix())


def validate_zip(archive_path: Path) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="cairn-hike-run-zip-validate-") as temporary:
        extraction = Path(temporary)
        with zipfile.ZipFile(archive_path) as archive:
            bad_crc = archive.testzip()
            if bad_crc:
                raise RuntimeError(f"CRC failure: {bad_crc}")
            for info in archive.infolist():
                relative = Path(info.filename)
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError(f"Unsafe archive path: {info.filename}")
                unix_mode = info.external_attr >> 16
                if stat.S_ISLNK(unix_mode):
                    raise RuntimeError(f"Symlink in archive: {info.filename}")
                if relative.suffix.lower() == ".zip":
                    raise RuntimeError(f"Nested ZIP dependency: {info.filename}")
            archive.extractall(extraction)
        roots = [path for path in extraction.iterdir() if path.is_dir()]
        if len(roots) != 1:
            raise RuntimeError("Archive must contain exactly one root directory")
        root = roots[0]
        manifest = root / "MANIFEST.sha256"
        checked = 0
        for line in manifest.read_text(encoding="utf-8").splitlines():
            expected, relative = line.split("  ", 1)
            target = root / relative
            if not target.is_file() or sha256(target) != expected:
                raise RuntimeError(f"Manifest mismatch: {relative}")
            checked += 1
        opened = {"json": 0, "jsonl": 0, "text": 0, "png": 0, "jpeg": 0}
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            suffix = path.suffix.lower()
            if suffix == ".json":
                json.loads(path.read_text(encoding="utf-8"))
                opened["json"] += 1
            elif suffix == ".jsonl":
                for line in path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        json.loads(line)
                opened["jsonl"] += 1
            elif suffix in {".md", ".tsv", ".txt", ".html", ".patch", ".log"}:
                path.read_text(encoding="utf-8", errors="strict")
                opened["text"] += 1
            elif suffix == ".png":
                if path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                    raise RuntimeError(f"Invalid PNG: {path}")
                opened["png"] += 1
            elif suffix in {".jpg", ".jpeg"}:
                data = path.read_bytes()
                if not (data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")):
                    raise RuntimeError(f"Invalid JPEG: {path}")
                opened["jpeg"] += 1
        return {
            "archive": str(archive_path),
            "bytes": archive_path.stat().st_size,
            "sha256": sha256(archive_path),
            "zipCompression": "ZIP_DEFLATED",
            "freshExtraction": "PASS",
            "crc": "PASS",
            "manifest": "PASS",
            "manifestFilesChecked": checked,
            "symlinks": 0,
            "nestedZipDependencies": 0,
            "openChecks": opened,
        }


def copy_selected_old_core(old: Path, core: Path) -> None:
    for name in [
        "contract",
        "corpus",
        "evidence",
        "experiments",
        "failures",
        "provider",
        "reports",
        "route-correction",
        "tests",
        "validation",
        "backend",
    ]:
        copy_tree(old / name, core / "prior-evidence" / name)
    regression = old / "old-regression"
    regression_out = core / "prior-evidence" / "old-regression"
    copy_tree(regression / "captured-probes", regression_out / "captured-probes")
    copy_tree(regression / "prior-metrics", regression_out / "prior-metrics")
    for metrics in sorted(regression.glob("metrics-*.json")):
        copy_file(metrics, regression_out / metrics.name)
    replay_receipts = []
    for activity_path in sorted((regression / "replayed-activities").glob("*/QA_ACTIVITY.json")):
        activity = json.loads(activity_path.read_text(encoding="utf-8"))
        receipt = {
            "schema": "cairn.hike-run.old-capture-replay-receipt.v1",
            "sourceQaActivitySha256": sha256(activity_path),
            "sourceQaActivityBytes": activity_path.stat().st_size,
            "activityId": activity.get("activityId"),
            "context": activity.get("context"),
            "requestCount": activity.get("requestCount"),
            "directionsRequestCount": activity.get("directionsRequestCount"),
            "transportReceipts": activity.get("transportReceipts"),
            "pointCounts": {
                key: len(activity.get(key) or [])
                for key in ["rawPoints", "canonicalPoints", "liveBeforeFinish", "localFinal", "selectedFinal"]
            },
            "selectedSource": activity.get("selectedSource"),
            "sessionPersistence": {
                key: (activity.get("session") or {}).get(key)
                for key in [
                    "clientActivityId", "syncState", "finalGeometryState",
                    "finalGeometryRevision", "finalGeometryFingerprint",
                ]
            },
            "refinementAuthority": activity.get("refinementAuthority"),
        }
        destination = regression_out / "replay-receipts" / activity_path.parent.name / "REPLAY_RECEIPT.json"
        write_json(destination, receipt)
        replay_receipts.append({
            "caseId": activity_path.parent.name,
            "receipt": destination.relative_to(regression_out).as_posix(),
            "sourceQaActivitySha256": receipt["sourceQaActivitySha256"],
        })
    write_json(
        regression_out / "REPLAY_RECEIPT_INDEX.json",
        {
            "schema": "cairn.hike-run.old-capture-replay-index.v1",
            "caseCount": len(replay_receipts),
            "allCasesHaveReceipts": len(replay_receipts) == 15,
            "note": "Exact value subsets extracted from the original QA_ACTIVITY files; source hashes bind each receipt to the unchanged original package.",
            "receipts": replay_receipts,
        },
    )
    campaign_out = core / "prior-evidence" / "new-campaign"
    campaign = old / "new-campaign"
    diagnostic_exports = []
    for phase in ["baseline", "development", "holdout"]:
        source_phase = campaign / phase
        for path in sorted(source_phase.rglob("*")):
            if not path.is_file():
                continue
            if path.name == "QA_ACTIVITY.json":
                activity = json.loads(path.read_text(encoding="utf-8"))
                diagnostic = activity.get("diagnosticReplay")
                if not isinstance(diagnostic, dict):
                    raise RuntimeError(f"Missing diagnosticReplay: {path}")
                destination = campaign_out / phase / "diagnostic-exports" / path.parent.name / "DIAGNOSTIC_EXPORT.json"
                write_json(destination, diagnostic)
                diagnostic_exports.append({
                    "phase": phase,
                    "caseId": path.parent.name,
                    "sourceQaActivitySha256": sha256(path),
                    "sourceQaActivityBytes": path.stat().st_size,
                    "diagnosticExport": destination.relative_to(campaign_out).as_posix(),
                    "diagnosticExportSha256": sha256(destination),
                    "recordsChecksum": diagnostic.get("recordsChecksum"),
                    "recordCount": len(diagnostic.get("records") or []),
                })
            elif path.name in {
                "metrics-v2.json",
                "NETWORK_BOUNDARY_AUDIT.json",
                "THEME_EVIDENCE.json",
                "PLANT_DURING_ACTIVITY.json",
            }:
                copy_file(path, campaign_out / path.relative_to(campaign))
    write_json(
        campaign_out / "DIAGNOSTIC_EXPORT_INDEX.json",
        {
            "schema": "cairn.hike-run.diagnostic-export-index.v1",
            "caseCount": len(diagnostic_exports),
            "all18Present": len(diagnostic_exports) == 18,
            "extraction": "The diagnosticReplay JSON value was parsed from each original QA_ACTIVITY and reserialized without dropping any field. Source file hashes bind each value to the original complete package.",
            "exports": diagnostic_exports,
        },
    )


def make_final_source_tree(repo: Path, old: Path, core: Path) -> list[str]:
    destination = core / "source" / "tested-tree"
    changed = run(repo, "git", "diff", "--name-only", f"{REVIEW_BASE}..{TESTED_HEAD}").decode().splitlines()
    exact_dependencies = {
        "app/package.json",
        "app/package-lock.json",
        "app/tsconfig.json",
        "app/babel.config.js",
        "app/jest.config.js",
        "app/scripts/overnight-hike-run-freeze-corpus.mjs",
        "app/src/navigation/RootNavigator.tsx",
        "app/src/screens/SettingsScreen.tsx",
        "app/src/services/backgroundLocationTask.ts",
        "app/src/services/syncDaemon.ts",
        "app/src/store/useTrackingStore.ts",
        "app/src/store/useSessionStore.ts",
        "app/src/store/useMemoryStore.ts",
        "app/src/store/useMarkerStore.ts",
        "app/src/store/useRouteStore.ts",
    }
    dependency_prefixes = (
        "app/scripts/hike-run-",
        "app/src/features/activity/",
        "app/src/features/activitySimulator/",
        "app/src/services/routing/",
        "app/src/utils/",
        "backend/scripts/hike-run-",
        "backend/scripts/run-hike-run-",
        "backend/src/",
    )
    repository_files = run(repo, "git", "ls-tree", "-r", "--name-only", TESTED_HEAD).decode().splitlines()
    selected = sorted(set(changed) | {
        relative for relative in repository_files
        if relative in exact_dependencies or relative.startswith(dependency_prefixes)
    })
    for relative in selected:
        try:
            content = run(repo, "git", "show", f"{TESTED_HEAD}:{relative}")
        except subprocess.CalledProcessError:
            target = destination / relative
            if target.exists():
                target.unlink()
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (core / "identity").mkdir(parents=True, exist_ok=True)
    (core / "identity" / "084a34e6-to-81574c0d.patch").write_bytes(
        run(repo, "git", "diff", "--binary", f"{EXPERIMENT_BASE}..{REVIEW_BASE}")
    )
    (core / "identity" / "81574c0d-to-ab76e419.patch").write_bytes(
        run(repo, "git", "diff", "--binary", f"{REVIEW_BASE}..{TESTED_HEAD}")
    )
    write_json(
        core / "source" / "SOURCE_SELECTION.json",
        {
            "testedHead": TESTED_HEAD,
            "testedTree": TESTED_TREE,
            "changedFiles": changed,
            "includedFiles": selected,
            "selectionRule": "All changed modules plus unchanged Activity, simulator, routing, utility, store, backend, configuration and closure-script dependencies required to inspect the implementation.",
        },
    )
    return changed


def build_core(args: argparse.Namespace, stage: Path) -> None:
    repo = args.repo
    old = args.old_core
    strict = args.strict_review
    closure = args.closure
    reports = repo / "docs/review/hike-run-quality-upgrade/closure-20261021"
    copy_tree(reports, stage / "reports")
    copy_tree(strict, stage / "strict-review")
    copy_selected_old_core(old, stage)
    changed = make_final_source_tree(repo, old, stage)
    for source, destination in [
        (closure / "q08-authentic-fixtures", stage / "q08"),
        (closure / "exact/q08-authentic-run", stage / "q08/run"),
        (closure / "exact/diagnostic-replay-all18", stage / "diagnostic-replay"),
        (closure / "exact/client-backend", stage / "client-backend"),
    ]:
        copy_tree(source, destination, excluded_parts={"_browser-profile", "screenshots"})
    copy_file(closure / "exact/q08-authentic-evaluation.json", stage / "q08/q08-authentic-evaluation.json")
    copy_file(closure / "exact/plant-lifecycle/RESULT.json", stage / "plant-lifecycle/RESULT.json")
    copy_file(closure / "exact/plant-lifecycle/PUBLIC_INPUT.json", stage / "plant-lifecycle/PUBLIC_INPUT.json")
    copy_tree(closure / "exact/route-correction", stage / "route-correction", excluded_parts={"screenshots"})
    copy_tree(closure / "exact/verification", stage / "verification")
    for pattern in ["client-backend-smoke*", "diagnostic-raw-replay-smoke*", "plant-lifecycle-smoke*"]:
        for source in sorted(closure.glob(pattern)):
            destination = stage / "attempt-history" / source.name
            copy_tree(source, destination, excluded_parts={"_browser-profile", "screenshots"})
    delivery_head = run(repo, "git", "rev-parse", "HEAD").decode().strip()
    identity = {
        "schema": "cairn.hike-run.strict-closure.source-identity.v1",
        "branch": "codex/hike-run-quality-upgrade-20261020",
        "testedSourceHead": TESTED_HEAD,
        "testedSourceTree": TESTED_TREE,
        "reviewBase": REVIEW_BASE,
        "experimentBase": EXPERIMENT_BASE,
        "originalMainBase": MAIN_BASE,
        "deliveryHeadAtPackaging": delivery_head,
        "changedFiles": changed,
        "originalCompleteZip": {
            "bytes": 18042156,
            "sha256": "5f85d0c8ee5bf5dd1cc3303596b1a77be222a829e4fc58b0a46fff0fd3c658d7",
        },
    }
    write_json(stage / "identity/SOURCE_IDENTITY.json", identity)
    write_text(
        stage / "identity/GIT_IDENTITY.txt",
        run(repo, "git", "show", "--no-patch", "--format=fuller", TESTED_HEAD).decode()
        + "\nTested tree: " + TESTED_TREE + "\nDelivery head at packaging: " + delivery_head + "\n",
    )
    write_text(
        stage / "provider/LEDGER_NOTE.md",
        "# Provider ledger note\n\nThe preserved ledger has 120 dispatched requests and 119 completed requests. "
        "Entry 120 (`snap-http-v1-c4b4049b`, Q09-run-biased-holdout) has no completion record; "
        "a later archived replay reports `NO_CASSETTE_MATCH`. The live upstream outcome is unknown. "
        "No new paid request was made in this closure round.\n",
    )
    write_text(
        stage / "README.md",
        "# Cairn Hike/Run strict-review closure CORE\n\n"
        "Start with `reports/CLOSURE_REPORT_CN.md`, `reports/CLOSURE_ISSUE_LEDGER.md`, and "
        "`reports/CLOSURE_EVIDENCE_INDEX.md`. The overall disposition is HOLD. "
        "All inspection paths are relative; no external network or absolute local path is required. "
        "All 18 complete diagnosticReplay JSON values are preserved under `prior-evidence/new-campaign/`; "
        "the new raw-only replay receipts are under `diagnostic-replay/`.\n",
    )


def extract_selected_visual(old_zip: Path, stage: Path) -> None:
    with zipfile.ZipFile(old_zip) as archive:
        prefix = "Cairn_Hike_Run_Quality_Upgrade_VISUAL/"
        excluded = {
            prefix + "MANIFEST.sha256",
            prefix + "FILE_INDEX.tsv",
            prefix + "index.html",
            prefix + "README.md",
            prefix + "atlases/PHYSICAL_ROUTE_ATLAS.jpg",
        }
        for info in archive.infolist():
            if info.is_dir() or not info.filename.startswith(prefix) or info.filename in excluded:
                continue
            relative = Path(info.filename[len(prefix):])
            if relative.suffix.lower() == ".zip":
                raise RuntimeError("Nested ZIP dependency in legacy visual archive")
            target = stage / "prior-candidate" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))


def build_visual(args: argparse.Namespace, stage: Path) -> None:
    closure = args.closure
    extract_selected_visual(args.old_visual_zip, stage)
    copy_tree(closure / "exact/plant-lifecycle/screenshots", stage / "closure/plant-lifecycle")
    copy_tree(closure / "exact/route-correction", stage / "closure/route-correction")
    write_text(
        stage / "CLOSURE_IMAGE_INDEX.tsv",
        "archive_path\tcase_id\tversion\tview_state\tmapbox_provenance\tsource_image_path\n"
        + "\n".join(
            [
                f"closure/plant-lifecycle/{path.name}\tQ04-hike-normal-holdout\tab76e419\tplant lifecycle {path.stem}\tcaptured provider responses; zero external fallback\t{path}"
                for path in sorted((closure / "exact/plant-lifecycle/screenshots").glob("*.png"))
            ]
            + [
                f"closure/route-correction/{path.relative_to(closure / 'exact/route-correction').as_posix()}\t{path.parts[-2]}\tab76e419\tfailed difficult Activity to Route attempt\tmap failed before provider request; no token\t{path}"
                for path in sorted((closure / "exact/route-correction").rglob("*.png"))
            ]
        )
        + "\n",
    )
    images = sorted(
        path.relative_to(stage).as_posix()
        for path in stage.rglob("*")
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    cards = "\n".join(
        f'<figure><a href="{html.escape(path)}"><img loading="lazy" src="{html.escape(path)}"></a><figcaption>{html.escape(path)}</figcaption></figure>'
        for path in images
    )
    write_text(
        stage / "index.html",
        "<!doctype html><meta charset=\"utf-8\"><title>Cairn Hike/Run closure visuals</title>"
        "<style>body{font-family:system-ui;background:#111;color:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0;background:#222;padding:10px}img{width:100%;height:auto}figcaption{overflow-wrap:anywhere;margin-top:8px}</style>"
        "<h1>Cairn Hike/Run strict-review closure visuals</h1><p>Open images directly for full resolution. Prior-candidate Q08 imagery is historical and its old Excellent grade is invalidated. New difficult Route attempts are retained as failures.</p><main>"
        + cards + "</main>",
    )
    write_text(
        stage / "README.md",
        "# Cairn Hike/Run strict-review closure VISUAL\n\n"
        "`prior-candidate/` preserves same-viewport baseline/candidate, ordinary walk, run, stop/restart, "
        "turn/retraversal, drift recovery, off-network, worst-case, live-frame and successful Q05-normal "
        "Activity→Route evidence. `closure/plant-lifecycle/` contains the new dynamic Plant flow. "
        "`closure/route-correction/` deliberately preserves the failed Q05/Q08 difficult attempts. "
        "The prior physical-route composite was omitted as redundant; its metadata remains and the directly "
        "inspectable off-network/live images remain. Use `index.html` or open any image directly.\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--old-core", type=Path, required=True)
    parser.add_argument("--strict-review", type=Path, required=True)
    parser.add_argument("--closure", type=Path, required=True)
    parser.add_argument("--old-visual-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.repo = args.repo.resolve()
    args.old_core = args.old_core.resolve()
    args.strict_review = args.strict_review.resolve()
    args.closure = args.closure.resolve()
    args.old_visual_zip = args.old_visual_zip.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="cairn-hike-run-package-") as temporary:
        temporary_root = Path(temporary)
        for name, builder in [
            ("Cairn_Hike_Run_Closure_CORE_20261021", build_core),
            ("Cairn_Hike_Run_Closure_VISUAL_20261021", build_visual),
        ]:
            stage = temporary_root / name
            stage.mkdir()
            builder(args, stage)
            add_manifest(stage)
            archive = args.output / f"{name}.zip"
            zip_root(stage, archive)
            result = validate_zip(archive)
            write_json(args.output / f"{name}.validation.json", result)
            results.append(result)
    write_json(args.output / "Cairn_Hike_Run_Closure_20261021_VALIDATION.json", {"archives": results})
    report = args.repo / "docs/review/hike-run-quality-upgrade/closure-20261021/CLOSURE_REPORT_CN.md"
    ledger = args.repo / "docs/review/hike-run-quality-upgrade/closure-20261021/CLOSURE_ISSUE_LEDGER.md"
    copy_file(report, args.output / "Cairn_Hike_Run_Closure_Report_CN_20261021.md")
    copy_file(ledger, args.output / "Cairn_Hike_Run_Closure_Issue_Ledger_20261021.md")
    print(json.dumps({"archives": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
