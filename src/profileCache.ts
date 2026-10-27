type AnyRecord = Record<string, any>;

const inMemoryProfileCache = new Map<string, AnyRecord>();
const inMemoryAssetCache = new Map<string, AnyRecord>();

/**
 * Retrieve cached user profile document (memory or sessionStorage).
 */
export function getCachedProfile(uid: string): AnyRecord | null {
  if (!uid) return null;
  const mem = inMemoryProfileCache.get(uid);
  if (mem) return mem;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(`shinzi_profile_${uid}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        inMemoryProfileCache.set(uid, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

/**
 * Cache user profile document in memory and sessionStorage.
 */
export function setCachedProfile(uid: string, data: AnyRecord): void {
  if (!uid || !data) return;
  inMemoryProfileCache.set(uid, data);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(`shinzi_profile_${uid}`, JSON.stringify(data));
    } catch {}
  }
}

/**
 * Invalidate cached profile (e.g. after profile edit).
 */
export function invalidateCachedProfile(uid: string): void {
  if (!uid) return;
  inMemoryProfileCache.delete(uid);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`shinzi_profile_${uid}`);
    } catch {}
  }
}

/**
 * Retrieve cached asset metadata document (providerFileId, mimeType, status).
 */
export function getCachedAssetMeta(assetId: string): AnyRecord | null {
  if (!assetId) return null;
  const trimmed = assetId.trim();
  const mem = inMemoryAssetCache.get(trimmed);
  if (mem) return mem;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(`shinzi_asset_${trimmed}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        inMemoryAssetCache.set(trimmed, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

/**
 * Cache asset metadata document in memory and sessionStorage.
 */
export function setCachedAssetMeta(assetId: string, data: AnyRecord): void {
  if (!assetId || !data) return;
  const trimmed = assetId.trim();
  inMemoryAssetCache.set(trimmed, data);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(`shinzi_asset_${trimmed}`, JSON.stringify(data));
    } catch {}
  }
}

/**
 * Client-side SPA navigation helper to prevent full page reloads.
 */
export function navigateTo(url: string): void {
  if (typeof window === 'undefined') return;

  const current = window.location.pathname + window.location.search;
  if (current === url) return;

  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
