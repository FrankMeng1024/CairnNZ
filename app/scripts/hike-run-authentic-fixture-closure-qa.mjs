#!/usr/bin/env node

/** Execute corrected late-batch fixtures through the actual tracking/Finish
 * pipeline. Private route diaries never enter the browser; the standard
 * overnight evaluator scores the resulting QA_ACTIVITY files afterward. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const outputRoot = path.resolve(argument('--output', '_review/hike-run-authentic-fixture-closure'));
const fixturePaths = String(argument('--fixtures', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const sourceActivityPaths = String(argument('--source-activities', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const sourceHead = argument('--head', 'dirty-development-worktree');
const sourceTree = argument('--tree', 'dirty-development-worktree');
if (fixturePaths.length === 0 || fixturePaths.length !== sourceActivityPaths.length) {
  throw new Error('fixtures_and_source_activities_must_have_same_nonzero_count');
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const rawIdentity = events => sha256(JSON.stringify(events.map(event => ({
  ordinal: event.ordinal,
  observationTimeMs: event.observationTimeMs,
  coordinate: event.coordinate,
  altitudeM: event.altitudeM ?? null,
  accuracyM: event.accuracyM ?? null,
  speedMps: event.speedMps ?? null,
}))));

fs.mkdirSync(outputRoot, { recursive: true });
const ownerUserId = 'hike-run-authentic-fixture-owner';
const browserErrors = [];
let externalMapboxRequestCount = 0;
const context = await chromium.launchPersistentContext(path.join(outputRoot, '_browser-profile'), {
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  viewport: { width: 390, height: 844 },
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  args: ['--disable-web-security'],
});
const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => browserErrors.push(error.message));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
      && !value.includes('Failed to load resource')
      && !value.includes('Mapbox')) browserErrors.push(value.slice(0, 500));
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/auth/me') return reply({ user: { id: ownerUserId, name: 'Authentic Fixture QA', email: 'authentic-fixture@example.invalid' } });
  if (pathname === '/api/sessions/unfinished') return reply({ session: null });
  if (pathname === '/api/sessions') return reply({ sessions: [] });
  if (pathname === '/api/routes') return reply([]);
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return reply({ points: [], presence_witnesses: [] });
  }
  return reply({ ok: true, data: [], routes: [], sessions: [], markers: [] });
});
for (const pattern of ['**/matching/v5/**', '**/directions/v5/**']) {
  await page.route(pattern, route => {
    externalMapboxRequestCount += 1;
    return route.abort('blockedbyclient');
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.snapLabLogicalRunner
  && globalThis.__cairnStores?.useAppStore
  && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(ownerId => {
  localStorage.setItem('cairn_jwt', 'authentic-fixture-local-browser-authority');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: ownerId, name: 'Authentic Fixture QA', email: 'authentic-fixture@example.invalid' },
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

const results = [];
for (let index = 0; index < fixturePaths.length; index += 1) {
  const fixturePath = fixturePaths[index];
  const sourceActivityPath = sourceActivityPaths[index];
  const fixtureBytes = fs.readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes);
  const sourceActivity = JSON.parse(fs.readFileSync(sourceActivityPath));
  const sourceDiagnostic = sourceActivity.diagnosticReplay;
  if (!Array.isArray(sourceDiagnostic?.providerResponses)) {
    throw new Error(`provider_responses_missing:${sourceActivityPath}`);
  }
  fixture.transportConfig = {
    mode: 'captured-real',
    cassetteEntries: sourceDiagnostic.providerResponses,
  };
  const beforeExternalCount = externalMapboxRequestCount;
  const activityId = `qa-snap-closure-${fixture.profile}-${fixture.fixtureSha256.slice(0, 12)}`;
  const run = await page.evaluate(async ({ publicInput, options }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.runSnapLabLogicalJourney(publicInput, options)
  ), {
    publicInput: fixture,
    options: {
      ownerUserId,
      activityId,
      activityName: `Closure ${fixture.runId}`,
      matrixSha256: sha256(fixtureBytes),
      retainQaRealmForDetailCapture: false,
    },
  });
  const runDir = path.join(outputRoot, 'activities', fixture.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(fixturePath, path.join(runDir, 'PUBLIC_INPUT.json'));
  writeJson(path.join(runDir, 'QA_ACTIVITY.json'), run.persisted);
  fs.writeFileSync(path.join(runDir, 'SIMULATOR_DIAGNOSTICS.jsonl'), run.simulatorDiagnostics ?? '');
  const receiptSummary = {
    total: run.persisted.transportReceipts.length,
    matched: run.persisted.transportReceipts.filter(receipt => receipt.matched === true).length,
    unavailable: run.persisted.transportReceipts.filter(receipt => receipt.matched !== true || receipt.status == null).length,
  };
  const diagnostic = run.persisted.diagnosticReplay;
  const result = {
    schema: 'cairn.hike-run.authentic-fixture-closure-case.v1',
    runId: fixture.runId,
    source: { head: sourceHead, tree: sourceTree },
    fixture: {
      path: fixturePath,
      fileSha256: sha256(fixtureBytes),
      declaredSha256: fixture.fixtureSha256,
      deliveryMode: fixture.clock.deliveryMode,
      rawEventCount: fixture.rawEvents.length,
      rawIdentitySha256: rawIdentity(fixture.rawEvents),
      oldSourceActivityPath: sourceActivityPath,
      oldDiagnosticRecordsChecksum: sourceDiagnostic.recordsChecksum ?? null,
    },
    execution: {
      platform: run.platform,
      rawEventCount: run.rawEventCount,
      accepted: run.acceptedCallbackCount,
      rejected: run.rejectedCallbackCount,
      acceptanceReasons: run.acceptanceReasons,
      acceptanceReceipts: run.acceptanceReceipts,
      preFinish: run.preFinish,
      finishResult: run.retryFinishResult ?? run.firstFinishResult,
      coldReopenFingerprint: run.coldReopened.session.finalGeometryFingerprint,
      persistedFingerprint: run.persisted.session.finalGeometryFingerprint,
      cleanupStatus: run.cleanupStatus,
    },
    provider: {
      source: 'CAPTURED_REAL_RESPONSE_CASSETTE_FROM_PREVIOUS_Q08_RUN',
      cassetteEntryCount: sourceDiagnostic.providerResponses.length,
      receiptSummary,
      externalMapboxRequestCount: externalMapboxRequestCount - beforeExternalCount,
    },
    diagnostic: {
      version: diagnostic?.version ?? null,
      completeness: diagnostic?.completeness ?? null,
      rawObservationCount: diagnostic?.records?.filter(record => record.kind === 'raw-observation').length ?? null,
    },
    passed: run.rawEventCount === fixture.rawEvents.length
      && run.acceptedCallbackCount + run.rejectedCallbackCount === fixture.rawEvents.length
      && run.persisted.session.finalGeometryFingerprint === run.coldReopened.session.finalGeometryFingerprint
      && run.cleanupStatus.status === 'cleared'
      && externalMapboxRequestCount === beforeExternalCount
      && diagnostic?.completeness?.selfContainedReplayComplete === true
      && browserErrors.length === 0,
  };
  writeJson(path.join(runDir, 'CLOSURE_RESULT.json'), result);
  results.push(result);
}

await context.close();
const summary = {
  schema: 'cairn.hike-run.authentic-fixture-closure-summary.v1',
  generatedAt: new Date().toISOString(),
  source: { head: sourceHead, tree: sourceTree },
  result: results.every(item => item.passed) ? 'PASS' : 'FAIL',
  caseCount: results.length,
  externalMapboxRequestCount,
  browserErrors,
  cases: results.map(item => ({
    runId: item.runId,
    passed: item.passed,
    accepted: item.execution.accepted,
    rejected: item.execution.rejected,
    provider: item.provider.receiptSummary,
    diagnosticComplete: item.diagnostic.completeness?.selfContainedReplayComplete ?? false,
  })),
};
writeJson(path.join(outputRoot, 'SUMMARY.json'), summary);
if (summary.result !== 'PASS') process.exitCode = 1;
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
