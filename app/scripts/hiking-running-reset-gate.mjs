import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('..');
const outputDir = path.join(root, 'docs', 'review', 'hiking-running-reset-gate');
const iconDir = path.join(outputDir, 'icons');
const acceptedCairnPath = path.join(
  root,
  'docs',
  'review',
  'action-icon-reset-gate',
  'icons',
  'family-b',
  'cairn.svg',
);
const sunnyHomePath = path.join(
  root,
  'docs',
  'qa',
  'visual-north-star',
  'final-home-weather-polish-gate',
  'sunny-day-home-390x844.png',
);

const colors = {
  ink: '#24453E',
  secondary: '#6F7A74',
  paper: '#F4F2EC',
  card: '#FFFEFA',
  border: '#D7DDD6',
  quiet: '#E7EBE5',
  accent: '#789174',
};

const hiking = [
  {
    id: 'hiking-1',
    name: 'Single pole + incline',
    note: 'A calm uphill stride, one pole and one short trail cue.',
    body: `
      <circle cx="22.5" cy="7.8" r="3"/>
      <path d="M22.2 11.5L21 23.8"/>
      <path d="M21.7 15.2l-5.6 4.4-3.2-2.8"/>
      <path d="M22 15.1l5.7 4.8 3.4-2"/>
      <path d="M21 23.8l6.8 6.3 6.8 3.1"/>
      <path d="M21 23.8l-4.8 8.1-6 5.7"/>
      <path d="M31 17.8l3.7 18.6"/>
      <path d="M8 39.5h10M31.5 37.5h8"/>
    `,
  },
  {
    id: 'hiking-2',
    name: 'Pack + trail stride',
    note: 'A small pack and measured walking rhythm; no scenery.',
    body: `
      <circle cx="25.5" cy="7.8" r="3"/>
      <path d="M24.8 11.5l-2.2 12.1"/>
      <path d="M23.7 13.4c-4.6.2-6.4 2.4-6 7.7l4.9 1.6"/>
      <path d="M24.1 15.1l5.9 5.1 3-1.9"/>
      <path d="M22.6 23.6l6.8 6.9 7 3.6"/>
      <path d="M22.6 23.6l-5.1 8-7 5.1"/>
      <path d="M32.8 18.8l2.8 18"/>
      <path d="M8.5 38.8h10M31.5 38.8h8"/>
    `,
  },
  {
    id: 'hiking-3',
    name: 'Ascending trail',
    note: 'A simple walker made hike-specific by a stepped rise.',
    body: `
      <circle cx="22.5" cy="7.8" r="3"/>
      <path d="M22.3 11.5l1 12.1"/>
      <path d="M22.7 14.8l-5.4 5-3.6-2.8"/>
      <path d="M22.9 14.8l5.2 5.5 3.9-2.4"/>
      <path d="M23.3 23.6l-4.7 7.5-6.3 3.2"/>
      <path d="M23.3 23.6l6.3 5.8 6.3 1.2"/>
      <path d="M8.5 39h10v-4.5h10v-4.5h11"/>
    `,
  },
  {
    id: 'hiking-4',
    name: 'Two-pole trek',
    note: 'Front-facing trekking posture with balanced pole support.',
    body: `
      <circle cx="24" cy="7.5" r="3"/>
      <path d="M24 11.2l-1.4 12.5"/>
      <path d="M23.5 14.3l-6.7 5.6"/>
      <path d="M23.9 14.4l6.7 5.4"/>
      <path d="M22.6 23.7l-4.8 8.2-4.2 5"/>
      <path d="M22.6 23.7l5.4 7.2 4.6 5.3"/>
      <path d="M16.6 19.4l-4.1 19"/>
      <path d="M30.8 19.3l4.4 19.1"/>
      <path d="M9.5 39h7M31.5 39h7"/>
    `,
  },
  {
    id: 'hiking-5',
    name: 'Open trail hiker',
    note: 'A relaxed pole-assisted stride over one rising contour.',
    body: `
      <circle cx="20.5" cy="8" r="3"/>
      <path d="M21 11.7l3.4 11.7"/>
      <path d="M22 14.9l-5.4 4.7-3.2-2.5"/>
      <path d="M22.2 14.9l6.6 4.2 3-2.2"/>
      <path d="M24.4 23.4l7.1 6.2 6.1 2.2"/>
      <path d="M24.4 23.4l-3.9 8.3-6.1 5.3"/>
      <path d="M31.8 17.4l3.6 18.4"/>
      <path d="M8 39.4c10.3-1 19-3.8 32-8.2"/>
    `,
  },
];

const running = [
  {
    id: 'running-1',
    name: 'Open stride',
    note: 'Forward lean, opposite arms and a decisive open stride.',
    body: `
      <circle cx="29.5" cy="8.5" r="3"/>
      <path d="M27.8 12.4l-6 11.6"/>
      <path d="M25.8 15.8l6 4.2 4.1-3.2"/>
      <path d="M25.5 16.1l-6.3 1.3-3.1-3.3"/>
      <path d="M21.8 24l8 5.8 8.2-.5"/>
      <path d="M21.8 24l-5.8 8.1-7 5"/>
    `,
  },
  {
    id: 'running-2',
    name: 'Forward drive',
    note: 'A compact athletic lean with clear knee and rear extension.',
    body: `
      <circle cx="30" cy="9" r="3"/>
      <path d="M28.2 12.8l-7.4 10.4"/>
      <path d="M26.1 15.6l5.3 5.2 4.6-2"/>
      <path d="M25.8 15.8l-6.4-.4-3-3.5"/>
      <path d="M20.8 23.2l8.7 5.1 6.6 5.4"/>
      <path d="M20.8 23.2l-3.4 8.1-8.1 3.6"/>
    `,
  },
  {
    id: 'running-3',
    name: 'Upright rhythm',
    note: 'A natural running cadence with restrained, readable joints.',
    body: `
      <circle cx="24" cy="8" r="3"/>
      <path d="M24 11.8l-2 12.2"/>
      <path d="M23.2 15l-6.7 4.2-3.4-2.6"/>
      <path d="M23.1 15.1l5.6 4.8 4-3.3"/>
      <path d="M22 24l7.6 6 7.4 1"/>
      <path d="M22 24l-4.2 8-7.1 4.2"/>
    `,
  },
  {
    id: 'running-4',
    name: 'Long stride',
    note: 'The widest stride of the set, simplified to six clear lines.',
    body: `
      <circle cx="28.5" cy="8.5" r="3"/>
      <path d="M27 12.5l-5.5 11.2"/>
      <path d="M25.7 15.3l6.5 3.4 3.2-3"/>
      <path d="M25 15.5l-5.8 2.9-4.4-2.3"/>
      <path d="M21.5 23.7l9.2 5.3 8 .8"/>
      <path d="M21.5 23.7l-6.7 7-6.5 5.8"/>
    `,
  },
  {
    id: 'running-5',
    name: 'Compact sprint',
    note: 'A shorter body mark with an unmistakable airborne cadence.',
    body: `
      <circle cx="28" cy="9" r="3"/>
      <path d="M26.3 12.8l-6.4 10.7"/>
      <path d="M24.9 15.6l5.2 4.7 4.6-1.3"/>
      <path d="M24.4 15.8l-6.4.8-2.3-3.4"/>
      <path d="M19.9 23.5l7.1 6.9 7.5 3.2"/>
      <path d="M19.9 23.5l-5.3 7.1-6.6 2.1"/>
    `,
  },
];

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function iconSvg(body, { color = colors.ink, width = 48, height = 48 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="4 3 40 40" style="color:${color}"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.35">${body}</g></svg>`;
}

function dataUri(content, mime = 'image/svg+xml') {
  return `data:${mime};base64,${Buffer.from(content).toString('base64')}`;
}

function text(value, x, y, size, options = {}) {
  const {
    color = colors.ink,
    weight = 500,
    anchor = 'start',
    spacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${color}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}">${value}</text>`;
}

async function renderSvg(name, svg) {
  await fs.writeFile(path.join(outputDir, `${name}.svg`), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, `${name}.png`));
}

await fs.mkdir(path.join(iconDir, 'hiking'), { recursive: true });
await fs.mkdir(path.join(iconDir, 'running'), { recursive: true });

const acceptedBefore = await fs.readFile(acceptedCairnPath);
const acceptedHashBefore = sha256(acceptedBefore);
const acceptedCairnSvg = acceptedBefore.toString('utf8');

for (const icon of hiking) {
  const source = iconSvg(icon.body);
  icon.svg = source;
  await fs.writeFile(path.join(iconDir, 'hiking', `${icon.id}.svg`), source);
}
for (const icon of running) {
  const source = iconSvg(icon.body);
  icon.svg = source;
  await fs.writeFile(path.join(iconDir, 'running', `${icon.id}.svg`), source);
}

const masterCards = (items, y) => items.map((item, index) => {
  const x = 50 + index * 305;
  return `
    <rect x="${x}" y="${y}" width="275" height="300" rx="28" fill="${colors.card}" stroke="${colors.border}"/>
    <circle cx="${x + 137.5}" cy="${y + 115}" r="72" fill="${colors.quiet}"/>
    <image href="${dataUri(item.svg)}" x="${x + 83.5}" y="${y + 61}" width="108" height="108"/>
    ${text(item.id.toUpperCase().replace('-', ' '), x + 137.5, y + 216, 19, { weight: 700, anchor: 'middle', spacing: 1.2 })}
    ${text(item.name, x + 137.5, y + 248, 17, { weight: 600, anchor: 'middle' })}
  `;
}).join('');

const masterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1150" viewBox="0 0 1600 1150">
  <rect width="1600" height="1150" fill="${colors.paper}"/>
  ${text('Hiking + Running reset', 50, 70, 38, { weight: 700 })}
  ${text('Ten independent line-art candidates. The accepted Family B cairn is context only and remains unchanged.', 50, 108, 18, { color: colors.secondary })}
  ${text('HIKING — select one independently', 50, 160, 18, { weight: 700, spacing: 2 })}
  ${masterCards(hiking, 185)}
  ${text('RUNNING — select one independently', 50, 540, 18, { weight: 700, spacing: 2 })}
  ${masterCards(running, 565)}
  <rect x="50" y="920" width="1500" height="170" rx="28" fill="#E7ECE6" stroke="${colors.border}"/>
  <image href="${dataUri(acceptedCairnSvg)}" x="92" y="951" width="108" height="108"/>
  ${text('ACCEPTED REFERENCE — FAMILY B LEAVE A CAIRN', 238, 976, 18, { weight: 700, spacing: 1.3 })}
  ${text('Preserved byte-for-byte. It is shown only to judge weight and maturity beside the new candidates.', 238, 1012, 18, { color: colors.secondary })}
  ${text(`SHA-256  ${acceptedHashBefore}`, 238, 1048, 14, { color: colors.secondary, spacing: 0.6 })}
</svg>`;

await renderSvg('hiking-running-reset-master', masterSvg);

function smallTiles(items, y) {
  return items.map((item, index) => {
    const x = 55 + index * 305;
    return `
      <rect x="${x}" y="${y}" width="275" height="180" rx="26" fill="rgba(255,254,250,0.88)" stroke="${colors.border}"/>
      <rect x="${x + 85}" y="${y + 30}" width="105" height="92" rx="22" fill="rgba(238,240,231,0.95)" stroke="#CAD2CA"/>
      <image href="${dataUri(item.svg)}" x="${x + 123}" y="${y + 49}" width="29" height="29"/>
      ${text(item.id.toUpperCase().replace('-', ' '), x + 137.5, y + 150, 17, { weight: 700, anchor: 'middle' })}
      ${text('29 px exact', x + 137.5, y + 171, 12, { color: colors.secondary, anchor: 'middle' })}
    `;
  }).join('');
}

const homeSizeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720" viewBox="0 0 1600 720">
  <rect width="1600" height="720" fill="${colors.paper}"/>
  ${text('Actual Home-size check', 50, 68, 38, { weight: 700 })}
  ${text('Each candidate is rendered at exactly 29 × 29 px. Judge the icon, not the enlarged drawing.', 50, 106, 18, { color: colors.secondary })}
  ${text('HIKING', 55, 155, 17, { weight: 700, spacing: 2 })}
  ${smallTiles(hiking, 178)}
  ${text('RUNNING', 55, 407, 17, { weight: 700, spacing: 2 })}
  ${smallTiles(running, 430)}
  <rect x="1190" y="635" width="355" height="58" rx="22" fill="#E7ECE6" stroke="${colors.border}"/>
  <image href="${dataUri(acceptedCairnSvg)}" x="1212" y="649" width="29" height="29"/>
  ${text('Accepted Family B cairn · 29 px', 1255, 672, 14, { weight: 600 })}
</svg>`;

await renderSvg('hiking-running-home-size', homeSizeSvg);

const homeCrop = await sharp(sunnyHomePath)
  .extract({ left: 50, top: 435, width: 290, height: 145 })
  .png()
  .toBuffer();
const homeCropUri = dataUri(homeCrop, 'image/png');

function actionPreviewRows(items, y, activeSlot) {
  return items.map((item, index) => {
    const x = 35 + index * 308;
    const activeCenter = activeSlot === 'hiking' ? x + 57 : x + 145;
    const otherCenter = activeSlot === 'hiking' ? x + 145 : x + 57;
    const cairnCenter = x + 232;
    return `
      <rect x="${x - 1}" y="${y - 1}" width="292" height="147" rx="16" fill="#fff" stroke="${colors.border}"/>
      <image href="${homeCropUri}" x="${x}" y="${y}" width="290" height="145"/>
      <rect x="${activeCenter - 20}" y="${y + 37}" width="40" height="38" rx="12" fill="#EEF0E7" opacity="0.98"/>
      <rect x="${otherCenter - 20}" y="${y + 37}" width="40" height="38" rx="12" fill="#EEF0E7" opacity="0.98"/>
      <rect x="${cairnCenter - 20}" y="${y + 37}" width="40" height="38" rx="12" fill="#EEF0E7" opacity="0.98"/>
      <image href="${dataUri(item.svg)}" x="${activeCenter - 14.5}" y="${y + 41.5}" width="29" height="29"/>
      <circle cx="${otherCenter}" cy="${y + 56}" r="4" fill="#A7AFA7"/>
      <image href="${dataUri(acceptedCairnSvg)}" x="${cairnCenter - 14.5}" y="${y + 41.5}" width="29" height="29"/>
      ${text(item.id.toUpperCase().replace('-', ' '), x + 145, y + 173, 15, { weight: 700, anchor: 'middle' })}
    `;
  }).join('');
}

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="750" viewBox="0 0 1600 750">
  <rect width="1600" height="750" fill="${colors.paper}"/>
  ${text('Sunny Day Home action-row preview', 35, 60, 36, { weight: 700 })}
  ${text('Independent slot tests: the grey dot is an intentionally neutral placeholder; the accepted cairn stays fixed.', 35, 96, 17, { color: colors.secondary })}
  ${text('HIKING SLOT ONLY', 35, 145, 16, { weight: 700, spacing: 2 })}
  ${actionPreviewRows(hiking, 168, 'hiking')}
  ${text('RUNNING SLOT ONLY', 35, 405, 16, { weight: 700, spacing: 2 })}
  ${actionPreviewRows(running, 428, 'running')}
  ${text('Preview-only · 29 px candidates · select Hiking and Running independently', 35, 722, 15, { color: colors.secondary })}
</svg>`;

await renderSvg('hiking-running-home-preview', previewSvg);

const acceptedAfter = await fs.readFile(acceptedCairnPath);
const acceptedHashAfter = sha256(acceptedAfter);
if (acceptedHashAfter !== acceptedHashBefore) {
  throw new Error('Accepted Family B cairn changed during review generation.');
}

const readme = `# Hiking + Running reset gate

Review-only exploration. No app/runtime source is changed by this generator.

## Preserved accepted reference

- Source: \`docs/review/action-icon-reset-gate/icons/family-b/cairn.svg\`
- SHA-256 before: \`${acceptedHashBefore}\`
- SHA-256 after: \`${acceptedHashAfter}\`
- Result: byte-for-byte unchanged

## Candidate intent

### Hiking

- H1: clearest single-pole uphill cue; compact and direct.
- H2: pack improves hike specificity, with slightly more detail at small size.
- H3: strongest trail/incline cue, but the stepped baseline is more symbolic.
- H4: symmetrical two-pole trek; very stable at small size, less directional.
- H5: open uphill stride with a softer trail contour.

### Running

- R1: balanced open stride and immediate running posture.
- R2: strongest forward drive; compact lower-body rhythm.
- R3: most upright/natural cadence; slightly closer to jogging.
- R4: widest stride and clearest speed through posture alone.
- R5: compact airborne cadence; simplest silhouette at reduced size.

Hiking and Running candidates are independent. The matching numbers do not define families or recommended pairs.
`;
await fs.writeFile(path.join(outputDir, 'README.md'), readme);

console.log(JSON.stringify({
  outputDir,
  hikingCandidates: hiking.length,
  runningCandidates: running.length,
  acceptedHashBefore,
  acceptedHashAfter,
  acceptedUnchanged: acceptedHashBefore === acceptedHashAfter,
}, null, 2));
