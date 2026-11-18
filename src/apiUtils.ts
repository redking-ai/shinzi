/**
 * apiUtils.ts
 * Ensures relative /api/ endpoints correctly route to https://shinzi.vercel.app
 * when running inside Capacitor Android native webview.
 */

export const getAbsoluteApiUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  if (url.startsWith('/api/')) {
    return `https://shinzi.vercel.app${url}`;
  }
  if (url.startsWith('api/')) {
    return `https://shinzi.vercel.app/${url}`;
  }
  return url;
};
