const KLIPY_API_KEY = 'BHo4WTWWcBsMJe9LDVLRmg1K9Bake1KOU5SEHEOSI6qGz4mAYr1bK1qyO3LYH9RA';
const KLIPY_BASE_URL = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}`;

export interface KlipyItem {
  id: string | number;
  title: string;
  type: 'gif' | 'sticker';
  previewUrl: string;
  originalUrl: string;
  width?: number | null;
  height?: number | null;
}

// In-memory query cache for instant 0ms responses
const klipyCache = new Map<string, KlipyItem[]>();

const extractMediaUrl = (file: any, type: 'gif' | 'sticker'): { previewUrl: string; originalUrl: string; width?: number | null; height?: number | null } => {
  if (!file) return { previewUrl: '', originalUrl: '' };

  // For lightning-fast previews, use high-efficiency animated WebP or PNG thumbnails
  const smWebp = file.sm?.webp?.url || file.xs?.webp?.url;
  const smPng = file.sm?.png?.url || file.md?.png?.url;
  const smGif = file.sm?.gif?.url || file.xs?.gif?.url;

  // In sticker mode, PNG/WebP provides transparent background
  const previewUrl = type === 'sticker'
    ? (smPng || smWebp || smGif || '')
    : (smWebp || smGif || smPng || '');

  // For chat playback, use medium WebP / GIF
  const mdWebp = file.md?.webp?.url || file.hd?.webp?.url;
  const mdGif = file.md?.gif?.url || file.hd?.gif?.url;
  const originalUrl = mdWebp || mdGif || previewUrl;

  const width = file.sm?.webp?.width || file.sm?.gif?.width || null;
  const height = file.sm?.webp?.height || file.sm?.gif?.height || null;

  return { previewUrl, originalUrl, width, height };
};

export const fetchKlipyTrending = async (
  type: 'gif' | 'sticker',
  perPage = 24,
  signal?: AbortSignal
): Promise<KlipyItem[]> => {
  const cacheKey = `trending_${type}_${perPage}`;
  if (klipyCache.has(cacheKey)) {
    return klipyCache.get(cacheKey)!;
  }

  const endpoint = type === 'gif' ? 'gifs' : 'stickers';
  const res = await fetch(`${KLIPY_BASE_URL}/${endpoint}/trending?per_page=${perPage}`, { signal });
  if (!res.ok) throw new Error(`Klipy trending error: ${res.status}`);
  const json = await res.json();
  const rawList = json?.data?.data || [];

  const items = rawList.map((item: any) => {
    const { previewUrl, originalUrl, width, height } = extractMediaUrl(item.file, type);
    return {
      id: item.id,
      title: item.title || (type === 'gif' ? 'GIF' : 'Sticker'),
      type,
      previewUrl,
      originalUrl,
      width,
      height,
    };
  }).filter((it: KlipyItem) => Boolean(it.previewUrl && it.originalUrl));

  klipyCache.set(cacheKey, items);
  return items;
};

export const searchKlipy = async (
  type: 'gif' | 'sticker',
  query: string,
  perPage = 24,
  signal?: AbortSignal
): Promise<KlipyItem[]> => {
  const q = query.trim().toLowerCase();
  if (!q) return fetchKlipyTrending(type, perPage, signal);

  const cacheKey = `search_${type}_${q}_${perPage}`;
  if (klipyCache.has(cacheKey)) {
    return klipyCache.get(cacheKey)!;
  }

  const endpoint = type === 'gif' ? 'gifs' : 'stickers';
  const res = await fetch(
    `${KLIPY_BASE_URL}/${endpoint}/search?q=${encodeURIComponent(q)}&per_page=${perPage}`,
    { signal }
  );
  if (!res.ok) throw new Error(`Klipy search error: ${res.status}`);
  const json = await res.json();
  const rawList = json?.data?.data || [];

  const items = rawList.map((item: any) => {
    const { previewUrl, originalUrl, width, height } = extractMediaUrl(item.file, type);
    return {
      id: item.id,
      title: item.title || (type === 'gif' ? 'GIF' : 'Sticker'),
      type,
      previewUrl,
      originalUrl,
      width,
      height,
    };
  }).filter((it: KlipyItem) => Boolean(it.previewUrl && it.originalUrl));

  klipyCache.set(cacheKey, items);
  return items;
};

export const getCachedKlipy = (type: 'gif' | 'sticker', query: string, perPage = 24): KlipyItem[] | null => {
  const q = query.trim().toLowerCase();
  const cacheKey = q ? `search_${type}_${q}_${perPage}` : `trending_${type}_${perPage}`;
  return klipyCache.get(cacheKey) || null;
};
