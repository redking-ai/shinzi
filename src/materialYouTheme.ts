// Google Material You Color Extraction & Harmonization for Profile Themes

export interface ProfileThemeColors {
  primary: string;
  secondary: string;
  accent: string;
}

export const DEFAULT_THEME_COLORS: ProfileThemeColors = {
  primary: '#000000',
  secondary: '#000000',
  accent: '#000000',
};

const CURATED_MATERIAL_YOU_PALETTES: ProfileThemeColors[] = [
  { primary: '#1e1035', secondary: '#0e0819', accent: '#a855f7' }, // Royal Violet
  { primary: '#0f2942', secondary: '#071524', accent: '#38bdf8' }, // Ocean Cerulean
  { primary: '#183321', secondary: '#0a170e', accent: '#4ade80' }, // Mint Emerald
  { primary: '#3b122d', secondary: '#1c0715', accent: '#fb7185' }, // Velvet Rose
  { primary: '#38220f', secondary: '#1c0f05', accent: '#fb923c' }, // Sunset Amber
  { primary: '#132e35', secondary: '#07161a', accent: '#2dd4bf' }, // Neon Teal
  { primary: '#281a44', secondary: '#120b22', accent: '#818cf8' }, // Indigo Sky
  { primary: '#331b26', secondary: '#1a0b12', accent: '#f43f5e' }, // Crimson Bloom
  { primary: '#212918', secondary: '#0d1308', accent: '#a3e635' }, // Lime Olive
  { primary: '#2e193e', secondary: '#14081c', accent: '#d946ef' }, // Fuchsia Glow
];

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

/**
 * Extracts dominant vibrant colors from an image URI using an offscreen canvas
 * according to Google's Material You principles (dominant seed hue, deep tonal primary,
 * deeper secondary, high-chroma pop accent).
 */
export async function extractMaterialYouTheme(
  imageUrl?: string | null
): Promise<ProfileThemeColors> {
  if (!imageUrl) {
    const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
    return CURATED_MATERIAL_YOU_PALETTES[rand];
  }

  try {
    return await new Promise<ProfileThemeColors>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      // Set safety timeout in case image loading hangs
      const timer = setTimeout(() => {
        const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
        resolve(CURATED_MATERIAL_YOU_PALETTES[rand]);
      }, 2500);

      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
            resolve(CURATED_MATERIAL_YOU_PALETTES[rand]);
            return;
          }

          const S = 48;
          canvas.width = S;
          canvas.height = S;
          ctx.drawImage(img, 0, 0, S, S);

          const imgData = ctx.getImageData(0, 0, S, S).data;
          const buckets = new Array(12).fill(0);
          const hueSums = new Array(12).fill(0);
          const satSums = new Array(12).fill(0);

          let totalVibrant = 0;
          let fallbackH = 260;
          let fallbackS = 60;

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            const a = imgData[i + 3];

            if (a < 128) continue;

            const { h, s, l } = rgbToHsl(r, g, b);

            // Filter out near grays / extreme whites / extreme blacks for dominant hue
            if (s > 15 && l > 15 && l < 85) {
              const bIdx = Math.floor(h / 30) % 12;
              buckets[bIdx]++;
              hueSums[bIdx] += h;
              satSums[bIdx] += s;
              totalVibrant++;
            }
          }

          if (totalVibrant > 0) {
            let maxCount = -1;
            let bestIdx = 0;
            for (let b = 0; b < 12; b++) {
              if (buckets[b] > maxCount) {
                maxCount = buckets[b];
                bestIdx = b;
              }
            }
            fallbackH = Math.round(hueSums[bestIdx] / buckets[bestIdx]);
            fallbackS = Math.round(satSums[bestIdx] / buckets[bestIdx]);
          }

          // Generate Material You tonal shades
          // Primary: Deep rich dark tone (lightness ~16-20%)
          const primary = hslToHex(fallbackH, Math.max(45, fallbackS * 0.75), 18);

          // Secondary: Slightly shifted hue, even deeper tone (lightness ~9-12%)
          const secHue = (fallbackH + 25) % 360;
          const secondary = hslToHex(secHue, Math.max(40, fallbackS * 0.65), 10);

          // Accent: Vivid high-chroma pop tone (lightness ~58%, high saturation)
          const accent = hslToHex(fallbackH, Math.min(100, Math.max(70, fallbackS * 1.2)), 58);

          resolve({ primary, secondary, accent });
        } catch {
          // If cross-origin security error occurred on getImageData
          const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
          resolve(CURATED_MATERIAL_YOU_PALETTES[rand]);
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
        resolve(CURATED_MATERIAL_YOU_PALETTES[rand]);
      };

      img.src = imageUrl;
    });
  } catch {
    const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
    return CURATED_MATERIAL_YOU_PALETTES[rand];
  }
}
