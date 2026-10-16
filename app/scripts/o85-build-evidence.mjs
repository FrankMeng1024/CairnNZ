#!/usr/bin/env node

/** Build the privacy-bounded, source-inclusive O85 evidence archive. */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const outputArg = process.argv.indexOf('--output');
const outputPath = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : '/Users/mzm/Downloads/Cairn_O85_Real_Mapbox_Routes_Memory_Closure.zip');
const archiveRootName = 'Cairn_O85_Real_Mapbox_Routes_Memory_Closure';
const workRoot = mkdtempSync(path.join(tmpdir(), 'cairn-o85-evidence-'));
const archiveRoot = path.join(workRoot, archiveRootName);
const sha256 = input => crypto.createHash('sha256').update(input).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

function copyRelative(relativePath, destinationPath = relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!existsSync(source)) throw new Error(`required evidence missing: ${relativePath}`);
  const destination = path.join(archiveRoot, destinationPath);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function copyArtifact(relativePath, destinationPath) {
  copyRelative(path.join('app', '_review', relativePath), path.join('evidence', destinationPath));
}

const expectedPrompt = '/Users/mzm/Downloads/Cairn_O85_O84_Device_Findings_Mapbox_Closure_Codex_EN.md';
const promptPath = existsSync(expectedPrompt)
  ? expectedPrompt
  : readdirSync('/Users/mzm/Downloads')
      .filter(name => /^Cairn_O85.*\.md$/i.test(name))
      .map(name => path.join('/Users/mzm/Downloads', name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!promptPath) throw new Error('authoritative O85 prompt not found');

const head = git('rev-parse', 'HEAD');
const base = git('merge-base', 'HEAD', 'origin/main');
const productionBackend = git('rev-parse', 'origin/master');
const branch = git('branch', '--show-current');
const changedFiles = git('diff', '--name-only', `${base}..${head}`).split('\n').filter(Boolean);
const status = git('status', '--porcelain');
if (status) throw new Error('evidence build requires a clean tracked worktree');

try {
  mkdirSync(archiveRoot, { recursive: true });
  const contractDestination = path.join(archiveRoot, 'contract', path.basename(promptPath));
  mkdirSync(path.dirname(contractDestination), { recursive: true });
  copyFileSync(promptPath, contractDestination);

  for (const relativePath of changedFiles) copyRelative(relativePath, path.join('source', 'changed-files', relativePath));
  for (const relativePath of [
    'app/package.json', 'app/package-lock.json', 'app/app.config.js', 'app/eas.json',
    'backend/src/routes/friend-sharing.js', 'backend/src/routes/memory-subscriptions.js',
    'backend/src/services/friendAuthorization.js', 'backend/src/services/friendProjection.js',
    'backend/src/migrations/045_memory_friends_cairn_contract.sql',
  ]) copyRelative(relativePath, path.join('source', 'context', relativePath));

  const patch = execFileSync('git', ['diff', '--binary', `${base}..${head}`], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  mkdirSync(path.join(archiveRoot, 'source'), { recursive: true });
  writeFileSync(path.join(archiveRoot, 'source', 'O85.patch'), patch);
  writeFileSync(path.join(archiveRoot, 'source', 'SOURCE_PROVENANCE.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    branch,
    baseCommit: base,
    candidateCommit: head,
    originMain: git('rev-parse', 'origin/main'),
    originMasterBackend: productionBackend,
    appVersion: '0.2.6',
    runtimeVersion: '0.2.6-o66',
    installedBuild: 65,
    currentProductionOta: {
      updateId: '01a1438a-9341-7774-8b04-a87afe660228',
      groupId: 'c83a6def-8777-48c1-9ebc-ff0453080601',
      marker: 'O84',
      gitCommit: base,
    },
    candidateDisposition: 'HOLD_NO_O85_MARKER_NO_OTA',
    promptFile: path.basename(promptPath),
    promptSha256: sha256(readFileSync(promptPath)),
    changedFiles,
  }, null, 2)}\n`);

  for (const name of [
    'PROVIDER_AND_SOURCE_RECEIPT.json', 'MANIFEST.json', 'RUNTIME_ERRORS.txt',
    'O85_REAL_MAPBOX_ROUTE_BOARD.jpg', 'route-92-test1-390x844.png',
    'route-93-test2-390x844.png', 'route-94-test3-390x844.png',
    'route-95-test-a-1-390x844.png', 'route-96-test-a-2-390x844.png',
  ]) copyArtifact(path.join('o85-real-mapbox', name), path.join('real-mapbox-routes', name));
  copyArtifact('o85-production-friend-fog.json', 'production-friend-fog/receipt.json');
  for (const name of [
    'route-ux-report.json', 'route-360-day-point.png', 'route-390-sunset-layers.png',
    'route-390-sunset-freehand.png', 'route-390-sunset-detail.png',
    'route-430-night-trim.png',
  ]) copyArtifact(path.join('o85-route-ux', name), path.join('route-web-real-basemap', name));
  for (const name of [
    'visual-qa.json', 'friends-360-day-360x800.jpg', 'friends-390-day-390x844.jpg',
    'friends-430-day-430x932.jpg', 'add-friend-existing-inline-390-day-390x844.jpg',
    'memory-picker-two-selected-loading-390x844.jpg',
    'memory-picker-two-loaded-390x844.jpg',
    'memory-friend-fog-wellington-390x844.jpg',
    'memory-friend-fog-queenstown-390x844.jpg',
  ]) copyArtifact(path.join('o85-friends-memory', name), path.join('friends-memory-web-real-basemap', name));
  copyArtifact(path.join('o85-o84-input', 'result.json'), 'isolated-authorized-fixture/result.json');

  const files = [];
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else {
        const relative = path.relative(archiveRoot, absolute);
        const contents = readFileSync(absolute);
        files.push({ path: relative, bytes: contents.length, sha256: sha256(contents) });
      }
    }
  };
  walk(archiveRoot);
  writeFileSync(path.join(archiveRoot, 'MANIFEST.json'), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'Allowlisted files only; no .env, token, raw production coordinates, unrelated Downloads files or EAS Build output.',
    fileCount: files.length,
    files,
  }, null, 2)}\n`);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) rmSync(outputPath);
  execFileSync('zip', ['-qry', outputPath, archiveRootName], { cwd: workRoot });
  const zipBytes = readFileSync(outputPath);
  const zipHash = sha256(zipBytes);
  writeFileSync(`${outputPath}.sha256`, `${zipHash}  ${path.basename(outputPath)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    bytes: zipBytes.length,
    sha256: zipHash,
    manifestFiles: files.length,
    base,
    head,
  }, null, 2)}\n`);
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
