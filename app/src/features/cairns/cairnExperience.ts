import type { Marker, MarkerPermission } from '../../store/useMarkerStore';
import { cairnText } from '../../i18n/runtime';

/**
 * User-facing Cairn language lives here so the current working name can be
 * replaced without rebuilding the paper, map, or motion system.
 */
export const CAIRN_TERMS = {
  object: 'Cairn',
  objectPlural: 'Cairns',
  get leaveTitle() { return cairnText('cairns.cairn-experience.leave-a-cairn'); },
  get notePrompt() { return cairnText('cairns.cairn-experience.what-would-you-leave-here'); },
  get encounterTitle() { return cairnText('cairns.cairn-experience.a-note-was-waiting-here'); },
} as const;

export const CAIRN_MOTION = {
  leaveMs: 620,
  encounterMs: 760,
  openMs: 360,
  updateMs: 360,
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
      label: cairnText('cairns.cairn-experience.friends'),
      shortLabel: cairnText('cairns.cairn-experience.friends-1c861a2'),
      action: cairnText('cairns.cairn-experience.leave-for-friends'),
      summary: cairnText('cairns.cairn-experience.friends-can-encounter-this-version-only-when'),
    };
  }
  if (permission === 'public') {
    return {
      label: cairnText('cairns.cairn-experience.public'),
      shortLabel: cairnText('cairns.cairn-experience.public-b8be570'),
      action: cairnText('cairns.cairn-experience.submit-for-review'),
      summary: cairnText('cairns.cairn-experience.requires-useful-text-an-eligible-completed-activity'),
    };
  }
  return {
    label: cairnText('cairns.cairn-experience.only-me'),
    shortLabel: cairnText('cairns.cairn-experience.only-me-e541b24'),
    action: cairnText('cairns.cairn-experience.save-privately'),
    summary: cairnText('cairns.cairn-experience.saved-to-your-own-memory-and-visible'),
  };
}

export function publicCreationBlockReason(args: {
  permission: MarkerPermission;
  publicEnabled: boolean;
  activityLocation: boolean;
  hasUsefulText: boolean;
}): string | null {
  if (args.permission !== 'public') return null;
  if (!args.publicEnabled) return cairnText('cairns.cairn-experience.public-is-not-available-for-this-account');
  if (!args.activityLocation) return cairnText('cairns.cairn-experience.public-cairns-currently-need-an-eligible-activity');
  if (!args.hasUsefulText) return cairnText('cairns.cairn-experience.add-a-useful-note-before-submitting-this');
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
  'permission' | 'synced' | 'syncState' | 'publicState' | 'publicSubmissionCode' | 'originActivityClientId'
>): CairnPublicationTruth | null {
  if (marker.permission !== 'public') return null;
  if (marker.syncState === 'failed') return {
    state: 'sync_failed', label: cairnText('cairns.cairn-experience.public-sync-needs-attention'), successTitle: cairnText('cairns.cairn-experience.cairn-saved-on-this-iphone'),
    explanation: cairnText('cairns.cairn-experience.this-version-is-saved-locally-but-it'),
  };
  if (marker.syncState === 'pending') return {
    state: 'syncing', label: cairnText('cairns.cairn-experience.public-waiting-to-sync'), successTitle: cairnText('cairns.cairn-experience.cairn-saved-on-this-iphone'),
    explanation: cairnText('cairns.cairn-experience.this-version-is-saved-locally-and-queued'),
  };
  if (marker.synced !== true && marker.syncState !== 'synced') return {
    state: 'local_saved', label: cairnText('cairns.cairn-experience.public-saved-locally'), successTitle: cairnText('cairns.cairn-experience.cairn-saved-on-this-iphone'),
    explanation: cairnText('cairns.cairn-experience.this-version-is-saved-locally-it-has'),
  };
  if (marker.publicSubmissionCode === 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED') return {
    state: 'waiting_activity',
    label: marker.originActivityClientId ? cairnText('cairns.cairn-experience.public-activity-not-confirmed') : cairnText('cairns.cairn-experience.public-activity-required'),
    successTitle: cairnText('cairns.cairn-experience.cairn-saved'),
    explanation: marker.originActivityClientId
      ? 'The linked Activity is not yet confirmed as eligible. This version is not in review or Public discovery; it can proceed only after the server confirms a completed eligible Activity.'
      : 'This Cairn has no Activity source, so this version cannot enter Public review. Choose another audience, or leave a new Public Cairn from an eligible Activity.',
  };
  if (marker.publicSubmissionCode === 'PUBLIC_TEXT_REQUIRED') return {
    state: 'not_submitted', label: cairnText('cairns.cairn-experience.public-useful-text-required'), successTitle: cairnText('cairns.cairn-experience.cairn-saved-privately'),
    explanation: cairnText('cairns.cairn-experience.this-cairn-is-saved-but-public-discovery'),
  };
  switch (marker.publicState) {
    case 'pending': return { state: 'pending_review', label: cairnText('cairns.cairn-experience.public-in-review'), successTitle: cairnText('cairns.cairn-experience.submitted-for-review'), explanation: cairnText('cairns.cairn-experience.this-exact-version-is-waiting-for-moderation') };
    case 'published': return { state: 'published', label: cairnText('cairns.cairn-experience.public-published'), successTitle: cairnText('cairns.cairn-experience.cairn-published'), explanation: cairnText('cairns.cairn-experience.qualified-people-nearby-can-discover-this-exact') };
    case 'rejected': return { state: 'rejected', label: cairnText('cairns.cairn-experience.public-not-approved'), successTitle: cairnText('cairns.cairn-experience.cairn-not-published'), explanation: cairnText('cairns.cairn-experience.this-version-was-not-approved-for-public') };
    case 'suspended': return { state: 'suspended', label: cairnText('cairns.cairn-experience.public-paused-by-review'), successTitle: cairnText('cairns.cairn-experience.public-delivery-paused'), explanation: cairnText('cairns.cairn-experience.public-delivery-of-this-version-is-paused') };
    case 'withdrawn': return { state: 'withdrawn', label: cairnText('cairns.cairn-experience.public-withdrawn'), successTitle: cairnText('cairns.cairn-experience.cairn-withdrawn'), explanation: cairnText('cairns.cairn-experience.this-version-is-no-longer-available-for') };
    case 'not_public': return { state: 'not_submitted', label: cairnText('cairns.cairn-experience.public-not-submitted'), successTitle: cairnText('cairns.cairn-experience.cairn-saved-privately'), explanation: cairnText('cairns.cairn-experience.this-version-is-not-in-public-review') };
    default: return { state: 'unknown', label: cairnText('cairns.cairn-experience.public-status-unavailable'), successTitle: cairnText('cairns.cairn-experience.cairn-saved'), explanation: cairnText('cairns.cairn-experience.cairn-cannot-confirm-the-public-status-of') };
  }
}
