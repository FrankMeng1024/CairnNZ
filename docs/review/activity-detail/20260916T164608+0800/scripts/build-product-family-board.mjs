#!/usr/bin/env node

/** Build one offline family-comparison board from existing QA references. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(scriptDir, '../../../../..');
const runDir = path.resolve(scriptDir, '..');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const sharp = requireFromApp('sharp');

const sourceBoard = path.join(repoRoot, 'docs/qa/visual-migration/final/product-unity-board.jpg');
const plantSource = path.join(repoRoot, 'docs/review/plant/current/03-compose-empty.png');
const candidateSource = path.join(runDir, 'visual/images/hike-detail--summary-linked--day--390x844.png');
const output = path.join(runDir, 'visual/images/board-product-family-comparison.jpg');

const tileW = 220;
const tileH = 476;
const labelH = 44;
const gap = 16;
const headerH = 86;
const columns = 3;
const items = [
  { label: 'Current Home reference', source: sourceBoard, extract: { left: 258, top: 62, width: 234, height: 546 } },
  { label: 'Current Hike reference', source: sourceBoard, extract: { left: 12, top: 624, width: 234, height: 538 } },
  { label: 'Current Run reference', source: sourceBoard, extract: { left: 258, top: 624, width: 234, height: 538 } },
  { label: 'Current Trails reference', source: sourceBoard, extract: { left: 750, top: 624, width: 234, height: 538 } },
  { label: 'Current Plant reference', source: plantSource },
  { label: 'AD-01 Activity Detail candidate', source: candidateSource },
];

const rows = Math.ceil(items.length / columns);
const width = gap + columns * (tileW + gap);
const height = headerH + rows * (labelH + tileH + gap);
const composites = [{
  input: Buffer.from(`<svg width="${width}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="34" font-family="Arial" font-size="23" font-weight="700" fill="#F2EFE7">Cairn product-family comparison</text><text x="${gap}" y="57" font-family="Arial" font-size="11" fill="#ABB9B2">CURRENT QA REFERENCES + AD-01 EXPO WEB CANDIDATE · COMPARATIVE EVIDENCE ONLY</text></svg>`),
  left: 0,
  top: 0,
}];

for (let index = 0; index < items.length; index += 1) {
  const item = items[index];
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = gap + column * (tileW + gap);
  const top = headerH + row * (labelH + tileH + gap);
  const pipeline = sharp(item.source);
  if (item.extract) pipeline.extract(item.extract);
  const image = await pipeline.resize(tileW, tileH, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();
  composites.push({
    input: Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="12" font-weight="600" fill="#E8ECE8">${item.label}</text></svg>`),
    left,
    top,
  });
  composites.push({ input: image, left, top: top + labelH });
}

await sharp({ create: { width, height, channels: 3, background: '#1D2522' } })
  .composite(composites)
  .jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(output);

const boardRelativePath = 'images/board-product-family-comparison.jpg';
const resultPath = path.join(runDir, 'visual/capture-results.json');
if (fs.existsSync(resultPath)) {
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  result.boards = [...new Set([...(result.boards ?? []), boardRelativePath])];
  result.product_family_sources = [
    'docs/qa/visual-migration/final/product-unity-board.jpg',
    'docs/review/plant/current/03-compose-empty.png',
  ];
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}

const htmlPath = path.join(runDir, 'visual/index.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes(boardRelativePath)) {
    fs.writeFileSync(
      htmlPath,
      html.replace(
        '<h2>Boards</h2>',
        `<h2>Boards</h2><img src="${boardRelativePath}" alt="Product-family comparison board">`,
      ),
    );
  }
}

process.stdout.write(`${output}\n`);
