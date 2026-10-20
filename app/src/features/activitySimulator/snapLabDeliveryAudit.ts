export interface SnapLabDeliveryEvent {
  ordinal: number;
  observationTimeMs: number;
  deliveryTimeMs: number;
  appState: string;
  duplicateOfProviderOrdinal?: number;
}

export interface SnapLabDeliveryAuthenticityIssue {
  kind: 'delivery-time-regression' | 'cross-callback-observation-regression';
  ordinal: number;
  observationTimeMs: number;
  deliveryTimeMs: number;
  previousDeliveryTimeMs: number;
  previousMaximumObservationTimeMs: number;
}

export interface SnapLabDeliveryAuthenticityAudit {
  model: string;
  callbackCount: number;
  eventCount: number;
  authenticForConfiguredNativeBatchModel: boolean;
  issues: SnapLabDeliveryAuthenticityIssue[];
}

/**
 * Frozen fixtures use one delivery timestamp as one native callback. The
 * installed Expo iOS consumer preserves callback order, and the Cairn
 * TaskManager handler sorts locations inside each callback by observation
 * time. A fixture that releases newer callbacks before an older held callback
 * therefore does not model that configured path and must not receive a native
 * batching grade.
 */
export function auditSnapLabDeliveryAuthenticity(
  events: SnapLabDeliveryEvent[],
  model: string,
): SnapLabDeliveryAuthenticityAudit {
  const issues: SnapLabDeliveryAuthenticityIssue[] = [];
  let previousDeliveryTimeMs = Number.NEGATIVE_INFINITY;
  let previousMaximumObservationTimeMs = Number.NEGATIVE_INFINITY;
  let callbackCount = 0;
  let currentDeliveryTimeMs = Number.NaN;
  let currentMaximumObservationTimeMs = Number.NEGATIVE_INFINITY;

  const closeCallback = () => {
    if (!Number.isFinite(currentDeliveryTimeMs)) return;
    previousDeliveryTimeMs = currentDeliveryTimeMs;
    previousMaximumObservationTimeMs = Math.max(
      previousMaximumObservationTimeMs,
      currentMaximumObservationTimeMs,
    );
  };

  for (const event of events) {
    if (event.deliveryTimeMs !== currentDeliveryTimeMs) {
      closeCallback();
      callbackCount += 1;
      currentDeliveryTimeMs = event.deliveryTimeMs;
      currentMaximumObservationTimeMs = Number.NEGATIVE_INFINITY;
      if (event.deliveryTimeMs < previousDeliveryTimeMs) {
        issues.push({
          kind: 'delivery-time-regression',
          ordinal: event.ordinal,
          observationTimeMs: event.observationTimeMs,
          deliveryTimeMs: event.deliveryTimeMs,
          previousDeliveryTimeMs,
          previousMaximumObservationTimeMs,
        });
      }
      if (event.observationTimeMs <= previousMaximumObservationTimeMs
        && event.duplicateOfProviderOrdinal == null) {
        issues.push({
          kind: 'cross-callback-observation-regression',
          ordinal: event.ordinal,
          observationTimeMs: event.observationTimeMs,
          deliveryTimeMs: event.deliveryTimeMs,
          previousDeliveryTimeMs,
          previousMaximumObservationTimeMs,
        });
      }
    }
    currentMaximumObservationTimeMs = Math.max(
      currentMaximumObservationTimeMs,
      event.observationTimeMs,
    );
  }
  closeCallback();
  return {
    model,
    callbackCount,
    eventCount: events.length,
    authenticForConfiguredNativeBatchModel: issues.length === 0,
    issues,
  };
}
