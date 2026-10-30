export const DEFAULT_RECENT_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉'];

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
