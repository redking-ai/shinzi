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

// Curated harmonious palettes with rich visible secondary colors (never pitch black)
export const CURATED_MATERIAL_YOU_PALETTES: ProfileThemeColors[] = [
  { primary: '#241242', secondary: '#18244a', accent: '#a855f7' }, // Royal Violet & Indigo -> Purple
  { primary: '#15325b', secondary: '#1a1d47', accent: '#38bdf8' }, // Deep Ocean & Navy -> Sky Blue
  { primary: '#163824', secondary: '#1a2e3b', accent: '#34d399' }, // Emerald Forest & Teal -> Mint
  { primary: '#4a152d', secondary: '#2a123d', accent: '#fb7185' }, // Velvet Rose & Plum -> Coral Rose
  { primary: '#452210', secondary: '#331326', accent: '#fb923c' }, // Sunset Rust & Mahogany -> Amber
  { primary: '#13393e', secondary: '#182046', accent: '#2dd4bf' }, // Neon Teal & Midnight Blue -> Aqua
  { primary: '#281a54', secondary: '#3e163b', accent: '#818cf8' }, // Indigo & Mulberry -> Violet
  { primary: '#3d161d', secondary: '#241438', accent: '#f43f5e' }, // Crimson Wine & Dark Violet -> Ruby
  { primary: '#263318', secondary: '#132c2c', accent: '#a3e635' }, // Olive Moss & Cypress -> Lime
  { primary: '#3b1842', secondary: '#19284d', accent: '#e879f9' }, // Fuchsia Night & Cobalt -> Orchid
];

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s));
  l = Math.max(0, Math.min(100, l));
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

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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
 * according to Google's Material You principles.
 * Ensures ALL 3 colors are clearly distinct, rich, and visible:
 * - Primary: Rich deep background tone (lightness ~24-28%)
 * - Secondary: Visible harmonious contrasting background tone (lightness ~18-22%) - NEVER black!
 * - Accent: High-chroma pop tone (lightness ~54-58%, saturation >80%) for buttons & highlights.
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

          const S = 64;
          canvas.width = S;
          canvas.height = S;
          ctx.drawImage(img, 0, 0, S, S);

          const imgData = ctx.getImageData(0, 0, S, S).data;
          // 18 buckets of 20 degrees for finer hue resolution
          const NUM_BUCKETS = 18;
          const buckets = new Array(NUM_BUCKETS).fill(0);
          const hueSums = new Array(NUM_BUCKETS).fill(0);
          const satSums = new Array(NUM_BUCKETS).fill(0);

          let totalVibrant = 0;

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            const a = imgData[i + 3];

            if (a < 128) continue;

            const { h, s, l } = rgbToHsl(r, g, b);

            // Filter out near-grays, pure blacks, and washed out whites
            if (s > 18 && l > 16 && l < 86) {
              const bIdx = Math.floor(h / (360 / NUM_BUCKETS)) % NUM_BUCKETS;
              buckets[bIdx]++;
              hueSums[bIdx] += h;
              satSums[bIdx] += s;
              totalVibrant++;
            }
          }

          // Gather all non-empty clusters and sort by pixel count
          const clusters = buckets
            .map((count, idx) => ({
              count,
              idx,
              hue: count > 0 ? Math.round(hueSums[idx] / count) : idx * 20,
              sat: count > 0 ? Math.round(satSums[idx] / count) : 60,
            }))
            .filter((c) => c.count > 0)
            .sort((a, b) => b.count - a.count);

          let primaryHue = 215;
          let primarySat = 65;
          let secondaryHue = 265;
          let secondarySat = 60;
          let accentHue = 215;
          let accentSat = 85;

          if (clusters.length > 0) {
            // Cluster 1: Most dominant color
            primaryHue = clusters[0].hue;
            primarySat = Math.max(50, clusters[0].sat);

            // Cluster 2: Second dominant color that is at least 35° away from primary
            const diffCluster = clusters.find(
              (c) => Math.abs(c.hue - primaryHue) > 35 && Math.abs(c.hue - primaryHue) < 325
            );

            if (diffCluster) {
              secondaryHue = diffCluster.hue;
              secondarySat = Math.max(45, diffCluster.sat);
            } else {
              // If image is monochromatic, shift hue by 40° for harmonious analogous gradient
              secondaryHue = (primaryHue + 40) % 360;
              secondarySat = Math.max(50, primarySat * 0.9);
            }

            // Accent: either the highest saturation cluster or primary hue pop
            const highSatCluster = [...clusters].sort((a, b) => b.sat - a.sat)[0];
            if (highSatCluster && highSatCluster.sat > 55) {
              accentHue = highSatCluster.hue;
              accentSat = Math.min(95, Math.max(75, highSatCluster.sat * 1.15));
            } else {
              accentHue = primaryHue;
              accentSat = 85;
            }
          } else {
            const rand = Math.floor(Math.random() * CURATED_MATERIAL_YOU_PALETTES.length);
            resolve(CURATED_MATERIAL_YOU_PALETTES[rand]);
            return;
          }

          // Generate rich, visible tones:
          // 1. Primary: Rich deep tone for top background (L: 24-27%)
          const primary = hslToHex(primaryHue, primarySat, 26);

          // 2. Secondary: Distinct, beautiful contrasting tone for bottom background (L: 18-21%) - NEVER black!
          const secondary = hslToHex(secondaryHue, secondarySat, 19);

          // 3. Accent: High-chroma vibrant pop for buttons & highlights (L: 54%, S: high)
          const accent = hslToHex(accentHue, accentSat, 54);

          resolve({ primary, secondary, accent });
        } catch {
          // If canvas security error occurs (e.g. CORS), fallback gracefully to rich curated palette
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
