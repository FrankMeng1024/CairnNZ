'use strict';

const crypto = require('crypto');
const { assignPresentationGroup } = require('./cairnDiscoveryCadence');

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: String(value.type || ''),
    text: String(value.text || ''),
    lat: Number(value.lat),
    lng: Number(value.lng),
    approximate: Boolean(value.approximate),
  })).digest('hex');
}

function audienceForPermission(permission) {
  if (permission === 'group') return 'friends';
  if (permission === 'public') return 'public';
  return 'personal';
}

async function ensureRevisionSnapshot(conn, snapshot) {
  const sourceAudience = snapshot.sourceAudience || audienceForPermission(snapshot.permission);
  const identityPolicy = sourceAudience === 'public' ? 'public_current' : 'friends_acquired';
  const sha256 = snapshot.contentSha256 || contentHash(snapshot);
  await conn.execute(
    `INSERT INTO cairn_revisions
       (marker_id,owner_id,content_revision,content_type,content_text,lat,lng,
        approximate,content_sha256,source_audience,audience_epoch,publication_id,
        publication_epoch,identity_policy,friend_author_name_snapshot)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [snapshot.markerId, snapshot.ownerId, snapshot.contentRevision,
      snapshot.type, snapshot.text ?? '', snapshot.lat, snapshot.lng,
      snapshot.approximate ? 1 : 0, sha256, sourceAudience,
      snapshot.audienceEpoch, snapshot.publicationId ?? null,
      snapshot.publicationEpoch ?? null, identityPolicy,
      sourceAudience === 'friends' ? String(snapshot.authorName || '').slice(0, 120) || null : null],
  );
  const [rows] = await conn.execute(
    `SELECT id,marker_id,owner_id,content_revision,source_audience,availability
       FROM cairn_revisions
      WHERE marker_id=? AND content_revision=? AND source_audience=? AND audience_epoch=?
      LIMIT 1`,
    [snapshot.markerId, snapshot.contentRevision, sourceAudience, snapshot.audienceEpoch],
  );
  return rows[0] || null;
}

async function captureCurrentMarkerRevision(conn, markerId, ownerId) {
  const [rows] = await conn.execute(
    `SELECT marker.id,marker.user_id,marker.type,marker.text,marker.lat,marker.lng,
            marker.approximate,marker.permission,marker.audience_epoch,
            marker.content_revision,user.name AS author_name
       FROM markers marker
       JOIN users user ON user.id=marker.user_id AND user.deleted_at IS NULL
      WHERE marker.id=? AND marker.user_id=? LIMIT 1`,
    [markerId, ownerId],
  );
  const marker = rows[0];
  if (!marker) return null;
  const revision = await ensureRevisionSnapshot(conn, {
    markerId: marker.id,
    ownerId: marker.user_id,
    contentRevision: marker.content_revision,
    type: marker.type,
    text: marker.text,
    lat: marker.lat,
    lng: marker.lng,
    approximate: marker.approximate,
    permission: marker.permission,
    audienceEpoch: marker.audience_epoch,
    authorName: marker.author_name,
  });
  await conn.execute(
    `INSERT INTO cairn_collections (viewer_id,marker_id,relationship)
     VALUES (?,?,'left')
     ON DUPLICATE KEY UPDATE relationship='left',removed_at=NULL`,
    [ownerId, markerId],
  );
  return revision;
}

async function capturePublicPublicationRevision(conn, publication) {
  return ensureRevisionSnapshot(conn, {
    markerId: publication.marker_id,
    ownerId: publication.owner_id || publication.author_id,
    contentRevision: publication.content_revision,
    type: publication.type || publication.snapshot_type,
    text: publication.text ?? publication.snapshot_text,
    lat: publication.lat ?? publication.snapshot_lat,
    lng: publication.lng ?? publication.snapshot_lng,
    approximate: publication.approximate ?? publication.snapshot_approximate,
    sourceAudience: 'public',
    audienceEpoch: publication.publication_epoch,
    publicationId: publication.publication_id || publication.id,
    publicationEpoch: publication.publication_epoch,
    contentSha256: publication.snapshot_sha256,
  });
}

async function acquireCairnRevision(conn, acquisition) {
  const [removedCollections] = await conn.execute(
    `SELECT removed_at FROM cairn_collections
      WHERE viewer_id=? AND marker_id=? LIMIT 1 FOR UPDATE`,
    [acquisition.viewerId, acquisition.markerId],
  );
  if (removedCollections[0]?.removed_at) {
    return { acquired: false, reason: 'collection_removed_by_viewer' };
  }
  const [sameVisit] = await conn.execute(
    `SELECT 1 FROM cairn_local_visit_acquisitions
      WHERE visit_id=? AND marker_id=? LIMIT 1`,
    [acquisition.visitId, acquisition.markerId],
  );
  if (sameVisit[0]) return { acquired: false, reason: 'marker_already_drawn_this_visit' };

  const [existing] = await conn.execute(
    `SELECT id FROM cairn_acquisitions
      WHERE viewer_id=? AND cairn_revision_id=? LIMIT 1`,
    [acquisition.viewerId, acquisition.revisionId],
  );
  if (existing[0]) return { acquired: false, reason: 'revision_already_acquired', acquisitionId: Number(existing[0].id) };

  const [insert] = await conn.execute(
    `INSERT IGNORE INTO cairn_acquisitions
       (viewer_id,marker_id,cairn_revision_id,acquired_via,evidence_kind,
        evidence_id,evidence_observed_at)
     VALUES (?,?,?,?,?,?,FROM_UNIXTIME(? / 1000))`,
    [acquisition.viewerId, acquisition.markerId, acquisition.revisionId,
      acquisition.via, acquisition.evidenceKind, acquisition.evidenceId,
      acquisition.evidenceObservedAtMs],
  );
  if (Number(insert.affectedRows) !== 1) {
    const [raced] = await conn.execute(
      `SELECT id FROM cairn_acquisitions
        WHERE viewer_id=? AND cairn_revision_id=? LIMIT 1`,
      [acquisition.viewerId, acquisition.revisionId],
    );
    return { acquired: false, reason: 'revision_already_acquired', acquisitionId: Number(raced[0]?.id) };
  }
  const acquisitionId = Number(insert.insertId);
  await conn.execute(
    `INSERT INTO cairn_local_visit_acquisitions (visit_id,acquisition_id,marker_id)
     VALUES (?,?,?)`,
    [acquisition.visitId, acquisitionId, acquisition.markerId],
  );
  await conn.execute(
    `INSERT INTO cairn_collections (viewer_id,marker_id,relationship)
     VALUES (?,?,'found')
     ON DUPLICATE KEY UPDATE relationship='found'`,
    [acquisition.viewerId, acquisition.markerId],
  );
  const presentationGroup = await assignPresentationGroup(
    conn,
    acquisition.viewerId,
    acquisitionId,
    acquisition.presentationGroupId ?? null,
  );
  return { acquired: true, acquisitionId, presentationGroup };
}

module.exports = {
  contentHash,
  audienceForPermission,
  ensureRevisionSnapshot,
  captureCurrentMarkerRevision,
  capturePublicPublicationRevision,
  acquireCairnRevision,
};
