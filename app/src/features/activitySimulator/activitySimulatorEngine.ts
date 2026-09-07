import { destinationPoint, distanceMeters, initialBearingDegrees } from './geodesy';
import { appendSimulatorLog } from './simulatorLog';
import { persistActivitySimulatorNow, simulatorAccuracyMeters, useActivitySimulatorStore } from './useActivitySimulatorStore';
import type { SimulatorActivityLease } from './types';
import { advanceSimulatorClock } from './simulatorTime';

export const SIMULATOR_SAMPLE_INTERVAL_MS = 1_000;
// Acceleration is represented by ordered canonical evidence, not one giant
// leap per wall tick. Ten virtual seconds keeps the worst-case 30x batch to
// three samples during a normal 1 Hz tick and avoids sparse Memory geometry.
export const SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS = 10_000;
export const SIMULATOR_JOYSTICK_DEAD_ZONE = 0.12;
const WAYPOINT_ARRIVAL_M = 1;
// Do not replay an unbounded timer backlog after JS was suspended. A real
// process/background interruption is represented by recovery/segment state,
// not by flooding thousands of delayed synthetic callbacks on foregrounding.
const MAX_WALL_ELAPSED_TICK_MS = 5_000;

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
    appendSimulatorLog('ACTIVITY_STATE', 'simulator_provider_paused', {
      virtualMovementStillAllowed: true,
    });
  }

  resumeActivity(lease: SimulatorActivityLease, sink: ActivitySink): void {
    this.lease = { ...lease };
    this.sink = sink;
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
      useActivitySimulatorStore.getState().unbindActivity();
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

  /** Public for deterministic unit tests and compact QA scenario actions. */
  async tick(nowMs = Date.now(), forceSample = false): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const state = useActivitySimulatorStore.getState();
      const previousWall = this.lastTickWallMs ?? nowMs;
      const elapsedWallMs = Math.max(0, Math.min(MAX_WALL_ELAPSED_TICK_MS, nowMs - previousWall));
      this.lastTickWallMs = nowMs;
      const activityBound = !!this.lease;
      const effectiveTimeScale = activityBound ? state.timeScale : 1;
      const activityStartedAtMs = state.virtualActivityStartedAtMs ?? (state.virtualTimestampMs || nowMs);
      const clock = activityBound
        ? advanceSimulatorClock({
            activityStartedAtMs,
            previousVirtualTimestampMs: state.virtualTimestampMs || activityStartedAtMs,
            wallElapsedMs: elapsedWallMs,
            wallClockTimestampMs: nowMs,
            timeScale: effectiveTimeScale,
          })
        : {
            virtualTimestampMs: nowMs,
            appliedVirtualElapsedMs: elapsedWallMs,
            effectiveVirtualElapsedMs: 0,
            limitReached: false,
            maximumVirtualTimestampMs: nowMs,
          };
      // The limit banner is already durable. Stay quiescent until the tester
      // uses the real Finish/Discard lifecycle instead of rewriting the same
      // provider state once per second forever.
      if (activityBound && state.clockLimitReached && clock.appliedVirtualElapsedMs <= 0) return;
      const nextBatchSequence = state.batchSequence + 1;
      const shouldPublish = forceSample || elapsedWallMs >= SIMULATOR_SAMPLE_INTERVAL_MS * 0.5;
      const elapsedVirtualMs = clock.appliedVirtualElapsedMs;
      const sampleCount = Math.max(
        1,
        Math.ceil(elapsedVirtualMs / SIMULATOR_MAX_VIRTUAL_SAMPLE_INTERVAL_MS),
      );
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
            bearingDegrees: bearing,
            joystickMagnitude: magnitude,
            signal: state.signal,
            timeScale: effectiveTimeScale,
            effectiveVirtualElapsed: effectiveVirtualElapsedMs,
            batchSequence: nextBatchSequence,
            batchSampleIndex: sampleIndex,
            batchSampleCount: sampleCount,
          }, { virtualTimestamp: virtualTimestampMs });
        }

        if (!shouldPublish || state.signal === 'lost') continue;
        if (!this.sink && this.passiveListeners.size === 0) continue;
        // Once the bounded clock is exhausted, do not emit duplicate timestamps.
        if (activityBound && stepVirtualMs <= 0 && state.sampleSequence > 0) continue;
        await this.emitSample({
          state,
          current,
          altitudeM,
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
      accuracy: simulatorAccuracyMeters(args.state),
      speed: args.moving ? args.state.speedKmh / 3.6 * args.magnitude : 0,
      course: args.bearing,
      timestamp: args.virtualTimestampMs,
      clientActivityId: this.lease?.clientActivityId,
      ownerGeneration: this.lease?.ownerGeneration,
      segmentId: this.lease?.segmentId,
      source: 'simulator',
      sequence,
    };
    useActivitySimulatorStore.setState({ sampleSequence: sequence });
    appendSimulatorLog('SIM_SAMPLE', 'simulator_sample_generated', {
      sequence,
      lat: sample.lat,
      lng: sample.lng,
      altitude: sample.alt,
      accuracy: sample.accuracy,
      configuredSpeedKmh: args.state.speedKmh,
      emittedSpeedMps: sample.speed,
      course: sample.course,
      signal: args.state.signal,
      activityBound: !!this.sink,
      timeScale: args.effectiveTimeScale,
      effectiveVirtualElapsed: args.effectiveVirtualElapsedMs,
      batchSequence: args.batchSequence,
      batchSampleIndex: args.batchSampleIndex,
      batchSampleCount: args.batchSampleCount,
    }, { virtualTimestamp: sample.timestamp });

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
      useActivitySimulatorStore.getState().recordDecision({ accepted: false, reason, sequence, atMs: sample.timestamp });
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
