#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const outputRoot = path.resolve(argument('--output', '_review/hike-run-diagnostic-raw-replay'));
const sourceHead = argument('--head', 'dirty-development-worktree');
const sourceTree = argument('--tree', 'dirty-development-worktree');
const exportPaths = String(argument('--exports', ''))
  .split(',')
  .filter(Boolean)
  .map(value => path.resolve(value));
if (exportPaths.length === 0) throw new Error('pass --exports path/to/QA_ACTIVITY.json[,path/to/other.json]');

const ownerUserId = 'hike-run-diagnostic-replay-owner';
const profileDir = path.join(outputRoot, '_browser-profile');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const fingerprint = points => {
  let hash = 0x811c9dc5;
  const segmentOrdinals = new Map();
  for (const point of points ?? []) {
    const rawSegment = point.segmentId ?? 'legacy';
    if (!segmentOrdinals.has(rawSegment)) segmentOrdinals.set(rawSegment, segmentOrdinals.size);
    // Activity IDs and generation suffixes are intentionally fresh on replay.
    // Normalize segment identities while retaining every segment boundary.
    const value = `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)},s${segmentOrdinals.get(rawSegment)};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
};

function fixtureFromDiagnostic(diagnostic) {
  if (diagnostic?.completeness?.complete !== true) throw new Error('diagnostic_replay_incomplete');
  const raw = diagnostic.records.filter(record => record.kind === 'raw-observation');
  if (raw.length === 0) throw new Error('diagnostic_replay_has_no_raw_observations');
  const start = diagnostic.records.find(record => record.kind === 'diagnostic-start');
  const observationTimes = raw.map(record => Number(record.data.observationTimeMs));
  const observationStartMs = Math.min(...observationTimes);
  const startWallTimeMs = Number(start?.wallTimeMs);
  const firstReceiptWallTimeMs = Number(raw[0]?.data?.receiptWallTimeMs);
  const receiptEpochMs = Number.isFinite(startWallTimeMs) ? startWallTimeMs : firstReceiptWallTimeMs;
  return {
    schema: 'cairn.activity-diagnostic-raw-replay.v1',
    fixtureSha256: diagnostic.recordsChecksum,
    caseId: `diagnostic-${diagnostic.clientActivityId.slice(-12)}`,
    mode: start?.data?.mode === 'running' ? 'run' : 'hike',
    profile: 'captured-owner-diagnostic',
    seed: 1,
    contractIntent: {
      scenario: 'Owner diagnostic raw observations replayed through production tracking acceptance.',
      transportFixture: 'Captured provider responses; cassette mismatch fails closed.',
      oracleRequirements: 'Canonical and Final artifacts are comparison outputs only.',
    },
    durationSeconds: (Math.max(...observationTimes) - Math.min(...observationTimes)) / 1_000,
    clock: {
      observationStartMs,
      observationEndMs: Math.max(...observationTimes),
      observationIntervalSeconds: 0,
      deliveryMode: 'diagnostic-recorded-receipt-order',
    },
    rawEvents: raw.map((record, ordinal) => ({
      ordinal,
      observationTimeMs: Number(record.data.observationTimeMs),
      deliveryTimeMs: Number.isFinite(Number(record.data.receiptWallTimeMs))
          && Number.isFinite(receiptEpochMs)
        ? observationStartMs + Math.max(0, Number(record.data.receiptWallTimeMs) - receiptEpochMs)
        : Number(record.data.observationTimeMs),
      appState: typeof record.data.appStateAtReceipt === 'string' ? record.data.appStateAtReceipt : 'unknown',
      coordinate: { lat: Number(record.data.lat), lng: Number(record.data.lng) },
      altitudeM: record.data.altitudeM == null ? null : Number(record.data.altitudeM),
      accuracyM: record.data.horizontalAccuracyM == null ? null : Number(record.data.horizontalAccuracyM),
      verticalAccuracyM: record.data.verticalAccuracyM == null
        ? null
        : Number(record.data.verticalAccuracyM),
      speedMps: record.data.speedMps == null ? null : Number(record.data.speedMps),
      speedAccuracyMps: record.data.speedAccuracyMps == null ? null : Number(record.data.speedAccuracyMps),
      courseDeg: record.data.courseDeg == null ? null : Number(record.data.courseDeg),
      courseAccuracyDeg: record.data.courseAccuracyDeg == null
        ? null
        : Number(record.data.courseAccuracyDeg),
      source: 'simulator',
      callbackIdentity: typeof record.data.callbackIdentity === 'string'
        ? record.data.callbackIdentity
        : null,
      nativeBatchSequence: record.data.nativeBatchSequence == null
        ? null
        : Number(record.data.nativeBatchSequence),
      nativeBatchIndex: record.data.nativeBatchIndex == null
        ? null
        : Number(record.data.nativeBatchIndex),
      receiptMonotonicTimeMs: record.monotonicTimeMs == null
        ? null
        : Number(record.monotonicTimeMs),
    })),
    lifecycle: {
      trueBlackout: false,
      offlineAtFinish: false,
      restoreOnlineAfterColdOpen: false,
      slowDiagnosticWriteMs: 0,
      walReadFaultOnce: false,
      yieldedFinish: false,
    },
    transportScenario: 'captured-owner-diagnostic',
    transportConfig: { mode: 'captured-real', cassetteEntries: diagnostic.providerResponses ?? [] },
  };
}

fs.mkdirSync(outputRoot, { recursive: true });
const browserErrors = [];
const unexpectedNetwork = [];
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  viewport: { width: 390, height: 844 },
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2865, longitude: 174.7762, accuracy: 8 },
  permissions: ['geolocation'],
  args: ['--disable-web-security'],
});
const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => browserErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    browserErrors.push(message.text().slice(0, 500));
  }
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== 'GET') unexpectedNetwork.push({ method: request.method(), path: url.pathname });
  const fulfill = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return fulfill({ user: { id: ownerUserId, name: 'Diagnostic Replay', email: 'diagnostic@example.invalid' } });
  if (url.pathname === '/api/sessions/unfinished') return fulfill({ session: null });
  if (url.pathname === '/api/sessions') return fulfill({ sessions: [] });
  if (url.pathname === '/api/routes') return fulfill([]);
  if (url.pathname === '/api/memory/points' || url.pathname === '/api/memory/sync') return fulfill({ points: [], presence_witnesses: [] });
  return fulfill({ ok: true, data: [], routes: [], sessions: [], markers: [] });
});
await page.route('**/matching/v5/**', route => route.abort('blockedbyclient'));
await page.route('**/directions/v5/**', route => route.abort('blockedbyclient'));
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.snapLabLogicalRunner
  && globalThis.__cairnStores?.useTrackingStore
  && globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(ownerId => {
  localStorage.setItem('cairn_jwt', 'diagnostic-replay-local-authority');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: ownerId, name: 'Diagnostic Replay', email: 'diagnostic@example.invalid' },
    isLoggedIn: true, hydrated: true, sessionExpired: false,
  });
  stores.useSessionStore.setState({ currentUserId: ownerId, sessions: [] });
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
}, ownerUserId);
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({
  index: 1, routes: [{ name: 'Home' }, { name: 'Debug' }],
}));
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Debug', null, { timeout: 30_000 });

const receipts = [];
for (const [index, exportPath] of exportPaths.entries()) {
  const sourceBytes = fs.readFileSync(exportPath);
  const source = JSON.parse(sourceBytes);
  const diagnostic = source.diagnosticReplay ?? source;
  const fixture = fixtureFromDiagnostic(diagnostic);
  const activityId = `qa-snap-diag-${index}-${diagnostic.recordsChecksum}`;
  process.stderr.write(`[diagnostic replay ${index + 1}/${exportPaths.length}] ${path.basename(path.dirname(exportPath))}\n`);
  const run = await page.evaluate(async input => (
    globalThis.__cairnStores.snapLabLogicalRunner.runSnapLabLogicalJourney(input.fixture, input.options)
  ), {
    fixture,
    options: {
      ownerUserId,
      activityId,
      activityName: `Diagnostic replay ${diagnostic.clientActivityId.slice(-12)}`,
      matrixSha256: diagnostic.recordsChecksum,
    },
  });
  const expectedDecisions = diagnostic.records
    .filter(record => record.kind === 'observation-decision')
    .map((record, ordinal) => ({
      ordinal,
      observationTimeMs: Number(record.data.observationTimeMs),
      accepted: record.data.accepted === true,
      reason: String(record.data.reason),
    }));
  const replayedDiagnosticDecisions = (run.persisted.diagnosticReplay?.records ?? [])
    .filter(record => record.kind === 'observation-decision')
    .map((record, ordinal) => ({
      ordinal,
      observationTimeMs: Number(record.data.observationTimeMs),
      accepted: record.data.accepted === true,
      reason: String(record.data.reason),
    }));
  const artifact = diagnostic.finalArtifact;
  const expectedCanonicalFingerprint = fingerprint(artifact.canonicalPoints);
  const expectedLocalFingerprint = fingerprint(artifact.localFinalPoints);
  const expectedSelectedFingerprint = fingerprint(artifact.selectedFinalPoints);
  const checks = {
    rawCountExact: run.rawEventCount === fixture.rawEvents.length,
    perObservationDecisionsExact: JSON.stringify(replayedDiagnosticDecisions) === JSON.stringify(expectedDecisions),
    canonicalCountExact: run.persisted.canonicalPoints.length === artifact.canonicalPointCount,
    canonicalFingerprintExact: fingerprint(run.persisted.canonicalPoints) === expectedCanonicalFingerprint,
    localFingerprintExact: fingerprint(run.persisted.localFinal) === expectedLocalFingerprint,
    selectedSourceExact: run.persisted.selectedSource === artifact.selectedSource,
    selectedFingerprintExact: fingerprint(run.persisted.selectedFinal) === expectedSelectedFingerprint,
    coldReopenExact: fingerprint(run.coldReopened.selectedFinal) === expectedSelectedFingerprint,
    noLiveProviderFallback: unexpectedNetwork.length === 0,
    cleanupComplete: run.cleanupStatus?.status === 'cleared',
  };
  const receipt = {
    schema: 'cairn.activity-diagnostic-raw-replay-receipt.v1',
    source: { path: exportPath, sha256: sha256(sourceBytes), clientActivityId: diagnostic.clientActivityId },
    sourceIdentity: { sourceHead, sourceTree },
    rawInputAuthority: 'diagnostic raw-observation records only',
    comparisonOnly: ['finalArtifact.canonicalPoints', 'finalArtifact.localFinalPoints', 'finalArtifact.selectedFinalPoints'],
    provider: {
      mode: 'captured-only',
      suppliedResponseCount: diagnostic.providerResponses?.length ?? 0,
      dispatchedRequestCount: run.persisted.transportReceipts?.length ?? 0,
      receipts: run.persisted.transportReceipts ?? [],
      liveFallbackAllowed: false,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
    actual: {
      rawCount: run.rawEventCount,
      acceptedCount: run.acceptedCallbackCount,
      rejectedCount: run.rejectedCallbackCount,
      canonicalCount: run.persisted.canonicalPoints.length,
      canonicalFingerprint: fingerprint(run.persisted.canonicalPoints),
      expectedCanonicalFingerprint,
      localFingerprint: fingerprint(run.persisted.localFinal),
      expectedLocalFingerprint,
      selectedSource: run.persisted.selectedSource,
      selectedFingerprint: fingerprint(run.persisted.selectedFinal),
      expectedSelectedFingerprint,
      acceptanceReceipts: run.acceptanceReceipts,
      diagnosticDecisionReceipts: replayedDiagnosticDecisions,
    },
    browserErrors: browserErrors.splice(0),
  };
  receipts.push(receipt);
  writeJson(path.join(outputRoot, `${path.basename(path.dirname(exportPath))}-receipt.json`), receipt);
}
await context.close();
const summary = {
  schema: 'cairn.activity-diagnostic-raw-replay-summary.v1',
  generatedAt: new Date().toISOString(),
  sourceIdentity: { sourceHead, sourceTree },
  cases: receipts.length,
  passed: receipts.filter(receipt => receipt.passed).length,
  failed: receipts.filter(receipt => !receipt.passed).length,
  unexpectedNetwork,
  receipts,
};
writeJson(path.join(outputRoot, 'SUMMARY.json'), summary);
if (summary.failed > 0 || unexpectedNetwork.length > 0) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ output: path.join(outputRoot, 'SUMMARY.json'), cases: summary.cases, passed: summary.passed })}\n`);
