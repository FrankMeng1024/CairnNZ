/**
 * Debug logger event types — see docs/debug-logger-spec.md §2
 *
 * O1 (2026-07-26) cleanup: removed dead event types that were declared
 * but never emitted in production code:
 * - DeviationStartEvent / DeviationEndEvent / DeviationAlertEvent
 *   (route-deviation feature was cut)
 * - BroadcastPlayedEvent (voice broadcast feature was cut)
 * - WaypointArrivedEvent (waypoint arrival detection was cut)
 * - SosTriggeredEvent (SOS button feature was cut)
 * - UserAnnotationEvent (user tag/note feature never shipped)
 *
 * Also removed the corresponding counters from MinuteSnapshotEvent
 * (broadcasts_played_count / deviations_count) — they were always 0.
 */

interface BaseEvent {
  ts: number;            // Unix ms
  session_id: string;
  event: string;
}

// ── L2: GPS ─────────────────────────────────────────────────────────────────
interface GpsFixEvent extends BaseEvent {
  event: 'gps_fix';
  lat: number;
  lon: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  altitude_accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  raw_or_filtered: 'raw' | 'filtered';
  source: 'foreground' | 'background' | 'simulated';
}

interface KalmanOutputEvent extends BaseEvent {
  event: 'kalman_output';
  input: { lat: number; lon: number; accuracy_m: number };
  output: { lat: number; lon: number };
  rejected: boolean;       // null if Kalman rejected as inconsistent
  movement: 'static' | 'walking' | 'running' | 'driving';
}

// ── L2: Battery / Network / App state ───────────────────────────────────────
interface BatterySampleEvent extends BaseEvent {
  event: 'battery_sample';
  level_pct: number;
  is_charging: boolean;
  battery_state: 'unknown' | 'unplugged' | 'charging' | 'full';
  screen_on: boolean;
  app_state: 'active' | 'background' | 'inactive';
  trigger: 'timer_60s' | 'level_change' | 'state_change' | 'session_start' | 'session_end';
}

interface NetworkChangeEvent extends BaseEvent {
  event: 'network_change';
  state: 'online' | 'offline';
  type: 'wifi' | 'cellular' | 'none' | 'unknown';
  is_connected: boolean;
  is_internet_reachable: boolean | null;
}

interface AppStateChangeEvent extends BaseEvent {
  event: 'app_state_change';
  from: 'active' | 'background' | 'inactive' | 'unknown';
  to: 'active' | 'background' | 'inactive' | 'unknown';
  tracking_active: boolean;
}

// ── L2: Markers ─────────────────────────────────────────────────────────────
interface MarkerPlacedEvent extends BaseEvent {
  event: 'marker_placed';
  marker_id: string;
  type: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  text_length: number;
  permission: 'personal' | 'group' | 'public';
}

// ── L2: Errors ──────────────────────────────────────────────────────────────
interface ErrorEvent extends BaseEvent {
  event: 'error';
  source: string;
  message: string;
  stack?: string;
  fatal: boolean;
}

// ── L3: Minute snapshot ─────────────────────────────────────────────────────
export interface MinuteSnapshotEvent extends BaseEvent {
  event: 'minute_snapshot';
  minute_index: number;

  // GPS
  gps_points_count: number;
  gps_avg_accuracy_m: number | null;
  gps_max_accuracy_m: number | null;
  gps_p95_accuracy_m: number | null;
  gps_lost_seconds: number;

  // Battery
  battery_start_pct: number | null;
  battery_end_pct: number | null;
  battery_drop_pct: number | null;
  is_charging_any: boolean;

  // App state
  screen_on_seconds: number;
  in_background_seconds: number;

  // Counters
  errors_count: number;

  // Network
  network_state_end: 'online' | 'offline';
  network_changes_count: number;
}

// ── L4: User annotation ────────────────────────────────────────────────────
interface BreadcrumbEvent extends BaseEvent {
  event: 'breadcrumb';
  /** Free-form tag, e.g. 'route_editor_open' / 'via_added' / 'trim_changed' */
  tag: string;
  /** Optional structured payload — kept small to stay within 100kb buffer cap. */
  payload?: Record<string, string | number | boolean | null>;
}

export type LogEvent =
  | GpsFixEvent
  | KalmanOutputEvent
  | BatterySampleEvent
  | NetworkChangeEvent
  | AppStateChangeEvent
  | MarkerPlacedEvent
  | ErrorEvent
  | MinuteSnapshotEvent
  | BreadcrumbEvent;

// ── Session metadata ────────────────────────────────────────────────────────
export interface SessionMetadata {
  session_id: string;
  started_at: number;
  ended_at: number | null;
  events_count: number;
  raw_size_bytes: number;
  device_info: DeviceInfo;
  activity_mode?: 'hiking' | 'running' | 'free' | null;
  uploaded: boolean;
  upload_attempts: number;
  upload_last_error?: string;
}

export interface DeviceInfo {
  model: string | null;
  os: 'ios' | 'android' | 'web' | 'unknown';
  os_version: string | null;
  app_version: string | null;
  build_number: string | null;
}
