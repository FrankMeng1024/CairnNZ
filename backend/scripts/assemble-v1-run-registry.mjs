#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { calculateV1SourceFingerprint } from './v1-source-fingerprint.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(scriptPath), '../..');
export const RESULT_STATES = Object.freeze([
  'PASS',
  'FAIL',
  'HOLD',
  'BLOCKED',
  'NOT_RUN',
  'UNVERIFIED',
  'NO_DEPLOYMENT',
]);

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function atomicWriteJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function statusStrings(document) {
  if (!document || typeof document !== 'object') return [];
  const candidates = [
    document.terminalStatus,
    document.terminal_status,
    document.outcome,
    document.status,
    document.verdict,
    document.result,
    document.summary?.result,
    document.summary?.status,
  ];
  return candidates.filter((value) => typeof value === 'string' && value.trim().length > 0);
}

export function normalizeResultState(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('NO_DEPLOYMENT')) return 'NO_DEPLOYMENT';
  if (normalized.includes('HOLD')) return 'HOLD';
  if (normalized.includes('BLOCK')) return 'BLOCKED';
  if (normalized.includes('NOT_RUN') || normalized.includes('NOT_REACHED') || normalized.includes('PENDING')) return 'NOT_RUN';
  if (normalized.includes('UNVERIFIED') || normalized.includes('DEFERRED') || normalized.includes('UNKNOWN')) return 'UNVERIFIED';
  if (normalized.includes('FAIL') || normalized.includes('ERROR')) return 'FAIL';
  if (normalized.includes('PASS') || normalized.includes('SUCCESS') || normalized.includes('GREEN')) return 'PASS';
  return RESULT_STATES.includes(normalized) ? normalized : null;
}

export function deriveTerminalStatus(document, options = {}) {
  if (options.pending === true) return 'NOT_RUN';
  const explicit = statusStrings(document).map(normalizeResultState).find(Boolean) ?? null;
  const exitCode = Number.isInteger(document?.exitCode)
    ? document.exitCode
    : Number.isInteger(document?.exit_code)
      ? document.exit_code
      : Number.isInteger(options.exitCode)
        ? options.exitCode
        : null;
  if (exitCode !== null && exitCode !== 0 && (explicit === null || explicit === 'PASS')) return 'FAIL';
  if (explicit) return explicit;
  if (document?.success === false) return 'FAIL';
  if (document?.success === true && exitCode === 0) return 'PASS';
  return 'UNVERIFIED';
}

function resolveIndexedPath(value, indexPath) {
  if (!value) return null;
  if (path.isAbsolute(value)) return path.normalize(value);
  const fromRepo = path.resolve(repoRoot, value);
  if (fs.existsSync(fromRepo)) return fromRepo;
  return path.resolve(path.dirname(indexPath), value);
}

function parseSourceLedger(ledgerPath) {
  return fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([0-9a-f]{64})\s+(.+?)\s*$/i);
    if (!match) return [];
    const listedPath = match[2].replace(/^\*/, '');
    const resolvedPath = path.isAbsolute(listedPath) ? listedPath : path.resolve(repoRoot, listedPath);
    return [{ expected: match[1].toLowerCase(), listedPath, resolvedPath }];
  });
}

export function evaluateSourceBinding(run, currentFingerprint) {
  if (run.pending) return { status: 'NOT_RUN', reason: 'pending run has no execution evidence' };
  if (run.sourceFingerprint?.digest === currentFingerprint.digest
      && run.sourceFingerprint?.fileCount === currentFingerprint.fileCount) {
    return { status: 'EXACT', checkedFiles: currentFingerprint.fileCount };
  }
  if (!run.sourceHashLedger) {
    return { status: 'UNVERIFIED', reason: 'no exact current fingerprint or dependency hash ledger' };
  }
  if (!fs.existsSync(run.sourceHashLedger)) {
    return { status: 'UNVERIFIED', reason: `source hash ledger missing: ${run.sourceHashLedger}` };
  }
  const entries = parseSourceLedger(run.sourceHashLedger);
  if (entries.length === 0) return { status: 'UNVERIFIED', reason: 'source hash ledger has no parseable entries' };
  const mismatches = [];
  for (const entry of entries) {
    if (!fs.existsSync(entry.resolvedPath)) {
      mismatches.push({ path: entry.listedPath, reason: 'missing' });
      continue;
    }
    const actual = sha256File(entry.resolvedPath);
    if (actual !== entry.expected) mismatches.push({ path: entry.listedPath, expected: entry.expected, actual });
  }
  return mismatches.length === 0
    ? { status: 'DEPENDENCY_EQUIVALENT', checkedFiles: entries.length, ledger: run.sourceHashLedger }
    : { status: 'UNVERIFIED', checkedFiles: entries.length, mismatches, ledger: run.sourceHashLedger };
}

function assertHash(filePath, expected, label) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`${label} missing: ${filePath ?? '<unset>'}`);
  if (expected) {
    const actual = sha256File(filePath);
    if (actual !== expected) throw new Error(`${label} hash mismatch: expected ${expected}, got ${actual}`);
  }
}

function receiptRun(entry, indexPath, currentFingerprint) {
  const specification = entry.registry;
  const runId = specification.runId;
  if (!runId) throw new Error(`${entry.id}: registry.runId missing`);
  const pending = specification.pending === true;
  const terminalReceipt = resolveIndexedPath(specification.terminalReceipt, indexPath);
  const sourceHashLedger = resolveIndexedPath(specification.sourceHashLedger, indexPath);
  if (!pending) assertHash(terminalReceipt, specification.terminalReceiptSha256, `${runId} terminal receipt`);
  if (sourceHashLedger && !fs.existsSync(sourceHashLedger)) throw new Error(`${runId} source ledger missing: ${sourceHashLedger}`);
  const terminalDocument = pending ? null : readJson(terminalReceipt);
  const sourceFingerprint = terminalDocument?.sourceFingerprint
    ?? terminalDocument?.source_fingerprint
    ?? terminalDocument?.sourceFingerprintBefore
    ?? specification.sourceFingerprint
    ?? null;
  const run = {
    runId,
    evidenceIndexId: entry.id,
    evidenceKind: entry.kind,
    terminalReceipt,
    terminalReceiptSha256: pending ? null : sha256File(terminalReceipt),
    sourceHashLedger,
    sourceFingerprint,
    terminalStatus: deriveTerminalStatus(terminalDocument, { pending }),
    pending,
    controlsClosure: specification.controlsClosure === true,
    covers: Array.isArray(specification.covers) ? specification.covers : [],
    proofs: specification.proofs ?? {},
    note: specification.note ?? entry.status ?? null,
  };
  run.sourceBinding = evaluateSourceBinding(run, currentFingerprint);
  return run;
}

function loadFromIndex(indexPath, currentFingerprint) {
  const index = readJson(indexPath);
  const entries = (index.entries ?? []).filter((entry) => entry.registry);
  const runs = entries.map((entry) => receiptRun(entry, indexPath, currentFingerprint));
  return { runs, evidenceIndexPath: indexPath };
}

function loadLegacyDirectory(receiptDir, currentFingerprint) {
  const runs = fs.readdirSync(receiptDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const receiptPath = path.join(receiptDir, name);
      const receipt = readJson(receiptPath);
      const run = {
        ...receipt,
        terminalReceipt: receiptPath,
        terminalReceiptSha256: sha256File(receiptPath),
        terminalStatus: deriveTerminalStatus(receipt, { exitCode: receipt.exitCode }),
        pending: false,
        controlsClosure: receipt.controlsClosure === true,
        covers: Array.isArray(receipt.covers) ? receipt.covers : [],
        proofs: receipt.proofs ?? {},
        sourceHashLedger: receipt.sourceHashLedger ? path.resolve(receipt.sourceHashLedger) : null,
      };
      run.sourceBinding = evaluateSourceBinding(run, currentFingerprint);
      return run;
    });
  return { runs, receiptDirectory: receiptDir };
}

export function assembleRegistry(inputPath) {
  const resolvedInput = path.resolve(inputPath);
  const currentFingerprint = calculateV1SourceFingerprint();
  const loaded = fs.statSync(resolvedInput).isDirectory()
    ? loadLegacyDirectory(resolvedInput, currentFingerprint)
    : loadFromIndex(resolvedInput, currentFingerprint);
  const runs = loaded.runs.sort((left, right) => left.runId.localeCompare(right.runId));
  const duplicateIds = runs.filter((run, index) => runs.findIndex((other) => other.runId === run.runId) !== index);
  if (duplicateIds.length > 0) throw new Error(`duplicate receipt IDs: ${duplicateIds.map((run) => run.runId).join(', ')}`);
  const allocations = {};
  for (const run of runs) {
    if (run.pending && run.covers.length > 0) throw new Error(`${run.runId}: pending run must remain unallocated`);
    for (const assertionId of run.covers) {
      allocations[assertionId] ??= [];
      allocations[assertionId].push(run.runId);
    }
  }
  return {
    schema: 'cairnnz.v1-closure.run-registry.v2',
    generatedAt: new Date().toISOString(),
    candidateFingerprint: currentFingerprint,
    ...loaded,
    runs,
    allocations,
    pendingRuns: runs.filter((run) => run.pending).map((run) => run.runId),
    deployment: {
      status: runs.some((run) => run.evidenceKind === 'deployment' && run.terminalStatus === 'PASS') ? 'PASS' : 'NO_DEPLOYMENT',
      reason: 'No deployment or OTA evidence is allocated by this closeout packet.',
    },
    note: 'Allocations come only from structured evidence-index entries. Terminal states and source equivalence are derived from immutable receipts and hash ledgers; prose cannot create PASS.',
  };
}

function usage() {
  console.error('usage: node assemble-v1-run-registry.mjs <evidence-index.json|receipt-directory> <output.json>');
  process.exit(2);
}

function main() {
  if (!process.argv[2] || !process.argv[3]) usage();
  const registry = assembleRegistry(process.argv[2]);
  const outputPath = path.resolve(process.argv[3]);
  atomicWriteJson(outputPath, registry);
  console.log(JSON.stringify({
    outputPath,
    runCount: registry.runs.length,
    pendingRuns: registry.pendingRuns,
    candidateFingerprint: registry.candidateFingerprint.digest,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
