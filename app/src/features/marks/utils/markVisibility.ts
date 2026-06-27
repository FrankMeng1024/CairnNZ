/**
 * markVisibility.ts — Friend System v1 / Sprint 68 / STORY-00532
 *
 * Iron law 1 from v4 plan §3:
 *
 *   visible(mark) =
 *     in_my_fog(mark)
 *     OR (
 *       in_subscribed_friend_fog(mark)
 *       AND visibility_grants_me(mark)
 *     )
 *
 *   visibility_grants_me(mark):
 *     personal → owner == me
 *     friend   → owner is my friend
 *     public   → always
 *
 * Pure function — no React, no IO. Caller threads in the fog membership
 * predicate `inMyFog` (computed by FogLayer / useMemoryStore.isExplored)
 * and the subscribed-friend set.
 *
 * For Sprint 68 client-side use, the "in_subscribed_friend_fog" check
 * collapses to "is the mark from a subscribed friend?" because Sprint 67
 * `GET /api/circle/markers` already filtered the wire to subscribed-friend
 * marks (LEFT JOIN hidden_items, permission IN (friend, group, public)).
 * Client just needs to verify the row's `user_id` is in friendIds AND the
 * mark's permission is one the viewer is allowed to see.
 */

import type { MarkerPermission } from '../../../store/useMarkerStore';

interface VisibleInput {
  viewerId: string | number | null;
  markUserId: string | number;
  markLat: number;
  markLng: number;
  permission: MarkerPermission | string | null | undefined;
  /** Predicate: has the viewer's own fog covered this coordinate? */
  inMyFog: (lat: number, lng: number) => boolean;
  /** Subscribed-friend ids (the 5-pick set, not all friends). */
  subscribedFriendIds: ReadonlyArray<string | number>;
  /** All friends (subset of which is the subscribed set). */
  friendIds: ReadonlyArray<string | number>;
}

export interface VisibilityResult {
  visible: boolean;
  /** True only if visibility holds AND viewer's own fog covers the coord.
   *  Drives iron law 2 (can_like_report) and Detail Sheet form B vs C. */
  inMyFog: boolean;
  /** True only if visibility holds via a subscribed-friend's fog (not the
   *  viewer's own). Mutually exclusive with inMyFog when the viewer has
   *  not walked the location themselves. */
  viaSubscribedFriend: boolean;
}

/**
 * Compute visibility + sub-status fields. Caller (Detail Sheet) maps the
 * result to one of the 4 forms (A/B/C/D) defined in v4 §4.11:
 *   - self mark  + visible       → form A
 *   - other mark + visible + inMyFog → form B (visited)
 *   - other mark + visible + via subscribed friend (not visited) → form C
 *   - !visible (far + outside fog)  → form D (no sheet)
 */
export function getMarkVisibility(input: VisibleInput): VisibilityResult {
  const viewerStr = input.viewerId == null ? '' : String(input.viewerId);
  const markStr = String(input.markUserId);
  const isMine = viewerStr !== '' && viewerStr === markStr;
  const myFogHit = input.inMyFog(input.markLat, input.markLng);

  // Own marks: always visible to self regardless of fog. Form A.
  if (isMine) {
    return { visible: true, inMyFog: myFogHit, viaSubscribedFriend: false };
  }

  // Permission gate for non-self.
  const perm = input.permission ?? '';
  const friendSet = new Set(input.friendIds.map(String));
  const subSet = new Set(input.subscribedFriendIds.map(String));
  const isFriend = friendSet.has(markStr);

  // visibility_grants_me():
  //   personal → owner == me (already returned above; non-self personal = denied)
  //   friend   → owner is my friend
  //   public   → always
  let permissionGrants: boolean;
  if (perm === 'personal') permissionGrants = false;
  else if (perm === 'friend' || perm === 'group') permissionGrants = isFriend;
  else if (perm === 'public') permissionGrants = true;
  else permissionGrants = false; // unknown permission = deny

  if (!permissionGrants) {
    return { visible: false, inMyFog: false, viaSubscribedFriend: false };
  }

  // visible if EITHER my fog hits the coord OR the mark belongs to a
  // subscribed friend (then I see it via their fog UNION — see
  // Sprint 67 STORY-00528 GET /api/circle/markers; if the mark came
  // back from that endpoint, the friend's fog membership is implied).
  if (myFogHit) {
    return { visible: true, inMyFog: true, viaSubscribedFriend: false };
  }
  const viaSub = subSet.has(markStr);
  if (viaSub) {
    return { visible: true, inMyFog: false, viaSubscribedFriend: true };
  }

  // permission granted but neither inMyFog nor via subscribed friend →
  // Public mark of a stranger, viewable only if the bbox query picked it
  // up. For Detail Sheet purposes treat as visible-stranger (form D-ish
  // — but caller of getMarkVisibility for stranger publics typically
  // skips the sheet entirely; the map render shows them as dim icons).
  if (perm === 'public') {
    return { visible: true, inMyFog: false, viaSubscribedFriend: false };
  }
  return { visible: false, inMyFog: false, viaSubscribedFriend: false };
}

export type MarkDetailForm = 'A' | 'B' | 'C' | 'D';

/**
 * Map visibility result + ownership to one of 4 sheet forms.
 * D means "do not show a sheet" (the caller should suppress the tap).
 */
export function getMarkDetailForm(args: {
  isMine: boolean;
  vis: VisibilityResult;
}): MarkDetailForm {
  if (!args.vis.visible) return 'D';
  if (args.isMine) return 'A';
  if (args.vis.inMyFog) return 'B';
  if (args.vis.viaSubscribedFriend) return 'C';
  // Visible stranger public mark, viewer has not walked there.
  // v4 §3 matrix row 4 (远观模糊) → form D semantics (no sheet) when
  // outside fog. Treat as D.
  return 'D';
}
