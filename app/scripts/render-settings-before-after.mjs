#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(appDir, '..');
const beforePath = path.join(
  repoDir,
  'docs/review/activity-simulator/captures/settings-simulator-toggle-390x844.png',
);
const afterPath = path.join(appDir, '_review/settings-product-dna/root-day-390x844.png');
const outputPath = path.join(appDir, '_review/settings-product-dna/settings-before-after.jpg');

const width = 824;
const height = 940;
const label = Buffer.from(`
  <svg width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#ede9df" />
    <text x="217" y="44" text-anchor="middle" font-family="Arial, sans-serif"
      font-size="22" font-weight="700" fill="#20302d">BEFORE · mixed warehouse</text>
    <text x="607" y="44" text-anchor="middle" font-family="Arial, sans-serif"
      font-size="22" font-weight="700" fill="#20302d">AFTER · durable controls</text>
  </svg>
`);

await sharp(label)
  .composite([
    { input: await sharp(beforePath).resize({ width: 390, height: 844, fit: 'cover' }).png().toBuffer(), left: 16, top: 72 },
    { input: await sharp(afterPath).resize({ width: 390, height: 844, fit: 'cover' }).png().toBuffer(), left: 418, top: 72 },
  ])
  .jpeg({ quality: 90 })
  .toFile(outputPath);

console.log(outputPath);
