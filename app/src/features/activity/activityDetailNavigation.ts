export type ActivityDetailBackContext = 'previous' | 'activities';

export type ActivityDetailBackAction = 'go-back' | 'canonical-activities';

/**
 * Resolve Activity Detail Back without accepting arbitrary route names from
 * params. Home and Cairn provenance may pop a retained parent. Finish,
 * Trails, QA and direct/deep-link entry use the canonical Activities landing.
 */
export function resolveActivityDetailBackAction(
  context: ActivityDetailBackContext | undefined,
  canGoBack: boolean,
): ActivityDetailBackAction {
  return context === 'previous' && canGoBack
    ? 'go-back'
    : 'canonical-activities';
}
