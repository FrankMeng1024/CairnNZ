#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const { version } = require('../package-lock.json').packages['node_modules/node-cron'];

const productionSchedules = [
  { name: 'cleanHiddenItemsOrphans', expression: '0 3 * * 0' },
  { name: 'authSweep', expression: '* * * * *' },
  { name: 'pushDrain', expression: '* * * * *' },
  { name: 'pushPurge', expression: '30 3 * * *' },
  { name: 'exportBuild', expression: '*/2 * * * *' },
  { name: 'exportPurge', expression: '0 4 * * *' },
];

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  assert.match(version, /^4\./, 'smoke must execute against node-cron v4');
  const productionEntrypoint = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const entrypointExpressions = [...productionEntrypoint.matchAll(/cron\.schedule\('([^']+)'/g)]
    .map(match => match[1]);
  assert.deepEqual(
    entrypointExpressions.sort(),
    productionSchedules.map(schedule => schedule.expression).sort(),
    'production scheduler registration drifted from the smoke matrix',
  );
  for (const schedule of productionSchedules) {
    assert.ok(productionEntrypoint.includes(schedule.name), `production entrypoint omits ${schedule.name}`);
  }
  for (const schedule of productionSchedules) {
    assert.equal(cron.validate(schedule.expression), true, `invalid production schedule: ${schedule.name}`);
  }

  const registryBefore = cron.getTasks().size;
  const registered = productionSchedules.map(schedule => cron.createTask(
    schedule.expression,
    () => {},
    { name: `o88-smoke-${schedule.name}`, timezone: 'UTC' },
  ));
  assert.equal(cron.getTasks().size - registryBefore, productionSchedules.length);
  assert.deepEqual(registered.map(task => task.getStatus()), productionSchedules.map(() => 'stopped'));

  let executions = 0;
  let active = 0;
  let overlaps = 0;
  const executionTimes = [];
  const liveTask = cron.schedule('* * * * * *', async () => {
    active += 1;
    if (active > 1) overlaps += 1;
    executions += 1;
    executionTimes.push(new Date().toISOString());
    await wait(1_250);
    active -= 1;
  }, { name: 'o88-smoke-live-no-overlap', timezone: 'UTC', noOverlap: true });

  assert.equal(liveTask.getStatus(), 'idle');
  await wait(3_650);
  liveTask.stop();
  while (active > 0) await wait(50);
  const executionsAtStop = executions;
  await wait(1_150);
  assert.equal(executions, executionsAtStop, 'stopped task executed again');
  assert.ok(executionsAtStop >= 2, `expected at least two real scheduled executions, got ${executionsAtStop}`);
  assert.equal(overlaps, 0, 'noOverlap allowed duplicate concurrent execution');

  liveTask.destroy();
  for (const task of registered) task.destroy();
  await cron.shutdown();
  assert.equal(cron.getTasks().size, registryBefore, 'scheduler registry did not return to baseline');

  process.stdout.write(`${JSON.stringify({
    schema: 'cairnnz.node-cron-v4-smoke.v1',
    node: process.version,
    nodeCron: version,
    productionExpressionsValidated: productionSchedules,
    productionEntrypointValidated: true,
    registrationCount: productionSchedules.length,
    executions: executionsAtStop,
    overlaps,
    executionTimes,
    stoppedWithoutFurtherExecution: true,
    registryReturnedToBaseline: true,
    passed: true,
  }, null, 2)}\n`);
}

main().catch(error => {
  void cron.shutdown().finally(() => {
    console.error(error);
    process.exitCode = 1;
  });
});
