#!/usr/bin/env node

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { atomicWriteJson, deriveTerminalStatus, readJson, sha256File } from './assemble-v1-run-registry.mjs';
import { calculateV1SourceFingerprint } from './v1-source-fingerprint.mjs';

function usage() {
  console.error('usage: node record-v1-evidence-command.mjs <receipt.json> <run-id> <evidence-path> -- <command> [args...]');
  process.exit(2);
}

const separator = process.argv.indexOf('--');
if (separator < 5) usage();
const [, , receiptPath, runId, evidencePath] = process.argv;
const commandParts = process.argv.slice(separator + 1);
if (commandParts.length === 0) usage();

const startedAt = new Date().toISOString();
const startedMonotonicNs = process.hrtime.bigint();
const fingerprint = calculateV1SourceFingerprint();
const result = childProcess.spawnSync(commandParts[0], commandParts.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
const finishedAt = new Date().toISOString();
const durationMs = Number(process.hrtime.bigint() - startedMonotonicNs) / 1e6;
const resolvedEvidencePath = path.resolve(evidencePath);
const exitCode = result.status ?? (result.signal ? 128 : 1);
const terminalNames = [
  'status.json',
  'gate-receipt.json',
  'GATE_RESULT.json',
  'RELEASE.json',
  'operator-ledger.json',
];
let terminalEvidencePath = null;
if (fs.existsSync(resolvedEvidencePath)) {
  const stat = fs.statSync(resolvedEvidencePath);
  if (stat.isFile() && resolvedEvidencePath.endsWith('.json')) terminalEvidencePath = resolvedEvidencePath;
  else if (stat.isDirectory()) terminalEvidencePath = terminalNames
    .map((name) => path.join(resolvedEvidencePath, name))
    .find((candidate) => fs.existsSync(candidate)) ?? null;
}
let terminalDocument = null;
let evidenceParseError = null;
if (terminalEvidencePath) {
  try {
    terminalDocument = readJson(terminalEvidencePath);
  } catch (error) {
    evidenceParseError = error.message;
  }
}
const terminalStatus = evidenceParseError
  ? 'UNVERIFIED'
  : deriveTerminalStatus(terminalDocument, { exitCode });
const receipt = {
  schema: 'cairnnz.v1-closure.command-receipt.v2',
  runId,
  command: commandParts,
  cwd: process.cwd(),
  startedAt,
  finishedAt,
  durationMs,
  exitCode,
  signal: result.signal ?? null,
  evidencePath: resolvedEvidencePath,
  evidenceExists: fs.existsSync(resolvedEvidencePath),
  terminalEvidencePath,
  terminalEvidenceSha256: terminalEvidencePath && !evidenceParseError ? sha256File(terminalEvidencePath) : null,
  evidenceParseError,
  terminalStatus,
  sourceFingerprint: fingerprint,
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    hostname: os.hostname(),
    publicPilotEnabled: process.env.PUBLIC_CAIRN_PILOT_ENABLED === '1',
    syntheticSourceEnabled: process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED === 'true',
  },
};
atomicWriteJson(path.resolve(receiptPath), receipt);
process.exit(receipt.exitCode);
