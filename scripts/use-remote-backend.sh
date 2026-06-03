#!/usr/bin/env bash
# Switch Cairn app to REMOTE backend (https://api.yiiling.cn)
# Also enables Playwright bypass for headless UI testing.
# Usage: bash scripts/use-remote-backend.sh
# After running: restart Expo with --reset-cache

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../app/.env"

sed -i 's|EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn|' "$ENV_FILE"
sed -i 's|EXPO_PUBLIC_PLAYWRIGHT_BYPASS=.*|EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true|' "$ENV_FILE"

echo "✓ Switched to REMOTE backend: https://api.yiiling.cn"
echo "✓ Playwright bypass: ON (skips auth for UI testing)"
echo "  Restart Expo: npx expo start --web --port 8081 --reset-cache"
