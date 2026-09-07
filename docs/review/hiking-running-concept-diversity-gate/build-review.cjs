const fs = require('fs');
const path = require('path');
const sharp = require('../../../app/node_modules/sharp');

const root = __dirname;
const repo = path.resolve(root, '../../..');
const acceptedCairn = path.join(repo, 'docs/review/action-icon-reset-gate/icons/family-b/cairn.svg');
const homeEvidence = path.join(repo, 'docs/qa/corrective-runtime-2026-08-22/after/home-sunny-day.png');

const families = [
  {
    id: 'A', slug: 'family-a', name: 'Field Signals',
    metaphor: 'Built field markings separate a rugged trail blaze from a measured running track.',
    hiking: 'Trail blaze post', running: 'Track lane marks',
    ratings: ['Good', 'Good', 'Strong'],
  },
  {
    id: 'B', slug: 'family-b', name: 'Ground Rhythm',
    metaphor: 'Contact marks show deliberate weight on rough ground versus a light accelerating cadence.',
    hiking: 'Weighted trail contacts', running: 'Light cadence trace',
    ratings: ['Fair', 'Good', 'Good'],
  },
  {
    id: 'C', slug: 'family-c', name: 'Movement Profile',
    metaphor: 'Motion notation contrasts stepped elevation gain with a continuous rebound profile.',
    hiking: 'Stepped ascent', running: 'Rebound cadence',
    ratings: ['Fair', 'Strong', 'Good'],
  },
  {
    id: 'D', slug: 'family-d', name: 'Specialist Tools',
    metaphor: 'Defining tools stand in: trekking poles for Hiking, a split timer for Running.',
    hiking: 'Trekking poles', running: 'Split timer',
    ratings: ['Good', 'Strong', 'Strong'],
  },
  {
    id: 'E', slug: 'family-e', name: 'Worn Form',
    metaphor: 'Purpose-built footwear contrasts a lugged boot with a low, light performance shoe.',
    hiking: 'Lugged trail boot', running: 'Low performance shoe',
    ratings: ['Strong', 'Strong', 'Good'],
  },
];

const palette = {
  page: '#F3F1EA', paper: '#FFFEFA', ink: '#24453E', muted: '#68756F',
  line: '#D2D9D1', field: '#E5EAE3', accent: '#DCE7DD', soft: '#ECEFE9',
  dark: '#17221F', white: '#F9FAF5',
};

const read = (file) => fs.readFileSync(file);
const dataUri = (file, mime = 'image/svg+xml') => `data:${mime};base64,${read(file).toString('base64')}`;
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const iconPath = (family, kind) => path.join(root, 'icons', family.slug, `${kind}.svg`);
const image = (file, x, y, w, h) => `<image href="${dataUri(file)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const text = (value, x, y, size, weight = 500, anchor = 'start', color = palette.ink, spacing = 0) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(value)}</text>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${palette.page}"/>${body}</svg>`;

function conceptIconCell(family, kind, x, y, label, caption) {
  return [
    `<rect x="${x}" y="${y}" width="190" height="168" rx="24" fill="${palette.paper}" stroke="${palette.line}"/>`,
    `<circle cx="${x + 95}" cy="${y + 69}" r="48" fill="${palette.field}"/>`,
    image(kind === 'cairn' ? acceptedCairn : iconPath(family, kind), x + 55, y + 29, 80, 80),
    text(label, x + 95, y + 133, 13, 750, 'middle', kind === 'cairn' ? palette.muted : palette.ink, 1),
    text(caption, x + 95, y + 154, 12, 600, 'middle', palette.muted),
  ].join('');
}

function conceptDirectionsBoard() {
  let body = '';
  body += text('CairnNZ — five icon concept directions', 50, 67, 36, 760);
  body += text('Choose the semantic metaphor first · Hiking + Running · review only', 50, 104, 18, 500, 'start', palette.muted);
  body += `<rect x="50" y="126" width="1500" height="2" fill="${palette.line}"/>`;
  families.forEach((family, index) => {
    const y = 152 + index * 230;
    body += `<rect x="50" y="${y}" width="1500" height="206" rx="28" fill="${palette.paper}" stroke="${palette.line}"/>`;
    body += `<circle cx="98" cy="${y + 48}" r="27" fill="${palette.accent}"/>`;
    body += text(family.id, 98, y + 56, 22, 800, 'middle');
    body += text(family.name, 140, y + 45, 22, 750);
    body += text(family.metaphor, 140, y + 77, 16, 500, 'start', palette.muted);
    body += text('SEMANTIC', 140, y + 120, 11, 750, 'start', palette.muted, 1.2);
    body += text(family.ratings[0], 140, y + 143, 14, 700);
    body += text('29PX', 250, y + 120, 11, 750, 'start', palette.muted, 1.2);
    body += text(family.ratings[1], 250, y + 143, 14, 700);
    body += text('CAIRNNZ FIT', 345, y + 120, 11, 750, 'start', palette.muted, 1.2);
    body += text(family.ratings[2], 345, y + 143, 14, 700);
    body += conceptIconCell(family, 'hiking', 880, y + 19, 'HIKING', family.hiking);
    body += conceptIconCell(family, 'running', 1090, y + 19, 'RUNNING', family.running);
    body += conceptIconCell(family, 'cairn', 1300, y + 19, 'LOCKED B', 'Context only');
  });
  body += text('The Cairn is repeated unchanged only to calibrate line weight, restraint, and 48px scale.', 50, 1340, 14, 600, 'start', palette.muted);
  body += text('Only Family E uses footwear. No human form, anatomy, character, pin, heart, ECG, or lightning symbol is used.', 1550, 1340, 14, 600, 'end', palette.muted);
  return svg(1600, 1380, body);
}

function homeCard(x, y, family, kind, label, code) {
  return [
    `<rect x="${x}" y="${y}" width="150" height="104" rx="22" fill="${palette.paper}" stroke="${palette.line}"/>`,
    image(kind === 'cairn' ? acceptedCairn : iconPath(family, kind), x + 60.5, y + 17, 29, 29),
    text(label, x + 75, y + 69, kind === 'cairn' ? 11.5 : 13, 700, 'middle'),
    text(code, x + 75, y + 90, 11, 750, 'middle', palette.muted, 0.9),
  ].join('');
}

function homeSizeBoard() {
  let body = '';
  body += text('Home-size board — actual 29px glyphs', 50, 66, 34, 760);
  body += text('Judge meaning at intended action size; the labels must not rescue an unreadable metaphor.', 50, 102, 17, 500, 'start', palette.muted);
  body += text('HIKING', 514, 148, 14, 750, 'middle', palette.ink, 1.4);
  body += text('RUNNING', 714, 148, 14, 750, 'middle', palette.ink, 1.4);
  body += text('ACCEPTED ANCHOR', 914, 148, 14, 750, 'middle', palette.ink, 1.4);
  families.forEach((family, index) => {
    const y = 172 + index * 124;
    body += text(`FAMILY ${family.id}`, 208, y + 42, 15, 780, 'end', palette.ink, 1);
    body += text(family.name, 208, y + 67, 13, 600, 'end', palette.muted);
    body += homeCard(439, y, family, 'hiking', 'Hiking', `${family.id} / H`);
    body += homeCard(639, y, family, 'running', 'Running', `${family.id} / R`);
    body += homeCard(839, y, family, 'cairn', 'Leave a Cairn', 'LOCKED B');
  });
  body += `<rect x="50" y="812" width="1100" height="80" rx="22" fill="${palette.soft}" stroke="${palette.line}"/>`;
  body += text('Actual-size rule', 78, 844, 13, 750, 'start', palette.ink, 1);
  body += text('Every icon above is exactly 29 × 29 CSS pixels. Cards are inspection scaffolding, not a proposed Home redesign.', 78, 871, 15, 500, 'start', palette.muted);
  return svg(1200, 930, body);
}

function previewPhone(family, x, y) {
  const screenshot = dataUri(homeEvidence, 'image/png');
  const cardY = y + 464;
  const cardXs = [x + 68, x + 155, x + 242];
  const icons = [iconPath(family, 'hiking'), iconPath(family, 'running'), acceptedCairn];
  const labels = ['Hiking', 'Running', 'Leave a Cairn'];
  let out = `<rect x="${x - 4}" y="${y - 4}" width="398" height="852" rx="34" fill="${palette.dark}"/>`;
  out += `<image href="${screenshot}" x="${x}" y="${y}" width="390" height="844"/>`;
  cardXs.forEach((cx, index) => {
    out += `<rect x="${cx}" y="${cardY}" width="82" height="84" rx="18" fill="${palette.white}" fill-opacity=".97"/>`;
    out += image(icons[index], cx + 26.5, cardY + 13, 29, 29);
    out += text(labels[index], cx + 41, cardY + 63, index === 2 ? 8.4 : 9.5, 700, 'middle');
  });
  return out;
}

function homeContextBoard() {
  let body = '';
  body += text('Home context — five metaphors, no integration', 50, 65, 34, 760);
  body += text('Each pair is previewed at 29px in the current three-action row; locked B Cairn remains unchanged.', 50, 101, 17, 500, 'start', palette.muted);
  const positions = [[50, 158], [480, 158], [910, 158], [265, 1058], [695, 1058]];
  positions.forEach(([x, y], index) => {
    const family = families[index];
    body += text(`FAMILY ${family.id} · ${family.name}`, x + 195, y - 20, 16, 760, 'middle', palette.ink, 0.8);
    body += previewPhone(family, x, y);
  });
  body += text('Static composite over real 390 × 844 Expo Web Home evidence. No runtime mapping or layout was changed.', 700, 1938, 14, 600, 'middle', palette.muted);
  return svg(1400, 1970, body);
}

async function writeBoard(name, markup) {
  const svgPath = path.join(root, `${name}.svg`);
  const pngPath = path.join(root, `${name}.png`);
  fs.writeFileSync(svgPath, markup);
  await sharp(Buffer.from(markup)).png().toFile(pngPath);
}

(async () => {
  await writeBoard('concept-directions-board', conceptDirectionsBoard());
  await writeBoard('home-size-board', homeSizeBoard());
  await writeBoard('home-context-board', homeContextBoard());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
