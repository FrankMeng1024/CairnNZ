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
    expect(source).toContain('Received · {incoming.length}');
    expect(source).toContain('Sent · {outbound.length}');
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
    expect(source).toMatch(/profileRemoveShell:\s*\{\s*marginTop: DS\.sp3,\s*paddingTop: Spacing\.md,/);
    expect(source).not.toContain('<ContentSurface\n              style={s.profileRemoveShell}');
    expect(source).not.toContain('Remove from your circle?');
    expect(source).not.toContain('label="Keep friend"');
  });

  it('closes Add friend without an artificial success delay and refreshes requests', () => {
    expect(source).toContain('onRequestSent();\n      close();');
    expect(source).toContain('onRequestSent={() => { void loadRequests(); }}');
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
    expect(source).toContain('>Cancel request</Text>');
    expect(source).toContain('testID="cancel-request-modal"');
    expect(source).toContain('testID="cancel-request-confirm"');
    expect(source).toContain('body="They won’t receive this friend request."');
    expect(source).not.toContain('label="Keep request"');
    expect(source).not.toContain('Alert.alert(');
    expect(source).not.toContain('window.confirm(');
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
