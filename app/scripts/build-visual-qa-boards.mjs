import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const stage = process.argv[2] || 'final';
const dir = path.resolve('..', 'docs', 'qa', 'visual-migration', stage);
const tileW = 234;
const tileH = 506;
const labelH = 34;
const titleH = 58;
const gap = 12;

function svgText(width, height, text, size = 18, weight = 650, color = '#F4F1E8') {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;font-size:${size}px;font-weight:${weight};fill:${color}}</style><text x="${width / 2}" y="${Math.round(height * .68)}" text-anchor="middle">${escaped}</text></svg>`);
}

async function createBoard(filename, title, entries, columns) {
  const rows = Math.ceil(entries.length / columns);
  const width = gap + columns * (tileW + gap);
  const height = titleH + gap + rows * (labelH + tileH + gap);
  const composites = [{ input: svgText(width, titleH, title, 24, 750), left: 0, top: 0 }];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const col = i % columns;
    const row = Math.floor(i / columns);
    const left = gap + col * (tileW + gap);
    const top = titleH + gap + row * (labelH + tileH + gap);
    const source = path.join(dir, entry.file);
    if (!fs.existsSync(source)) throw new Error(`Missing QA screenshot: ${source}`);
    const image = await sharp(source).resize(tileW, tileH, { fit: 'fill' }).png().toBuffer();
    composites.push({ input: svgText(tileW, labelH, entry.label, 14, 650, '#DDE8DD'), left, top });
    composites.push({ input: image, left, top: top + labelH });
  }

  await sharp({ create: { width, height, channels: 3, background: '#26302B' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toFile(path.join(dir, filename));
}

await createBoard('weather-board.jpg', 'CairnNZ — Final Home Weather Family', [
  { file: 'home-sunny-day.png', label: 'Sunny Day' },
  { file: 'home-cloudy-day.png', label: 'Cloudy Day' },
  { file: 'home-rain-day.png', label: 'Rainy Day' },
  { file: 'home-snow-day.png', label: 'Snowy Day' },
  { file: 'home-sunny-night.png', label: 'Sunny Night' },
  { file: 'home-cloudy-night.png', label: 'Cloudy Night' },
  { file: 'home-rain-night.png', label: 'Rainy Night' },
  { file: 'home-snow-night.png', label: 'Snowy Night' },
], 4);

await createBoard('day-night-board.jpg', 'CairnNZ — Day / Night Functional System', [
  { file: 'home-sunny-day.png', label: 'Home — Day' },
  { file: 'home-sunny-night.png', label: 'Home — Night' },
  { file: 'settings-day.png', label: 'Settings — Day' },
  { file: 'settings-night.png', label: 'Settings — Night' },
  { file: 'friends-day.png', label: 'Friends — Day' },
  { file: 'friends-night.png', label: 'Friends — Night' },
  { file: 'add-friend-day.png', label: 'Add Friend — Day' },
  { file: 'add-friend-night.png', label: 'Add Friend — Night' },
  { file: 'hiking-day.png', label: 'Hiking — Day' },
  { file: 'hiking-night.png', label: 'Hiking — Night' },
  { file: 'running-day.png', label: 'Running — Day' },
  { file: 'running-night.png', label: 'Running — Night' },
  { file: 'memory-map-day.png', label: 'Memory — Day' },
  { file: 'memory-night.png', label: 'Memory — Night' },
  { file: 'trails-day.png', label: 'Trails — Day' },
  { file: 'trails-night.png', label: 'Trails — Night' },
], 4);

await createBoard('product-unity-board.jpg', 'CairnNZ — Product Unity', [
  { file: 'auth-landing.png', label: 'Auth' },
  { file: 'home-sunny-day.png', label: 'Home' },
  { file: 'settings-day.png', label: 'Settings' },
  { file: 'friends-day.png', label: 'Friends' },
  { file: 'add-friend-day.png', label: 'Add Friend' },
  { file: 'hiking-day.png', label: 'Hiking' },
  { file: 'running-day.png', label: 'Running' },
  { file: 'memory-map-day.png', label: 'Memory' },
  { file: 'trails-day.png', label: 'Trails' },
  { file: 'home-rain-night.png', label: 'Rainy Night' },
], 5);

console.log(`Built visual QA boards in ${dir}`);
