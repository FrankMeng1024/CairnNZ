import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(appRoot, 'src/services/accountLocalData.ts'), 'utf8');

describe('deleted-account local ownership isolation', () => {
  test('purge requires an exact owner and removes every owner-scoped durable family', () => {
    expect(source).toContain('account_local_purge_owner_required');
    for (const authority of [
      'listPending()',
      'removePending(activity.localId, owner)',
      'listActiveHikes()',
      'discardActiveHike(activity.session_id)',
      'deleteExtras(routeId)',
      'clearSimulatorLogs(owner)',
      'debugLogger.clearAllSessions()',
      'deleteAcknowledgedHikeTrackArtifacts(activityId, owner)',
      'cairn_sessions_${owner}',
      'cairn_trackpoints_${owner}_',
      '@cairn:activity_registry:v1:${owner}',
      '@cairn:offline_markers:v2:${owner}',
      '@cairn:offline_routes:v1:${owner}',
      'cairn:memory:tiles:v5:${owner}',
      'cairn:memory:h3:v2:${owner}',
      'cairn_saf01_payload:${owner}',
      'cairn:plant:draft:v3:${owner}',
      '@cairn:offline_queue:v1',
      '@cairn:edit_session_active_v6_3',
      'cairn_friends',
      'cairn_last_crash',
      'cairn_boot_checkpoint_v1',
    ]) expect(source).toContain(authority);
  });

  test('an interrupted server-accepted deletion resumes before another account hydrates', () => {
    expect(source).toContain("const SCHEDULED_PURGE_KEY = '@cairn:account-deletion-local-purge:v1'");
    expect(source).toContain("const SECURE_SCHEDULED_PURGE_KEY = 'cairn_account_deletion_local_purge_v1'");
    expect(source).toContain('account_local_purge_schedule_failed');
    expect(source).toContain('scheduleDeletedAccountLocalPurge');
    expect(source).toContain('completeDeletedAccountLocalPurge');
    expect(source).toContain('resumeScheduledDeletedAccountLocalPurge');
  });

  test('precise last position and account hierarchy cache cannot leak to the next account', () => {
    expect(source).toContain("'cairn_last_fix_v1'");
    expect(source).toContain("key.startsWith('hierarchy:deepest:')");
    expect(source).toContain("key.startsWith('hierarchy:panel:')");
    expect(source).toContain('key.includes(`:${owner}:`)');
  });

  test('device preferences and internal build capability are deliberately not wiped', () => {
    expect(source).not.toContain("'cairn_settings'");
    expect(source).not.toContain('EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED');
  });
});
