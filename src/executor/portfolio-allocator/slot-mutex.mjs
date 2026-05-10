// Slot mutex — in-process lock per slot id for the K-rotator.
// Prevents two in-flight intents from claiming the same slot.
// Auto-release after timeout to prevent permanent lock.

const locks = new Map();

export function featureEnabled(profile = {}) {
  return profile.slotMutex !== false;
}

export function acquireSlot(slotId, { timeoutMs = 30_000 } = {}) {
  const now = Date.now();
  const existing = locks.get(slotId);

  if (existing) {
    if (now < existing.expiresAt) {
      return { acquired: false, release: () => {} };
    }
    // Timed out — clear stale lock before acquiring
    clearTimeout(existing.timer);
    locks.delete(slotId);
  }

  const expiresAt = now + timeoutMs;
  let released = false;

  const timer = setTimeout(() => {
    if (!released) {
      released = true;
      const current = locks.get(slotId);
      if (current && current.timer === timer) {
        locks.delete(slotId);
      }
    }
  }, timeoutMs);

  const lockEntry = { slotId, expiresAt, timer };
  locks.set(slotId, lockEntry);

  function release() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    const current = locks.get(slotId);
    if (current && current.timer === timer) {
      locks.delete(slotId);
    }
  }

  return { acquired: true, release };
}

export function clearAllSlots() {
  for (const [, entry] of locks) {
    clearTimeout(entry.timer);
  }
  locks.clear();
}
