import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const repo = path.resolve('..');
const outputDir = path.join(repo, 'docs', 'review', 'orthogonal-non-human-action-icons-v2');
const iconDir = path.join(outputDir, 'icons');
const acceptedCairn = path.join(repo, 'docs', 'review', 'action-icon-reset-gate', 'icons', 'family-b', 'cairn.svg');
const homeEvidence = path.join(repo, 'docs', 'qa', 'visual-north-star', 'final-home-weather-polish-gate', 'sunny-day-home-390x844.png');
fs.mkdirSync(iconDir, { recursive: true });

const families = [
  {
    id: 'A', name: 'Footwear objects', metaphor: 'The only footwear-led family',
    hiking: `<path d="M12 11v17l-4 5v4h30c3 0 5-1 7-4-5-1-9-3-13-6l-5-4-2-12H12Z"/><path d="M13 18h12M13 23h13M9 37v4h29M16 41v2m7-2v2m7-2v2"/>`,
    running: `<path d="M8 31c8 0 12-5 15-15l8 8c4 4 8 5 13 6-1 6-5 9-12 9H12c-3 0-5-3-4-8Z"/><path d="M21 23l6 3m-9 2 6 3M9 35h25"/>`,
  },
  {
    id: 'B', name: 'Terrain rhythm', metaphor: 'Rugged switchback versus smooth track cadence',
    hiking: `<path d="M7 39h34M10 35l9-8-7-6 10-8 8 5 8-9"/><path d="M13 35h7m-6-14h8m8-3h8"/><circle cx="38" cy="9" r="1.4"/>`,
    running: `<path d="M10 35c0-10 7-20 17-22 7-1 12 3 11 9-1 8-9 15-19 17-7 1-11-1-9-4Z"/><path d="M16 33c5-1 10-4 14-8 3-3 4-6 3-8M9 24h8m-10 5h7"/>`,
  },
  {
    id: 'C', name: 'Purpose-built equipment', metaphor: 'Trekking poles versus a restrained race bib',
    hiking: `<path d="M16 8l5 4-3 5-5-3 3-6Zm16 0 5 4-3 5-5-3 3-6ZM17 16 9 41m24-25 6 25"/><path d="M7 41h5m25 0h5M11 34h7m20 0h-7"/>`,
    running: `<path d="M12 13h24l3 27H9l3-27Z"/><path d="M17 13v-3m14 3v-3M15 21h18M16 33c3-5 6-8 11-8h5M24 25l-5 8"/>`,
  },
  {
    id: 'D', name: 'Navigation and pace', metaphor: 'Topo ascent versus split-time momentum',
    hiking: `<path d="M8 34c7-8 12-10 18-7 6 3 10 2 14-5M8 40c8-8 14-10 20-7 5 2 9 1 12-2M9 27c6-7 11-9 16-6 5 2 9 1 14-5"/><path d="M14 36 27 19l3 5 8-13"/>`,
    running: `<circle cx="25" cy="26" r="14"/><path d="M21 7h8m-4 5V8m10 7 4-4M25 26l7-6M12 17H5m6 7H4m8 7H6"/>`,
  },
  {
    id: 'E', name: 'Trail and event infrastructure', metaphor: 'Backcountry waymark versus finish gate',
    hiking: `<path d="M16 41V11m16 30V18M16 14h20l-6 7H16M12 41h24"/><path d="M20 31l5-6 5 6"/>`,
    running: `<path d="M10 40V13m28 27V13M10 16c5-4 9 4 14 0s9 4 14 0v10c-5 4-9-4-14 0s-9-4-14 0V16Z"/><path d="M16 40h16"/>`,
  },
];

const palette = { page: '#F3F1EA', paper: '#FFFEFA', ink: '#24453E', muted: '#6E7973', line: '#D5DCD4', field: '#E6EBE4', accent: '#DDE7DE' };
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const txt = (value, x, y, size, weight = 500, anchor = 'start', color = palette.ink, spacing = 0) => `<text x="${x}" y="${y}" fill="${color}" font-family="Inter,Arial,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(value)}</text>`;
const dataUri = (file, mime = 'image/svg+xml') => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const img = (file, x, y, w, h) => `<image href="${dataUri(file)}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const pageSvg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${palette.page}"/>${body}</svg>`;

function iconSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" style="color:${palette.ink}"><g fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}

for (const family of families) {
  for (const kind of ['hiking', 'running']) {
    fs.writeFileSync(path.join(iconDir, `family-${family.id.toLowerCase()}-${kind}.svg`), `${iconSvg(family[kind])}\n`);
  }
}
const iconPath = (family, kind) => path.join(iconDir, `family-${family.id.toLowerCase()}-${kind}.svg`);

function masterSheet() {
  let body = txt('CairnNZ — Orthogonal non-human action concepts', 48, 65, 34, 760);
  body += txt('Five fundamentally different metaphors · one footwear family maximum · review only', 48, 101, 17, 500, 'start', palette.muted);
  families.forEach((family, index) => {
    const y = 145 + index * 190;
    body += `<rect x="48" y="${y}" width="1280" height="166" rx="24" fill="${palette.paper}" stroke="${palette.line}"/>`;
    body += txt(`FAMILY ${family.id}`, 76, y + 38, 15, 760, 'start', palette.ink, 1.4);
    body += txt(family.name, 76, y + 71, 23, 720);
    body += txt(family.metaphor, 76, y + 101, 14, 500, 'start', palette.muted);
    body += `<circle cx="667" cy="${y + 79}" r="58" fill="${palette.field}"/>${img(iconPath(family, 'hiking'), 619, y + 31, 96, 96)}`;
    body += txt('HIKING', 667, y + 149, 12, 760, 'middle', palette.muted, 1.2);
    body += `<circle cx="892" cy="${y + 79}" r="58" fill="${palette.field}"/>${img(iconPath(family, 'running'), 844, y + 31, 96, 96)}`;
    body += txt('RUNNING', 892, y + 149, 12, 760, 'middle', palette.muted, 1.2);
    body += img(acceptedCairn, 1084, y + 33, 92, 92);
    body += txt('ACCEPTED B CAIRN', 1130, y + 149, 11, 760, 'middle', palette.muted, 1);
  });
  body += txt('Accepted Cairn is embedded from its locked source; no copy is rewritten.', 1328, 1125, 14, 600, 'end', palette.muted);
  return pageSvg(1376, 1155, body);
}

function homeSizeSheet() {
  let body = txt('Home-size readability — 29px', 48, 64, 34, 760);
  body += txt('Judge recognition and Hiking/Running separation before enlarged craftsmanship.', 48, 100, 17, 500, 'start', palette.muted);
  families.forEach((family, index) => {
    const y = 145 + index * 126;
    body += txt(`FAMILY ${family.id}`, 155, y + 57, 14, 760, 'end', palette.muted, 1.2);
    [['hiking', 'Hiking'], ['running', 'Running']].forEach(([kind, label], col) => {
      const x = 200 + col * 190;
      body += `<rect x="${x}" y="${y}" width="154" height="104" rx="20" fill="${palette.paper}" stroke="${palette.line}"/>`;
      body += img(iconPath(family, kind), x + 62.5, y + 16, 29, 29);
      body += txt(label, x + 77, y + 69, 14, 700, 'middle');
      body += txt(family.name, x + 77, y + 90, 10, 550, 'middle', palette.muted);
    });
    body += `<rect x="580" y="${y}" width="154" height="104" rx="20" fill="${palette.accent}" stroke="${palette.line}"/>`;
    body += img(acceptedCairn, 642.5, y + 16, 29, 29);
    body += txt('Leave a Cairn', 657, y + 69, 12.5, 700, 'middle');
    body += txt('LOCKED B', 657, y + 90, 10, 700, 'middle', palette.muted, 1);
  });
  body += `<rect x="48" y="800" width="728" height="90" rx="20" fill="${palette.field}"/>`;
  body += txt('The five rows test five meanings—not five renderings of footwear.', 74, 836, 16, 680);
  body += txt('Only Family A uses a boot/shoe metaphor.', 74, 865, 14, 500, 'start', palette.muted);
  return pageSvg(824, 932, body);
}

function semanticSheet() {
  let body = txt('Semantic check — concept diversity', 48, 64, 34, 760);
  body += txt('Read each pair without its label, then compare the explicit metaphor and 29px state.', 48, 100, 17, 500, 'start', palette.muted);
  families.forEach((family, index) => {
    const x = 48 + (index % 3) * 420;
    const y = 145 + Math.floor(index / 3) * 380;
    body += `<rect x="${x}" y="${y}" width="388" height="344" rx="25" fill="${palette.paper}" stroke="${palette.line}"/>`;
    body += txt(`FAMILY ${family.id} · ${family.name}`, x + 24, y + 38, 15, 760);
    body += `<circle cx="${x + 108}" cy="${y + 135}" r="66" fill="${palette.field}"/>${img(iconPath(family, 'hiking'), x + 58, y + 85, 100, 100)}`;
    body += `<circle cx="${x + 280}" cy="${y + 135}" r="66" fill="${palette.field}"/>${img(iconPath(family, 'running'), x + 230, y + 85, 100, 100)}`;
    body += txt('HIKING', x + 108, y + 225, 12, 760, 'middle', palette.muted, 1.2);
    body += txt('RUNNING', x + 280, y + 225, 12, 760, 'middle', palette.muted, 1.2);
    body += txt(family.metaphor, x + 194, y + 264, 13, 550, 'middle', palette.muted);
    body += img(iconPath(family, 'hiking'), x + 128, y + 288, 29, 29) + img(iconPath(family, 'running'), x + 230, y + 288, 29, 29);
  });
  body += `<rect x="888" y="525" width="388" height="344" rx="25" fill="${palette.accent}" stroke="${palette.line}"/>`;
  body += img(acceptedCairn, 1006, 583, 150, 150);
  body += txt('ACCEPTED B CAIRN', 1082, 768, 15, 760, 'middle', palette.ink, 1.2);
  body += txt('Context anchor · unchanged', 1082, 802, 14, 550, 'middle', palette.muted);
  return pageSvg(1324, 918, body);
}

function homePreview() {
  const home = dataUri(homeEvidence, 'image/png');
  let body = txt('Preview-only Home action context', 44, 58, 32, 760);
  body += txt('Icons are overlays on real Home evidence; runtime mappings remain untouched.', 44, 92, 16, 500, 'start', palette.muted);
  families.forEach((family, index) => {
    const x = 44 + index * 420;
    const y = 140;
    body += txt(`FAMILY ${family.id}`, x + 195, y - 18, 15, 760, 'middle', palette.ink, 1.2);
    body += `<rect x="${x - 4}" y="${y - 4}" width="398" height="852" rx="30" fill="#1B211F"/><image href="${home}" x="${x}" y="${y}" width="390" height="844"/>`;
    const cardY = y + 469;
    const items = [[iconPath(family, 'hiking'), 'Hiking'], [iconPath(family, 'running'), 'Running'], [acceptedCairn, 'Leave a Cairn']];
    items.forEach(([file, label], itemIndex) => {
      const cx = x + 63 + itemIndex * 94;
      body += `<rect x="${cx}" y="${cardY}" width="86" height="84" rx="18" fill="#F8F8F3" fill-opacity=".97"/>`;
      body += img(file, cx + 28.5, cardY + 12, 29, 29);
      body += txt(label, cx + 43, cardY + 63, itemIndex === 2 ? 8 : 9.5, 700, 'middle');
    });
  });
  return pageSvg(2144, 1040, body);
}

async function write(name, markup) {
  fs.writeFileSync(path.join(outputDir, `${name}.svg`), `${markup}\n`);
  await sharp(Buffer.from(markup)).png().toFile(path.join(outputDir, `${name}.png`));
}

await write('orthogonal-icon-master', masterSheet());
await write('orthogonal-icon-home-size', homeSizeSheet());
await write('orthogonal-icon-semantic-check', semanticSheet());
await write('orthogonal-icon-home-preview', homePreview());
fs.writeFileSync(path.join(outputDir, 'README.md'), `# Orthogonal non-human Hiking + Running concepts v2\n\nThe earlier footwear-heavy non-human study is rejected historical evidence. This reset uses five independent metaphors: footwear objects, terrain rhythm, purpose-built equipment, navigation/pace, and trail/event infrastructure. Family A is the only footwear-led family. No human figures are present. The accepted Family B Cairn is read directly from its locked source and is not modified. Review only; no runtime integration.\n`);
console.log(`Created 10 icons and four review sheets in ${outputDir}`);
