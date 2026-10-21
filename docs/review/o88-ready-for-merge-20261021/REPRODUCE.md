# Reproduction commands

Run only in an isolated clone/worktree. The database scripts create and remove their own local Docker MySQL containers and anonymous volumes.

```sh
cd app
npm ci --ignore-scripts
npm run verify:changed
npm test -- --runInBand --forceExit
npm run verify:full
npx tsc --noEmit --pretty false
npx expo install --check
```

```sh
cd backend
node --test
node scripts/node-cron-v4-smoke.js
SHANGHAI_CLEANUP_BATCH_MODE=explicit-expired ./scripts/run-cairn-shanghai-fixture-rehearsal.sh
SHANGHAI_CLEANUP_BATCH_MODE=active-elapsed ./scripts/run-cairn-shanghai-fixture-rehearsal.sh
SHANGHAI_CLEANUP_BATCH_MODE=active-valid ./scripts/run-cairn-shanghai-fixture-rehearsal.sh
./scripts/run-public-cairn-harness.sh
./scripts/run-personal-friends-harness.sh
```

For visual evidence, start Expo Web with an authorized Mapbox environment and a dedicated port, then run `app/scripts/cairn-o88-review-capture.mjs` and `app/scripts/o88-found-detail-qa.mjs` with their output-directory environment variables. Never persist or export the token. The connected runner is documented by `backend/scripts/run-public-cairn-harness.sh`; use `SKIP_API_BASELINE=1 SKIP_MEMORY_BASELINE=1` when running it after a separate clean baseline so connected actors have a fresh schema.

Do not run these scripts against production or shared identities.
