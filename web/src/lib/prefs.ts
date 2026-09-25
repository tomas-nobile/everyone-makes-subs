// Tiny localStorage wrapper for UI preferences (F07.3). Always wrapped in try/catch: private
// browsing, quota, or storage-disabled must never break the view that reads it.

const PREFIX = 'ems.';

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage unavailable — the preference just won't survive a reload
  }
}
