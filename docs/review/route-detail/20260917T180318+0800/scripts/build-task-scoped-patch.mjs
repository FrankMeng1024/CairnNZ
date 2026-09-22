#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../../..');
const runRoot = resolve(import.meta.dirname, '..');
const capturedRoot = '/tmp/cairn-route-20260917T180318+0800/source';
const output = join(runRoot, 'TASK_SCOPED.patch');

const capturedAtStart = [
  'app/src/components/OtaBadge.tsx',
  'app/src/screens/HikingScreen.tsx',
  'app/src/screens/MapHistoryScreen.tsx',
  'app/src/screens/RouteEditorScreen.tsx',
  'app/src/screens/RunningScreen.tsx',
  'app/src/services/offlineEntity.ts',
  'app/src/services/routeOfflineEntities.ts',
  'app/src/services/routeService.ts',
  'app/src/store/useRouteStore.ts',
  'app/src/store/__tests__/useRouteStore.offline.test.ts',
  'backend/src/middleware/schemas.js',
  'backend/src/models/Route.js',
  'backend/src/routes/routes.js',
  'backend/src/routes/__tests__/freeActivityContracts.test.js',
];

const cleanAtStart = [
  'app/src/components/Icon.tsx',
  'app/src/components/map/EditOverlayV274.tsx',
  'app/src/services/routing/corridor/PolylineSampler.ts',
  'app/src/store/__tests__/runPreviewFinally.test.ts',
];

const createdByCard = [
  'app/src/features/route/routeContracts.ts',
  'app/src/features/route/__tests__/routeContracts.test.ts',
  'app/src/services/__tests__/routeService.contract.test.ts',
  'app/src/services/routeTombstones.ts',
  'backend/src/migrations/036_route_origin_identity.sql',
  'backend/src/routes/__tests__/routeOriginRoundTrip.test.js',
];

function unifiedDiff(before, after, path) {
  const beforeTmp = join('/tmp/cairn-route-20260917T180318+0800/patch-before', path);
  mkdirSync(dirname(beforeTmp), { recursive: true });
  const normalize = value => Buffer.from(value).toString('utf8').replace(/\r\n/g, '\n');
  writeFileSync(beforeTmp, normalize(before));
  const afterTmp = join('/tmp/cairn-route-20260917T180318+0800/patch-after', path);
  mkdirSync(dirname(afterTmp), { recursive: true });
  writeFileSync(afterTmp, normalize(after));
  try {
    return execFileSync('diff', [
      '-u',
      '--label', `a/${path}`, '--label', `b/${path}`,
      beforeTmp, afterTmp,
    ], { encoding: 'utf8' });
  } catch (error) {
    if (error.status === 1) return error.stdout;
    throw error;
  }
}

const chunks = [];
for (const path of capturedAtStart) {
  const beforePath = join(capturedRoot, path);
  const afterPath = join(root, path);
  if (!existsSync(beforePath) || !existsSync(afterPath)) continue;
  const diff = unifiedDiff(readFileSync(beforePath), readFileSync(afterPath), path);
  if (diff) chunks.push(diff);
}
for (const path of cleanAtStart) {
  const before = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root });
  const after = readFileSync(join(root, path));
  const diff = unifiedDiff(before, after, path);
  if (diff) chunks.push(diff);
}
for (const path of createdByCard) {
  const afterPath = join(root, path);
  if (!existsSync(afterPath)) continue;
  const diff = unifiedDiff('', readFileSync(afterPath), path);
  if (diff) chunks.push(diff);
}

writeFileSync(output, chunks.join('\n'));
console.log(`Wrote ${output} (${chunks.length} file diffs)`);
