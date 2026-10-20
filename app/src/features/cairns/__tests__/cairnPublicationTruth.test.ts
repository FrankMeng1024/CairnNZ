import { cairnPublicationTruth } from '../cairnExperience';

describe('Cairn publication truth', () => {
  const publicMarker = { permission: 'public' as const, synced: true, syncState: 'synced' as const };

  test.each([
    [{ permission: 'public' as const, synced: false, syncState: 'failed' as const }, 'sync_failed'],
    [{ permission: 'public' as const, synced: false, syncState: 'pending' as const }, 'syncing'],
    [{ permission: 'public' as const, synced: false }, 'local_saved'],
    [{ ...publicMarker, publicSubmissionCode: 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED' }, 'waiting_activity'],
    [{ ...publicMarker, publicSubmissionCode: 'PUBLIC_TEXT_REQUIRED' }, 'not_submitted'],
    [{ ...publicMarker, publicState: 'pending' as const }, 'pending_review'],
    [{ ...publicMarker, publicState: 'published' as const }, 'published'],
    [{ ...publicMarker, publicState: 'rejected' as const }, 'rejected'],
    [{ ...publicMarker, publicState: 'suspended' as const }, 'suspended'],
    [{ ...publicMarker, publicState: 'withdrawn' as const }, 'withdrawn'],
    [{ ...publicMarker, publicState: 'not_public' as const }, 'not_submitted'],
    [{ ...publicMarker }, 'unknown'],
  ])('reports exact state %# without inventing submission', (marker, expected) => {
    const truth = cairnPublicationTruth(marker);
    expect(truth?.state).toBe(expected);
    if (['local_saved', 'syncing', 'sync_failed', 'waiting_activity', 'not_submitted', 'unknown'].includes(expected)) {
      expect(truth?.successTitle.toLowerCase()).not.toContain('submitted for review');
      if (truth?.explanation.toLowerCase().includes('submitted for review')) {
        expect(truth.explanation.toLowerCase()).toContain('not been submitted for review');
      }
    }
  });

  test('non-Public Cairns have no publication claim', () => {
    expect(cairnPublicationTruth({ permission: 'group', synced: true })).toBeNull();
  });
});
