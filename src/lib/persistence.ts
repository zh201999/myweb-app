/**
 * persistence.ts
 *
 * Thin localStorage layer for dashboard state.
 * All reads/writes go through `load` and `save` so the call-sites stay
 * identical when we later swap this for a Supabase backend — only this
 * file changes.
 */

export const KEYS = {
  contacts:       "myweb:contacts",
  sectorPalettes: "myweb:sectorPalettes",
  youColors:      "myweb:youColors",
} as const;

/**
 * Load a value from localStorage.
 * Returns `fallback` when:
 *   - running on the server (window undefined)
 *   - the key is missing
 *   - the stored value fails JSON.parse
 */
export function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Persist a value to localStorage.
 * Fails silently (quota exceeded, private-browsing restrictions, etc.).
 */
export function save<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — state lives in memory only this session
  }
}

/**
 * Wipe all app-owned keys.
 * Useful for testing the "first load / fallback" path.
 */
export function clearPersistedState(): void {
  if (typeof window === "undefined") return;
  Object.values(KEYS).forEach(key => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  });
}
