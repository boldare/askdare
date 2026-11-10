/**
 * localStorage that never throws. Third-party iframe storage may be partitioned, ephemeral or
 * blocked entirely, so persistence is best effort (ADR-0005).
 */
export interface SafeStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function browserStorage(): SafeStorage {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage unavailable: the conversation simply won't survive a reload.
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore.
      }
    },
  };
}

export function memoryStorage(): SafeStorage {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  };
}
