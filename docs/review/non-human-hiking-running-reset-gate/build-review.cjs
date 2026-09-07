const fs = require('fs');
const path = require('path');
const sharp = require('../../../app/node_modules/sharp');

const root = __dirname;
const repo = path.resolve(root, '../../..');
const acceptedCairn = path.join(repo, 'docs/review/action-icon-reset-gate/icons/family-b/cairn.svg');
const homeEvidence = path.join(repo, 'docs/qa/corrective-runtime-2026-08-22/after/home-sunny-day.png');

const hiking = [
  ['H1', 'Lugged trail boot', 'Grounded boot profile with a high collar and visible trail lugs.'],
  ['H2', 'Uphill boot', 'A planted trail boot aligned to a clear rising grade.'],
  ['H3', 'Contour boot', 'Rugged footwear paired with two restrained topo contours.'],
  ['H4', 'Pole + alpine ridge', 'A trekking pole set against a reduced alpine ridge.'],
  ['H5', 'Trail pack', 'A compact technical pack as a long-distance hiking cue.'],
];

const running = [
  ['R1', 'Low road shoe', 'Light low-cut shoe with a clean segmented outsole.'],
  ['R2', 'Forward shoe', 'A compact performance shoe with quiet trailing motion lines.'],
  ['R3', 'Split-sole racer', 'Performance footwear with a clearly split, lighter midsole.'],
  ['R4', 'Pace-arc shoe', 'A reduced shoe paired with two forward cadence arcs.'],
  ['R5', 'Toe-off shoe', 'An angled shoe leaving a short ground-contact shadow.'],
];

const palette = {
  page: '#F4F2EC', paper: '#FFFEFA', ink: '#24453E', muted: '#6F7A74',
  line: '#D7DDD6', field: '#E7EBE5', accent: '#DDE7DE', soft: '#EEF1EB',
};

const read = (file) => fs.readFileSync(file);
const dataUri = (file, mime = 'image/svg+xml') => `data:${mime};base64,${read(file).toString('base64')}`;
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const iconPath = (kind, index) => path.join(root, 'icons', kind, `${kind}-${index}.svg`);
const image = (file, x, y, w, h) => `<image href="${dataUri(file)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const text = (value, x, y, size, weight = 500, anchor = 'start', color = palette.ink, spacing = 0) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(value)}</text>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${palette.page}"/>${body}</svg>`;

function wrap(value, max = 39) {
  const words = value.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function candidateCard(kind, item, index, x, y) {
  const [code, name, description] = item;
  const file = iconPath(kind, index + 1);
  const descriptionLines = wrap(description);
  return [
    `<rect x="${x}" y="${y}" width="282" height="292" rx="28" fill="${palette.paper}" stroke="${palette.line}"/>`,
    `<circle cx="${x + 141}" cy="${y + 102}" r="68" fill="${palette.field}"/>`,
    image(file, x + 87, y + 48, 108, 108),
    text(code, x + 141, y + 198, 19, 750, 'middle', palette.ink, 1.2),
    text(name, x + 141, y + 230, 17, 700, 'middle'),
    ...descriptionLines.map((line, lineIndex) => text(line, x + 141, y + 258 + lineIndex * 16, 12.5, 500, 'middle', palette.muted)),
  ].join('');
}

function masterSheet() {
  let body = '';
  body += text('CairnNZ — Non-human action icon exploration', 50, 68, 36, 750);
  body += text('Hiking + Running reset · ten independent candidates · review only', 50, 106, 18, 500, 'start', palette.muted);
  body += text('HIKING — grounded, rugged, trail-specific', 50, 158, 18, 750, 'start', palette.ink, 1.8);
  hiking.forEach((item, i) => { body += candidateCard('hiking', item, i, 50 + i * 305, 182); });
  body += text('RUNNING — lighter, quicker, performance-led', 50, 534, 18, 750, 'start', palette.ink, 1.8);
  running.forEach((item, i) => { body += candidateCard('running', item, i, 50 + i * 305, 558); });
  body += `<rect x="50" y="900" width="1502" height="180" rx="28" fill="${palette.accent}" stroke="${palette.line}"/>`;
  body += image(acceptedCairn, 92, 936, 108, 108);
  body += text('ACCEPTED CONTEXT ANCHOR — FAMILY B LEAVE A CAIRN', 238, 960, 18, 750, 'start', palette.ink, 1.25);
  body += text('Preserved byte-for-byte. Shown only to calibrate restraint, weight, and product maturity.', 238, 998, 18, 500, 'start', palette.muted);
  body += text('SHA-256  5429c91d5c810a1de2652e6eef8a1162f17b345b0b4ff973193ced60823ee1e1', 238, 1038, 14, 500, 'start', palette.muted, 0.45);
  body += text('No people, silhouettes, anatomy, pins, footprints, hearts, ECG marks, or lightning cues.', 1552, 1122, 14, 600, 'end', palette.muted);
  return svg(1602, 1150, body);
}

function homeCard(x, y, iconFile, label, code) {
  return [
    `<rect x="${x}" y="${y}" width="138" height="104" rx="22" fill="${palette.paper}" stroke="${palette.line}"/>`,
    image(iconFile, x + 54.5, y + 17, 29, 29),
    text(label, x + 69, y + 68, 13, 700, 'middle'),
    text(code, x + 69, y + 89, 11, 700, 'middle', palette.muted, 0.8),
  ].join('');
}

function homeSizeSheet() {
  let body = '';
  body += text('Home-size check — actual 29px icons', 50, 66, 34, 750);
  body += text('Every glyph below is rendered at exactly 29 × 29 CSS pixels in a Home-action-sized card.', 50, 102, 17, 500, 'start', palette.muted);
  body += text('HIKING', 470, 146, 15, 750, 'middle', palette.ink, 1.5);
  body += text('RUNNING', 670, 146, 15, 750, 'middle', palette.ink, 1.5);
  body += text('ACCEPTED ANCHOR', 870, 146, 15, 750, 'middle', palette.ink, 1.5);
  for (let i = 0; i < 5; i++) {
    const y = 174 + i * 122;
    body += text(`PAIR ${i + 1}`, 250, y + 59, 14, 750, 'end', palette.muted, 1);
    body += homeCard(401, y, iconPath('hiking', i + 1), 'Hiking', `H${i + 1}`);
    body += homeCard(601, y, iconPath('running', i + 1), 'Running', `R${i + 1}`);
    body += homeCard(801, y, acceptedCairn, 'Leave a Cairn', 'LOCKED B');
  }
  body += `<rect x="50" y="800" width="1100" height="88" rx="22" fill="${palette.soft}" stroke="${palette.line}"/>`;
  body += text('Inspection rule', 78, 833, 14, 750, 'start', palette.ink, 1);
  body += text('Judge the 29px mark first. The labels support the decision but must not rescue an unreadable symbol.', 78, 863, 16, 500, 'start', palette.muted);
  return svg(1200, 930, body);
}

function semanticRow(kind, item, index, x, y) {
  const [code, name] = item;
  const file = iconPath(kind, index + 1);
  return [
    `<rect x="${x}" y="${y}" width="620" height="142" rx="24" fill="${palette.paper}" stroke="${palette.line}"/>`,
    `<circle cx="${x + 86}" cy="${y + 71}" r="50" fill="${palette.field}"/>`,
    image(file, x + 44, y + 29, 84, 84),
    text(code, x + 162, y + 44, 17, 750, 'start', palette.ink, 1),
    text('FIRST GLANCE:', x + 162, y + 78, 12, 750, 'start', palette.muted, 1),
    `<line x1="${x + 272}" y1="${y + 75}" x2="${x + 575}" y2="${y + 75}" stroke="${palette.line}" stroke-width="1.5"/>`,
    text('WITH LABEL', x + 162, y + 115, 11, 750, 'start', palette.muted, 1),
    image(file, x + 258, y + 91, 29, 29),
    text(kind === 'hiking' ? 'Hiking' : 'Running', x + 302, y + 113, 14, 700),
    text(name, x + 575, y + 113, 13, 600, 'end', palette.muted),
  ].join('');
}

function semanticSheet() {
  let body = '';
  body += text('Semantic check — identify before reading', 50, 66, 34, 750);
  body += text('Use the blank line to record the first meaning you see. Then check the 29px labeled state.', 50, 102, 17, 500, 'start', palette.muted);
  body += text('HIKING CANDIDATES', 50, 154, 16, 750, 'start', palette.ink, 1.6);
  body += text('RUNNING CANDIDATES', 730, 154, 16, 750, 'start', palette.ink, 1.6);
  for (let i = 0; i < 5; i++) {
    body += semanticRow('hiking', hiking[i], i, 50, 178 + i * 160);
    body += semanticRow('running', running[i], i, 730, 178 + i * 160);
  }
  body += `<rect x="50" y="994" width="1300" height="122" rx="24" fill="${palette.accent}" stroke="${palette.line}"/>`;
  body += image(acceptedCairn, 78, 1013, 84, 84);
  body += text('ACCEPTED B CAIRN — CONTEXT ONLY', 190, 1038, 16, 750, 'start', palette.ink, 1.1);
  body += text('Maturity anchor only. Do not compare its placement gesture as an activity-semantic requirement.', 190, 1074, 16, 500, 'start', palette.muted);
  return svg(1400, 1165, body);
}

function previewPhone(i, x, y) {
  const screenshot = dataUri(homeEvidence, 'image/png');
  const cardY = y + 464;
  const cardXs = [x + 68, x + 155, x + 242];
  const iconFiles = [iconPath('hiking', i + 1), iconPath('running', i + 1), acceptedCairn];
  const labels = ['Hiking', 'Running', 'Leave a Cairn'];
  let out = `<rect x="${x - 4}" y="${y - 4}" width="398" height="852" rx="34" fill="#1D211F"/>`;
  out += `<image href="${screenshot}" x="${x}" y="${y}" width="390" height="844"/>`;
  cardXs.forEach((cx, j) => {
    out += `<rect x="${cx}" y="${cardY}" width="82" height="84" rx="18" fill="#F7F8F2" fill-opacity=".97"/>`;
    out += image(iconFiles[j], cx + 26.5, cardY + 13, 29, 29);
    out += text(labels[j], cx + 41, cardY + 63, j === 2 ? 8.4 : 9.5, 700, 'middle');
  });
  return out;
}

function homePreview() {
  let body = '';
  body += text('Preview only — current Expo Web Home context', 50, 65, 34, 750);
  body += text('Five independent pairings at 390 × 844. The accepted B Cairn is repeated unchanged as the third action.', 50, 101, 17, 500, 'start', palette.muted);
  const positions = [[50, 158], [480, 158], [910, 158], [265, 1058], [695, 1058]];
  positions.forEach(([x, y], i) => {
    body += text(`H${i + 1} + R${i + 1}`, x + 195, y - 20, 16, 750, 'middle', palette.ink, 1.1);
    body += previewPhone(i, x, y);
  });
  body += text('Static review composite derived from real 390 × 844 Expo Web evidence; no runtime icon or layout mapping changed.', 700, 1938, 14, 600, 'middle', palette.muted);
  return svg(1400, 1970, body);
}

async function writeBoard(name, markup) {
  const svgPath = path.join(root, `${name}.svg`);
  const pngPath = path.join(root, `${name}.png`);
  fs.writeFileSync(svgPath, markup);
  await sharp(Buffer.from(markup)).png().toFile(pngPath);
}

(async () => {
  await writeBoard('non-human-icon-master', masterSheet());
  await writeBoard('non-human-icon-home-size', homeSizeSheet());
  await writeBoard('non-human-icon-semantic-check', semanticSheet());
  await writeBoard('non-human-icon-home-preview', homePreview());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
