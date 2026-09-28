export type RealLocationConsumerId = 'activity' | 'passive-memory';

export interface RealLocationObservationEnvelope<TObservation> {
  observation: TObservation;
  observationTimestampMs: number;
}

export interface RealLocationConsumer<TObservation, TOptions> {
  id: RealLocationConsumerId;
  ownerUserId: string;
  generation: string;
  priority: number;
  options: TOptions;
  optionsKey: string;
  onObservation: (value: RealLocationObservationEnvelope<TObservation>) => void | Promise<unknown>;
  onTerminalError?: (error: unknown) => void;
  onState?: (snapshot: RealLocationSupervisorSnapshot) => void;
}

export interface RealLocationSupervisorSnapshot {
  desiredConsumers: Array<{
    id: RealLocationConsumerId;
    ownerUserId: string;
    generation: string;
    priority: number;
  }>;
  effectiveConsumer: RealLocationConsumerId | null;
  effectiveOwnerUserId: string | null;
  providerGeneration: number;
  startInFlight: boolean;
  streamActive: boolean;
  recoverableError: string | null;
  terminalError: string | null;
  retryAttempt: number;
  retryScheduledAtMs: number | null;
  lastCallbackReceiptMs: number | null;
  lastObservationTimestampMs: number | null;
  lastFreshObservationReceiptMs: number | null;
  lastProcessingCompletedMs: number | null;
  watchdogScheduledAtMs: number | null;
}

export interface RealLocationStreamHandle {
  remove(): void;
}

type StartStream<TObservation, TOptions> = (
  options: TOptions,
  onObservation: (observation: TObservation, observationTimestampMs: number) => void,
  onTerminalError: (error: unknown) => void,
) => Promise<RealLocationStreamHandle>;

interface SupervisorDependencies<TObservation, TOptions> {
  startStream: StartStream<TObservation, TOptions>;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  retryDelaysMs?: number[];
  /** Provider liveness means callback receipt, not user movement. A stationary
   * callback keeps the stream healthy; a completely silent handle is fenced. */
  startupSilenceMs?: number;
  callbackSilenceMs?: number;
  isTerminalWithoutRetry?: (error: unknown) => boolean;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 160);
  return String(error).slice(0, 160);
}

/**
 * One logical foreground real-location owner. Consumers express intent; this
 * supervisor owns the native handle, start races, generations and bounded
 * restart policy. Activity wins while recording, so mounting another screen
 * can never create a competing GPS watcher or duplicate business evidence.
 */
export class RealLocationSupervisor<TObservation, TOptions> {
  private readonly consumers = new Map<RealLocationConsumerId, RealLocationConsumer<TObservation, TOptions>>();
  private readonly startStream: StartStream<TObservation, TOptions>;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly retryDelaysMs: number[];
  private readonly isTerminalWithoutRetry: (error: unknown) => boolean;
  private providerGeneration = 0;
  private handle: RealLocationStreamHandle | null = null;
  private inFlightToken: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private retryScheduledAtMs: number | null = null;
  private watchdogScheduledAtMs: number | null = null;
  private activeIdentity: string | null = null;
  private recoverableError: string | null = null;
  private terminalError: string | null = null;
  private lastCallbackReceiptMs: number | null = null;
  private lastObservationTimestampMs: number | null = null;
  private lastFreshObservationReceiptMs: number | null = null;
  private lastProcessingCompletedMs: number | null = null;
  private readonly startupSilenceMs: number;
  private readonly callbackSilenceMs: number;

  constructor(dependencies: SupervisorDependencies<TObservation, TOptions>) {
    this.startStream = dependencies.startStream;
    this.now = dependencies.now ?? Date.now;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
    this.retryDelaysMs = dependencies.retryDelaysMs ?? [1_000, 5_000, 15_000, 60_000];
    // Deliberately generous relative to the native 10–15 s Activity options.
    // These bounds detect a dead stream, not slow/stationary movement.
    this.startupSilenceMs = dependencies.startupSilenceMs ?? 120_000;
    this.callbackSilenceMs = dependencies.callbackSilenceMs ?? 300_000;
    this.isTerminalWithoutRetry = dependencies.isTerminalWithoutRetry ?? (() => false);
  }

  snapshot(): RealLocationSupervisorSnapshot {
    const desiredConsumers = [...this.consumers.values()]
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map(({ id, ownerUserId, generation, priority }) => ({ id, ownerUserId, generation, priority }));
    const effective = this.effectiveConsumer();
    return {
      desiredConsumers,
      effectiveConsumer: effective?.id ?? null,
      effectiveOwnerUserId: effective?.ownerUserId ?? null,
      providerGeneration: this.providerGeneration,
      startInFlight: this.inFlightToken !== null,
      streamActive: this.handle !== null,
      recoverableError: this.recoverableError,
      terminalError: this.terminalError,
      retryAttempt: this.retryAttempt,
      retryScheduledAtMs: this.retryScheduledAtMs,
      lastCallbackReceiptMs: this.lastCallbackReceiptMs,
      lastObservationTimestampMs: this.lastObservationTimestampMs,
      lastFreshObservationReceiptMs: this.lastFreshObservationReceiptMs,
      lastProcessingCompletedMs: this.lastProcessingCompletedMs,
      watchdogScheduledAtMs: this.watchdogScheduledAtMs,
    };
  }

  isActiveConsumer(id: RealLocationConsumerId): boolean {
    return this.snapshot().effectiveConsumer === id && this.handle !== null;
  }

  async setConsumer(consumer: RealLocationConsumer<TObservation, TOptions>): Promise<boolean> {
    const previous = this.consumers.get(consumer.id);
    this.consumers.set(consumer.id, consumer);
    const materiallyChanged = !previous
      || previous.ownerUserId !== consumer.ownerUserId
      || previous.generation !== consumer.generation
      || previous.optionsKey !== consumer.optionsKey
      || previous.priority !== consumer.priority;
    if (materiallyChanged || this.activeIdentity !== this.identity(this.effectiveConsumer())) {
      await this.reconcile();
    } else {
      this.publish();
    }
    return this.isActiveConsumer(consumer.id);
  }

  async removeConsumer(id: RealLocationConsumerId, expectedGeneration?: string): Promise<void> {
    const current = this.consumers.get(id);
    if (!current || (expectedGeneration != null && current.generation !== expectedGeneration)) return;
    this.consumers.delete(id);
    await this.reconcile();
  }

  async clear(): Promise<void> {
    this.consumers.clear();
    await this.reconcile();
  }

  private effectiveConsumer(): RealLocationConsumer<TObservation, TOptions> | null {
    return [...this.consumers.values()]
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] ?? null;
  }

  private identity(consumer: RealLocationConsumer<TObservation, TOptions> | null): string | null {
    return consumer
      ? `${consumer.id}|${consumer.ownerUserId}|${consumer.generation}|${consumer.optionsKey}`
      : null;
  }

  private invalidateNativeOwnership(): void {
    this.providerGeneration += 1;
    this.inFlightToken = null;
    this.activeIdentity = null;
    if (this.handle) {
      try { this.handle.remove(); } catch { /* native teardown is best effort */ }
      this.handle = null;
    }
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.watchdogTimer) {
      this.clearTimer(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.retryScheduledAtMs = null;
    this.watchdogScheduledAtMs = null;
  }

  private async reconcile(): Promise<void> {
    const desired = this.effectiveConsumer();
    const desiredIdentity = this.identity(desired);
    if (desiredIdentity && desiredIdentity === this.activeIdentity && (this.handle || this.inFlightToken != null)) {
      this.publish();
      return;
    }
    this.invalidateNativeOwnership();
    this.retryAttempt = 0;
    this.recoverableError = null;
    this.terminalError = null;
    this.publish();
    if (desired) await this.startDesired(desiredIdentity!);
  }

  private async startDesired(expectedIdentity: string): Promise<void> {
    const desired = this.effectiveConsumer();
    if (!desired || this.identity(desired) !== expectedIdentity) return;
    const token = ++this.providerGeneration;
    this.inFlightToken = token;
    this.activeIdentity = expectedIdentity;
    this.terminalError = null;
    this.recoverableError = null;
    let failedBeforeResolution = false;
    let callbackObserved = false;
    this.publish();
    const terminal = (error: unknown) => {
      if (token !== this.providerGeneration || this.activeIdentity !== expectedIdentity) return;
      failedBeforeResolution = true;
      // Fence the failed generation before notifying consumers or scheduling
      // retry. Delayed callbacks and a late start resolution are now inert.
      this.providerGeneration += 1;
      this.terminalError = errorCode(error);
      this.recoverableError = this.isTerminalWithoutRetry(error) ? null : this.terminalError;
      this.inFlightToken = null;
      this.activeIdentity = null;
      if (this.watchdogTimer) {
        this.clearTimer(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.watchdogScheduledAtMs = null;
      if (this.handle) {
        try { this.handle.remove(); } catch { /* best effort */ }
        this.handle = null;
      }
      desired.onTerminalError?.(error);
      this.publish();
      if (!this.isTerminalWithoutRetry(error)) this.scheduleRetry(expectedIdentity);
    };
    try {
      const handle = await this.startStream(
        desired.options,
        (observation, observationTimestampMs) => {
          if (token !== this.providerGeneration || this.activeIdentity !== expectedIdentity) return;
          const live = this.effectiveConsumer();
          if (!live || this.identity(live) !== expectedIdentity) return;
          const receiptMs = this.now();
          callbackObserved = true;
          this.lastCallbackReceiptMs = receiptMs;
          const fresh = this.lastObservationTimestampMs == null
            || observationTimestampMs > this.lastObservationTimestampMs;
          if (fresh) {
            this.lastObservationTimestampMs = observationTimestampMs;
            this.lastFreshObservationReceiptMs = receiptMs;
            // A native handle is not recovery evidence. A fresh observation is.
            this.retryAttempt = 0;
            this.retryScheduledAtMs = null;
            this.recoverableError = null;
            this.terminalError = null;
          }
          this.armWatchdog(token, expectedIdentity, terminal, this.callbackSilenceMs);
          this.publish();
          Promise.resolve(live.onObservation({ observation, observationTimestampMs }))
            .catch(() => undefined)
            .finally(() => {
              if (token !== this.providerGeneration || this.activeIdentity !== expectedIdentity) return;
              this.lastProcessingCompletedMs = this.now();
              this.publish();
            });
        },
        terminal,
      );
      if (token !== this.providerGeneration || this.activeIdentity !== expectedIdentity || failedBeforeResolution) {
        try { handle.remove(); } catch { /* late obsolete start */ }
        return;
      }
      this.handle = handle;
      this.inFlightToken = null;
      this.retryScheduledAtMs = null;
      this.armWatchdog(
        token,
        expectedIdentity,
        terminal,
        callbackObserved ? this.callbackSilenceMs : this.startupSilenceMs,
      );
      this.publish();
    } catch (error) {
      terminal(error);
    }
  }

  private armWatchdog(
    token: number,
    expectedIdentity: string,
    terminal: (error: unknown) => void,
    delayMs: number,
  ): void {
    if (this.watchdogTimer) this.clearTimer(this.watchdogTimer);
    this.watchdogScheduledAtMs = this.now() + delayMs;
    this.watchdogTimer = this.setTimer(() => {
      this.watchdogTimer = null;
      this.watchdogScheduledAtMs = null;
      if (token !== this.providerGeneration || this.activeIdentity !== expectedIdentity) return;
      terminal(new Error('provider-silent-stream'));
    }, delayMs);
  }

  private scheduleRetry(expectedIdentity: string): void {
    if (this.retryTimer || !this.effectiveConsumer()) return;
    const delay = this.retryDelaysMs[Math.min(this.retryAttempt, this.retryDelaysMs.length - 1)];
    this.retryAttempt += 1;
    this.retryScheduledAtMs = this.now() + delay;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.retryScheduledAtMs = null;
      if (this.identity(this.effectiveConsumer()) !== expectedIdentity) return;
      void this.startDesired(expectedIdentity);
    }, delay);
    this.publish();
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const consumer of this.consumers.values()) consumer.onState?.(snapshot);
  }
}
