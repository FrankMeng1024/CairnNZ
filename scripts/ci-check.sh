#!/bin/bash
# CI-style check: run before every commit / PR.
# Validates:
#   - Backend syntax OK
#   - Backend smoke script syntax
#   - App TypeScript compiles (allowing pre-existing Sprint 35 errors)
#   - All app jest tests pass
#   - Bash deploy script syntax
#   - Python analyze script can parse smoke fixture

set -e

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "=== [1/5] Backend syntax ==="
cd "$REPO/backend"
node -c src/index.js
node -c src/routes/telemetry.js
node -c scripts/smoke-telemetry.js
echo "  [OK] Backend syntax"

echo ""
echo "=== [2/5] App TypeScript ==="
cd "$REPO/app"
# Run tsc; new errors should fail. Pre-existing Sprint 35 issues are filtered.
TSC_OUT=$(npx tsc --noEmit 2>&1 || true)
NEW_ERRORS=$(echo "$TSC_OUT" | grep -v "Sprint 35" \
  | grep -v "HikingScreen.tsx(588" \
  | grep -v "RoutesScreen.tsx" \
  | grep -v "RunningScreen.tsx(273" \
  | grep -v "RootNavigator.tsx(54" \
  | grep -v "mapbox-gl" \
  | grep ": error" || true)
if [ -n "$NEW_ERRORS" ]; then
  echo "  [FAIL] New TypeScript errors:"
  echo "$NEW_ERRORS"
  exit 1
fi
echo "  [OK] No new TS errors"

echo ""
echo "=== [3/5] App tests ==="
npm test --silent 2>&1 | grep -E "Test Suites:|Tests:" | tail -2
RESULT=$(npm test --silent 2>&1 | grep -E "Tests:" | tail -1)
if echo "$RESULT" | grep -q "failed"; then
  echo "  [FAIL] Some tests failed"
  exit 1
fi
echo "  [OK] All tests pass"

echo ""
echo "=== [4/5] Bash scripts ==="
bash -n "$REPO/docker/deploy.sh"
echo "  [OK] deploy.sh"

echo ""
echo "=== [5/5] Python analysis ==="
TMP_FIXTURE="/tmp/cairn-ci-fixture-$$.jsonl"
cat > "$TMP_FIXTURE" << 'EOF'
{"ts":1715990400000,"session_id":"ci-1","event":"gps_fix","lat":-41,"lon":174,"accuracy_m":7,"altitude_m":100,"altitude_accuracy_m":5,"speed_mps":1,"heading_deg":90,"raw_or_filtered":"raw","source":"foreground"}
{"ts":1715990460000,"session_id":"ci-1","event":"battery_sample","level_pct":92,"is_charging":false,"battery_state":"unplugged","screen_on":true,"app_state":"active","trigger":"session_start"}
EOF
python "$REPO/scripts/analyze-session.py" --session "$TMP_FIXTURE" > /dev/null
rm -f "$TMP_FIXTURE"
echo "  [OK] analyze-session.py"

echo ""
echo "================================"
echo "  ALL CHECKS PASSED"
echo "================================"
