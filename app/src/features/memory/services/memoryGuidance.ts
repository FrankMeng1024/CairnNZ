import { storage } from '../../../store/storage';

const PREFIX = 'cairn:memory-guidance:v1:';
const shownThisProcess = new Set<string>();

function keyFor(ownerId: string): string {
  return `${PREFIX}${encodeURIComponent(ownerId)}`;
}

/**
 * Claims the one-time Memory education for exactly one signed-in owner.
 * The durable claim is written before presentation, so lock/background or a
 * killed modal cannot make the same guidance recur on every visit.
 */
export async function claimMemoryGuidance(input: {
  ownerId: string | null;
  hasExploredEvidence: boolean;
  legacyDone: boolean;
}): Promise<boolean> {
  const ownerId = String(input.ownerId ?? '').trim();
  if (!ownerId) return false;
  const key = keyFor(ownerId);
  if (shownThisProcess.has(key)) return false;

  try {
    if (await storage.getItem(key)) {
      shownThisProcess.add(key);
      return false;
    }
    if (input.hasExploredEvidence || input.legacyDone) {
      await storage.setItem(key, JSON.stringify({ completed: true, reason: input.hasExploredEvidence ? 'explored' : 'legacy' }));
      shownThisProcess.add(key);
      return false;
    }
    await storage.setItem(key, JSON.stringify({ completed: true, reason: 'presented' }));
    shownThisProcess.add(key);
    return true;
  } catch {
    // Avoid a repeated modal loop within this process if durable storage is
    // temporarily unavailable. A later healthy launch may offer it once.
    if (shownThisProcess.has(key)) return false;
    shownThisProcess.add(key);
    return true;
  }
}

export const __memoryGuidanceTest = {
  reset(): void { shownThisProcess.clear(); },
  keyFor,
};
