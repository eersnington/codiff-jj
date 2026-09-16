import { useEffect, type EffectCallback } from 'react';

/** Owns a mount-lifetime subscription; the callback must only capture stable values. */
export function useMountEffect(effect: EffectCallback) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Mount-only subscriptions capture stable values.
  useEffect(effect, []);
}
