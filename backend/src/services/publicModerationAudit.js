'use strict';

const PUBLICATION_TRANSITIONS = Object.freeze({
  approve: Object.freeze({ from: ['pending'], to: 'published' }),
  reject: Object.freeze({ from: ['pending'], to: 'rejected' }),
  suspend: Object.freeze({ from: ['published'], to: 'suspended' }),
  restore: Object.freeze({ from: ['suspended'], to: 'published' }),
});

const REPORT_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['reviewed', 'dismissed', 'actioned']),
  reviewed: Object.freeze(['dismissed', 'actioned']),
  dismissed: Object.freeze([]),
  actioned: Object.freeze([]),
});

function resolvePublicationTransition(currentState, action, lastCommittedAction = null) {
  const transition = PUBLICATION_TRANSITIONS[action];
  if (!transition) return { allowed: false, idempotent: false, nextState: null };
  // A shared target state is not proof that this action already committed:
  // both approve and restore end at "published". Only the durable audit
  // action can authorize an idempotent replay of an otherwise-invalid edge.
  if (currentState === transition.to) {
    const idempotent = lastCommittedAction === action;
    return { allowed: idempotent, idempotent, nextState: transition.to };
  }
  return {
    allowed: transition.from.includes(currentState),
    idempotent: false,
    nextState: transition.to,
  };
}

function resolveReportTransition(currentState, nextState) {
  if (!Object.prototype.hasOwnProperty.call(REPORT_TRANSITIONS, currentState)) {
    return { allowed: false, idempotent: false, nextState: null };
  }
  if (currentState === nextState) return { allowed: true, idempotent: true, nextState };
  return {
    allowed: REPORT_TRANSITIONS[currentState].includes(nextState),
    idempotent: false,
    nextState,
  };
}

async function appendPublicModerationAudit(conn, event) {
  if (!/^[a-z][a-z0-9_]{2,47}$/.test(String(event.eventType || ''))) {
    throw new Error('public_audit_event_type_invalid');
  }
  let metadata = null;
  if (event.metadata != null) {
    const objectMetadata = typeof event.metadata === 'object'
      && !Array.isArray(event.metadata);
    const keys = objectMetadata ? Object.keys(event.metadata).sort() : [];
    const decisionMetadata = event.eventType === 'publication_decision'
      && keys.join(',') === 'action'
      && ['approve', 'reject', 'suspend', 'restore'].includes(event.metadata.action);
    const resnapshotMetadata = event.eventType === 'publication_policy_resnapshotted'
      && keys.join(',') === [
        'locationPolicyVersion',
        'previousPolicyVersion',
        'previousPublicationId',
        'previousSnapshotSha256',
        'snapshotSha256',
      ].join(',')
      && /^[1-9]\d*$/.test(String(event.metadata.previousPublicationId || ''))
      && /^[a-f0-9]{64}$/.test(String(event.metadata.previousSnapshotSha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(event.metadata.snapshotSha256 || ''))
      && /^grid-20m\+deny-circles-v1:sha256:[a-f0-9]{64}$/.test(String(event.metadata.previousPolicyVersion || ''))
      && /^grid-20m\+deny-circles-v1:sha256:[a-f0-9]{64}$/.test(String(event.metadata.locationPolicyVersion || ''));
    if (!objectMetadata || (!decisionMetadata && !resnapshotMetadata)) {
      throw new Error('public_audit_metadata_invalid');
    }
    // The ledger survives subject deletion. Its metadata is intentionally a
    // tiny enum-only schema so content, coordinates, tokens, or request bodies
    // can never be copied into that durable surface by a future caller.
    metadata = decisionMetadata
      ? JSON.stringify({ action: event.metadata.action })
      : JSON.stringify({
        previousPublicationId: String(event.metadata.previousPublicationId),
        previousPolicyVersion: event.metadata.previousPolicyVersion,
        locationPolicyVersion: event.metadata.locationPolicyVersion,
        previousSnapshotSha256: event.metadata.previousSnapshotSha256,
        snapshotSha256: event.metadata.snapshotSha256,
      });
  }
  const [result] = await conn.execute(
    `INSERT INTO public_cairn_moderation_audit
       (event_type,actor_user_id,owner_user_id,marker_id,publication_id,report_id,
        publication_epoch,content_revision,from_state,to_state,reason,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [event.eventType, event.actorUserId ?? null, event.ownerUserId ?? null,
      event.markerId ?? null, event.publicationId ?? null, event.reportId ?? null,
      event.publicationEpoch ?? null, event.contentRevision ?? null,
      event.fromState ?? null, event.toState ?? null,
      event.reason ? String(event.reason).slice(0, 240) : null, metadata],
  );
  return String(result.insertId);
}

module.exports = {
  resolvePublicationTransition,
  resolveReportTransition,
  appendPublicModerationAudit,
};
