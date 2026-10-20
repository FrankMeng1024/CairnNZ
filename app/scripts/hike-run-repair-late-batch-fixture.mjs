#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const inputPaths = String(argument('--inputs', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const outputRoot = path.resolve(argument('--output', '_review/hike-run-authentic-late-batch'));
if (inputPaths.length === 0) throw new Error('pass --inputs old-fixture.json[,old-fixture.json]');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function audit(events) {
  let previousDelivery = -Infinity;
  let previousMaximumObservation = -Infinity;
  let currentDelivery = NaN;
  let currentMaximumObservation = -Infinity;
  const issues = [];
  const close = () => {
    if (!Number.isFinite(currentDelivery)) return;
    previousDelivery = currentDelivery;
    previousMaximumObservation = Math.max(previousMaximumObservation, currentMaximumObservation);
  };
  for (const event of events) {
    if (event.deliveryTimeMs !== currentDelivery) {
      close();
      currentDelivery = event.deliveryTimeMs;
      currentMaximumObservation = -Infinity;
      if (event.observationTimeMs <= previousMaximumObservation && event.duplicateOfProviderOrdinal == null) {
        issues.push({
          ordinal: event.ordinal,
          observationTimeMs: event.observationTimeMs,
          deliveryTimeMs: event.deliveryTimeMs,
          previousDeliveryTimeMs: previousDelivery,
          previousMaximumObservationTimeMs: previousMaximumObservation,
        });
      }
    }
    currentMaximumObservation = Math.max(currentMaximumObservation, event.observationTimeMs);
  }
  close();
  return { authentic: issues.length === 0, issueCount: issues.length, issues };
}

const results = [];
for (const inputPath of inputPaths) {
  const inputBytes = fs.readFileSync(inputPath);
  const fixture = JSON.parse(inputBytes);
  const delayedGroups = new Map();
  for (const event of fixture.rawEvents) {
    if (event.deliveryTimeMs <= event.observationTimeMs + 1_000) continue;
    const group = delayedGroups.get(event.deliveryTimeMs) ?? [];
    group.push(event);
    delayedGroups.set(event.deliveryTimeMs, group);
  }
  const [deliveryTimeMs, heldEvents] = [...delayedGroups.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0] ?? [];
  if (!deliveryTimeMs || !heldEvents || heldEvents.length < 2) {
    throw new Error(`no_late_batch_found:${inputPath}`);
  }
  const firstHeldObservationTimeMs = Math.min(...heldEvents.map(event => event.observationTimeMs));
  const repairedEvents = fixture.rawEvents.map(event => (
    event.observationTimeMs >= firstHeldObservationTimeMs
      && event.observationTimeMs <= deliveryTimeMs
      && event.duplicateOfProviderOrdinal == null
      ? { ...event, deliveryTimeMs, appState: 'background' }
      : { ...event }
  )).sort((left, right) => left.deliveryTimeMs - right.deliveryTimeMs
    || left.observationTimeMs - right.observationTimeMs
    || left.providerOrdinal - right.providerOrdinal)
    .map((event, ordinal) => ({ ...event, ordinal, arrivalOrder: ordinal }));
  const repairedBase = {
    ...fixture,
    clock: { ...fixture.clock, deliveryMode: 'native-callback-batched-late-window' },
    rawEvents: repairedEvents,
    closureProvenance: {
      sourceFixturePath: inputPath,
      sourceFixtureSha256: sha256(inputBytes),
      sourceFixtureDeclaredSha256: fixture.fixtureSha256,
      coordinatesChanged: false,
      observationTimesChanged: false,
      correction: 'Contiguous observations through the delayed callback time share one native callback.',
    },
  };
  delete repairedBase.fixtureSha256;
  const repaired = { ...repairedBase, fixtureSha256: sha256(JSON.stringify(repairedBase)) };
  const oldAudit = audit(fixture.rawEvents);
  const newAudit = audit(repaired.rawEvents);
  const coordinateInputsUnchanged = fixture.rawEvents.length === repaired.rawEvents.length
    && fixture.rawEvents.slice().sort((a, b) => a.providerOrdinal - b.providerOrdinal).every((event, index) => {
      const candidate = repaired.rawEvents.slice().sort((a, b) => a.providerOrdinal - b.providerOrdinal)[index];
      return candidate
        && event.observationTimeMs === candidate.observationTimeMs
        && event.coordinate.lat === candidate.coordinate.lat
        && event.coordinate.lng === candidate.coordinate.lng
        && event.accuracyM === candidate.accuracyM
        && event.speedMps === candidate.speedMps;
    });
  const outputPath = path.join(outputRoot, `${repaired.runId}-authentic-batch-closure.json`);
  writeJson(outputPath, repaired);
  results.push({
    sourcePath: inputPath,
    outputPath,
    sourceSha256: sha256(inputBytes),
    outputSha256: sha256(fs.readFileSync(outputPath)),
    oldAudit,
    newAudit,
    coordinateInputsUnchanged,
    eventCount: repaired.rawEvents.length,
    delayedCallbackSize: repaired.rawEvents.filter(event => event.deliveryTimeMs === deliveryTimeMs).length,
    firstHeldObservationTimeMs,
    deliveryTimeMs,
    manifestEntry: {
      runId: repaired.runId,
      routeId: repaired.caseId,
      mode: repaired.mode,
      profile: repaired.profile,
      category: repaired.category,
      holdout: true,
      publicInputPath: path.basename(outputPath),
      fixtureSha256: repaired.fixtureSha256,
      rawEventCount: repaired.rawEvents.length,
    },
  });
}
const report = {
  schema: 'cairn.hike-run.late-batch-fixture-repair.v1',
  generatedAt: new Date().toISOString(),
  results,
  passed: results.every(result => !result.oldAudit.authentic
    && result.newAudit.authentic
    && result.coordinateInputsUnchanged),
};
writeJson(path.join(outputRoot, 'FIXTURE_REPAIR_REPORT.json'), report);
writeJson(path.join(outputRoot, 'FROZEN_CORPUS_MANIFEST.json'), {
  schema: 'cairn.hike-run.authentic-late-batch-closure-manifest.v1',
  generatedAt: report.generatedAt,
  entries: results.map(result => result.manifestEntry),
});
if (!report.passed) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ output: outputRoot, passed: report.passed, cases: results.length })}\n`);
