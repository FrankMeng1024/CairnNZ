#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outputRoot = path.resolve(argument(
  '--output',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/sentinels-before-fix'),
));
const inputRoot = path.resolve(argument('--input', outputRoot));
const inputActivityRoot = path.resolve(argument('--activities', path.join(inputRoot, 'activities')));
const inputCaptureRoot = path.resolve(argument('--captures', path.join(inputRoot, 'http-captures')));
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const runIds = String(argument('--runs', 'X01-hike-normal,X02-hike-normal')).split(',').filter(Boolean);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let unexpectedNavigationRequests = 0;
await page.route('**/matching/v5/**', route => {
  unexpectedNavigationRequests += 1;
  return route.abort('blockedbyclient');
});
await page.route('**/directions/v5/**', route => {
  unexpectedNavigationRequests += 1;
  return route.abort('blockedbyclient');
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ user: null, data: [], routes: [], sessions: [], markers: [], points: [] }),
}));

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(
    globalThis.__cairnStores?.snapLabLogicalRunner?.probeSnapLabFinalWithCapturedResponses,
  ), null, { timeout: 120_000 });
  const reports = [];
  for (const runId of runIds) {
    const activity = JSON.parse(fs.readFileSync(
      path.join(inputActivityRoot, runId, 'QA_ACTIVITY.json'),
      'utf8',
    ));
    const entries = activity.transportReceipts.map(receipt => {
      const capture = JSON.parse(fs.readFileSync(
        path.join(inputCaptureRoot, `${receipt.requestFingerprint}.json`),
        'utf8',
      ));
      return {
        requestFingerprint: capture.requestFingerprint,
        method: 'GET',
        sanitizedUrl: capture.sanitizedUrl,
        status: capture.status,
        headers: capture.headers,
        body: capture.body,
        provenance: 'CAPTURED_REAL_RESPONSE',
        capturedAt: capture.capturedAt,
      };
    });
    const result = await page.evaluate(async input => (
      globalThis.__cairnStores.snapLabLogicalRunner.probeSnapLabFinalWithCapturedResponses(
        input.canonical,
        input.entries,
        input.context,
      )
    ), {
      canonical: activity.canonicalPoints,
      entries,
      context: {
        caseId: activity.context.caseId,
        profileId: activity.context.profileId,
        seed: activity.context.seed,
        requestIdentity: activity.context.requestIdentity,
      },
    });
    const report = {
      schema: 'cairn.real-map-snap.captured-probe.v1',
      runId,
      capturedResponseCount: entries.length,
      selectedSource: result.selectedSource,
      acceptedIslandCount: result.acceptedIslandCount,
      requestCount: result.requestCount,
      directionsRequestCount: result.directionsRequestCount,
      localFinal: result.localFinal,
      selectedFinal: result.selectedFinal,
      segmentStats: result.segmentStats,
      transportReceipts: result.transportReceipts,
    };
    writeJson(path.join(outputRoot, 'captured-probes', `${runId}.json`), report);
    writeJson(path.join(outputRoot, 'replayed-activities', runId, 'QA_ACTIVITY.json'), {
      ...activity,
      localFinal: result.localFinal,
      selectedFinal: result.selectedFinal,
      selectedSource: result.selectedSource,
      segmentStats: result.segmentStats,
      requestCount: result.requestCount,
      directionsRequestCount: result.directionsRequestCount,
      acceptedIslandCount: result.acceptedIslandCount,
      transportReceipts: result.transportReceipts,
    });
    reports.push(report);
  }
  if (unexpectedNavigationRequests !== 0) throw new Error('captured_probe_network_fallback');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    unexpectedNavigationRequests,
    cases: reports.map(report => ({
      runId: report.runId,
      selectedSource: report.selectedSource,
      acceptedIslandCount: report.acceptedIslandCount,
    })),
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
