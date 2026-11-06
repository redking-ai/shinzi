const KLIPY_API_KEY = 'BHo4WTWWcBsMJe9LDVLRmg1K9Bake1KOU5SEHEOSI6qGz4mAYr1bK1qyO3LYH9RA';
const KLIPY_BASE_URL = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}`;

export interface KlipyItem {
  id: string | number;
  title: string;
  type: 'gif' | 'sticker';
  previewUrl: string;
  originalUrl: string;
  width?: number;
  height?: number;
}

const extractMediaUrl = (file: any): { previewUrl: string; originalUrl: string; width?: number; height?: number } => {
  if (!file) return { previewUrl: '', originalUrl: '' };

  // Preferred order: sm for preview, md/hd for original
  const sm = file.sm?.webp?.url || file.sm?.gif?.url || file.sm?.png?.url;
  const md = file.md?.gif?.url || file.md?.webp?.url || file.md?.png?.url;
  const hd = file.hd?.gif?.url || file.hd?.webp?.url || file.hd?.png?.url;

  const originalUrl = md || hd || sm || '';
  const previewUrl = sm || originalUrl;

  const width = file.sm?.gif?.width || file.md?.gif?.width || file.hd?.gif?.width;
  const height = file.sm?.gif?.height || file.md?.gif?.height || file.hd?.gif?.height;

  return { previewUrl, originalUrl, width, height };
};

export const fetchKlipyTrending = async (
  type: 'gif' | 'sticker',
  perPage = 30
): Promise<KlipyItem[]> => {
  const endpoint = type === 'gif' ? 'gifs' : 'stickers';
  const res = await fetch(`${KLIPY_BASE_URL}/${endpoint}/trending?per_page=${perPage}`);
  if (!res.ok) throw new Error(`Klipy trending error: ${res.status}`);
  const json = await res.json();
  const rawList = json?.data?.data || [];

  return rawList.map((item: any) => {
    const { previewUrl, originalUrl, width, height } = extractMediaUrl(item.file);
    return {
      id: item.id,
      title: item.title || (type === 'gif' ? 'GIF' : 'Sticker'),
      type,
      previewUrl,
      originalUrl,
      width,
      height,
    };
  }).filter((it: KlipyItem) => Boolean(it.originalUrl));
};

export const searchKlipy = async (
  type: 'gif' | 'sticker',
  query: string,
  perPage = 30
): Promise<KlipyItem[]> => {
  const q = query.trim();
  if (!q) return fetchKlipyTrending(type, perPage);

  const endpoint = type === 'gif' ? 'gifs' : 'stickers';
  const res = await fetch(`${KLIPY_BASE_URL}/${endpoint}/search?q=${encodeURIComponent(q)}&per_page=${perPage}`);
  if (!res.ok) throw new Error(`Klipy search error: ${res.status}`);
  const json = await res.json();
  const rawList = json?.data?.data || [];

  return rawList.map((item: any) => {
    const { previewUrl, originalUrl, width, height } = extractMediaUrl(item.file);
    return {
      id: item.id,
      title: item.title || (type === 'gif' ? 'GIF' : 'Sticker'),
      type,
      previewUrl,
      originalUrl,
      width,
      height,
    };
  }).filter((it: KlipyItem) => Boolean(it.originalUrl));
};
