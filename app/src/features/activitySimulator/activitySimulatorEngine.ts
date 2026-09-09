import { destinationPoint, distanceMeters, initialBearingDegrees } from './geodesy';
import { appendSimulatorLog } from './simulatorLog';
import { persistActivitySimulatorNow, simulatorAccuracyMeters, useActivitySimulatorStore } from './useActivitySimulatorStore';
import type { SimulatorActivityLease, SimulatorSignal } from './types';
import { advanceSimulatorClock } from './simulatorTime';

export const SIMULATOR_SAMPLE_INTERVAL_MS = 1_000;
// Acceleration is represented by ordered canonical evidence, not one giant
// leap per wall tick. Ten virtual seconds keeps 30x at three samples and 120x
// at twelve samples during a normal 1 Hz tick, avoiding sparse Memory geometry.
export const SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS = 10_000;
// A 120x normal timer tick becomes twelve ordered ten-second canonical
// samples. If JS was suspended, do not replay more than this in one turn:
// delayed wall time is Debug wait-time noise, not missing Activity movement.
export const SIMULATOR_MAX_VIRTUAL_ADVANCE_PER_TICK_MS = 120_000;
export const SIMULATOR_MAX_SAMPLES_PER_TICK = Math.ceil(
  SIMULATOR_MAX_VIRTUAL_ADVANCE_PER_TICK_MS / SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS,
);
export const SIMULATOR_JOYSTICK_DEAD_ZONE = 0.12;
const WAYPOINT_ARRIVAL_M = 1;
// Do not replay an unbounded timer backlog after JS was suspended. A real
// process/background interruption is represented by recovery/segment state,
// not by flooding thousands of delayed synthetic callbacks on foregrounding.
const MAX_WALL_ELAPSED_TICK_MS = 5_000;

/**
 * Poor GPS still produces a live but degraded feed. The deterministic cycle
 * deliberately mixes usable and unusable fixes so the shared production
 * accuracy gate — not the Simulator — decides which samples become Activity
 * evidence. This also keeps native QA runs reproducible.
 */
export function poorSimulatorAccuracyMeters(sequence: number): number {
  return [18, 48, 22, 60][Math.abs(Math.floor(sequence)) % 4];
}

export interface SimulatorCanonicalSample {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  speed: number;
  course: number;
  timestamp: number;
  clientActivityId?: string;
  ownerGeneration?: string;
  segmentId?: string;
  segmentStartReason?: 'gps-reacquired';
  source: 'simulator';
  sequence: number;
}

export interface SimulatorPipelineDecision {
  accepted: boolean;
  reason: string;
  segmentId?: string | null;
  memoryCommitted?: boolean;
  memoryDeduplicated?: boolean;
}

type ActivitySink = (sample: SimulatorCanonicalSample) => Promise<SimulatorPipelineDecision>;
type PassiveListener = (sample: SimulatorCanonicalSample) => void;

class ActivitySimulatorEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickWallMs: number | null = null;
  private lease: SimulatorActivityLease | null = null;
  private sink: ActivitySink | null = null;
  private passiveListeners = new Set<PassiveListener>();
  private ticking = false;
  private correctionPaused = false;
  private providerPaused = false;
  private frozenReportedPosition: { lat: number; lng: number; altitudeM: number } | null = null;

  startRuntime(): void {
    if (this.timer) return;
    this.lastTickWallMs = Date.now();
    this.timer = setInterval(() => { void this.tick(); }, SIMULATOR_SAMPLE_INTERVAL_MS);
  }

  async stopRuntime(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastTickWallMs = null;
    useActivitySimulatorStore.getState().releaseJoystick();
    await persistActivitySimulatorNow().catch(() => {});
  }

  bindActivity(lease: SimulatorActivityLease, sink: ActivitySink, startedAt: number): void {
    this.lease = { ...lease };
    this.sink = sink;
    this.lastTickWallMs = Date.now();
    this.correctionPaused = false;
    this.providerPaused = false;
    this.frozenReportedPosition = null;
    const simulatorSessionId = useActivitySimulatorStore.getState().bindActivity(
      lease.ownerUserId,
      lease.clientActivityId,
      startedAt,
    );
    this.startRuntime();
    appendSimulatorLog('SIM_SESSION', 'simulator_activity_bound', {
      mode: lease.mode,
      segmentId: lease.segmentId,
      wallSampleCadenceMs: SIMULATOR_SAMPLE_INTERVAL_MS,
      maxVirtualSampleIntervalMs: SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS,
      timeScale: useActivitySimulatorStore.getState().timeScale,
      effectiveVirtualElapsed: 0,
      deterministicSeed: useActivitySimulatorStore.getState().deterministicSeed,
    }, {
      userId: lease.ownerUserId,
      clientActivityId: lease.clientActivityId,
      simulatorSessionId,
      virtualTimestamp: startedAt,
    });
    // The first sample establishes the normal Activity location anchor even
    // before the tester moves. It still passes through canonical acceptance.
    setTimeout(() => { void this.tick(Date.now(), true); }, 0);
  }

  pauseActivity(): void {
    this.sink = null;
    this.providerPaused = true;
    appendSimulatorLog('ACTIVITY_STATE', 'simulator_provider_paused', {
      virtualMovementStillAllowed: false,
    });
  }

  resumeActivity(lease: SimulatorActivityLease, sink: ActivitySink): void {
    this.lease = { ...lease };
    this.sink = sink;
    this.providerPaused = false;
    // One millisecond of wall time guarantees the forced Resume anchor is
    // strictly newer than the pre-interruption sample without inventing a
    // meaningful Activity interval.
    this.lastTickWallMs = Date.now() - 1;
    this.startRuntime();
    appendSimulatorLog('ACTIVITY_STATE', 'simulator_provider_resumed', {
      mode: lease.mode,
      segmentId: lease.segmentId,
      timeScale: useActivitySimulatorStore.getState().timeScale,
    });
    setTimeout(() => { void this.tick(Date.now(), true); }, 0);
  }

  async endActivity(reason: 'completed' | 'discarded' | 'account-switch' | 'start-failed'): Promise<void> {
    const lease = this.lease;
    this.sink = null;
    this.lease = null;
    this.correctionPaused = false;
    this.providerPaused = false;
    this.frozenReportedPosition = null;
    if (lease) {
      appendSimulatorLog('SIM_SESSION', 'simulator_activity_unbound', { reason }, {
        userId: lease.ownerUserId,
        clientActivityId: lease.clientActivityId,
      });
    }
    // Account switching parks the owner-scoped unfinished Activity. Keep its
    // persisted simulator binding/context so the original owner can recover;
    // completion/discard/start failure end the simulator session normally.
    if (reason !== 'account-switch') {
      const clearOrigin = reason === 'completed' || reason === 'discarded';
      if (clearOrigin && lease) {
        appendSimulatorLog('SIM_SESSION', 'virtual_origin_cleared', { reason }, {
          userId: lease.ownerUserId,
          clientActivityId: lease.clientActivityId,
          coordinateSource: 'none',
        });
      }
      useActivitySimulatorStore.getState().unbindActivity({ clearOrigin });
    }
    await persistActivitySimulatorNow().catch(() => {});
  }

  subscribePassive(listener: PassiveListener): () => void {
    this.passiveListeners.add(listener);
    return () => { this.passiveListeners.delete(listener); };
  }

  getLease(): SimulatorActivityLease | null {
    return this.lease ? { ...this.lease } : null;
  }

  isActivityBound(clientActivityId?: string | null): boolean {
    return !!this.lease && (!clientActivityId || this.lease.clientActivityId === clientActivityId);
  }

  async pauseForCorrection(): Promise<void> {
    this.correctionPaused = true;
    useActivitySimulatorStore.getState().releaseJoystick();
    for (let attempt = 0; this.ticking && attempt < 200; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    if (this.ticking) throw new Error('simulator_pipeline_busy');
  }

  restoreCommittedTail(args: {
    coordinate: { lat: number; lng: number };
    altitudeM: number;
    virtualTimestampMs: number;
    segmentId: string;
  }): void {
    if (this.lease) this.lease = { ...this.lease, segmentId: args.segmentId, segmentStartReason: undefined };
    useActivitySimulatorStore.getState().restoreRuntimeTail(
      args.coordinate,
      args.altitudeM,
      args.virtualTimestampMs,
    );
    this.frozenReportedPosition = null;
    this.lastTickWallMs = Date.now();
    this.correctionPaused = false;
  }

  async reacquireAt(
    coordinate: { lat: number; lng: number },
    segmentId: string,
    nextSignal: Exclude<SimulatorSignal, 'lost'> = 'normal',
  ): Promise<void> {
    this.correctionPaused = true;
    useActivitySimulatorStore.getState().releaseJoystick();
    if (this.lease) this.lease = { ...this.lease, segmentId, segmentStartReason: 'gps-reacquired' };
    const state = useActivitySimulatorStore.getState();
    useActivitySimulatorStore.getState().restoreRuntimeTail(
      coordinate,
      state.altitudeM,
      state.virtualTimestampMs,
    );
    useActivitySimulatorStore.getState().setSignal(nextSignal);
    this.frozenReportedPosition = null;
    this.lastTickWallMs = Date.now() - 1;
    this.correctionPaused = false;
    await this.tick(Date.now(), true);
  }

  /** Public for deterministic unit tests and compact QA scenario actions. */
  async tick(nowMs = Date.now(), forceSample = false): Promise<void> {
    if (this.ticking || this.correctionPaused || this.providerPaused) return;
    this.ticking = true;
    try {
      const state = useActivitySimulatorStore.getState();
      const previousWall = this.lastTickWallMs ?? nowMs;
      const wallElapsedCapMs = Math.min(
        MAX_WALL_ELAPSED_TICK_MS,
        SIMULATOR_MAX_VIRTUAL_ADVANCE_PER_TICK_MS / Math.max(1, state.timeScale),
      );
      const elapsedWallMs = Math.max(0, Math.min(wallElapsedCapMs, nowMs - previousWall));
      this.lastTickWallMs = nowMs;
      const activityBound = !!this.lease;
      // Configuration is inert until Start binds an Activity lease. The SIM
      // panel may prepare a start/destination/waypoint queue, but it cannot
      // advance a virtual location, publish a passive fix, or affect a map
      // lifecycle while the ordinary pre-Activity map is in use.
      if (!activityBound) return;
      const effectiveTimeScale = state.timeScale;
      const activityStartedAtMs = state.virtualActivityStartedAtMs ?? (state.virtualTimestampMs || nowMs);
      const clock = advanceSimulatorClock({
        activityStartedAtMs,
        previousVirtualTimestampMs: state.virtualTimestampMs || activityStartedAtMs,
        wallElapsedMs: elapsedWallMs,
        wallClockTimestampMs: nowMs,
        timeScale: effectiveTimeScale,
      });
      // The limit banner is already durable. Stay quiescent until the tester
      // uses the real Finish/Discard lifecycle instead of rewriting the same
      // provider state once per second forever.
      if (state.clockLimitReached && clock.appliedVirtualElapsedMs <= 0) return;
      const nextBatchSequence = state.batchSequence + 1;
      const shouldPublish = forceSample || elapsedWallMs >= SIMULATOR_SAMPLE_INTERVAL_MS * 0.5;
      const elapsedVirtualMs = clock.appliedVirtualElapsedMs;
      const sampleCount = Math.max(
        1,
        Math.ceil(elapsedVirtualMs / SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS),
      );
      if (sampleCount > SIMULATOR_MAX_SAMPLES_PER_TICK) {
        throw new Error('simulator_sample_burst_bound_exceeded');
      }
      let remainingVirtualMs = elapsedVirtualMs;
      let consumedVirtualMs = 0;
      let current = state.current;
      let altitudeM = state.altitudeM;

      for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
        const stepVirtualMs = sampleIndex === sampleCount
          ? remainingVirtualMs
          : Math.min(SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS, remainingVirtualMs);
        remainingVirtualMs -= stepVirtualMs;
        consumedVirtualMs += stepVirtualMs;

        let bearing = state.joystickBearingDegrees;
        let magnitude = state.joystickMagnitude <= SIMULATOR_JOYSTICK_DEAD_ZONE
          ? 0
          : (state.joystickMagnitude - SIMULATOR_JOYSTICK_DEAD_ZONE) / (1 - SIMULATOR_JOYSTICK_DEAD_ZONE);
        let remainingDistanceM = (state.speedKmh / 3.6) * (stepVirtualMs / 1000) * magnitude;
        const stepStart = current;

        if (magnitude === 0 && state.autopilotActive && useActivitySimulatorStore.getState().waypoints.length > 0) {
          magnitude = 1;
          remainingDistanceM = (state.speedKmh / 3.6) * (stepVirtualMs / 1000);
        }

        const requestedDistanceM = remainingDistanceM;

        let guard = 0;
        while (state.autopilotActive && magnitude > 0 && useActivitySimulatorStore.getState().waypoints.length > 0 && guard < 12) {
          guard += 1;
          const waypoint = useActivitySimulatorStore.getState().waypoints[0];
          const distanceToWaypoint = distanceMeters(current, waypoint);
          bearing = initialBearingDegrees(current, waypoint);
          if (distanceToWaypoint <= WAYPOINT_ARRIVAL_M || remainingDistanceM >= distanceToWaypoint) {
            current = { lat: waypoint.lat, lng: waypoint.lng };
            remainingDistanceM = Math.max(0, remainingDistanceM - distanceToWaypoint);
            useActivitySimulatorStore.getState().shiftWaypoint();
            appendSimulatorLog('SIM_INPUT', 'simulator_waypoint_arrived', {
              waypointId: waypoint.id,
              lat: waypoint.lat,
              lng: waypoint.lng,
            });
            if (remainingDistanceM <= 0) break;
          } else {
            current = destinationPoint(current, bearing, remainingDistanceM);
            remainingDistanceM = 0;
          }
        }

        if (!state.autopilotActive && magnitude > 0 && remainingDistanceM > 0) {
          current = destinationPoint(current, bearing, remainingDistanceM);
        }

        const movedDistanceM = distanceMeters(stepStart, current);
        const moving = movedDistanceM > 0.001;
        const verticalDelta = moving ? state.verticalRateMPerHour * (stepVirtualMs / 3_600_000) : 0;
        altitudeM = Math.max(-500, Math.min(9_000, altitudeM + verticalDelta));
        // Accelerated clocks advance exactly by applied virtual elapsed. The
        // final sample uses the authoritative clock result so 1x recovery can
        // safely catch its epoch up without inventing displacement.
        const virtualTimestampMs = sampleIndex === sampleCount
          ? clock.virtualTimestampMs
          : state.virtualTimestampMs + consumedVirtualMs;
        const effectiveVirtualElapsedMs = Math.max(0, virtualTimestampMs - activityStartedAtMs);
        useActivitySimulatorStore.getState().setRuntimePosition(current, altitudeM, {
          virtualTimestampMs,
          effectiveVirtualElapsedMs,
          batchSequence: nextBatchSequence,
          clockLimitReached: clock.limitReached,
        });

        if (moving) {
          appendSimulatorLog('SIM_POSITION', 'simulator_position_advanced', {
            lat: current.lat,
            lng: current.lng,
            altitude: altitudeM,
            movedDistanceM,
            requestedDistanceM,
            bearingDegrees: bearing,
            joystickActive: state.joystickActive,
            joystickMagnitude: magnitude,
            autopilotActive: state.autopilotActive,
            signal: state.signal,
            timeScale: effectiveTimeScale,
            effectiveVirtualElapsed: effectiveVirtualElapsedMs,
            batchSequence: nextBatchSequence,
            batchSampleIndex: sampleIndex,
            batchSampleCount: sampleCount,
          }, { virtualTimestamp: virtualTimestampMs });
        }

        if (state.signal === 'lost') {
          this.frozenReportedPosition = null;
          continue;
        }
        if (!shouldPublish) continue;
        if (!this.sink && this.passiveListeners.size === 0) continue;
        // Once the bounded clock is exhausted, do not emit duplicate timestamps.
        if (stepVirtualMs <= 0 && state.sampleSequence > 0) continue;
        if (state.signal === 'frozen' && !this.frozenReportedPosition) {
          this.frozenReportedPosition = { ...stepStart, altitudeM: state.altitudeM };
        } else if (state.signal !== 'frozen') {
          this.frozenReportedPosition = null;
        }
        const reported = state.signal === 'frozen' && this.frozenReportedPosition
          ? this.frozenReportedPosition
          : current;
        await this.emitSample({
          state,
          current: reported,
          altitudeM: state.signal === 'frozen' && this.frozenReportedPosition
            ? this.frozenReportedPosition.altitudeM
            : altitudeM,
          moving,
          magnitude,
          bearing,
          virtualTimestampMs,
          effectiveTimeScale,
          effectiveVirtualElapsedMs,
          batchSequence: nextBatchSequence,
          batchSampleIndex: sampleIndex,
          batchSampleCount: sampleCount,
        });
      }

      if (clock.limitReached && !state.clockLimitReached) {
        useActivitySimulatorStore.getState().setLastFailure(
          'Accelerated clock reached its safe 12-hour virtual limit. Finish or discard this Activity.',
        );
        appendSimulatorLog('ERROR', 'simulator_virtual_clock_limit_reached', {
          timeScale: effectiveTimeScale,
          effectiveVirtualElapsed: clock.effectiveVirtualElapsedMs,
          maximumVirtualTimestamp: clock.maximumVirtualTimestampMs,
          errorCode: 'virtual-clock-limit',
        }, { virtualTimestamp: clock.virtualTimestampMs });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async emitSample(args: {
    state: ReturnType<typeof useActivitySimulatorStore.getState>;
    current: { lat: number; lng: number };
    altitudeM: number;
    moving: boolean;
    magnitude: number;
    bearing: number;
    virtualTimestampMs: number;
    effectiveTimeScale: number;
    effectiveVirtualElapsedMs: number;
    batchSequence: number;
    batchSampleIndex: number;
    batchSampleCount: number;
  }): Promise<void> {
    const sequence = useActivitySimulatorStore.getState().sampleSequence + 1;
    const sample: SimulatorCanonicalSample = {
      lat: args.current.lat,
      lng: args.current.lng,
      alt: args.altitudeM,
      accuracy: args.state.signal === 'poor'
        ? poorSimulatorAccuracyMeters(sequence)
        : simulatorAccuracyMeters(args.state),
      speed: args.moving ? args.state.speedKmh / 3.6 * args.magnitude : 0,
      course: args.bearing,
      timestamp: args.virtualTimestampMs,
      clientActivityId: this.lease?.clientActivityId,
      ownerGeneration: this.lease?.ownerGeneration,
      segmentId: this.lease?.segmentId,
      segmentStartReason: this.lease?.segmentStartReason,
      source: 'simulator',
      sequence,
    };
    useActivitySimulatorStore.setState({ sampleSequence: sequence });
    useActivitySimulatorStore.getState().recordGeneratedSample({
      sequence,
      atMs: sample.timestamp,
      lat: sample.lat,
      lng: sample.lng,
      bearingDegrees: sample.course,
      joystickMagnitude: args.magnitude,
      effectiveVirtualElapsedMs: args.effectiveVirtualElapsedMs,
    });
    appendSimulatorLog('SIM_SAMPLE', 'simulator_sample_generated', {
      sequence,
      lat: sample.lat,
      lng: sample.lng,
      altitude: sample.alt,
      accuracy: sample.accuracy,
      configuredSpeedKmh: args.state.speedKmh,
      emittedSpeedMps: sample.speed,
      course: sample.course,
      joystickActive: args.state.joystickActive,
      joystickMagnitude: args.magnitude,
      autopilotActive: args.state.autopilotActive,
      signal: args.state.signal,
      activityBound: !!this.sink,
      timeScale: args.effectiveTimeScale,
      effectiveVirtualElapsed: args.effectiveVirtualElapsedMs,
      batchSequence: args.batchSequence,
      batchSampleIndex: args.batchSampleIndex,
      batchSampleCount: args.batchSampleCount,
    }, { virtualTimestamp: sample.timestamp });
    if (sequence === 1) {
      appendSimulatorLog('PROVIDER', 'simulator_first_sample_generated', {
        sequence,
        segmentId: sample.segmentId ?? null,
        providerLocked: true,
      }, {
        userId: this.lease?.ownerUserId,
        clientActivityId: this.lease?.clientActivityId,
        virtualTimestamp: sample.timestamp,
        coordinateSource: 'simulator',
      });
    }

    for (const listener of this.passiveListeners) {
      try { listener(sample); } catch { /* one passive consumer cannot stop the provider */ }
    }

    const sink = this.sink;
    const leaseAtEmission = this.lease;
    if (!sink || !leaseAtEmission) return;
    try {
      const decision = await sink(sample);
      useActivitySimulatorStore.getState().recordDecision({
        accepted: decision.accepted,
        reason: decision.reason,
        sequence,
        atMs: sample.timestamp,
        lat: sample.lat,
        lng: sample.lng,
        segmentId: decision.segmentId,
        memoryCommitted: decision.memoryCommitted,
        memoryDeduplicated: decision.memoryDeduplicated,
      });
      if (decision.accepted && decision.segmentId && decision.segmentId !== leaseAtEmission.segmentId) {
        appendSimulatorLog('GPS_SEGMENT', 'canonical_segment_changed', {
          previousSegmentId: leaseAtEmission.segmentId,
          segmentId: decision.segmentId,
          reason: decision.reason,
        }, {
          userId: leaseAtEmission.ownerUserId,
          clientActivityId: leaseAtEmission.clientActivityId,
          virtualTimestamp: sample.timestamp,
        });
        this.lease = { ...leaseAtEmission, segmentId: decision.segmentId };
      }
      if (decision.accepted && sequence === 1) {
        appendSimulatorLog('PROVIDER', 'simulator_first_point_accepted', {
          sequence,
          segmentId: decision.segmentId ?? null,
        }, {
          userId: leaseAtEmission.ownerUserId,
          clientActivityId: leaseAtEmission.clientActivityId,
          virtualTimestamp: sample.timestamp,
          coordinateSource: 'simulator',
        });
      }
      // Keep the segment-start marker until an accepted sample establishes
      // the new component. A rejected first Poor fix must not consume the
      // only explicit continuity break and let the next fix attach to the
      // previous segment.
      if (decision.accepted && leaseAtEmission.segmentStartReason === 'gps-reacquired' && this.lease) {
        this.lease = { ...this.lease, segmentStartReason: undefined };
      }
      appendSimulatorLog(
        decision.accepted ? 'GPS_ACCEPT' : 'GPS_REJECT',
        decision.accepted ? 'canonical_gps_accepted' : 'canonical_gps_rejected',
        {
          sequence,
          accepted: decision.accepted,
          rejectionReason: decision.accepted ? null : decision.reason,
          segmentId: decision.segmentId ?? null,
          memoryCommitted: decision.memoryCommitted ?? null,
          memoryDeduplicated: decision.memoryDeduplicated ?? null,
        },
        {
          userId: leaseAtEmission.ownerUserId,
          clientActivityId: leaseAtEmission.clientActivityId,
          virtualTimestamp: sample.timestamp,
        },
      );
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error).slice(0, 160);
      useActivitySimulatorStore.getState().recordDecision({
        accepted: false,
        reason,
        sequence,
        atMs: sample.timestamp,
        lat: sample.lat,
        lng: sample.lng,
      });
      appendSimulatorLog('ERROR', 'simulator_sample_pipeline_error', {
        sequence,
        errorCode: reason,
      }, {
        userId: leaseAtEmission.ownerUserId,
        clientActivityId: leaseAtEmission.clientActivityId,
        virtualTimestamp: sample.timestamp,
      });
    }
  }
}

export const activitySimulatorEngine = new ActivitySimulatorEngine();
