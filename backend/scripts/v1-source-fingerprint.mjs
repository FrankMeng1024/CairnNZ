#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const roots = [
  'app/src',
  'app/scripts',
  'app/package.json',
  'app/package-lock.json',
  'backend/src',
  'backend/scripts',
  'backend/package.json',
  'backend/package-lock.json',
];

function collect(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => collect(path.join(relativePath, entry.name)))
    .filter((entry) => !entry.includes(`${path.sep}node_modules${path.sep}`));
}

export function calculateV1SourceFingerprint() {
  const files = roots.flatMap(collect).sort();
  const hash = crypto.createHash('sha256');
  for (const relativePath of files) {
    hash.update(relativePath.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
    hash.update('\0');
  }
  return {
    algorithm: 'sha256',
    digest: hash.digest('hex'),
    fileCount: files.length,
    scope: roots,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.stdout.write(`${JSON.stringify(calculateV1SourceFingerprint(), null, 2)}\n`);
}
