#!/usr/bin/env bash
# tools/asset-fingerprint.sh
#
# Compute SHA-256 of the ASSETS that determine v187 portal cairn rendering
# correctness. Lets us detect Unity-version serialization drift:
#   • You build locally with 76f1 → produces hash set A
#   • CI builds with 36f1 → produces hash set B
#   • If A == B  → no drift, EAS-safe
#   • If A != B  → drift detected, identify which file changed before EAS
#
# Used by:
#   1. CI workflow (writes fingerprints to Editor.log)
#   2. Local devs after a testbed build (writes to tools/asset-hashes-local.txt)
#   3. Pre-EAS gate (compare local vs CI fingerprints, fail-fast on mismatch)
#
# v187.7.12 — Strategy B: keep 76f1 locally + 36f1 in CI, monitor drift via
# fingerprints rather than forcing one Unity version.

set -e

# Files whose serialization we MUST monitor across Unity versions.
# Adding a file: only add things that materially affect runtime rendering.
ASSETS=(
  "UnityARLib/Assets/Settings/CairnURPRenderer.asset"
  "UnityARLib/Assets/Settings/CairnURP.asset"
  "UnityARLib/Assets/Settings/CairnVolumeProfile.asset"
  "UnityARLib/Assets/Scenes/CairnAR.unity"
  "UnityARLib/Assets/link.xml"
  "UnityARLib/ProjectSettings/GraphicsSettings.asset"
  "UnityARLib/ProjectSettings/QualitySettings.asset"
  "UnityARLib/ProjectSettings/ProjectSettings.asset"
  "UnityARLib/ProjectSettings/EditorBuildSettings.asset"
  "UnityARLib/ProjectSettings/URPProjectSettings.asset"
  # v199 cinematic-rebuild — 8 new shaders + 3 pebble meshes + V199
  # superlayer script. Cross-Unity-version drift on these (CI 36f1 vs
  # local 76f1) would silently regress visual without this coverage.
  "UnityARLib/Assets/Shaders/PebbleShader.shader"
  "UnityARLib/Assets/Shaders/TypeChipShader.shader"
  "UnityARLib/Assets/Shaders/StoneBackplateShader.shader"
  "UnityARLib/Assets/Shaders/RibbonStrandShader.shader"
  "UnityARLib/Assets/Shaders/LightShaftShader.shader"
  "UnityARLib/Assets/Shaders/ScanningGridShader.shader"
  "UnityARLib/Assets/Shaders/ConfidenceRingShader.shader"
  "UnityARLib/Assets/Shaders/HandshakeBeamShader.shader"
  "UnityARLib/Assets/Meshes/Pebble_S.asset"
  "UnityARLib/Assets/Meshes/Pebble_M.asset"
  "UnityARLib/Assets/Meshes/Pebble_L.asset"
  "UnityARLib/Assets/Scripts/PortalSpawnerV199.cs"
  "UnityARLib/Assets/Scripts/CairnGlobalsExt.cs"
)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==== Asset fingerprint v187.7.12 ===="
echo "Repo root: $REPO_ROOT"
echo "Date: $(date -u +%FT%TZ)"
echo "Project Unity: $(grep '^m_EditorVersion:' UnityARLib/ProjectSettings/ProjectVersion.txt | awk '{print $2}')"
echo ""
echo "ASSET                                                         SHA-256"
echo "-------------------------------------------------------------- ----------------"
for asset in "${ASSETS[@]}"; do
  if [ -f "$asset" ]; then
    h="$(sha256sum "$asset" | awk '{print $1}')"
    printf "%-62s %s\n" "$asset" "$h"
  else
    printf "%-62s %s\n" "$asset" "MISSING"
  fi
done
echo ""
echo "==== END asset fingerprint ===="
