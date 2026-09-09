import type { ActivityMode } from '../../store/useSessionStore';

export type ActivityLocationSource = 'real' | 'simulator';
export type SimulatorSignal = 'normal' | 'poor' | 'lost' | 'frozen';
export type SimulatorAccuracyPreset = 'good' | 'normal' | 'poor';
export type SimulatorSpeedPreset = 'slow' | 'walk' | 'brisk' | 'hike' | 'run' | 'custom';
export type SimulatorAltitudeMode = 'flat' | 'climb' | 'descend' | 'custom';
export type SimulatorTimeScale = 1 | 2 | 5 | 10 | 30 | 60 | 120;

export interface SimulatorCoordinate {
  lat: number;
  lng: number;
}

export interface SimulatorWaypoint extends SimulatorCoordinate {
  id: string;
}

export interface SimulatorActivityLease {
  clientActivityId: string;
  ownerUserId: string;
  ownerGeneration: string;
  mode: ActivityMode;
  segmentId: string;
  segmentStartReason?: 'gps-reacquired';
}

export const SIMULATOR_ACCURACY_METERS: Record<SimulatorAccuracyPreset, number> = {
  good: 5,
  normal: 12,
  poor: 60,
};

export const SIMULATOR_SPEED_KMH: Record<Exclude<SimulatorSpeedPreset, 'custom'>, number> = {
  slow: 3,
  walk: 5,
  brisk: 6.5,
  hike: 3.5,
  run: 10,
};

export const SIMULATOR_TIME_SCALES: readonly SimulatorTimeScale[] = [1, 2, 5, 10, 30, 60, 120];
