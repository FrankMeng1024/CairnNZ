export type FriendMemoryFailure = 'offline' | 'unavailable' | 'unauthorized';

export type MemoryOperationFailureKind =
  | 'transport'
  | 'timeout'
  | 'http'
  | 'authentication'
  | 'authorization'
  | 'payload'
  | 'cancelled'
  | 'render-readiness';

export interface MemoryOperationFailure {
  kind: MemoryOperationFailureKind;
  operation: string;
  stage: string;
  httpStatus?: number;
  causeCode: string;
  message: string;
  targetRevision?: string;
  occurredAtMs: number;
}

export function memoryOperationFailure(input: {
  error?: unknown;
  httpStatus?: number;
  operation: string;
  stage: string;
  targetRevision?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  invalidPayload?: boolean;
  renderReadiness?: boolean;
  causeCode?: string;
}): MemoryOperationFailure {
  const error = input.error as any;
  const httpStatus = Number.isFinite(input.httpStatus) ? Number(input.httpStatus) : undefined;
  const syntaxFailure = error instanceof SyntaxError || error?.name === 'SyntaxError';
  const kind: MemoryOperationFailureKind = input.cancelled
    ? 'cancelled'
    : input.timedOut
      ? 'timeout'
      : input.renderReadiness
        ? 'render-readiness'
        : input.invalidPayload || syntaxFailure || httpStatus === 200
          ? 'payload'
          : httpStatus === 401
            ? 'authentication'
            : httpStatus === 403
              ? 'authorization'
              : httpStatus !== undefined
                ? 'http'
                : 'transport';
  return {
    kind,
    operation: input.operation,
    stage: input.stage,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    causeCode: input.causeCode
      ?? (typeof error?.code === 'string' ? error.code : undefined)
      ?? (typeof error?.name === 'string' ? error.name : undefined)
      ?? kind,
    message: String(error?.message ?? error ?? kind).slice(0, 240),
    ...(input.targetRevision ? { targetRevision: input.targetRevision } : {}),
    occurredAtMs: Date.now(),
  };
}

export function friendMemoryPresentationFailure(
  failure: MemoryOperationFailure,
): FriendMemoryFailure {
  if (failure.kind === 'authentication' || failure.kind === 'authorization') return 'unauthorized';
  if (failure.kind === 'transport' || failure.kind === 'timeout') return 'offline';
  return 'unavailable';
}

export function classifyFriendMemoryFailure(input: {
  httpStatus?: number;
  timedOut?: boolean;
}): FriendMemoryFailure {
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'unauthorized';
  if (Number.isFinite(input.httpStatus)) return 'unavailable';
  return 'offline';
}
