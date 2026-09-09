const FORBIDDEN_FIELD = /(access|refresh)?token|password|passcode|reset.?code|email|authorization|cookie|secret|api.?key/i;
const COORDINATE_FIELD = /^(lat|lng|lon|latitude|longitude|coordinate|coordinates|location|position|centerCoordinate|cameraTarget|displayedPosition)$/i;

function scrubString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email-redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, '[jwt-redacted]')
    .replace(/([?&](?:access_?token|refresh_?token|token|password|passcode|secret|code|api_?key)=)[^&#\s]*/gi, '$1[redacted]')
    // Fail private for coordinates embedded in breadcrumbs or error text.
    .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[coordinates-redacted]')
    .slice(0, 2_000);
}

function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'string' ? scrubString(value) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => scrubSecrets(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELD.test(key)) continue;
    out[key] = scrubSecrets(nested, depth + 1);
  }
  return out;
}

function removeCoordinateFields(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (
      value.length >= 2
      && typeof value[0] === 'number'
      && typeof value[1] === 'number'
      && Number.isFinite(value[0])
      && Number.isFinite(value[1])
      && ((Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90)
        || (Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180))
    ) return '[coordinates-redacted]';
    return value.map(item => removeCoordinateFields(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (COORDINATE_FIELD.test(key)) continue;
    out[key] = removeCoordinateFields(nested, depth + 1);
  }
  return out;
}

export function sanitizeTelemetryEventForUpload(event: Record<string, unknown>): Record<string, unknown> {
  const secretSafe = scrubSecrets(event) as Record<string, unknown>;
  const source = String(secretSafe.coordinateSource ?? secretSafe.source ?? '').toLowerCase();
  if (source === 'simulator' || source === 'simulated') return secretSafe;
  // Unknown and real sources fail private: precise coordinate-shaped fields
  // are stripped recursively. Synthetic events must opt in explicitly above.
  return removeCoordinateFields(secretSafe) as Record<string, unknown>;
}

/** Invalid lines are dropped rather than uploaded as an opaque privacy bypass. */
export function sanitizeTelemetryJsonlForUpload(jsonl: string): string {
  return jsonl.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      return [JSON.stringify(sanitizeTelemetryEventForUpload(parsed))];
    } catch {
      return [];
    }
  }).join('\n');
}
