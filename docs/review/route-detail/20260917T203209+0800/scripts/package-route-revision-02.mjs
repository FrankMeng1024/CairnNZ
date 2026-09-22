#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const runId = '20260917T203209+0800';
const archiveRevision = '02';
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(runDir, '../../../..');
const archivePath = '/Users/mzm/Desktop/cairn_route_detail_02.zip';
const sidecarPath = `${archivePath}.sha256`;
const staging = `/tmp/cairn-route-detail-rev02-package-${runId.replaceAll(/[^a-zA-Z0-9]/g, '-')}`;
const packageRootName = 'cairn_route_detail_02';
const packageRoot = path.join(staging, packageRootName);

const sourceFiles = [
  'app/src/services/routeService.ts',
  'app/src/services/routeTombstones.ts',
  'app/src/store/useRouteStore.ts',
  'app/src/screens/RouteEditorScreen.tsx',
  'app/src/screens/MapHistoryScreen.tsx',
  'app/src/features/route/__tests__/routeContracts.test.ts',
  'app/src/services/__tests__/routeService.contract.test.ts',
  'app/src/store/__tests__/useRouteStore.offline.test.ts',
  'app/src/features/route/routeEditorSaveCoordinator.ts',
  'app/src/features/route/__tests__/routeEditorSaveCoordinator.test.ts',
  'backend/src/routes/routes.js',
  'backend/src/migrations/036_route_origin_identity.sql',
  'backend/scripts/verify-migration-036.sh',
  'backend/src/routes/__tests__/fixtures/route-origin-pre036.sql',
  'backend/src/routes/__tests__/routeOriginMySql.integration.js',
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

if (fs.existsSync(archivePath) || fs.existsSync(sidecarPath)) {
  throw new Error(`refusing to overwrite existing revision-02 delivery: ${archivePath}`);
}
if (!runDir.startsWith(repoRoot + path.sep)) throw new Error('report root escaped repository');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(packageRoot, { recursive: true });

const reviewTarget = path.join(packageRoot, 'review', runId);
fs.cpSync(runDir, reviewTarget, {
  recursive: true,
  filter: source => !['PACKAGE_MANIFEST.json', 'MANIFEST.sha256'].includes(path.basename(source)),
});
for (const relative of sourceFiles) {
  const source = path.join(repoRoot, relative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`missing source payload: ${relative}`);
  }
  const target = path.join(packageRoot, 'source', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const prohibited = /(^|\/)(node_modules|\.env(?:\.|$)|[^/]*\.(?:sqlite|sqlite3|db))($|\/)/i;
const payloadFiles = walk(packageRoot)
  .map(file => path.relative(packageRoot, file).split(path.sep).join('/'))
  .sort();
for (const relative of payloadFiles) {
  if (prohibited.test(relative)) throw new Error(`prohibited package path: ${relative}`);
}

const entries = payloadFiles.map(relative => {
  const absolute = path.join(packageRoot, relative);
  return { path: relative, bytes: fs.statSync(absolute).size, sha256: sha256(absolute) };
});
const manifest = {
  schema_version: 1,
  card: 'CARD-ROUTE-01',
  delivery_revision: archiveRevision,
  run_id: runId,
  candidate_marker: 'O59',
  created_at: new Date().toISOString(),
  source_identity: {
    branch: 'master',
    head_at_start: '12fa1cd0ef599e53a81cd30537ce761c5e2150ce',
    revision_01_archive_sha256: '1ad5c5084873df71665208edbca1abaa7ca04b0968717db3fbf0859139ca4f43',
  },
  boundaries: {
    production_data: false,
    secrets: false,
    env_files: false,
    private_databases: false,
    full_private_coordinates: false,
    node_modules: false,
  },
  manifest_self_excluded: true,
  line_hash_manifest_self_excluded: true,
  payload_file_count: entries.length,
  files: entries,
};
const manifestPath = path.join(packageRoot, 'PACKAGE_MANIFEST.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const hashFiles = [...payloadFiles, 'PACKAGE_MANIFEST.json'].sort();
const lineManifest = hashFiles.map(relative => {
  const absolute = path.join(packageRoot, relative);
  return `${sha256(absolute)}  ${relative}`;
}).join('\n') + '\n';
const lineManifestPath = path.join(packageRoot, 'MANIFEST.sha256');
fs.writeFileSync(lineManifestPath, lineManifest);

execFileSync('/usr/bin/zip', ['-qry', archivePath, packageRootName], { cwd: staging });
execFileSync('/usr/bin/unzip', ['-tq', archivePath], { stdio: 'inherit' });
const archiveHash = sha256(archivePath);
fs.writeFileSync(sidecarPath, `${archiveHash}  ${path.basename(archivePath)}\n`);

fs.copyFileSync(manifestPath, path.join(runDir, 'PACKAGE_MANIFEST.json'));
fs.copyFileSync(lineManifestPath, path.join(runDir, 'MANIFEST.sha256'));
fs.rmSync(staging, { recursive: true, force: true });

console.log(JSON.stringify({
  archive: archivePath,
  sidecar: sidecarPath,
  sha256: archiveHash,
  payload_file_count: entries.length,
  archive_bytes: fs.statSync(archivePath).size,
}, null, 2));
