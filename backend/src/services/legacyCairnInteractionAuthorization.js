'use strict';

const { qaFixtureEligibleSql } = require('./qaFixtureEligibility');

/**
 * The legacy marker vote surface predates retained Cairn revisions. A marker
 * id is never authority: a non-owner may use this compatibility path only
 * when this account retained the marker's exact current Friends revision.
 *
 * Friendship is deliberately not re-required. Revocation stops new
 * encounters, but does not erase a legitimately acquired historical copy.
 * A later author edit advances content_revision and therefore closes this
 * legacy path until that exact new revision is independently acquired.
 */
async function authorizedLegacyGroupInteraction(
  db,
  { viewerId, markerId, ownerId, contentRevision },
) {
  const [rows] = await db.execute(
    `SELECT acquisition.id,revision.id AS cairn_revision_id,
            revision.content_revision
       FROM cairn_acquisitions acquisition
       JOIN cairn_revisions revision
         ON revision.id=acquisition.cairn_revision_id
       JOIN cairn_collections collection
         ON collection.viewer_id=acquisition.viewer_id
        AND collection.marker_id=acquisition.marker_id
        AND collection.relationship='found'
       JOIN users owner
         ON owner.id=revision.owner_id AND owner.deleted_at IS NULL
       LEFT JOIN cairn_source_moderation moderation
         ON moderation.marker_id=revision.marker_id
       LEFT JOIN hidden_items hidden
         ON hidden.user_id=acquisition.viewer_id
        AND hidden.item_type='mark' AND hidden.item_id=acquisition.marker_id
      WHERE acquisition.viewer_id=? AND acquisition.marker_id=?
        AND revision.owner_id=? AND revision.content_revision=?
        AND revision.source_audience='friends'
        AND acquisition.acquired_via='friends'
        AND acquisition.removed_at IS NULL
        AND collection.removed_at IS NULL
        AND hidden.user_id IS NULL
        AND revision.availability='available'
        AND COALESCE(moderation.state,'available')='available'
        AND ${qaFixtureEligibleSql('revision.marker_id', 'acquisition.viewer_id')}
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users block
           WHERE (block.blocker_id=acquisition.viewer_id AND block.blocked_id=revision.owner_id)
              OR (block.blocker_id=revision.owner_id AND block.blocked_id=acquisition.viewer_id)
        )
      LIMIT 1`,
    [viewerId, markerId, ownerId, contentRevision],
  );
  return rows[0] || null;
}

module.exports = { authorizedLegacyGroupInteraction };
