'use strict';

const MAX_QA_EVENTS = 2_000;
const MAX_QA_PAYLOAD_BYTES = 512 * 1024;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 2_000;

const FORBIDDEN_FIELD = /(access|refresh)?token|password|passcode|reset.?code|email|authorization|cookie|secret|api.?key/i;
const COORDINATE_FIELD = /^(lat|lng|lon|latitude|longitude|coordinate|coordinates|location|position|centerCoordinate|cameraTarget|displayedPosition)$/i;

function scrubString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email-redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, '[jwt-redacted]')
    .replace(/([?&](?:access_?token|refresh_?token|token|password|passcode|secret|code|api_?key)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(lat(?:itude)?|lng|lon(?:gitude)?)\s*[:=]\s*-?\d{1,3}(?:\.\d+)?/gi, '$1=[redacted]')
    .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[coordinates-redacted]')
    .slice(0, MAX_STRING_LENGTH);
}

function scrubSecrets(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return typeof value === 'string' ? scrubString(value) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => scrubSecrets(item, depth + 1));
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) continue;
    result[key] = scrubSecrets(nested, depth + 1);
  }
  return result;
}

function isCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const first = value[0];
  const second = value[1];
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
  return (Math.abs(first) <= 180 && Math.abs(second) <= 90)
    || (Math.abs(first) <= 90 && Math.abs(second) <= 180);
}

function removeCoordinates(value, depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (isCoordinatePair(value)) return '[coordinates-redacted]';
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => removeCoordinates(item, depth + 1));
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (COORDINATE_FIELD.test(key)) continue;
    result[key] = removeCoordinates(nested, depth + 1);
  }
  return result;
}

function sanitizeQaEvent(event) {
  const secretSafe = scrubSecrets(event);
  const source = String(secretSafe.coordinateSource || secretSafe.source || '').toLowerCase();
  if (source === 'simulator' || source === 'simulated') return secretSafe;
  return removeCoordinates(secretSafe);
}

function qaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeQaJsonl(input) {
  const source = typeof input === 'string' ? input : '';
  if (Buffer.byteLength(source, 'utf8') > MAX_QA_PAYLOAD_BYTES) {
    throw qaError('QA_PAYLOAD_TOO_LARGE', `QA payload exceeds ${MAX_QA_PAYLOAD_BYTES} bytes.`);
  }
  const lines = source.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) throw qaError('QA_JSONL_INVALID', 'QA payload has no events.');
  if (lines.length > MAX_QA_EVENTS) {
    throw qaError('QA_EVENT_LIMIT', `QA payload exceeds ${MAX_QA_EVENTS} events.`);
  }
  const events = lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw qaError('QA_JSONL_INVALID', `QA event ${index + 1} is not valid JSON.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw qaError('QA_JSONL_INVALID', `QA event ${index + 1} must be an object.`);
    }
    return sanitizeQaEvent(parsed);
  });
  return {
    events,
    eventsCount: events.length,
    jsonl: events.map(event => JSON.stringify(event)).join('\n'),
  };
}

module.exports = {
  MAX_QA_EVENTS,
  MAX_QA_PAYLOAD_BYTES,
  sanitizeQaEvent,
  sanitizeQaJsonl,
};
