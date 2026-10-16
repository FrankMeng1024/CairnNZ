jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('../../activitySimulator/activityLocationProvider', () => ({
  selectedActivityLocationSource: () => 'simulator',
  readTrustedSimulatorLocation: () => ({
    lat: -41.2864,
    lng: 174.7762,
    accuracyM: 6,
    altitudeM: 12,
    timestamp: 1_800_000_000_123,
  }),
}));

jest.mock('../../activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(),
}));

jest.mock('../../../services/appLog', () => ({ log: jest.fn() }));

import fs from 'node:fs';
import path from 'node:path';
import { sampleGpsWindow } from '../services/gpsSampler';

describe('Plant GPS evidence authority', () => {
  test('native Simulator slow sampling retains synthetic provenance and virtual time', async () => {
    await expect(sampleGpsWindow()).resolves.toMatchObject({
      ok: true,
      provenance: 'simulator_test',
      observedAtMs: 1_800_000_000_123,
    });
  });

  test('a bounded Plant lock is not submitted as server-accepted passive Memory', () => {
    const plant = fs.readFileSync(path.resolve(__dirname, '../../../screens/PlantScreen.tsx'), 'utf8');
    expect(plant).not.toContain('recordMemoryEvidence');
    expect(plant).toContain('a single Cairn placement can never manufacture shareable Fog');
  });
});
