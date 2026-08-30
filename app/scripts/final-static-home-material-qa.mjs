import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'final-static-visual-correction-gate', 'home');
const p = path.resolve('assets', 'home', 'prototypes');
fs.mkdirSync(out, { recursive: true });

const sources = {
  clean: path.join(p, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
  oldV2: path.join(p, 'weather-material-polish-v2', 'sunny', 'sunny-day-material-natural-v2-native.png'),
  v3: path.join(p, 'weather-material-rebuild-v3', 'sunny', 'sunny-day-soft-natural-v3-native.png'),
};

async function labeledBoard(name, panels, columns, tileW, tileH) {
  const header = 38;
  const rows = Math.ceil(panels.length / columns);
  const composites = [];
  for (let index = 0; index < panels.length; index += 1) {
    const left = (index % columns) * tileW;
    const top = Math.floor(index / columns) * (tileH + header);
    let image = sharp(panels[index].file);
    if (panels[index].crop) image = image.extract(panels[index].crop);
    const tile = await image.resize(tileW, tileH, { fit: panels[index].fit ?? 'cover' }).png().toBuffer();
    composites.push({ input: tile, left, top: top + header });
    composites.push({ input: Buffer.from(`<svg width="${tileW}" height="${header}"><rect width="100%" height="100%" fill="#F4F2EC"/><text x="${tileW / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#243B34">${panels[index].label}</text></svg>`), left, top });
  }
  await sharp({ create: { width: columns * tileW, height: rows * (tileH + header), channels: 3, background: '#F4F2EC' } })
    .composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(path.join(out, name));
}

await labeledBoard('clean-master-vs-old-v2-review.jpg', [
  { file: sources.clean, label: 'APPROVED CLEAN MASTER' },
  { file: sources.oldV2, label: 'REJECTED V2 · FACETS RETAINED' },
  { file: sources.v3, label: 'V3 · GEOMETRY-LOCKED RECOVERY' },
], 3, 390, 844);

const variants = [
  ['SUNNY', 'sunny', 'sunny-day'],
  ['CLOUDY', 'cloudy', 'cloudy-day'],
  ['RAINY', 'rainy', 'rainy-day'],
  ['SNOWY', 'snowy', 'snowy-day'],
];
const v3 = (family, key) => path.join(p, 'weather-material-rebuild-v3', family, `${key}-soft-natural-v3-native.png`);

await labeledBoard('water-softness-naturalism-review.jpg', variants.map(([label, family, key]) => ({
  file: v3(family, key), label: `${label} · ORGANIC WATER`, crop: { left: 335, top: 830, width: 518, height: 340 }, fit: 'cover',
})), 4, 320, 230);

await labeledBoard('mountain-softness-review.jpg', variants.map(([label, family, key]) => ({
  file: v3(family, key), label: `${label} · SIMPLIFIED GEOLOGY`, crop: { left: 190, top: 500, width: 663, height: 500 }, fit: 'cover',
})), 4, 320, 250);

await labeledBoard('foreground-naturalism-review.jpg', variants.map(([label, family, key]) => ({
  file: v3(family, key), label: `${label} · CALMER FOREGROUND`, crop: { left: 0, top: 1120, width: 853, height: 724 }, fit: 'cover',
})), 4, 320, 270);

for (const [from, to] of [
  ['weather-12-state-final-polish-board.jpg', '12-state-weather-review.jpg'],
  ['night-sky-beauty-restraint-review.jpg', 'night-sky-beauty-review.jpg'],
  ['same-world-geometry-final-polish-review.jpg', 'same-world-geometry-review.jpg'],
]) fs.copyFileSync(path.join(out, from), path.join(out, to));

console.log(`Wrote final Home material QA to ${out}`);
