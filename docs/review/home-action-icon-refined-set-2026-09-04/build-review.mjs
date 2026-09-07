import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(outputDir, '..', '..', '..');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const sharp = requireFromApp('sharp');

const asDataUrl = (filePath, mime) => {
  const bytes = fs.readFileSync(filePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
};

const screenshotUrl = asDataUrl(
  path.join(repoRoot, 'docs', 'review', 'global-visual-audit-2026-09-04', 'runtime-overview', 'home-day-390x844.png'),
  'image/png',
);
const hikeUrl = asDataUrl(path.join(outputDir, 'icons', 'hike.svg'), 'image/svg+xml');
const runUrl = asDataUrl(path.join(outputDir, 'icons', 'run.svg'), 'image/svg+xml');
const cairnUrl = asDataUrl(path.join(outputDir, 'icons', 'leave-a-cairn.svg'), 'image/svg+xml');

const proposedRow = `
  <g>
    <rect x="69" y="470" width="78" height="70" rx="16" fill="#F4F2E8" fill-opacity=".94"/>
    <rect x="156" y="470" width="78" height="70" rx="16" fill="#F4F2E8" fill-opacity=".94"/>
    <rect x="243" y="470" width="78" height="70" rx="16" fill="#F4F2E8" fill-opacity=".94"/>
    <image href="${hikeUrl}" x="93.5" y="478" width="29" height="29"/>
    <image href="${runUrl}" x="180.5" y="478" width="29" height="29"/>
    <image href="${cairnUrl}" x="267.5" y="478" width="29" height="29"/>
    <g fill="#18352F" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="9.2" text-anchor="middle">
      <text x="108" y="526">Hiking</text>
      <text x="195" y="526">Running</text>
      <text x="282" y="526" font-size="8.3">Leave a Cairn</text>
    </g>
  </g>`;

const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000">
  <defs>
    <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000" flood-opacity=".3"/></filter>
    <clipPath id="phone"><rect x="80" y="112" width="390" height="844" rx="28"/></clipPath>
  </defs>
  <rect width="1500" height="1000" fill="#101815"/>
  <text x="560" y="76" fill="#F2F0E7" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="39" font-weight="700">Proposed Home action row</text>
  <text x="560" y="116" fill="#9DB0A7" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="19">Review composite only · current Day Home capture · production remains unchanged</text>

  <g filter="url(#shadow)" clip-path="url(#phone)">
    <image href="${screenshotUrl}" x="80" y="112" width="390" height="844"/>
    <g transform="translate(80 112)">${proposedRow}</g>
  </g>

  <rect x="555" y="190" width="875" height="450" rx="34" fill="#23322E"/>
  <svg x="585" y="222" width="815" height="386" viewBox="40 420 310 180" preserveAspectRatio="xMidYMid slice">
    <image href="${screenshotUrl}" width="390" height="844"/>
    ${proposedRow}
  </svg>

  <g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <text x="570" y="714" fill="#A8CF8D" font-size="17" font-weight="700" letter-spacing="2">AT CURRENT HOME SIZE</text>
    <text x="570" y="756" fill="#F2F0E7" font-size="23">Hike reads from the incline and planted pole.</text>
    <text x="570" y="798" fill="#F2F0E7" font-size="23">Run reads from the forward lean and open stride.</text>
    <text x="570" y="840" fill="#F2F0E7" font-size="23">Leave a Cairn preserves the accepted Family B anchor.</text>
    <text x="570" y="902" fill="#91A39B" font-size="18">No motion lines · no decorative fill · no production icon integration</text>
  </g>
</svg>`;

fs.writeFileSync(path.join(outputDir, 'home-row-preview.svg'), previewSvg);

for (const name of ['master-review-sheet', 'home-size-review-sheet', 'home-row-preview']) {
  await sharp(path.join(outputDir, `${name}.svg`), { density: 144 })
    .png()
    .toFile(path.join(outputDir, `${name}.png`));
}

console.log(`Built icon review sheets in ${outputDir}`);
