/**
 * Debug logger event types — see docs/debug-logger-spec.md §2
 *
 * 11 event types in L2 + L3 minute snapshot + L4 user annotation.
 * All events share `ts` + `session_id` + `event` discriminator.
 */

export interface BaseEvent {
  ts: number;            // Unix ms
  session_id: string;
  event: string;
}

// ── L2: GPS ─────────────────────────────────────────────────────────────────
export interface GpsFixEvent extends BaseEvent {
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

export interface KalmanOutputEvent extends BaseEvent {
  event: 'kalman_output';
  input: { lat: number; lon: number; accuracy_m: number };
  output: { lat: number; lon: number };
  rejected: boolean;       // null if Kalman rejected as inconsistent
  movement: 'static' | 'walking' | 'running' | 'driving';
}

// ── L2: Route deviation ─────────────────────────────────────────────────────
export interface DeviationStartEvent extends BaseEvent {
  event: 'deviation_start';
  route_id: string | null;
  distance_m: number;
  lat: number;
  lon: number;
}

export interface DeviationEndEvent extends BaseEvent {
  event: 'deviation_end';
  route_id: string | null;
  max_distance_m: number;
  duration_s: number;
}

export interface DeviationAlertEvent extends BaseEvent {
  event: 'deviation_alert';
  alert_type: 'alert' | 'suggest_free';
  distance_m: number;
  duration_s: number;
}

// ── L2: Broadcasts ──────────────────────────────────────────────────────────
export interface BroadcastPlayedEvent extends BaseEvent {
  event: 'broadcast_played';
  priority: 'P0' | 'P1' | 'P2';
  category: string;        // freeform: 'deviation' | 'waypoint' | 'danger' | etc.
  message: string;
  duration_ms: number;
  trigger_to_play_latency_ms: number;
  app_state: 'active' | 'background' | 'inactive';
}

// ── L2: Battery / Network / App state ───────────────────────────────────────
export interface BatterySampleEvent extends BaseEvent {
  event: 'battery_sample';
  level_pct: number;
  is_charging: boolean;
  battery_state: 'unknown' | 'unplugged' | 'charging' | 'full';
  screen_on: boolean;
  app_state: 'active' | 'background' | 'inactive';
  trigger: 'timer_60s' | 'level_change' | 'state_change' | 'session_start' | 'session_end';
}

export interface NetworkChangeEvent extends BaseEvent {
  event: 'network_change';
  state: 'online' | 'offline';
  type: 'wifi' | 'cellular' | 'none' | 'unknown';
  is_connected: boolean;
  is_internet_reachable: boolean | null;
}

export interface AppStateChangeEvent extends BaseEvent {
  event: 'app_state_change';
  from: 'active' | 'background' | 'inactive' | 'unknown';
  to: 'active' | 'background' | 'inactive' | 'unknown';
  tracking_active: boolean;
}

// ── L2: Markers / Waypoints / SOS ───────────────────────────────────────────
export interface MarkerPlacedEvent extends BaseEvent {
  event: 'marker_placed';
  marker_id: string;
  type: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  text_length: number;
  permission: 'personal' | 'group' | 'public';
}

export interface WaypointArrivedEvent extends BaseEvent {
  event: 'waypoint_arrived';
  waypoint_id: string;
  route_id: string | null;
  distance_at_trigger_m: number;
  expected_radius_m: number;
}

export interface SosTriggeredEvent extends BaseEvent {
  event: 'sos_triggered';
  stage:
    | 'longpress_start'
    | 'longpress_complete'
    | 'longpress_cancelled'
    | 'countdown_start'
    | 'countdown_cancelled'
    | 'sms_sent'
    | 'sms_failed'
    | 'queued_offline';
  contact_count?: number;
  network_state?: 'online' | 'offline';
  lat?: number;
  lon?: number;
  accuracy_m?: number | null;
  error_message?: string;
}

// ── L2: Errors ──────────────────────────────────────────────────────────────
export interface ErrorEvent extends BaseEvent {
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
  broadcasts_played_count: number;
  deviations_count: number;
  errors_count: number;

  // Network
  network_state_end: 'online' | 'offline';
  network_changes_count: number;
}

// ── L4: User annotation ─────────────────────────────────────────────────────
export interface UserAnnotationEvent extends BaseEvent {
  event: 'user_annotation';
  tag:
    | 'gps_inaccurate'
    | 'deviation_false_positive'
    | 'deviation_missed'
    | 'broadcast_jarring'
    | 'marker_misplaced'
    | 'other';
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  note?: string;
}

// ── Union ───────────────────────────────────────────────────────────────────
// ── L4: User annotation ────────────────────────────────────────────────────
export interface BreadcrumbEvent extends BaseEvent {
  event: 'breadcrumb';
  /** Free-form tag, e.g. 'route_editor_open' / 'via_added' / 'trim_changed' */
  tag: string;
  /** Optional structured payload — kept small to stay within 100kb buffer cap. */
  payload?: Record<string, string | number | boolean | null>;
}

export type LogEvent =
  | GpsFixEvent
  | KalmanOutputEvent
  | DeviationStartEvent
  | DeviationEndEvent
  | DeviationAlertEvent
  | BroadcastPlayedEvent
  | BatterySampleEvent
  | NetworkChangeEvent
  | AppStateChangeEvent
  | MarkerPlacedEvent
  | WaypointArrivedEvent
  | SosTriggeredEvent
  | ErrorEvent
  | MinuteSnapshotEvent
  | BreadcrumbEvent
  | UserAnnotationEvent;

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
