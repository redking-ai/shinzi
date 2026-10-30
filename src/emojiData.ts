import type { EmojiData } from 'emoji-picker-react';

export const DEFAULT_RECENT_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉'];

type CompactEmoji = {
  group?: number;
  hexcode: string;
  label: string;
  tags?: string[];
  unicode: string;
  skins?: Array<{ hexcode: string }>;
};

type EmojiCategoryKey =
  | 'smileys_people'
  | 'animals_nature'
  | 'food_drink'
  | 'travel_places'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

const groupToCategory: Record<number, EmojiCategoryKey> = {
  0: 'smileys_people',
  1: 'smileys_people',
  3: 'animals_nature',
  4: 'food_drink',
  5: 'travel_places',
  6: 'activities',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
};

const categoryData = {
  smileys_people: { category: 'smileys_people', name: 'Smileys & People' },
  animals_nature: { category: 'animals_nature', name: 'Animals & Nature' },
  food_drink: { category: 'food_drink', name: 'Food & Drink' },
  travel_places: { category: 'travel_places', name: 'Travel & Places' },
  activities: { category: 'activities', name: 'Activities' },
  objects: { category: 'objects', name: 'Objects' },
  symbols: { category: 'symbols', name: 'Symbols' },
  flags: { category: 'flags', name: 'Flags' },
} as unknown as EmojiData['categories'];

export async function loadEmojiPickerData(): Promise<EmojiData> {
  const [dataModule, versionsModule] = await Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/versions/emoji.json'),
  ]);
  const records = dataModule.default as CompactEmoji[];
  const versions = versionsModule.default as Record<string, string[]>;
  const versionByHexcode = new Map<string, string>();

  Object.entries(versions).forEach(([version, hexcodes]) => {
    hexcodes.forEach((hexcode) => versionByHexcode.set(hexcode, version));
  });

  const emojis: EmojiData['emojis'] = {
    smileys_people: [],
    animals_nature: [],
    food_drink: [],
    travel_places: [],
    activities: [],
    objects: [],
    symbols: [],
    flags: [],
  };

  records.forEach((record) => {
    const category = record.group === undefined ? undefined : groupToCategory[record.group];
    if (!category) return;

    const hexcode = record.hexcode.toUpperCase();
    const baseHexcode = hexcode.split('-')[0];
    emojis[category].push({
      n: [record.label, ...(record.tags || [])],
      u: hexcode.toLowerCase(),
      ...(record.skins?.length
        ? { v: record.skins.map((skin) => skin.hexcode.toLowerCase()) }
        : {}),
      a: versionByHexcode.get(hexcode) || versionByHexcode.get(baseHexcode) || '18.0',
    });
  });

  return { categories: categoryData, emojis };
}

export function getRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem('shinzi_recent_emojis');
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((emoji) => typeof emoji === 'string') && parsed.length > 0) {
        return parsed.slice(0, 5);
      }
    }
  } catch {
    // Ignore unavailable storage or malformed data.
  }
  return DEFAULT_RECENT_EMOJIS.slice(0, 5);
}

export function saveRecentEmoji(emoji: string): string[] {
  try {
    const current = getRecentEmojis();
    const updated = [emoji, ...current.filter((item) => item !== emoji)].slice(0, 20);
    localStorage.setItem('shinzi_recent_emojis', JSON.stringify(updated));
    return updated.slice(0, 5);
  } catch {
    // Keep the quick reaction bar usable when storage is unavailable.
  }
  return DEFAULT_RECENT_EMOJIS.slice(0, 5);
}
