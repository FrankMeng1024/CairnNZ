/**
 * Export Service — generates GPX and PDF from session data.
 *
 * GPX: Standard GPS Exchange Format (compatible with AllTrails, Komoot, Strava, Garmin)
 * PDF: Simple HTML rendered via expo-print (session summary + stats)
 */
import { Share, Platform } from 'react-native';
import type { TrackingSession } from '../store/useSessionStore';
import { formatDistance, formatDuration } from '../utils/geo';

/**
 * Generate GPX XML string from a session.
 * GPX 1.1 spec: https://www.topografix.com/GPX/1/1/
 */
export function generateGPX(session: TrackingSession): string {
  const startDate = new Date(session.startedAt).toISOString();
  const endDate = new Date(session.endedAt).toISOString();
  const name = session.name || `${session.activityMode === 'running' ? 'Run' : 'Hike'} ${new Date(session.startedAt).toLocaleDateString()}`;

  const trackpoints = session.trackPoints.map(tp => {
    const time = new Date(tp.t).toISOString();
    const ele = tp.alt != null ? `\n        <ele>${tp.alt.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${tp.lat.toFixed(7)}" lon="${tp.lng.toFixed(7)}">${ele}
        <time>${time}</time>
      </trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cairn"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${startDate}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <type>${session.activityMode}</type>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Generate a simple HTML summary for PDF export.
 */
export function generatePDFHTML(session: TrackingSession): string {
  const name = session.name || `${session.activityMode === 'running' ? 'Run' : 'Hike'}`;
  const date = new Date(session.startedAt).toLocaleDateString('en-NZ', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const distance = formatDistance(session.distanceM, 'km', 2);
  const duration = formatDuration(session.durationS);
  const elevation = session.elevationGainM;
  const startTime = new Date(session.startedAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(session.endedAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; color: #333; }
    h1 { color: #5a8a3c; margin-bottom: 4px; }
    .date { color: #666; font-size: 14px; margin-bottom: 30px; }
    .stats { display: flex; gap: 30px; margin-bottom: 30px; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #333; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .meta { font-size: 13px; color: #666; border-top: 1px solid #eee; padding-top: 16px; }
    .footer { margin-top: 40px; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <p class="date">${date}</p>
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${distance}</div>
      <div class="stat-label">Kilometers</div>
    </div>
    <div class="stat">
      <div class="stat-value">${duration}</div>
      <div class="stat-label">Duration</div>
    </div>
    <div class="stat">
      <div class="stat-value">+${elevation}m</div>
      <div class="stat-label">Elevation</div>
    </div>
  </div>
  <div class="meta">
    <p><strong>Start:</strong> ${startTime}</p>
    <p><strong>End:</strong> ${endTime}</p>
    <p><strong>Activity:</strong> ${session.activityMode}</p>
    <p><strong>Track points:</strong> ${session.trackPoints.length}</p>
    <p><strong>Markers planted:</strong> ${session.markerIds.length}</p>
  </div>
  <div class="footer">Exported from Cairn — Outdoor Safety App</div>
</body>
</html>`;
}

/**
 * Share GPX file content via system share sheet.
 */
export async function shareGPX(session: TrackingSession): Promise<void> {
  const gpx = generateGPX(session);
  const name = session.name || `${session.activityMode}_${new Date(session.startedAt).toISOString().slice(0, 10)}`;

  if (Platform.OS === 'web') {
    // Web: download as file
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  // Native: use Share API
  await Share.share({
    message: gpx,
    title: `${name}.gpx`,
  });
}

/**
 * Export session as PDF (native only — uses expo-print).
 */
export async function sharePDF(session: TrackingSession): Promise<void> {
  const html = generatePDFHTML(session);

  if (Platform.OS === 'web') {
    // Web: open in new tab
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    return;
  }

  // Native: use expo-print + expo-sharing
  try {
    // @ts-ignore — optional native-only dependencies
    const Print = await import('expo-print');
    // @ts-ignore
    const Sharing = await import('expo-sharing');
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
  } catch {
    // Fallback: share HTML as text
    await Share.share({ message: html, title: 'Activity Summary' });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
