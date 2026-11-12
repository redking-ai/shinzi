import React from 'react';

/**
 * Shinzi Text Style Engine (ts)
 * Allows styling text dynamically using (ts <style>) and {ts <style>} tags.
 * Supports:
 *  1. Built-in styles (Ashetic, Arabic, New Ashetic, Super Bold White/Black, Bold, Latte, Weird)
 *  2. Custom uploaded .txt mapping files (Unicode replacements)
 *  3. Custom uploaded font files (.ttf, .otf, .woff, .woff2) such as Google Fonts
 */

export interface TextStyleDefinition {
  id: string;
  name: string;
  isCustom?: boolean;
  type?: 'unicode' | 'font';
  map?: Record<string, string>;
  fontFamily?: string;
  fontDataUrl?: string;
}

// Built-in standard styles
const BUILT_IN_STYLES: Record<string, TextStyleDefinition> = {
  ashetic: {
    id: 'ashetic',
    name: 'Ashetic',
    type: 'unicode',
    map: {
      a: 'ａ', b: 'ｂ', c: 'ｃ', d: 'ｄ', e: 'ｅ', f: 'ｆ', g: 'ｇ', h: 'ｈ', i: 'ｉ', j: 'ｊ',
      k: 'ｋ', l: 'ｌ', m: 'ｍ', n: 'ｎ', o: 'ｏ', p: 'ｐ', q: 'ｑ', r: 'ｒ', s: 'ｓ', t: 'ｔ',
      u: 'ｕ', v: 'ｖ', w: 'ｗ', x: 'ｘ', y: 'ｙ', z: 'ｚ',
      A: 'Ａ', B: 'Ｂ', C: 'Ｃ', D: 'Ｄ', E: 'Ｅ', F: 'Ｆ', G: 'Ｇ', H: 'Ｈ', I: 'Ｉ', J: 'Ｊ',
      K: 'Ｋ', L: 'Ｌ', M: 'Ｍ', N: 'Ｎ', O: 'Ｏ', P: 'Ｐ', Q: 'Ｑ', R: 'Ｒ', S: 'Ｓ', T: 'Ｔ',
      U: 'Ｕ', V: 'Ｖ', W: 'Ｗ', X: 'Ｘ', Y: 'Ｙ', Z: 'Ｚ',
      '0': '０', '1': '１', '2': '２', '3': '３', '4': '４', '5': '５', '6': '６', '7': '７', '8': '８', '9': '９',
    },
  },
  arabic: {
    id: 'arabic',
    name: 'Arabic',
    type: 'unicode',
    map: {
      a: 'α', b: 'в', c: 'ƈ', d: 'ԃ', e: 'є', f: 'ғ', g: 'ց', h: 'ɦ', i: 'ι', j: 'ʝ',
      k: 'к', l: 'ℓ', m: 'ɱ', n: 'η', o: 'σ', p: 'ρ', q: 'φ', r: 'я', s: 'ѕ', t: 'т',
      u: 'υ', v: 'ν', w: 'ω', x: 'χ', y: 'у', z: 'չ',
      A: 'Д', B: 'В', C: 'С', D: 'D', E: 'Є', F: 'F', G: 'G', H: 'Н', I: 'I', J: 'J',
      K: 'К', L: 'L', M: 'М', N: 'И', O: 'О', P: 'Р', Q: 'Q', R: 'Я', S: 'S', T: 'Т',
      U: 'U', V: 'V', W: 'Ш', X: 'X', Y: 'У', Z: 'Z',
    },
  },
  newashetic: {
    id: 'newashetic',
    name: 'New Ashetic',
    type: 'unicode',
    map: {
      a: '𝒶', b: '𝒷', c: '𝒸', d: '𝒹', e: 'ℯ', f: '𝒻', g: 'ℊ', h: '𝒽', i: '𝒾', j: '𝒿',
      k: '𝓀', l: '𝓁', m: '𝓂', n: '𝓃', o: 'ℴ', p: '𝓅', q: '𝓆', r: '𝓇', s: '𝓈', t: '𝓉',
      u: '𝓊', v: '𝓋', w: '𝓌', x: '𝓍', y: '𝓎', z: '𝓏',
      A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ', J: '𝒥',
      K: '𝒦', L: 'ℒ', M: 'ℳ', N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ', S: '𝒮', T: '𝒯',
      U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵',
    },
  },
  superboldwhite: {
    id: 'superboldwhite',
    name: 'Super Bold White',
    type: 'unicode',
    map: {
      a: '𝕒', b: '𝕓', c: '𝕔', d: '𝕕', e: '𝕖', f: '𝕗', g: '𝕘', h: '𝕙', i: '𝕚', j: '𝕛',
      k: '𝕜', l: '𝕝', m: '𝕞', n: '𝕟', o: '𝕠', p: '𝕡', q: '𝕢', r: '𝕣', s: '𝕤', t: '𝕥',
      u: '𝕦', v: '𝕧', w: '𝕨', x: '𝕩', y: '𝕪', z: '𝕫',
      A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀', J: '𝕁',
      K: '𝕂', L: '𝕃', M: '𝕄', N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ', S: '𝕊', T: '𝕋',
      U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ',
      '0': '𝟘', '1': '𝟙', '2': '𝟚', '3': '𝟛', '4': '𝟜', '5': '𝟝', '6': '𝟞', '7': '𝟟', '8': '𝟠', '9': '𝟡',
    },
  },
  superboldblack: {
    id: 'superboldblack',
    name: 'Super Bold Black',
    type: 'unicode',
    map: {
      a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷',
      k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁',
      u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
      A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝',
      K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧',
      U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
      '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵',
    },
  },
  bold: {
    id: 'bold',
    name: 'Bold',
    type: 'unicode',
    map: {
      a: '𝐚', b: '𝐛', c: '𝐜', d: '𝐝', e: '𝐞', f: '𝐟', g: '𝐠', h: '𝐡', i: '𝐢', j: '𝐣',
      k: '𝐤', l: '𝐥', m: '𝐦', n: '𝐧', o: '𝐨', p: '𝐩', q: '𝐪', r: '𝐫', s: '𝐬', t: '𝐭',
      u: '𝐮', v: '𝐯', w: '𝐰', x: '𝐱', y: '𝐲', z: '𝐳',
      A: '𝐀', B: '𝐁', C: '𝐂', D: '𝐃', E: '𝐄', F: '𝐅', G: '𝐆', H: '𝐇', I: '𝐈', J: '𝐉',
      K: '𝐊', L: '𝐋', M: '𝐌', N: '𝐍', O: '𝐎', P: '𝐏', Q: '𝐐', R: '𝐑', S: '𝐒', T: '𝐓',
      U: '𝐔', V: '𝐕', W: '𝐖', X: '𝐗', Y: '𝐘', Z: '𝐙',
      '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗',
    },
  },
  latte: {
    id: 'latte',
    name: 'Latte',
    type: 'unicode',
    map: {
      a: '𝒶', b: '𝒷', c: '𝒸', d: '𝒹', e: 'ℯ', f: '𝒻', g: 'ℊ', h: '𝒽', i: '𝒾', j: '𝒿',
      k: '𝓀', l: '𝓁', m: '𝓂', n: '𝓃', o: 'ℴ', p: '𝓅', q: '𝓆', r: '𝓇', s: '𝓈', t: '𝓉',
      u: '𝓊', v: '𝓋', w: '𝓌', x: '𝓍', y: '𝓎', z: '𝓏',
      A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ', J: '𝒥',
      K: '𝒦', L: 'ℒ', M: 'ℳ', N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ', S: '𝒮', T: '𝒯',
      U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵',
      '0': '𝟢', '1': '𝟣', '2': '𝟤', '3': '𝟥', '4': '𝟦', '5': '𝟧', '6': '𝟨', '7': '𝟩', '8': '𝟪', '9': '𝟫',
    },
  },
  weird: {
    id: 'weird',
    name: 'Weird',
    type: 'unicode',
    map: {
      a: '𝔄', b: '𝔅', c: 'ℭ', d: '𝔇', e: '𝔈', f: '𝔉', g: '𝔊', h: 'ℌ', i: 'ℑ', j: '𝔍',
      k: '𝔎', l: '𝔏', m: '𝔐', n: '𝔑', o: '𝔒', p: '𝔓', q: '𝔔', r: 'ℜ', s: '𝔖', t: '𝔗',
      u: '𝔘', v: '𝔙', w: '𝔚', x: '𝔛', y: '𝔜', z: 'ℨ',
      A: '𝔄', B: '𝔅', C: 'ℭ', D: '𝔇', E: '𝔈', F: '𝔉', G: '𝔊', H: 'ℌ', I: 'ℑ', J: '𝔍',
      K: '𝔎', L: '𝔏', M: '𝔐', N: '𝔑', O: '𝔒', P: '𝔓', Q: '𝔔', R: 'ℜ', S: '𝔖', T: '𝔗',
      U: '𝔘', V: '𝔙', W: '𝔚', X: '𝔛', Y: '𝔜', Z: 'ℨ',
    },
  },
};

const STORAGE_KEY = 'shinzi_custom_text_styles';

// Auto-cleanup any broken 'ofl' style imported by mistake from OFL.txt license file
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ofl && (!parsed.ofl.type || parsed.ofl.type !== 'font')) {
        delete parsed.ofl;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
    }
  } catch {}
}

export function getCustomStyles(): Record<string, TextStyleDefinition> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getAllTextStyles(): Record<string, TextStyleDefinition> {
  const custom = getCustomStyles();
  return { ...BUILT_IN_STYLES, ...custom };
}

export function saveCustomStyle(name: string, map: Record<string, string>): TextStyleDefinition {
  const cleanId = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const styleDef: TextStyleDefinition = {
    id: cleanId,
    name: name.trim(),
    isCustom: true,
    type: 'unicode',
    map,
  };
  const current = getCustomStyles();
  current[cleanId] = styleDef;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
  return styleDef;
}

export function saveCustomFontStyle(name: string, dataUrl: string, fontFamilyOverride?: string): TextStyleDefinition {
  const family = (fontFamilyOverride || name).trim();
  const cleanId = family.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const styleDef: TextStyleDefinition = {
    id: cleanId,
    name: family,
    isCustom: true,
    type: 'font',
    fontFamily: family,
    fontDataUrl: dataUrl,
  };
  const current = getCustomStyles();
  current[cleanId] = styleDef;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
  return styleDef;
}

export function deleteCustomStyle(id: string): void {
  const current = getCustomStyles();
  delete current[id];
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }
}

/**
 * Registers a dynamic @font-face in the document so it is immediately rendered by the browser.
 */
export function registerFontFace(fontFamily: string, srcUrl: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // 1. Modern FontFace API
  try {
    const font = new FontFace(fontFamily, `url("${srcUrl}")`);
    font.load().then((loadedFont) => {
      document.fonts.add(loadedFont);
    }).catch((e) => console.warn('FontFace load warning:', e));
  } catch (err) {
    console.warn('FontFace API warning:', err);
  }

  // 2. Inject <style> @font-face fallback
  const styleId = `sh-font-${fontFamily.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      @font-face {
        font-family: "${fontFamily}";
        src: url("${srcUrl}") format("truetype");
        font-display: swap;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // 3. Fallback to Google Fonts CDN if family name matches Google Fonts
  const cleanGoogleFamily = fontFamily.replace(/\s+/g, '+');
  const gfId = `sh-gf-${cleanGoogleFamily.toLowerCase()}`;
  if (!document.getElementById(gfId)) {
    const link = document.createElement('link');
    link.id = gfId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(cleanGoogleFamily)}&display=swap`;
    document.head.appendChild(link);
  }
}

/**
 * Parses Font Family Name from TTF/OTF ArrayBuffer 'name' table.
 */
export function extractFontFamilyFromTTF(buffer: ArrayBuffer): string | null {
  try {
    const view = new DataView(buffer);
    const numTables = view.getUint16(4, false);
    let nameTableOffset = 0;
    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16;
      let tag = '';
      for (let j = 0; j < 4; j++) {
        tag += String.fromCharCode(view.getUint8(offset + j));
      }
      if (tag === 'name') {
        nameTableOffset = view.getUint32(offset + 8, false);
        break;
      }
    }
    if (!nameTableOffset) return null;
    const count = view.getUint16(nameTableOffset + 2, false);
    const stringOffset = nameTableOffset + view.getUint16(nameTableOffset + 4, false);
    const names: Record<number, string> = {};
    for (let i = 0; i < count; i++) {
      const recOffset = nameTableOffset + 6 + i * 12;
      const platformId = view.getUint16(recOffset, false);
      const nameId = view.getUint16(recOffset + 6, false);
      const length = view.getUint16(recOffset + 8, false);
      const offset = view.getUint16(recOffset + 10, false);
      const strStart = stringOffset + offset;
      let str = '';
      if (platformId === 0 || platformId === 3) {
        // UTF-16BE
        for (let j = 0; j < length; j += 2) {
          str += String.fromCharCode(view.getUint16(strStart + j, false));
        }
      } else {
        // ASCII / UTF-8
        for (let j = 0; j < length; j++) {
          str += String.fromCharCode(view.getUint8(strStart + j));
        }
      }
      str = str.replace(/\0/g, '').trim();
      if (str && !names[nameId]) {
        names[nameId] = str;
      }
    }
    return names[1] || names[4] || names[6] || null;
  } catch (err) {
    console.warn('Failed to parse TTF name table:', err);
    return null;
  }
}

/**
 * Initializes all registered custom fonts in the browser.
 */
export function initRegisteredFonts(): void {
  if (typeof window === 'undefined') return;
  const styles = getAllTextStyles();
  for (const style of Object.values(styles)) {
    if (style.type === 'font' && style.fontFamily && style.fontDataUrl) {
      registerFontFace(style.fontFamily, style.fontDataUrl);
    }
  }
}

// Auto-run font initialization
if (typeof window !== 'undefined') {
  initRegisteredFonts();
}

/**
 * Validates text style syntax.
 * If user writes (tsashetic) or {tsashetic} without a space,
 * returns error describing the issue.
 */
export function validateTextStyleSyntax(text: string): { isValid: boolean; error?: string } {
  if (!text) return { isValid: true };
  const invalidMatch = text.match(/[({]ts(?!\s)[a-zA-Z0-9_-]+[)}]/i);
  if (invalidMatch) {
    const raw = invalidMatch[0];
    const stylePart = raw.slice(3, -1);
    const bracketOpen = raw[0];
    const bracketClose = raw[raw.length - 1];
    return {
      isValid: false,
      error: `Unsupported syntax. Please enter a space: it should be ${bracketOpen}ts ${stylePart}${bracketClose}`,
    };
  }
  return { isValid: true };
}

/**
 * Parses .txt mapping files into character maps.
 * Handles key=val, key:val, key val, or sequential alphabet rows.
 */
export function parseTextStyleFile(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!content) return map;
  const trimmed = content.trim();

  // 1. JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') map[k] = v;
      }
      if (Object.keys(map).length > 0) return map;
    } catch {}
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 2. Line by line key=val / key:val / key->val
  let isKeyValue = false;
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z0-9_!@#$%^&*()\-+=~`[\]{}|;:,.<>?/])\s*[:=->\t]\s*(.+)$/);
    if (m) {
      isKeyValue = true;
      map[m[1]] = m[2].trim();
    }
  }

  if (isKeyValue && Object.keys(map).length > 0) {
    return map;
  }

  // 3. Alphabet rows
  if (lines.length >= 1) {
    const az = Array.from(lines[0]);
    const lowerLetters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < Math.min(az.length, 26); i++) {
      map[lowerLetters[i]] = az[i];
    }
    if (lines.length >= 2) {
      const AZ = Array.from(lines[1]);
      const upperLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let i = 0; i < Math.min(AZ.length, 26); i++) {
        map[upperLetters[i]] = AZ[i];
      }
    }
    if (lines.length >= 3) {
      const digits = Array.from(lines[2]);
      const nums = '0123456789';
      for (let i = 0; i < Math.min(digits.length, 10); i++) {
        map[nums[i]] = digits[i];
      }
    }
  }

  return map;
}

/**
 * Transforms characters using the given style key.
 */
function transformString(text: string, styleKey: string | null, allStyles: Record<string, TextStyleDefinition>): string {
  if (!styleKey) return text;
  const cleanKey = styleKey.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const style = allStyles[cleanKey];
  if (!style || !style.map) return text;
  return Array.from(text).map((ch) => style.map?.[ch] || ch).join('');
}

/**
 * Applies text styles to a string by finding (ts <style>) and {ts <style>} tags.
 * For Unicode styles: replaces characters directly with Unicode characters.
 * For Font styles: preserves font tag for renderStyledContent to style with CSS font-family.
 */
export function applyTextStyles(input: string): string {
  if (!input || (!input.includes('(ts') && !input.includes('{ts'))) return input;

  const allStyles = getAllTextStyles();
  const tagRegex = /[({]ts\s+([a-zA-Z0-9_\s-]+?)[)}]\s?/gi;
  let result = '';
  let lastIndex = 0;
  let currentStyleKey: string | null = null;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    const textBefore = input.slice(lastIndex, match.index);
    if (textBefore) {
      const cleanKey = currentStyleKey?.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const style = cleanKey ? allStyles[cleanKey] : undefined;
      if (style?.type === 'font') {
        result += `(ts ${cleanKey}) ${textBefore}`;
      } else {
        result += transformString(textBefore, currentStyleKey, allStyles);
      }
    }
    currentStyleKey = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  const remaining = input.slice(lastIndex);
  if (remaining) {
    const cleanKey = currentStyleKey?.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const style = cleanKey ? allStyles[cleanKey] : undefined;
    if (style?.type === 'font') {
      result += `(ts ${cleanKey}) ${remaining}`;
    } else {
      result += transformString(remaining, currentStyleKey, allStyles);
    }
  }

  return result;
}

export interface StyledTextPart {
  text: string;
  fontFamily?: string;
}

/**
 * Splits text into segments with associated font family styles.
 */
export function parseStyledTextParts(input: string): StyledTextPart[] {
  if (!input) return [];
  const allStyles = getAllTextStyles();
  const tagRegex = /[({]ts\s+([a-zA-Z0-9_\s-]+?)[)}]\s?/gi;
  const parts: StyledTextPart[] = [];
  let lastIndex = 0;
  let currentStyleKey: string | null = null;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(input)) !== null) {
    const textBefore = input.slice(lastIndex, match.index);
    if (textBefore) {
      const cleanKey = currentStyleKey?.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const style = cleanKey ? allStyles[cleanKey] : undefined;
      if (style?.type === 'font' && style.fontFamily) {
        parts.push({ text: textBefore, fontFamily: style.fontFamily });
      } else if (style?.map) {
        parts.push({ text: transformString(textBefore, currentStyleKey, allStyles) });
      } else {
        parts.push({ text: textBefore });
      }
    }
    currentStyleKey = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  const remaining = input.slice(lastIndex);
  if (remaining) {
    const cleanKey = currentStyleKey?.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const style = cleanKey ? allStyles[cleanKey] : undefined;
    if (style?.type === 'font' && style.fontFamily) {
      parts.push({ text: remaining, fontFamily: style.fontFamily });
    } else if (style?.map) {
      parts.push({ text: transformString(remaining, currentStyleKey, allStyles) });
    } else {
      parts.push({ text: remaining });
    }
  }

  return parts;
}

/**
 * Renders text containing style tags into React nodes with appropriate font-family and unicode transformations.
 */
export function renderStyledContent(
  input: string,
  onMentionClick?: (mention: string) => void,
  renderMentionFn?: (text: string, onMentionClick?: (m: string) => void) => React.ReactNode
): React.ReactNode {
  if (!input) return null;
  const parts = parseStyledTextParts(input);
  if (parts.length === 0) return null;
  if (parts.length === 1 && !parts[0].fontFamily) {
    return renderMentionFn ? renderMentionFn(parts[0].text, onMentionClick) : parts[0].text;
  }
  return parts.map((part, idx) => {
    const content = renderMentionFn ? renderMentionFn(part.text, onMentionClick) : part.text;
    if (part.fontFamily) {
      return React.createElement(
        'span',
        { key: idx, style: { fontFamily: `"${part.fontFamily}", sans-serif` } },
        content
      );
    }
    return React.createElement(React.Fragment, { key: idx }, content);
  });
}
