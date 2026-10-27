#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const evidenceRoot = path.resolve(process.env.CAIRN_VISUAL_REFINEMENT_EVIDENCE_ROOT || '/tmp/cairn-visual-refinement');
const output = path.resolve(process.env.CAIRN_VISUAL_REFINEMENT_BOARD_DIR || path.join(evidenceRoot, 'contact-sheets'));
fs.mkdirSync(output, { recursive: true });

const xml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

async function labelledTile(source, title, width = 260, imageHeight = 563) {
  if (!fs.existsSync(source)) throw new Error(`Missing review source: ${source}`);
  const image = await sharp(source)
    .resize(width, imageHeight, { fit: 'contain', background: '#111715' })
    .png()
    .toBuffer();
  const labelHeight = 44;
  const label = Buffer.from(`<svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#26322d"/>
    <text x="${width / 2}" y="27" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#edf2ee">${xml(title)}</text>
  </svg>`);
  return sharp({ create: { width, height: labelHeight + imageHeight, channels: 3, background: '#111715' } })
    .composite([{ input: label, left: 0, top: 0 }, { input: image, left: 0, top: labelHeight }])
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function board(file, title, entries, columns = 3) {
  const tileWidth = 260;
  const tileHeight = 607;
  const gap = 16;
  const header = 62;
  const rows = Math.ceil(entries.length / columns);
  const width = gap + columns * (tileWidth + gap);
  const height = header + rows * (tileHeight + gap);
  const titleSvg = Buffer.from(`<svg width="${width}" height="${header}" xmlns="http://www.w3.org/2000/svg">
    <text x="${width / 2}" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#edf2ee">${xml(title)}</text>
  </svg>`);
  const composites = [{ input: titleSvg, left: 0, top: 0 }];
  for (let index = 0; index < entries.length; index += 1) {
    const [source, label] = entries[index];
    const tile = await labelledTile(source, label, tileWidth, tileHeight - 44);
    composites.push({
      input: tile,
      left: gap + (index % columns) * (tileWidth + gap),
      top: header + Math.floor(index / columns) * (tileHeight + gap),
    });
  }
  await sharp({ create: { width, height, channels: 3, background: '#111715' } })
    .composite(composites)
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toFile(path.join(output, file));
}

const beforeActivity = path.join(evidenceRoot, 'before/hike-run');
const afterActivity = path.join(evidenceRoot, 'after/hike-run-v2');
const routeEditor = path.join(evidenceRoot, 'after/route-editor-final');
const trails = path.join(evidenceRoot, 'after/trails-final');
const system = path.join(evidenceRoot, 'after/system-ui');
const publicDetail = path.join(evidenceRoot, 'after/public-detail-v4');
const cairn = path.join(evidenceRoot, 'after/cairn-core-v2');
const sheets = path.join(evidenceRoot, 'after/sheets');
const settings = path.join(evidenceRoot, 'after/settings-final2');

await board('01_hike_run_before_after.jpg', 'Hike / Run · genuine Mapbox before → after', [
  [path.join(beforeActivity, 'hike-tracking-sunset-390x844.png'), 'BEFORE · Hike Sunset'],
  [path.join(afterActivity, 'hike-tracking-sunset-390x844.png'), 'AFTER · Hike Sunset'],
  [path.join(beforeActivity, 'run-tracking-sunset-390x844.png'), 'BEFORE · Run Sunset'],
  [path.join(afterActivity, 'run-tracking-sunset-390x844.png'), 'AFTER · Run Sunset'],
  [path.join(beforeActivity, 'hike-tracking-night-390x844.png'), 'BEFORE · Night render unavailable'],
  [path.join(afterActivity, 'hike-tracking-night-390x844.png'), 'AFTER · Hike Night'],
  [path.join(beforeActivity, 'run-tracking-night-390x844.png'), 'BEFORE · Night render unavailable'],
  [path.join(afterActivity, 'run-tracking-night-390x844.png'), 'AFTER · Run Night'],
], 2);

await board('02_hike_run_themes_and_sizes.jpg', 'Hike / Run · three themes and required sizes', [
  [path.join(afterActivity, 'hike-tracking-day-320x568.png'), 'Hike Day · 320×568'],
  [path.join(afterActivity, 'hike-tracking-sunset-390x844.png'), 'Hike Sunset · 390×844'],
  [path.join(afterActivity, 'hike-prestart-night-430x932.png'), 'Hike Night · 430×932'],
  [path.join(afterActivity, 'run-paused-day-320x568.png'), 'Run paused Day · 320×568'],
  [path.join(afterActivity, 'run-tracking-sunset-390x844.png'), 'Run Sunset · 390×844'],
  [path.join(afterActivity, 'run-tracking-night-430x932.png'), 'Run Night · 430×932'],
]);

await board('03_route_editor_sunset_states.jpg', 'Route Editor · Sunset state consistency', [
  [path.join(routeEditor, 'route-editor-390-browse-sunset.png'), 'Browse'],
  [path.join(routeEditor, 'route-editor-390-draw-sunset.png'), 'Draw / Freehand'],
  [path.join(routeEditor, 'route-editor-390-point-sunset.png'), 'Point'],
  [path.join(routeEditor, 'route-editor-390-trim-sunset.png'), 'Trim'],
  [path.join(routeEditor, 'route-editor-390-layers-sunset.png'), 'Layers'],
  [path.join(routeEditor, 'route-editor-390-leave-confirmation-sunset.png'), 'Leave confirmation'],
]);

await board('04_route_detail_and_trails.jpg', 'Route Detail + Trails · themes, empty and error', [
  [path.join(trails, '13-route-detail-use-first-day-390x844.png'), 'Route Detail · Day'],
  [path.join(trails, '15-route-detail-use-first-sunset-390x844.png'), 'Route Detail · Sunset'],
  [path.join(trails, '16-route-detail-use-first-night-390x844.png'), 'Route Detail · Night'],
  [path.join(trails, '04-routes-empty-day-390x844.png'), 'Routes success-empty'],
  [path.join(trails, '05-routes-local-with-server-error-day-390x844.png'), 'Routes server error'],
  [path.join(trails, '03-routes-few-sunset-390x844.png'), 'Routes populated · Sunset'],
]);

await board('05_map_legal_controls_and_back.jpg', 'Map legal controls + Back · shared contract', [
  [path.join(system, 'memory-sunset-390x844.png'), 'Memory · Sunset'],
  [path.join(system, 'activity-detail-night-390x844.png'), 'Activity Detail · Night'],
  [path.join(system, 'cairn-detail-sunset-390x844.png'), 'Cairn Detail · Sunset'],
  [path.join(publicDetail, 'day-public-readonly-detail-back-320x568.png'), 'Public Detail · 320×568'],
  [path.join(publicDetail, 'sunset-public-readonly-detail-back-390x844.png'), 'Public Detail · Sunset'],
  [path.join(publicDetail, 'night-public-readonly-detail-back-430x932.png'), 'Public Detail · Night'],
]);

await board('06_cairn_authorized_changes.jpg', 'Cairn · authorized changes only', [
  [path.join(cairn, '01-day-plant-only-me-390x844.png'), 'Leave title'],
  [path.join(cairn, '06-day-owned-edit-new-version-390x844.png'), 'Edit Back'],
  [path.join(cairn, '06a-day-owned-edit-failure-retained-390x844.png'), 'Edit failure retained'],
  [path.join(cairn, '06b-day-owned-edit-saved-390x844.png'), 'Edit saved'],
  [path.join(cairn, '07-day-owned-withdraw-delete-390x844.png'), 'Delete · vertical actions'],
  [path.join(cairn, '07b-day-owned-withdraw-complete-390x844.png'), 'Delete complete'],
]);

await board('07_settings_states_and_sizes.jpg', 'Settings · hierarchy, states and compact width', [
  [path.join(settings, 'help-overview-day-390x844.png'), 'Help overview'],
  [path.join(settings, 'help-feedback-failed-day-390x844.png'), 'Feedback failure'],
  [path.join(settings, 'help-day-small-320x568.png'), 'Help · 320×568'],
  [path.join(settings, 'privacy-overview-night-390x844.png'), 'Privacy · Night'],
  [path.join(settings, 'privacy-permission-limited-day-390x844.png'), 'Permission limited'],
  [path.join(settings, 'privacy-day-small-320x568.png'), 'Privacy · 320×568'],
]);

await board('08_lightweight_sheet_three_themes.jpg', 'Mark Detail · no duplicate scrim, no X', [
  [path.join(sheets, 'mark-detail-sheet-day-390x844.png'), 'Day'],
  [path.join(sheets, 'mark-detail-sheet-sunset-390x844.png'), 'Sunset'],
  [path.join(sheets, 'mark-detail-sheet-night-390x844.png'), 'Night'],
]);

console.log(`Visual refinement review boards written to ${output}`);
