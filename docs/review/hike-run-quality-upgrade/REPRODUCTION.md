# Evidence reproduction

All commands run from repository root unless noted. They use captured responses and do not require a Mapbox token except atlas regeneration.

```sh
cd app
npm run verify:changed

CAIRN_DIAGNOSTIC_EXPORT_PATH=/path/to/QA_ACTIVITY.json \
  npx jest --runInBand src/features/activity/__tests__/activityDiagnosticFreshProcessReplay.test.ts

node scripts/overnight-hike-run-evaluate.mjs \
  --corpus /path/to/frozen-corpus \
  --results /path/to/candidate-exact-development-final,/path/to/candidate-exact-holdout-final2 \
  --include all \
  --output /tmp/cairn-metrics.json
```

Captured old regression:

```sh
node app/scripts/real-map-snap-captured-probe.mjs \
  --input /path/to/prior-group \
  --captures /path/to/captured-response-inputs \
  --output /tmp/cairn-old-regression \
  --runs comma,separated,run-ids \
  --url http://127.0.0.1:8098
```

The review ZIP has `SHA256SUMS.txt`; verify with `shasum -a 256 -c SHA256SUMS.txt` from its extracted root. Provider URLs are credential-stripped. No clean diary is required or permitted for application replay; private diaries are only evaluator inputs.
