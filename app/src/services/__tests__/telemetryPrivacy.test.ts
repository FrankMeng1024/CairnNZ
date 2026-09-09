import {
  sanitizeTelemetryEventForUpload,
  sanitizeTelemetryJsonlForUpload,
} from '../telemetryPrivacy';

describe('Internal QA telemetry privacy boundary', () => {
  test('removes real coordinates recursively while retaining diagnostic metadata', () => {
    expect(sanitizeTelemetryEventForUpload({
      event: 'gps_fix',
      source: 'foreground',
      lat: -45.0312,
      lon: 168.6626,
      accuracy_m: 7,
      nested: { centerCoordinate: [168.6626, -45.0312], accepted: true },
    })).toEqual({
      event: 'gps_fix',
      source: 'foreground',
      accuracy_m: 7,
      nested: { accepted: true },
    });
  });

  test('redacts coordinate pairs hidden in arrays and diagnostic strings', () => {
    const result = sanitizeTelemetryEventForUpload({
      event: 'breadcrumb',
      payload: {
        samples: [[168.6626, -45.0312], [168.663, -45.031]],
        message: 'camera at -45.031200, 168.662600',
      },
    });
    expect(JSON.stringify(result)).not.toContain('168.6626');
    expect(JSON.stringify(result)).not.toContain('-45.0312');
    expect(result).toMatchObject({ payload: { message: 'camera at [coordinates-redacted]' } });
  });

  test('retains explicitly synthetic coordinates', () => {
    expect(sanitizeTelemetryEventForUpload({
      eventName: 'simulator_sample_generated',
      coordinateSource: 'simulator',
      fields: { lat: -45.0312, lng: 168.6626, accuracyM: 5 },
    })).toMatchObject({ fields: { lat: -45.0312, lng: 168.6626, accuracyM: 5 } });
  });

  test('drops secret fields, redacts secret-looking strings, and rejects invalid JSONL', () => {
    const jsonl = [
      JSON.stringify({
        session_id: 'qa-safe',
        coordinateSource: 'none',
        accessToken: 'do-not-upload',
        apiKey: 'also-private',
        message: 'Bearer abc.def.ghi user qa@example.test?token=private&api_key=hidden',
      }),
      'not-json',
    ].join('\n');
    const lines = sanitizeTelemetryJsonlForUpload(jsonl).split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('do-not-upload');
    expect(lines[0]).not.toContain('qa@example.test');
    expect(lines[0]).not.toContain('abc.def.ghi');
    expect(lines[0]).not.toContain('token=private');
    expect(lines[0]).not.toContain('also-private');
    expect(lines[0]).not.toContain('api_key=hidden');
  });
});
