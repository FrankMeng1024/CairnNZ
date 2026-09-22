#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SUPERVISION_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_DIR = path.dirname(SUPERVISION_DIR);

export const DEFAULT_PATHS = Object.freeze({
  queue: path.join(RUN_DIR, '04_WORK_QUEUE.json'),
  acceptance: path.join(RUN_DIR, '03_ACCEPTANCE_PLAN.json'),
  control: path.join(SUPERVISION_DIR, 'CONTROL.json'),
  output: path.join(SUPERVISION_DIR, 'QUEUE_PROJECTION.json'),
});

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isTerminalQueueState(state) {
  return ['completed', 'not_applicable', 'blocked_external'].includes(state);
}

function dependencySatisfied(itemById, dependencyId) {
  const dependency = itemById.get(dependencyId);
  return Boolean(dependency && isTerminalQueueState(dependency.state));
}

export function deriveQueueProjection({ queue, acceptance, control, sourceHashes = {} }) {
  const itemById = new Map((queue.items ?? []).map((item) => [item.id, item]));
  const items = (queue.items ?? []).map((item) => {
    const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
    const dependenciesSatisfied = dependencies.every((id) => dependencySatisfied(itemById, id));
    return {
      id: item.id,
      state: item.state,
      task: item.task,
      dependencies,
      requiredLocalWork: item.requiredLocalWork !== false,
      ready: ['pending', 'ready', 'in_progress_paused'].includes(item.state) && dependenciesSatisfied,
    };
  });
  const openItems = items.filter((item) => item.requiredLocalWork && !isTerminalQueueState(item.state));
  const firstReadyWork = openItems.find((item) => item.state === 'in_progress_paused')
    ?? openItems.find((item) => item.ready)
    ?? null;
  const openAssertions = (acceptance.assertions ?? [])
    .filter((assertion) => assertion.result !== 'PASS' && assertion.status !== 'PASS')
    .map((assertion) => ({ id: assertion.id, result: assertion.result ?? assertion.status ?? 'NOT_RUN' }));
  const workers = (control.workers ?? []).map((worker) => ({
    id: worker.id,
    task: worker.task,
    attempt: worker.attempt,
    required: worker.required !== false,
    state: worker.state,
    disposition: worker.disposition ?? null,
    quarantined: worker.quarantined === true,
  }));
  const jobs = (control.ownedProcesses ?? []).map((job) => ({
    pid: job.pid,
    role: job.role,
    ownership: job.ownership,
    expectedState: job.expectedState,
  }));
  const projection = {
    schema: 'cairnnz.v1-closure.supervision.queue-projection.v1',
    runId: control.runId,
    rootSessionId: control.rootSessionId,
    mode: control.mode,
    activeStage: queue.activeStage,
    ownerPause: queue.ownerPause ?? control.ownerPause ?? null,
    sourceHashes,
    sourceFingerprint: control.source?.productFingerprint ?? null,
    items,
    openItemIds: openItems.map((item) => item.id),
    firstReadyWork: firstReadyWork
      ? { id: firstReadyWork.id, state: firstReadyWork.state, task: firstReadyWork.task }
      : null,
    runnableWithoutOwnerResume: queue.ownerPause?.state === 'explicit'
      ? []
      : items.filter((item) => item.ready).map((item) => item.id),
    openAssertions,
    workers,
    ownedProcesses: jobs,
  };
  projection.projectionDigest = crypto.createHash('sha256')
    .update(JSON.stringify(projection))
    .digest('hex');
  return projection;
}

function parseArguments(argv) {
  const options = { ...DEFAULT_PATHS };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error(`invalid argument pair: ${name ?? '<missing>'}`);
    const key = name.slice(2);
    if (!(key in options)) throw new Error(`unknown option: ${name}`);
    options[key] = path.resolve(value);
  }
  return options;
}

export function projectFromFiles(paths = DEFAULT_PATHS) {
  return deriveQueueProjection({
    queue: readJson(paths.queue),
    acceptance: readJson(paths.acceptance),
    control: readJson(paths.control),
    sourceHashes: {
      queueSha256: sha256File(paths.queue),
      acceptanceSha256: sha256File(paths.acceptance),
      controlSha256: sha256File(paths.control),
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const paths = parseArguments(process.argv.slice(2));
    const projection = projectFromFiles(paths);
    const serialized = `${JSON.stringify(projection, null, 2)}\n`;
    if (paths.output === '-') process.stdout.write(serialized);
    else {
      fs.mkdirSync(path.dirname(paths.output), { recursive: true });
      fs.writeFileSync(paths.output, serialized);
      process.stdout.write(`${JSON.stringify({ output: paths.output, projectionDigest: projection.projectionDigest })}\n`);
    }
  } catch (error) {
    process.stderr.write(`queue adapter failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
