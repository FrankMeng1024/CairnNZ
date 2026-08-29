import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputRoot = path.join(repoRoot, 'docs/review/action-icon-reset-gate');
const iconRoot = path.join(outputRoot, 'icons');

const ink = '#24453E';
const cream = '#F4F1E8';
const paper = '#FAF8F2';
const line = '#D8D7CD';
const muted = '#6F7771';
const night = '#172823';
const nightInk = '#F3F0E7';
const accent = '#C87846';

const common = `fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"`;

const families = [
  {
    id: 'A',
    title: 'Field Pictograms',
    note: 'Rounded human-action symbols with only the outdoor cues needed to separate hiking, running, and placement.',
    icons: {
      hiking: `<g ${common} stroke-width="2.7">
        <circle cx="20" cy="8.5" r="3"/>
        <path d="M18 14.5l-4.8 4.2 1.4 8.2M18 15l6.3 8.6-5.8 6.2-4.4 9.1M24.3 23.6l6.5 4.2 4.7 10.1M14.2 38.9h5M33.5 38h5M12.9 19.2l-4.2 19.3"/>
        <path d="M15.4 15.6l-3.2-.6-1.6 7.1 4 1.1"/>
        <path d="M6.5 41c7.2-3 12.6-2.7 17.6-.7 6.2 2.5 11.2 2 17.4-1.4" stroke-width="2"/>
      </g>`,
      running: `<g ${common} stroke-width="2.8">
        <circle cx="28.5" cy="8.5" r="3"/>
        <path d="M25.8 14.5l-6.9 7.2 8.5 4.8 6.3-7.2M19 21.7l-6.6-2.4M27.4 26.5l8.4 5.1 6.2-.4M27.4 26.5l-8 8.7-8.1 1.6"/>
        <path d="M7 14h8M4.5 20h7" stroke-width="2"/>
      </g>`,
      cairn: `<g ${common} stroke-width="2.5">
        <path d="M11 39c0-4.1 3.9-6.8 13-6.8S37 34.9 37 39c0 1.3-1.1 2-2.4 2H13.4C12.1 41 11 40.3 11 39Z"/>
        <path d="M15.8 30.8c0-3.8 3-6.2 8.2-6.2s8.2 2.4 8.2 6.2M19.2 23.1c0-3 1.8-5 4.8-5s4.8 2 4.8 5"/>
        <path d="M24 4v8M20.5 8.8 24 12.3l3.5-3.5"/>
        <path d="M20.5 16.4c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4" stroke-width="2"/>
      </g>`,
    },
  },
  {
    id: 'B',
    title: 'Essential Objects',
    note: 'Equipment-led profiles: a trail boot, a running shoe, and a hand leaving a stack of stones.',
    icons: {
      hiking: `<g ${common} stroke-width="2.35">
        <path d="M14 7.5h13l.5 14.5c4.4 1.8 7.4 4.3 13 5.8 2.3.6 3.5 2.2 3.5 4.5V36H8.7c-2.6 0-4.3-1.8-4-4.1.3-2.2 2-3.6 4.2-4l5.7-1.1L14 7.5Z"/>
        <path d="M14.5 16h11.8M15 21h12.1M8.2 36v4h34.3v-4M19 12.2h7.1"/>
        <path d="M12 40h5m5 0h5m5 0h5" stroke-width="1.8"/>
      </g>`,
      running: `<g ${common} stroke-width="2.35">
        <path d="M14.8 13.5h10.4l4.6 9.2 9.5 4.4c2.7 1.2 4.2 3.1 3.3 6H9.1c-2.5 0-4-1.3-4.1-3.4-.1-2 1.4-3.4 3.4-3.9l8.1-2-1.7-10.3Z"/>
        <path d="m18 18 9.3 1M18.7 22.4l10.7 1.1M7.5 33.1l1 4h30.7l2.1-4"/>
        <path d="M4.8 17.5h7M2.5 22.5h8.2" stroke-width="1.8"/>
      </g>`,
      cairn: `<g ${common} stroke-width="2.25">
        <path d="M8 38.5h25.5c4.8 0 7.4-1.3 10.5-4.8-4.8-.6-8.4-.6-12.2.2L25 36.1"/>
        <path d="M11 33.5c.2-3.6 3.5-5.6 10.5-5.6s10.3 2 10.5 5.6M14.8 26.5c.2-3.4 2.5-5.3 6.7-5.3s6.5 1.9 6.7 5.3M17.8 19.7c.2-2.8 1.5-4.4 3.9-4.4s3.8 1.6 4 4.4"/>
      </g>`,
    },
  },
  {
    id: 'C',
    title: 'Trail Marks',
    note: 'Landscape and route notation reduced to small field marks, with a shared node-and-line vocabulary.',
    icons: {
      hiking: `<g ${common} stroke-width="2.35">
        <path d="M5 38.5 15.3 20l7.2 10.2L30.7 13 43 38.5"/>
        <path d="M9 39c5.7-1 9.4-3.2 10.6-6.6 1.1-3.1-1.3-5.5.3-8.7 1.2-2.3 4.2-3.6 8.9-4.2"/>
        <circle cx="29.5" cy="19.4" r="2.3" fill="currentColor" stroke="none"/>
      </g>`,
      running: `<g ${common} stroke-width="2.25">
        <path d="M12 38h18.5C37.4 38 42 33.4 42 27s-4.6-11-11.5-11H21C12.4 16 6 22.2 6 30.2 6 34 8.2 38 12 38Z"/>
        <path d="M14.5 33.5h15.7c4.2 0 7.1-2.6 7.1-6.4s-2.9-6.4-7.1-6.4h-8.8c-5.8 0-10.1 4-10.1 9.2" opacity=".65"/>
        <path d="m27.8 18.1 4.7 2.7-4.8 2.5"/>
      </g>`,
      cairn: `<g ${common} stroke-width="2.35">
        <path d="M4.5 39h39M7 39c5.7 0 7.5-3.8 11.2-3.8h7.6" opacity=".7"/>
        <path d="M18 35.2c.2-3.6 2.3-5.8 6-5.8s5.8 2.2 6 5.8M20 28c.2-3.1 1.5-4.9 4-4.9s3.8 1.8 4 4.9M21.8 21.7c0-2.5.8-4 2.2-4s2.2 1.5 2.2 4"/>
        <circle cx="24" cy="10" r="2.4" fill="currentColor" stroke="none"/>
        <path d="M24 12.5v3"/>
      </g>`,
    },
  },
  {
    id: 'D',
    title: 'Compact Action Marks',
    note: 'Bold, reduced silhouettes for maximum phone-size legibility, tempered by simple open-space construction.',
    icons: {
      hiking: `<g fill="currentColor">
        <circle cx="20" cy="8" r="3.4"/>
        <path d="M15.1 14.1c2.8-2.2 6.9-1.7 8.8 1.2l4.8 7.2-4.2 2.8-3.1-4.8-3 7.3 6.9 4.9-2.9 4.1-8.7-6.1a4 4 0 0 1-1.4-4.7l2.8-7.3-4.6 3.5-2.8-3.6 7.4-4.5Z"/>
        <path d="m17 29.4-4.7 10.4H7.2l5.3-12.4 4.5 2Z"/>
        <path d="M31.5 20h3.6L40 40h-4.6l-3.9-20Z"/>
        <rect x="11.2" y="14.2" width="5.2" height="10" rx="2" transform="rotate(18 11.2 14.2)"/>
      </g>`,
      running: `<g fill="currentColor">
        <circle cx="29" cy="7.5" r="3.4"/>
        <path d="M22.7 14.4c2.8-2.2 7-1.7 9 1.1l2.1 2.9 6-3 2.1 4.1-8.1 4a3.2 3.2 0 0 1-4-1l-1.4-1.8-4.8 6.4 7.5 3.4-1.9 4.3-10.5-4.6a4 4 0 0 1-1.6-6l5.6-9.8Z"/>
        <path d="m18.4 25.8-8.5 10.7H3.8l10.7-14 3.9 3.3ZM29 30.1h12.8v4.7H29z"/>
        <rect x="9" y="15" width="9" height="3.2" rx="1.6"/>
      </g>`,
      cairn: `<g fill="currentColor">
        <path d="M8 40c0-4.5 5-7 16-7s16 2.5 16 7c0 1.1-.9 2-2 2H10a2 2 0 0 1-2-2ZM13 31c0-4.4 3.8-7 11-7s11 2.6 11 7H13ZM18 22c0-3.7 2.1-6 6-6s6 2.3 6 6H18Z"/>
        <rect x="22" y="4" width="4" height="7.5" rx="2"/>
        <path d="m18.8 8.7 5.2 5.2 5.2-5.2-2.8-2.8L24 8.3l-2.4-2.4-2.8 2.8Z"/>
      </g>`,
    },
  },
  {
    id: 'E',
    title: 'Quiet Gestures',
    note: 'Fine, open gestures that favour grace and negative space while keeping one decisive semantic cue per action.',
    icons: {
      hiking: `<g ${common} stroke-width="2.15">
        <circle cx="21" cy="8" r="2.7"/>
        <path d="M19.2 13.8c-2.4 4.1-3.2 8-2.5 11.6l2 4.2-5.8 9.4M18.1 17.2l7.8 6.3M18.7 29.6l8.2 9.4M11.8 18.5 7.8 39"/>
        <path d="M5.5 41c6.5-1.5 11.6-1.2 15.2.7 5.2 2.7 11.4 2 21-2.8" opacity=".8"/>
      </g>`,
      running: `<g ${common} stroke-width="2.15">
        <circle cx="29" cy="7.5" r="2.7"/>
        <path d="M26.7 13.4c-4 3.7-6.3 7.5-7 11.3l8.2 4.3M22.3 18l-8.1-1.2M24.5 15.4l8.8 5 6.7-3.8M27.9 29l10.2 4.6M27.9 29l-10.6 9.2-9.2.8"/>
        <path d="M5 23h8M3 28h7" opacity=".65"/>
      </g>`,
      cairn: `<g ${common} stroke-width="2.15">
        <path d="M7 38.5h24c5.1 0 8.7-1.6 11-5.1-4.3-.7-7.6-.4-10.9.8l-5.4 2"/>
        <path d="M11.5 34c.2-3.1 2.6-5 7.1-5s6.9 1.9 7.1 5M14.2 27.5c.2-2.9 1.6-4.6 4.5-4.6s4.3 1.7 4.5 4.6M16.5 21.4c0-2.2.8-3.6 2.3-3.6s2.3 1.4 2.3 3.6"/>
        <path d="M34.5 7c-1.1-1.1-2.5-1.7-4.1-1.7-3 0-5.1 2.2-5.1 5.4v3.8M22.3 11.8l3 3 3-3"/>
      </g>`,
    },
  },
];

const iconLabels = { hiking: 'Hiking', running: 'Running', cairn: 'Leave a Cairn' };

function iconSvg(body, color = ink, size = 48) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" style="color:${color}">${body}</svg>`;
}

function embeddedIcon(body, x, y, size, color = ink) {
  const scale = size / 48;
  return `<g transform="translate(${x} ${y}) scale(${scale})" style="color:${color}">${body}</g>`;
}

function text(x, y, value, { size = 24, weight = 500, color = ink, anchor = 'start', tracking = 0 } = {}) {
  return `<text x="${x}" y="${y}" fill="${color}" text-anchor="${anchor}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${value}</text>`;
}

function svgDocument(width, height, content, background = paper) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${background}"/>
    ${content}
  </svg>`;
}

async function writeSheet(name, svg) {
  const svgPath = path.join(outputRoot, `${name}.svg`);
  const pngPath = path.join(outputRoot, `${name}.png`);
  fs.writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
}

function masterSheet() {
  const width = 1500;
  const height = 1480;
  let content = text(72, 74, 'CairnNZ — Action Icon Reset', { size: 34, weight: 650 });
  content += text(72, 112, 'Five from-zero families · review candidates only · no runtime integration', { size: 18, color: muted });
  const colX = [650, 980, 1310];
  ['Hiking', 'Running', 'Leave a Cairn'].forEach((label, i) => {
    content += text(colX[i], 172, label, { size: 18, weight: 650, anchor: 'middle', tracking: 0.7 });
  });
  families.forEach((family, row) => {
    const y = 215 + row * 244;
    content += `<rect x="50" y="${y}" width="1400" height="214" rx="26" fill="#FFFFFF" stroke="${line}"/>`;
    content += text(78, y + 52, `Family ${family.id}`, { size: 25, weight: 700 });
    content += text(78, y + 82, family.title, { size: 17, weight: 600, color: muted });
    const words = family.note.split(' ');
    const lines = ['', '', ''];
    let lineIndex = 0;
    for (const word of words) {
      if ((lines[lineIndex] + ' ' + word).trim().length > 45 && lineIndex < 2) lineIndex += 1;
      lines[lineIndex] = `${lines[lineIndex]} ${word}`.trim();
    }
    lines.forEach((value, index) => {
      content += text(78, y + 118 + index * 21, value, { size: 13.5, color: muted });
    });
    Object.entries(family.icons).forEach(([key, body], i) => {
      content += `<circle cx="${colX[i]}" cy="${y + 103}" r="74" fill="${cream}"/>`;
      content += embeddedIcon(body, colX[i] - 55, y + 48, 110);
      content += text(colX[i], y + 190, iconLabels[key], { size: 14, weight: 600, anchor: 'middle', color: muted });
    });
  });
  return svgDocument(width, height, content);
}

function homeSizeSheet() {
  const width = 1500;
  const height = 1040;
  let content = text(72, 72, 'Actual Home-size Readability', { size: 34, weight: 650 });
  content += text(72, 110, 'Glyphs are exactly 29 px, matching the current Home action size', { size: 18, color: muted });
  content += text(900, 112, 'DAY', { size: 15, weight: 700, tracking: 2, anchor: 'middle', color: muted });
  content += text(1245, 112, 'NIGHT', { size: 15, weight: 700, tracking: 2, anchor: 'middle', color: muted });
  families.forEach((family, row) => {
    const y = 150 + row * 168;
    content += `<rect x="54" y="${y}" width="1392" height="140" rx="24" fill="#FFFFFF" stroke="${line}"/>`;
    content += text(82, y + 52, `Family ${family.id}`, { size: 23, weight: 700 });
    content += text(82, y + 80, family.title, { size: 15, color: muted });
    const modes = [
      { x: 900, card: '#F1EEE4', icon: ink, label: ink },
      { x: 1245, card: '#263934', icon: nightInk, label: nightInk },
    ];
    modes.forEach((mode) => {
      Object.entries(family.icons).forEach(([key, body], i) => {
        const x = mode.x + (i - 1) * 86;
        content += `<rect x="${x - 39}" y="${y + 18}" width="78" height="102" rx="18" fill="${mode.card}" stroke="${mode.icon}" stroke-opacity=".12"/>`;
        content += embeddedIcon(body, x - 14.5, y + 35, 29, mode.icon);
        content += text(x, y + 91, key === 'cairn' ? 'Cairn' : iconLabels[key], { size: 10.5, weight: 600, anchor: 'middle', color: mode.label });
      });
    });
  });
  return svgDocument(width, height, content);
}

function semanticSheet() {
  const width = 1800;
  const height = 1870;
  let content = text(76, 76, 'Semantic Check — Meaning Before Style', { size: 34, weight: 650 });
  content += text(76, 114, 'Each candidate is shown without a label first; the answer key sits directly below.', { size: 18, color: muted });
  families.forEach((family, row) => {
    const y = 160 + row * 332;
    content += text(78, y + 38, `FAMILY ${family.id} · ${family.title.toUpperCase()}`, { size: 17, weight: 700, tracking: 1.2, color: muted });
    Object.entries(family.icons).forEach(([key, body], i) => {
      const x = 370 + i * 500;
      content += `<rect x="${x - 180}" y="${y + 62}" width="360" height="230" rx="28" fill="#FFFFFF" stroke="${line}"/>`;
      content += embeddedIcon(body, x - 70, y + 85, 140);
      content += `<line x1="${x - 110}" y1="${y + 240}" x2="${x + 110}" y2="${y + 240}" stroke="${line}"/>`;
      content += text(x, y + 274, iconLabels[key], { size: 17, weight: 650, anchor: 'middle' });
    });
  });
  return svgDocument(width, height, content);
}

function homePreviewSheet() {
  const width = 1500;
  const height = 1160;
  let content = text(72, 72, 'Simple Home Action-row Preview', { size: 34, weight: 650 });
  content += text(72, 110, 'Preview only · current layout proportions · 29 px glyphs', { size: 18, color: muted });
  families.forEach((family, row) => {
    const y = 150 + row * 190;
    content += `<rect x="54" y="${y}" width="1392" height="160" rx="28" fill="${row % 2 === 0 ? '#DBE4DC' : '#E9E0CF'}"/>`;
    content += text(85, y + 55, `Family ${family.id}`, { size: 24, weight: 700 });
    content += text(85, y + 86, family.title, { size: 15, color: muted });
    Object.entries(family.icons).forEach(([key, body], i) => {
      const x = 650 + i * 245;
      content += `<rect x="${x - 103}" y="${y + 20}" width="206" height="120" rx="25" fill="rgba(250,248,242,.78)" stroke="rgba(36,69,62,.13)"/>`;
      content += embeddedIcon(body, x - 14.5, y + 42, 29);
      content += text(x, y + 107, iconLabels[key], { size: 14, weight: 620, anchor: 'middle' });
    });
  });
  return svgDocument(width, height, content);
}

async function main() {
  fs.mkdirSync(iconRoot, { recursive: true });
  for (const family of families) {
    const familyDir = path.join(iconRoot, `family-${family.id.toLowerCase()}`);
    fs.mkdirSync(familyDir, { recursive: true });
    for (const [key, body] of Object.entries(family.icons)) {
      fs.writeFileSync(path.join(familyDir, `${key}.svg`), iconSvg(body));
    }
  }

  await writeSheet('master-icon-sheet', masterSheet());
  await writeSheet('home-size-icon-sheet', homeSizeSheet());
  await writeSheet('semantic-check-sheet', semanticSheet());
  await writeSheet('home-action-row-preview', homePreviewSheet());

  const readme = `# CairnNZ action-icon reset gate\n\nThis is a from-zero, review-only exploration. None of these candidates is imported by application runtime code.\n\n- Family A — Field Pictograms: human actions, rounded monoline, explicit outdoor/placement cues. Strongest overall balance and clearest semantics.\n- Family B — Essential Objects: trail boot, running shoe, and hand-supported cairn. Very clear activity distinction; the hand/cairn relationship is slightly more interpretive.\n- Family C — Trail Marks: route, terrain, track, and waypoint notation. Compact and outdoor-specific, but more dependent on labels than the figure families.\n- Family D — Compact Action Marks: reduced solid action silhouettes for maximum small-size clarity. Strongest raw legibility, with a heavier and less quiet character.\n- Family E — Quiet Gestures: fine open-line actions with the most restrained premium character. Most elegant, though slightly lighter at phone size.\n\nThe 15 SVG candidates are under \`icons/\`. The PNG and SVG review sheets are in this directory.\n`;
  fs.writeFileSync(path.join(outputRoot, 'README.md'), readme);

  console.log(`Created 15 from-zero SVG candidates and four review sheets in ${outputRoot}`);
}

await main();
