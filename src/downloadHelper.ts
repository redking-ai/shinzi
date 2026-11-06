/**
 * downloadHelper.ts
 *
 * Utilities for formatting file sizes, triggering mobile device downloads,
 * and tracking downloaded state in localStorage for WhatsApp-style media.
 */

export const formatBytes = (bytes?: number): string => {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
};

const DOWNLOAD_PREFIX = 'shinzi_dl_';

export const isMediaDownloaded = (id: string, own?: boolean): boolean => {
  if (own) return true; // Senders already possess the original files
  if (!id) return false;
  if (id.startsWith('klipy_')) return true;
  try {
    return localStorage.getItem(DOWNLOAD_PREFIX + id) === '1';
  } catch {
    return false;
  }
};

export const markMediaDownloaded = (id: string): void => {
  if (!id) return;
  try {
    localStorage.setItem(DOWNLOAD_PREFIX + id, '1');
  } catch {}
};

/**
 * Trigger native browser file download into the phone's internal storage / Downloads.
 */
export const downloadToDevice = async (url: string, fileName: string): Promise<boolean> => {
  if (!url) return false;

  try {
    // If it's a data URI or local blob URL
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }

    // Remote URL: fetch blob to force browser download prompt
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 20000);
    return true;
  } catch (err) {
    console.warn('[downloadHelper] Fetch failed, falling back to direct link:', err);
    // Direct link fallback
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }
};
