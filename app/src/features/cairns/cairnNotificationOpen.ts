import type { CairnNotificationDestination } from './cairnEncounterNotifications';
import type { CairnPresentationDestination } from './cairnPresentationNavigation';

export type CairnNotificationOpenResult = 'opened' | 'deferred' | 'retryable' | 'discarded';

type Dependencies = {
  currentViewerId: () => string;
  navigationReady: () => boolean;
  resolve: (viewerId: string, groupIds: readonly string[]) => Promise<CairnPresentationDestination[]>;
  openSingle: (destination: CairnPresentationDestination) => void;
  openGroup: (destinations: CairnPresentationDestination[]) => void;
};

/**
 * Opens only the exact acquired revision(s) represented by the durable event
 * group. Every async boundary is fenced by the authenticated viewer identity.
 */
export async function openCairnNotificationDestination(
  destination: CairnNotificationDestination,
  dependencies: Dependencies,
): Promise<CairnNotificationOpenResult> {
  const expectedViewer = destination.viewerId;
  const current = () => Boolean(expectedViewer) && dependencies.currentViewerId() === expectedViewer;
  if (!current() || !destination.presentationGroupId) return 'discarded';
  let items: CairnPresentationDestination[];
  try {
    items = await dependencies.resolve(expectedViewer, [destination.presentationGroupId]);
  } catch {
    return current() ? 'retryable' : 'discarded';
  }
  if (!current()) return 'discarded';
  if (!dependencies.navigationReady()) return 'deferred';
  if (!current()) return 'discarded';
  if (items.length === 1) dependencies.openSingle(items[0]);
  else dependencies.openGroup(items);
  return 'opened';
}
