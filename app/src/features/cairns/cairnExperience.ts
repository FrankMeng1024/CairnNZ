import type { MarkerPermission } from '../../store/useMarkerStore';

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
