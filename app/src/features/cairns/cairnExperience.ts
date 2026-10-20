import type { Marker, MarkerPermission } from '../../store/useMarkerStore';

/**
 * User-facing Cairn language lives here so the current working name can be
 * replaced without rebuilding the paper, map, or motion system.
 */
export const CAIRN_TERMS = {
  object: 'Cairn',
  objectPlural: 'Cairns',
  leaveTitle: 'Leave a Cairn',
  notePrompt: 'What would you leave here?',
  encounterTitle: 'A note was waiting here',
} as const;

export const CAIRN_MOTION = {
  leaveMs: 620,
  encounterMs: 760,
  openMs: 360,
  updateMs: 320,
  closeMs: 380,
  reducedMs: 120,
} as const;

export type CairnAudienceCopy = {
  label: string;
  shortLabel: string;
  action: string;
  summary: string;
};

export function cairnAudienceCopy(permission: MarkerPermission): CairnAudienceCopy {
  if (permission === 'group') {
    return {
      label: 'Friends',
      shortLabel: 'Friends',
      action: 'Leave for friends',
      summary: 'Friends can encounter this version only when they genuinely pass nearby. It is not a live-location broadcast.',
    };
  }
  if (permission === 'public') {
    return {
      label: 'Public',
      shortLabel: 'Public',
      action: 'Submit for review',
      summary: 'Requires useful text, an eligible completed Activity here, and review. Strangers see you anonymously; current friends may recognize you. Acquired copies can remain.',
    };
  }
  return {
    label: 'Only me',
    shortLabel: 'Only me',
    action: 'Save privately',
    summary: 'Saved to your own Memory and visible only to you.',
  };
}

export function publicCreationBlockReason(args: {
  permission: MarkerPermission;
  publicEnabled: boolean;
  activityLocation: boolean;
  hasUsefulText: boolean;
}): string | null {
  if (args.permission !== 'public') return null;
  if (!args.publicEnabled) return 'Public is not available for this account.';
  if (!args.activityLocation) return 'Public Cairns currently need an eligible Activity recorded at this place.';
  if (!args.hasUsefulText) return 'Add a useful note before submitting this version for review.';
  return null;
}

export type CairnPublicationTruthState =
  | 'local_saved'
  | 'syncing'
  | 'sync_failed'
  | 'waiting_activity'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'suspended'
  | 'withdrawn'
  | 'not_submitted'
  | 'unknown';

export type CairnPublicationTruth = {
  state: CairnPublicationTruthState;
  label: string;
  successTitle: string;
  explanation: string;
};

/** Shared publication truth for creation, owner detail and library. Unknown
 * is deliberately not collapsed into "submitted" or "in review". */
export function cairnPublicationTruth(marker: Pick<
  Marker,
  'permission' | 'synced' | 'syncState' | 'publicState' | 'publicSubmissionCode'
>): CairnPublicationTruth | null {
  if (marker.permission !== 'public') return null;
  if (marker.syncState === 'failed') return {
    state: 'sync_failed', label: 'Public · Sync needs attention', successTitle: 'Cairn saved on this iPhone',
    explanation: 'This version is saved locally, but it has not reached Public review. Open the Cairn to retry sync.',
  };
  if (marker.syncState === 'pending') return {
    state: 'syncing', label: 'Public · Waiting to sync', successTitle: 'Cairn saved on this iPhone',
    explanation: 'This version is saved locally and queued to sync. It has not been submitted for review yet.',
  };
  if (marker.synced !== true && marker.syncState !== 'synced') return {
    state: 'local_saved', label: 'Public · Saved locally', successTitle: 'Cairn saved on this iPhone',
    explanation: 'This version is saved locally. It has not been submitted for review yet.',
  };
  if (marker.publicSubmissionCode === 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED') return {
    state: 'waiting_activity', label: 'Public · Waiting for Activity', successTitle: 'Cairn saved',
    explanation: 'When its eligible source Activity finishes, this version can proceed to Public review automatically.',
  };
  if (marker.publicSubmissionCode === 'PUBLIC_TEXT_REQUIRED') return {
    state: 'not_submitted', label: 'Public · Useful text required', successTitle: 'Cairn saved privately',
    explanation: 'This Cairn is saved, but Public discovery needs useful text before it can be submitted.',
  };
  switch (marker.publicState) {
    case 'pending': return { state: 'pending_review', label: 'Public · In review', successTitle: 'Submitted for review', explanation: 'This exact version is waiting for moderation. It is not published yet.' };
    case 'published': return { state: 'published', label: 'Public · Published', successTitle: 'Cairn published', explanation: 'Qualified people nearby can discover this exact approved version.' };
    case 'rejected': return { state: 'rejected', label: 'Public · Not approved', successTitle: 'Cairn not published', explanation: 'This version was not approved for Public discovery. Your personal Cairn remains saved.' };
    case 'suspended': return { state: 'suspended', label: 'Public · Paused by review', successTitle: 'Public delivery paused', explanation: 'Public delivery of this version is paused. Your personal Cairn remains saved.' };
    case 'withdrawn': return { state: 'withdrawn', label: 'Public · Withdrawn', successTitle: 'Cairn withdrawn', explanation: 'This version is no longer available for new Public encounters. Your personal Cairn remains saved.' };
    case 'not_public': return { state: 'not_submitted', label: 'Public · Not submitted', successTitle: 'Cairn saved privately', explanation: 'This version is not in Public review or Public discovery.' };
    default: return { state: 'unknown', label: 'Public · Status unavailable', successTitle: 'Cairn saved', explanation: 'Cairn cannot confirm the Public status of this version yet. It is not being described as submitted or published.' };
  }
}
