#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SUPERVISION_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTROL = path.join(SUPERVISION_DIR, 'CONTROL.json');

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveStatusPath(control, candidate) {
  return path.isAbsolute(candidate) ? candidate : path.join(control.repoRoot, candidate);
}

export function sampleObserver({
  controlPath = DEFAULT_CONTROL,
  nowMs = Date.now(),
  isAlive = defaultIsAlive,
} = {}) {
  let control;
  try {
    control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
  } catch (error) {
    return {
      schema: 'cairnnz.v1-closure.supervision.observer-sample.v1',
      sampledAt: new Date(nowMs).toISOString(),
      state: 'UNCERTAIN',
      control: { path: controlPath, available: false, error: error.message },
      warning: 'Control state is unavailable. This observer does not restart or repair anything.',
    };
  }

  const statusFiles = (control.observer?.statusFiles ?? []).map((entry) => {
    const filePath = resolveStatusPath(control, entry.path);
    try {
      const stat = fs.statSync(filePath);
      const ageSeconds = Math.max(0, (nowMs - stat.mtimeMs) / 1000);
      return {
        path: filePath,
        available: true,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds: Number(ageSeconds.toFixed(3)),
        stale: ageSeconds > entry.staleAfterSeconds,
      };
    } catch (error) {
      return { path: filePath, available: false, stale: true, error: error.message };
    }
  });
  const processes = (control.ownedProcesses ?? [])
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
    .map((entry) => ({
      pid: entry.pid,
      role: entry.role,
      ownership: entry.ownership,
      expectedState: entry.expectedState,
      alive: isAlive(entry.pid),
    }));
  const progressMs = Date.parse(control.observer?.rootProgressObservedAt ?? '');
  const progressAgeSeconds = Number.isFinite(progressMs) ? Math.max(0, (nowMs - progressMs) / 1000) : null;
  const rootObservationStale = progressAgeSeconds === null
    || progressAgeSeconds > (control.observer?.rootStaleAfterSeconds ?? 300);
  const uncertain = rootObservationStale
    || statusFiles.some((entry) => entry.stale || !entry.available)
    || processes.some((entry) => !entry.alive);
  return {
    schema: 'cairnnz.v1-closure.supervision.observer-sample.v1',
    sampledAt: new Date(nowMs).toISOString(),
    state: uncertain ? 'UNCERTAIN' : 'OBSERVED',
    runId: control.runId,
    rootSessionId: control.rootSessionId,
    mode: control.mode,
    rootProgress: {
      observedAt: control.observer?.rootProgressObservedAt ?? null,
      ageSeconds: progressAgeSeconds === null ? null : Number(progressAgeSeconds.toFixed(3)),
      stale: rootObservationStale,
    },
    statusFiles,
    processes,
    limitations: [
      'Read-only metadata observation cannot infer semantic progress from CPU activity.',
      'It never starts Codex, sends prompts, grants permissions, merges code, or kills processes.',
    ],
  };
}

function parseArguments(argv) {
  const options = {
    mode: 'once',
    control: DEFAULT_CONTROL,
    output: null,
    intervalMs: null,
    maxSamples: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--once' || value === '--watch') options.mode = value.slice(2);
    else if (value === '--control' || value === '--output' || value === '--interval-ms' || value === '--max-samples') {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value`);
      index += 1;
      if (value === '--control') options.control = path.resolve(next);
      else if (value === '--output') options.output = path.resolve(next);
      else if (value === '--interval-ms') options.intervalMs = Number(next);
      else options.maxSamples = Number(next);
    } else throw new Error(`unknown option: ${value}`);
  }
  return options;
}

function writeBoundedJsonl(outputPath, sample, maxSamples) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  let prior = [];
  try {
    prior = fs.readFileSync(outputPath, 'utf8').split('\n').filter(Boolean);
  } catch {
    prior = [];
  }
  const lines = [...prior, JSON.stringify(sample)].slice(-maxSamples);
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const control = JSON.parse(fs.readFileSync(options.control, 'utf8'));
  const intervalMs = options.intervalMs ?? control.observer?.defaultIntervalMs ?? 60000;
  const maxSamples = options.maxSamples ?? control.observer?.maxSamples ?? 720;
  const output = options.output ?? (options.mode === 'watch' ? control.observer?.defaultOutput : null);
  if (options.mode === 'watch' && (!Number.isFinite(intervalMs) || intervalMs < 1000)) {
    throw new Error('watch interval must be at least 1000 ms');
  }
  do {
    const sample = sampleObserver({ controlPath: options.control });
    process.stdout.write(`${JSON.stringify(sample)}\n`);
    if (output) writeBoundedJsonl(output, sample, maxSamples);
    if (options.mode !== 'watch') break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`observer failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
