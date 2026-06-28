/**
 * Tier — shared type for marker visual tier classification.
 * Lives in its own file to break the CairnPinsLayer ↔ CairnPinV10 cyclic import.
 */
export type Tier = 'self' | 'friend' | 'public';
