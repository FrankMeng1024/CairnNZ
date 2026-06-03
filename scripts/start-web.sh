#!/usr/bin/env bash
# Start Expo web with a clean Metro cache.
# Automatically picks up whatever backend is in app/.env
#
# Usage:
#   bash scripts/start-web.sh           # uses current .env setting
#   bash scripts/start-web.sh local     # switches to local first
#   bash scripts/start-web.sh remote    # switches to remote first

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$1" = "local" ]; then
  bash "$SCRIPT_DIR/use-local-backend.sh"
elif [ "$1" = "remote" ]; then
  bash "$SCRIPT_DIR/use-remote-backend.sh"
fi

# Show current setting
CURRENT=$(grep EXPO_PUBLIC_API_BASE_URL "$SCRIPT_DIR/../app/.env" | cut -d= -f2)
echo "→ Backend: $CURRENT"
echo "→ Starting Expo web on port 8081..."

cd "$SCRIPT_DIR/../app" && npx expo start --web --port 8081 --reset-cache
