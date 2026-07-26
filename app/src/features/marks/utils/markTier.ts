/**
 * markTier.ts — Friend System v1 / Sprint 68 / STORY-00531
 *
 * Pure functions for computing the visual tier of a marker from the
 * viewer's perspective. Reused by:
 *   - Map render (assigns ring color / desaturation in MapScreen, HikingScreen)
 *   - Detail Sheet header (Story-532, picks form A vs B/C)
 *   - Trails Flags Mine|Friends filter (F3 Sprint 69)
 *
 * Three tiers per v4 plan §3 visibility rules:
 *   - self      → viewer === mark.user_id
 *   - friend    → viewer != mark.user_id AND mark.user_id ∈ friendIds AND
 *                  permission ∈ ('friend', 'group')
 *   - stranger  → everything else that's visible (mark.permission === 'public'
 *                  from someone not in friendIds)
 *
 * Note on legacy 'group' = 'friend': backend markers.permission ENUM is
 * ('personal','group','public'); the 'friend' tier is represented as 'group'
 * at the DB layer. The /api/circle/markers endpoint already normalizes
 * 'group' → 'friend' on the wire (Sprint 67 STORY-00528 + permission.js),
 * but local-store markers may still carry 'group'. Accept both.
 */

/** Tier-color palette curated to match Cairn sepia tokens. 8 stable colors
 *  cycled deterministically via FNV-1a hash on user_id. Each color is high
 *  enough contrast to read on the cream map background AND visually distinct
 *  from neighbors. Order chosen so that small friend groups (≤3) avoid
 *  near-duplicates. */
const FRIEND_RING_PALETTE = [
  '#c87941', // warm brown (matches Cairn flag)
  '#5d7c46', // primary sage
  '#3d7ab5', // running blue
  '#b36b00', // amber
  '#7a4fcf', // muted purple
  '#2e8c3a', // success green
  '#c53d2e', // danger red (used only when other 6 taken)
  '#8c5a3a', // espresso brown
] as const;

type MarkerTier = 'self' | 'friend' | 'stranger';

interface TierInput {
  viewerId: string | number | null;
  markUserId: string | number;
  permission: string | null | undefined;
  friendIds: ReadonlyArray<string | number>;
}

/**
 * FNV-1a 32-bit hash. Stable, fast, no deps.
 * Used to pick a deterministic palette index for a given user_id.
 */
function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Returns one of FRIEND_RING_PALETTE deterministically. */
function colorFromUserId(userId: string | number): string {
  const idx = fnv1aHash(String(userId)) % FRIEND_RING_PALETTE.length;
  return FRIEND_RING_PALETTE[idx];
}

/**
 * Compute the visual tier of a mark from a viewer's perspective.
 * Pure function — same inputs always produce same output. Callers may
 * memoize at the list-render level.
 *
 * Tier semantics drive visual treatment in MapScreen (Story-531) and the
 * Detail Sheet form selection (Story-532). The function does NOT decide
 * visibility (use a separate visible() function for that, since visibility
 * also depends on fog coverage which lives outside this module).
 */
function getMarkerTier({
  viewerId,
  markUserId,
  permission,
  friendIds,
}: TierInput): MarkerTier {
  // Coerce both sides to string to avoid string-vs-number ID drift between
  // local-only marks (string ids from generateId()) and synced marks
  // (numeric ids from backend insertId).
  const vId = viewerId == null ? '' : String(viewerId);
  const mId = String(markUserId);
  if (vId !== '' && vId === mId) return 'self';

  const friendSet = new Set(friendIds.map(String));
  const isFriend = friendSet.has(mId);
  const perm = permission ?? '';
  const isFriendTier = perm === 'friend' || perm === 'group';
  if (isFriend && isFriendTier) return 'friend';

  // Everything else that reaches this function is treated as stranger.
  // (visible() should have filtered out personal-from-friend and
  // far-outside-fog before tier computation.)
  return 'stranger';
}

/** Combined helper: returns tier + ring color in one call. */
export function getMarkerTierVisuals(input: TierInput): {
  tier: MarkerTier;
  ringColor: string | null;
  opacity: number;
} {
  const tier = getMarkerTier(input);
  switch (tier) {
    case 'self':
      return { tier, ringColor: null, opacity: 1 };
    case 'friend':
      return { tier, ringColor: colorFromUserId(input.markUserId), opacity: 1 };
    case 'stranger':
      return { tier, ringColor: null, opacity: 0.6 };
  }
}
