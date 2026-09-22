#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PATHS,
  deriveQueueProjection,
  readJson,
  sha256File,
} from '../../docs/review/v1-closure/20260918T222838+0800/supervision/queue-adapter.mjs';

export const EXPECTED_ROOT_SESSION_ID = '01a0b4c1-b498-76e0-95bd-1976d11586f2';
export const EXPECTED_RUN_ID = '20260918T222838+0800';
export const EXPECTED_REPO_ROOT = '/Users/mzm/Desktop/cairn/CairnNZ';

const TERMINAL_WORKER_STATES = new Set(['COMPLETED', 'REJECTED', 'QUARANTINED']);
const TERMINAL_QUEUE_STATES = new Set(['completed', 'not_applicable', 'blocked_external']);
const PAUSE_MODES = new Set([
  'PREPARE_ONLY',
  'RECOVER_ONLY',
  'PAUSE_REQUESTED',
  'PAUSED_USER',
  'PAUSED_QUOTA',
  'PAUSED_BUDGET',
  'PAUSED_NETWORK',
  'BLOCKED_EXTERNAL',
]);

function safeRealpath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate ?? '.');
  }
}

function matchingRootEvent(event) {
  return event?.hook_event_name === 'Stop'
    && event?.session_id === EXPECTED_ROOT_SESSION_ID
    && safeRealpath(event?.cwd) === safeRealpath(EXPECTED_REPO_ROOT);
}

function boundedFault(event, message) {
  if (event?.stop_hook_active === true) {
    return {
      action: 'STOP_WITH_FAULT',
      output: {
        continue: false,
        stopReason: 'BLOCKED_SUPERVISION',
        systemMessage: `BLOCKED_SUPERVISION: ${message} The corrective continuation limit was reached; return control to the owner without claiming closure.`,
      },
    };
  }
  return {
    action: 'BLOCK',
    output: {
      decision: 'block',
      reason: `Cairn V1 closure is not ready to stop: ${message} Continue in this same root session, preserve the queue, and perform only the next authorized action.`,
    },
  };
}

function explicitOwnerPause(queue, control) {
  return queue?.ownerPause?.state === 'explicit'
    || control?.ownerPause?.state === 'explicit'
    || control?.mode === 'PAUSE_REQUESTED'
    || control?.mode === 'PAUSED_USER';
}

export function evaluateStop({ event, control, queue, acceptance, loadError = null }) {
  if (!matchingRootEvent(event)) return { action: 'IGNORE', output: null };

  // The authoritative queue-level owner pause wins even if the newer control file is damaged.
  if (explicitOwnerPause(queue, control)) return { action: 'ALLOW_OWNER_PAUSE', output: null };
  if (loadError) return boundedFault(event, `control state could not be loaded (${loadError}).`);
  if (!control || control.runId !== EXPECTED_RUN_ID || control.rootSessionId !== EXPECTED_ROOT_SESSION_ID) {
    return boundedFault(event, 'control identity does not match this root session and run.');
  }
  if (PAUSE_MODES.has(control.mode)) {
    if (['PAUSED_QUOTA', 'PAUSED_BUDGET', 'PAUSED_NETWORK', 'BLOCKED_EXTERNAL'].includes(control.mode)
      && control.pause?.checkpointRecorded !== true) {
      return boundedFault(event, `${control.mode} lacks a recorded recoverable checkpoint.`);
    }
    return { action: `ALLOW_${control.mode}`, output: null };
  }
  if (control.gate?.armed !== true) return boundedFault(event, `mode ${control.mode} is not explicitly armed.`);

  let projection;
  try {
    projection = deriveQueueProjection({ queue, acceptance, control });
  } catch (error) {
    return boundedFault(event, `queue projection failed (${error.message}).`);
  }

  const blockers = [];
  for (const worker of control.workers ?? []) {
    if (worker.required === false) continue;
    if (worker.state === 'RETURNED') {
      if (!['integrated', 'rejected', 'quarantined'].includes(worker.disposition)) {
        blockers.push(`worker ${worker.id} returned but is not dispositioned`);
      }
      continue;
    }
    if (worker.state === 'SUPERSEDED_RETURNED') {
      if (worker.quarantined !== true) blockers.push(`superseded worker ${worker.id} is not quarantined`);
      continue;
    }
    if (!TERMINAL_WORKER_STATES.has(worker.state) && worker.state !== 'WAITING_APPROVAL') {
      blockers.push(`worker ${worker.id} remains ${worker.state}`);
    } else if (worker.state === 'WAITING_APPROVAL') {
      blockers.push(`worker ${worker.id} is waiting for approval`);
    }
  }
  const activeJobs = (control.jobs ?? []).filter((job) => job.owned === true
    && ['DISPATCHED', 'RUNNING', 'STOPPING', 'UNKNOWN'].includes(job.state));
  if (activeJobs.length > 0) blockers.push(`owned jobs remain ${activeJobs.map((job) => `${job.id}:${job.state}`).join(', ')}`);
  const openQueueIds = projection.items
    .filter((item) => item.requiredLocalWork && !TERMINAL_QUEUE_STATES.has(item.state))
    .map((item) => item.id);
  if (openQueueIds.length > 0) blockers.push(`required queue items remain ${openQueueIds.join(', ')}`);
  if (projection.openAssertions.length > 0) {
    blockers.push(`local acceptance remains open for ${projection.openAssertions.map((item) => item.id).join(', ')}`);
  }
  if (control.evidence?.testedFingerprint
    && control.source?.productFingerprint
    && control.evidence.testedFingerprint !== control.source.productFingerprint) {
    blockers.push('evidence fingerprint is stale for the current source');
  }
  if (control.closure?.localSoftware !== 'VERIFIED') blockers.push('local software closure is not VERIFIED');
  if (control.closure?.closeoutValidator !== 'PASS') blockers.push('closeout validator is not PASS');

  if (blockers.length === 0) return { action: 'ALLOW_VERIFIED_LOCAL_CLOSURE', output: null };
  const firstReady = projection.firstReadyWork
    ? ` First ready work: ${projection.firstReadyWork.id} — ${projection.firstReadyWork.task}`
    : '';
  return boundedFault(event, `${blockers.join('; ')}.${firstReady}`);
}

function testOverride(name, fallback) {
  return process.env.CAIRN_SUPERVISION_TEST === '1' && process.env[name]
    ? path.resolve(process.env[name])
    : fallback;
}

async function readStdin(maxBytes = 131072) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`hook input exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function runCli() {
  let event;
  try {
    event = await readStdin();
  } catch {
    return;
  }
  if (!matchingRootEvent(event)) return;

  const controlPath = testOverride('CAIRN_SUPERVISION_CONTROL_PATH', DEFAULT_PATHS.control);
  const queuePath = testOverride('CAIRN_SUPERVISION_QUEUE_PATH', DEFAULT_PATHS.queue);
  const acceptancePath = testOverride('CAIRN_SUPERVISION_ACCEPTANCE_PATH', DEFAULT_PATHS.acceptance);
  let control = null;
  let queue = null;
  let acceptance = null;
  let loadError = null;
  try {
    queue = readJson(queuePath);
  } catch (error) {
    loadError = `queue: ${error.message}`;
  }
  try {
    control = readJson(controlPath);
  } catch (error) {
    loadError = `${loadError ? `${loadError}; ` : ''}control: ${error.message}`;
  }
  try {
    acceptance = readJson(acceptancePath);
  } catch (error) {
    loadError = `${loadError ? `${loadError}; ` : ''}acceptance: ${error.message}`;
  }
  const result = evaluateStop({ event, control, queue, acceptance, loadError });
  if (result.output) process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const event = { stop_hook_active: false };
    process.stdout.write(`${JSON.stringify(boundedFault(event, `unexpected handler error (${error.message}).`).output)}\n`);
  });
}
