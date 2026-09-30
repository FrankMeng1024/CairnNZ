#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateAuthoritativeFixtures, validateFixtureSet } from './snap-lab-fixtures.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const matrixPath = path.resolve(argument('--matrix') ?? 'contracts/CASE_MATRIX.json');
const outputRoot = path.resolve(argument('--output') ?? '_review/snap-lab-fixtures');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const fixtures = generateAuthoritativeFixtures(matrix);
const validation = validateFixtureSet(fixtures, matrix);
if (!validation.valid) throw new Error(`snap_lab_fixture_validation_failed:${JSON.stringify(validation)}`);

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries = [];
for (const fixture of fixtures) {
  const directory = path.join(outputRoot, fixture.caseId, fixture.mode, fixture.profile);
  const target = path.join(directory, 'FIXTURE.json');
  fs.mkdirSync(directory, { recursive: true });
  const encoded = `${JSON.stringify(fixture, null, 2)}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== encoded) {
    throw new Error(`snap_lab_frozen_fixture_drift:${fixture.caseId}/${fixture.mode}/${fixture.profile}`);
  }
  fs.writeFileSync(target, encoded);
  entries.push({
    runId: `${fixture.caseId}/${fixture.mode}/${fixture.profile}`,
    fixtureSha256: fixture.fixtureSha256,
    fileSha256: hash(target),
    relativePath: path.relative(outputRoot, target).split(path.sep).join('/'),
    rawEventCount: fixture.rawEvents.length,
    logicalDurationSeconds: fixture.durationSeconds,
  });
}
const manifest = {
  schema: 'cairn.snaplab.fixture-manifest.v1',
  matrixPath,
  matrixSha256: hash(matrixPath),
  generatedAt: new Date().toISOString(),
  generator: 'app/scripts/snap-lab-fixtures.mjs',
  validation,
  entries,
};
const manifestPath = path.join(outputRoot, 'FIXTURE_MANIFEST.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputRoot, manifestPath, manifestSha256: hash(manifestPath), validation }, null, 2)}\n`);
