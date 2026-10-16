import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'FriendsScreen.tsx'),
  'utf8',
);
const qaSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'scripts', 'three-theme-phase-b2-friends-qa.mjs'),
  'utf8',
);

describe('Friends production proof contract', () => {
  it('uses the accepted functional copy and removes unverified social metrics', () => {
    expect(source).toContain("label: 'Requests'");
    expect(source).toContain('Received · {visibleIncoming.length}');
    expect(source).toContain('Sent · {visibleOutbound.length}');
    expect(source).toContain('Loading friends…');
    expect(source).toContain('Add someone by email to connect on CairnNZ.');
    expect(source).toContain('Enter a valid email address.');
    expect(source).toContain('No CairnNZ account uses that email yet.');
    expect(source).toContain('You can’t send a request to your own account.');
    expect(source).not.toContain('Paths that cross yours');
    expect(source).not.toContain('YOUR CIRCLE');
    expect(source).not.toContain('QUIETLY CONNECTED');
    expect(source).not.toContain('sharedFlags');
  });

  it('has one Add friend entry and the shared top-right dismiss control', () => {
    expect(source.match(/label="Add friend"/g)).toHaveLength(1);
    expect(source).toContain('testID="add-friend-close"');
    expect(source).toContain('right: Spacing.base');
    expect(source).not.toContain('style={s.f6Cancel}');
  });

  it('keeps removal inside Profile and reserves destructive styling for the final action', () => {
    expect(source).toContain('testID="friend-profile-remove-trigger"');
    expect(source).toContain('testID="friend-profile-remove-confirmation"');
    expect(source).toContain('testID="friend-profile-remove-region"');
    expect(source).toContain('label="Remove friend"');
    expect(source).toContain('variant="secondary"');
    expect(source).toContain('You’ll lose access to routes, cairns, and explored areas shared by this friend. Your own exploration won’t be affected.');
    expect(source.match(/label="Remove friend"/g)).toHaveLength(2);
    expect(source).not.toContain('label={`Remove ${firstNameOf(profileFriend.name)}`}');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('removeFriendAPI(profileFriend.id)');
    expect(source).toContain('<View style={s.profileRemoveShell} testID="friend-profile-remove-region">');
    expect(source).toMatch(/profileRemoveShell:\s*\{\s*marginTop: 0,\s*paddingTop: 0,/);
    expect(source).not.toContain('<ContentSurface\n              style={s.profileRemoveShell}');
    expect(source).not.toContain('Remove from your circle?');
    expect(source).not.toContain('label="Keep friend"');
  });

  it('silently discards stale block and unfriend completions after an account boundary', () => {
    expect(source.match(/if \(result\.superseded\) return;/g)).toHaveLength(3);
    expect(source).toMatch(/cancelOutboundRequest\(req\.id\);\s+if \(result\.superseded\) return;\s+setOutboundBusyId\(null\)/);
    expect(source).toMatch(/blockUser\(friendActionTarget\.id\);\s+if \(result\.superseded\) return;\s+setBlockBusy\(false\)/);
    expect(source).toMatch(/removeFriendAPI\(profileFriend\.id\);\s+if \(result\.superseded\) return;\s+setRemoveBusy\(false\)/);
  });

  it('closes Add friend without an artificial success delay and immediately shows the authoritative request', () => {
    expect(source).toContain('onRequestSent(r.request);\n      close();');
    expect(source).toContain('setOutbound(current => [request, ...current.filter(item => item.id !== request.id)]);');
    expect(source).toContain("setTab('pending');");
    expect(source).not.toContain('setTimeout(() => { setEmail');
    expect(source).not.toContain('}, 1600);');
  });

  it('uses tonal elevation rather than a full green block for Night Add friend', () => {
    expect(source).toContain("tint={theme.mode === 'night' ? theme.controlSelected : undefined}");
    expect(source).toContain("textColor={theme.mode === 'night' ? theme.textPrimary : undefined}");
    expect(source).not.toContain('withMaterialOpacity(theme.primaryAction');
    expect(source).toContain('renderIcon={(color) => <Icon name="Send"');
  });

  it('shows authenticated request emails and uses CairnNZ product dialogs', () => {
    expect(source).toContain('toEmail={r.toEmail}');
    expect(source).toContain('>{toEmail}</Text>');
    expect(source).toContain("{status === 'declined'");
    expect(source).toContain('? <Icon name="X"');
    expect(source).toContain('>Cancel request</Text>');
    expect(source).toContain('testID="cancel-request-modal"');
    expect(source).toContain('testID="cancel-request-confirm"');
    expect(source).toContain('body="They won’t receive this friend request."');
    expect(source).toContain("if (req.status === 'declined')");
    expect(source).toContain('void dismissDeclinedOutbound(req);');
    expect(source).not.toContain('Dismiss declined request from');
    expect(source).not.toContain('label={cancelRequestTarget.status');
    expect(source).not.toContain('label="Keep request"');
    expect(source).not.toContain('Alert.alert(');
    expect(source).not.toContain('window.confirm(');
  });

  it('uses only directional per-friend sharing controls', () => {
    expect(source).toContain('>Share my Memory</Text>');
    expect(source).toContain('testID="friend-profile-memory-toggle"');
    expect(source).toContain("grant.friend_id === profileFriend.id)?.enabled");
    expect(source).not.toContain('MemorySharingSheet');
    expect(source).not.toContain('Open shared content');
    expect(source).not.toContain('Protected Places');
    expect(source).not.toContain('Memory sharing is available');
    expect(source).not.toContain('No shared Memory layer');
    expect(source).not.toContain('encountered Cairns');
    expect(source).not.toContain('shared Routes');
    expect(source).not.toContain('fetchFriendProfileForNavigation');
  });

  it('keeps Decline left of Accept and preserves independent recipient consent', () => {
    expect(source.indexOf('accessibilityLabel="Decline friend request"'))
      .toBeLessThan(source.indexOf('accessibilityLabel="Accept friend request"'));
    expect(source).toContain('onPress={() => onAccept(shareMemory)}');
    expect(source).toContain('value={shareMemory}');
    expect(source).toContain('Will share their Memory');
  });

  it('renders only populated request categories and one destination-level empty state', () => {
    expect(source).toContain("const pendingEmpty = requestContentState === 'empty'");
    expect(source).toContain('{showReceived && (');
    expect(source).toContain('{showSent && (');
    expect(source).toContain('Received and sent requests will appear here.');
    expect(source).not.toContain('No received requests');
    expect(source).not.toContain('No sent requests');
  });

  it('keeps realistic multi-friend fixtures inside QA infrastructure only', () => {
    expect(qaSource).toContain("{ id: 18, name: 'Sofia Patel'");
    expect(qaSource).toContain("page.route('**/api/**'");
    expect(source).not.toContain('Sofia Patel');
    expect(source).not.toContain('Charlotte Ngata-Smith');
  });
});
