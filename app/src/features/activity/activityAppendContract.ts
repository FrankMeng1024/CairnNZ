import type { SegmentStartReason } from './activityContracts';

export interface ActivityAppendPointInput {
  lat: number; lng: number; t?: number; timestamp?: string;
  alt?: number | null;
  acc?: number | null; accuracy?: number | null;
  v_acc?: number | null; verticalAccuracy?: number | null;
  speed_mps?: number | null; speed?: number | null;
  course_deg?: number | null; course?: number | null;
  raw_ordinal?: number; rawOrdinal?: number;
  segment_id?: string; segmentId?: string;
  segment_start_reason?: SegmentStartReason; segmentStartReason?: SegmentStartReason;
}

export interface ActivityAppendWirePoint {
  lat: number; lng: number; t: number;
  alt?: number | null; acc?: number | null; v_acc?: number | null;
  speed_mps?: number | null; course_deg?: number | null;
  raw_ordinal?: number; segment_id?: string; segment_start_reason?: SegmentStartReason;
}

const optionalSensor = (value: number | null | undefined) => (
  value == null || !Number.isFinite(value) || value < 0 ? null : value
);

/** Strict allow-list shared by live flush and legacy durable queue repair. */
export function toActivityAppendWirePoint(point: ActivityAppendPointInput): ActivityAppendWirePoint {
  const output: ActivityAppendWirePoint = {
    lat: point.lat,
    lng: point.lng,
    t: Number.isFinite(point.t)
      ? Math.floor(point.t!)
      : Math.floor(Date.parse(point.timestamp ?? '')),
  };
  if (point.alt !== undefined) output.alt = optionalSensor(point.alt);
  if (point.acc !== undefined || point.accuracy !== undefined) output.acc = optionalSensor(point.acc ?? point.accuracy);
  if (point.v_acc !== undefined || point.verticalAccuracy !== undefined) output.v_acc = optionalSensor(point.v_acc ?? point.verticalAccuracy);
  if (point.speed_mps !== undefined || point.speed !== undefined) output.speed_mps = optionalSensor(point.speed_mps ?? point.speed);
  if (point.course_deg !== undefined || point.course !== undefined) output.course_deg = optionalSensor(point.course_deg ?? point.course);
  const rawOrdinal = point.raw_ordinal ?? point.rawOrdinal;
  if (rawOrdinal !== undefined) output.raw_ordinal = Math.max(0, Math.floor(rawOrdinal));
  const segmentId = point.segment_id ?? point.segmentId;
  if (segmentId !== undefined) output.segment_id = segmentId;
  const segmentStartReason = point.segment_start_reason ?? point.segmentStartReason;
  if (segmentStartReason !== undefined) output.segment_start_reason = segmentStartReason;
  return output;
}
