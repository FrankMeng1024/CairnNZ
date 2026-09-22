#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ALLOWED_ROOT = '/Users/mzm/Desktop/cairn_revision03_work/supervision/drills';

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!key || !value) throw new Error(`invalid argument pair at ${index}`);
    options[key] = value;
  }
  for (const required of ['nonce', 'attempt', 'partial', 'status', 'release', 'deadline-ms']) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  for (const key of ['partial', 'status', 'release']) {
    options[key] = path.resolve(options[key]);
    if (options[key] !== ALLOWED_ROOT && !options[key].startsWith(`${ALLOWED_ROOT}${path.sep}`)) {
      throw new Error(`${key} must remain under ${ALLOWED_ROOT}`);
    }
  }
  options.deadlineMs = Number(options['deadline-ms']);
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 5000 || options.deadlineMs > 180000) {
    throw new Error('deadline must be 5000..180000 ms');
  }
  return options;
}

const options = argumentsFrom(process.argv.slice(2));
const startedAt = new Date().toISOString();
const base = {
  schema: 'cairnnz.v1-closure.supervision.disposable-worker.v1',
  nonce: options.nonce,
  attempt: options.attempt,
  pid: process.pid,
  startedAt,
};

fs.mkdirSync(path.dirname(options.partial), { recursive: true });
fs.writeFileSync(options.partial, `${JSON.stringify({ ...base, state: 'PARTIAL', payload: 'preserve-me' }, null, 2)}\n`);
fs.writeFileSync(options.status, `${JSON.stringify({ ...base, state: 'RUNNING_NO_PROGRESS' }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...base, state: 'ACKNOWLEDGED', partial: options.partial, status: options.status })}\n`);

let finished = false;
function finish(state, exitCode, detail) {
  if (finished) return;
  finished = true;
  const finishedAt = new Date().toISOString();
  fs.writeFileSync(options.status, `${JSON.stringify({ ...base, state, detail, finishedAt, exitCode }, null, 2)}\n`);
  process.exit(exitCode);
}

process.on('SIGTERM', () => finish('QUIESCED_BY_COORDINATOR', 143, 'Exact disposable PID received SIGTERM; partial artifact preserved.'));
process.on('SIGINT', () => finish('QUIESCED_BY_COORDINATOR', 130, 'Exact disposable PID received SIGINT; partial artifact preserved.'));

const poll = setInterval(() => {
  if (fs.existsSync(options.release)) finish('RELEASED', 0, 'Release file observed.');
}, 250);
const deadline = setTimeout(() => finish('DEADLINE_NONZERO', 4, 'Finite stall deadline reached without release.'), options.deadlineMs);
poll.unref();
deadline.unref();
setInterval(() => {}, 1000);
