#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const runRoot = resolve(import.meta.dirname, '..');
const archiveBase = 'cairn_route_detail_01';
const archivePath = `/Users/mzm/Desktop/${archiveBase}.zip`;
const sidecarPath = `${archivePath}.sha256`;

if (existsSync(archivePath) || existsSync(sidecarPath)) {
  throw new Error(`${archiveBase} already exists; choose the next two-digit archive revision instead of overwriting it.`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(root, current = root) {
  const result = [];
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed in delivery: ${path}`);
    if (stat.isDirectory()) result.push(...walk(root, path));
    else result.push(path);
  }
  return result;
}

const forbidden = /(^|\/)(node_modules|\.env(?:\.|$))|\.(?:db|sqlite|sqlite3)$/i;
const payloadBeforeManifest = walk(runRoot)
  .filter(path => !['PACKAGE_MANIFEST.json', 'MANIFEST.sha256'].includes(basename(path)));
for (const path of payloadBeforeManifest) {
  const rel = relative(runRoot, path).replaceAll('\\', '/');
  if (forbidden.test(rel)) throw new Error(`Forbidden delivery path: ${rel}`);
}

const manifest = {
  schema_version: 1,
  package: archiveBase,
  archive_revision: '01',
  run_id: '20260917T180318+0800',
  created_at: new Date().toISOString(),
  timezone: 'Asia/Shanghai',
  source: {
    repository: '/Users/mzm/Desktop/cairn/CairnNZ',
    branch: 'master',
    head_at_start: '12fa1cd0ef599e53a81cd30537ce761c5e2150ce',
    baseline_marker: 'O58',
    candidate_marker: 'O59',
  },
  boundaries: {
    backend_deployed: false,
    migration_executed: false,
    ota_published: false,
    device_loaded: false,
    owner_accepted: false,
    native_mapbox_proven: false,
  },
  payload_file_count_before_manifests: payloadBeforeManifest.length,
  files: payloadBeforeManifest.map(path => ({
    path: relative(runRoot, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    sha256: sha256(path),
  })),
  excluded: ['secrets', '.env files', 'private databases', 'full private coordinate dumps', 'node_modules', 'unrelated project files'],
};
writeFileSync(join(runRoot, 'PACKAGE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const hashedFiles = walk(runRoot).filter(path => basename(path) !== 'MANIFEST.sha256');
const checksumLines = hashedFiles.map(path => (
  `${sha256(path)}  ${relative(runRoot, path).replaceAll('\\', '/')}`
));
writeFileSync(join(runRoot, 'MANIFEST.sha256'), `${checksumLines.join('\n')}\n`);

const stageRoot = mkdtempSync(join(tmpdir(), 'cairn-route-package-'));
const staged = join(stageRoot, archiveBase);
mkdirSync(staged);
for (const name of readdirSync(runRoot)) cpSync(join(runRoot, name), join(staged, name), { recursive: true });

try {
  execFileSync('zip', ['-q', '-r', archivePath, archiveBase], { cwd: stageRoot, stdio: 'inherit' });
  execFileSync('unzip', ['-t', archivePath], { stdio: 'ignore' });
  writeFileSync(sidecarPath, `${sha256(archivePath)}  ${basename(archivePath)}\n`);
  console.log(JSON.stringify({
    archive: archivePath,
    sidecar: sidecarPath,
    sha256: sha256(archivePath),
    bytes: statSync(archivePath).size,
    internal_files: walk(staged).length,
  }, null, 2));
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
