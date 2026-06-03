#!/usr/bin/env bash
# Switch Cairn app to LOCAL backend (http://localhost:3001)
# Also disables Playwright bypass so real auth is used.
# Usage: bash scripts/use-local-backend.sh
# After running: restart Expo with --reset-cache

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../app/.env"

sed -i 's|EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=http://localhost:3001|' "$ENV_FILE"
sed -i 's|EXPO_PUBLIC_PLAYWRIGHT_BYPASS=.*|EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false|' "$ENV_FILE"

echo "✓ Switched to LOCAL backend: http://localhost:3001"
echo "✓ Playwright bypass: OFF (real auth)"
echo "  Restart Expo: npx expo start --web --port 8081 --reset-cache"
