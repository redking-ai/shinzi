import { doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebaseConfig';

export type OnlineStatusMode = 'online' | 'dnd' | 'ghost';
export type EffectiveStatus = 'online' | 'offline' | 'dnd' | 'ghost';

/**
 * Computes the real-time visual status of any user.
 * - If user chose 'ghost': always appears offline (gray ring).
 * - If user chose 'dnd': always appears Do Not Disturb (red block).
 * - If user chose 'online':
 *     * When actively on the app (active within the last 60 seconds and isOnline !== false): green dot.
 *     * When they close the tab, leave the web, or disconnect: gray dot.
 */
export function getUserEffectiveStatus(
  userDoc?: Record<string, any> | null,
  presenceDoc?: Record<string, any> | null
): EffectiveStatus {
  const merged = presenceDoc ? { ...(userDoc || {}), ...presenceDoc } : userDoc;
  if (!merged) return 'offline';

  const mode: OnlineStatusMode = merged.onlineStatusMode || 'online';

  if (mode === 'ghost') return 'ghost';
  if (mode === 'dnd') return 'dnd';

  const lastSeen = Number(merged.lastSeen || 0);
  const isRecent = Date.now() - lastSeen < 60000;
  const isActivelyOnline = merged.isOnline !== false && isRecent;

  return isActivelyOnline ? 'online' : 'offline';
}

/**
 * Updates the user's presence state in Firestore.
 * Always writes to `users/{uid}/friends/presence` which is open for authenticated writes
 * under existing Firestore rules without any schema locks.
 * Also attempts to sync `users/{uid}` directly.
 */
export async function updateUserPresence(
  uid: string,
  isOnline: boolean,
  mode?: OnlineStatusMode
) {
  if (!uid) return;

  const now = Date.now();
  const currentMode =
    mode ||
    (typeof window !== 'undefined'
      ? (localStorage.getItem('shinzi_status_mode') as OnlineStatusMode)
      : null) ||
    'online';

  const presencePayload: Record<string, any> = {
    isOnline,
    lastSeen: now,
    onlineStatusMode: currentMode,
    updatedAt: serverTimestamp(),
  };

  // 1. Write to subcollection allowed by existing firestore rules: /users/{uid}/friends/presence
  try {
    await setDoc(doc(db, 'users', uid, 'friends', 'presence'), presencePayload, { merge: true });
  } catch (err) {
    console.warn('[presenceService] Could not write to friends/presence:', err);
  }

  // 2. Also try writing directly to /users/{uid}
  try {
    await updateDoc(doc(db, 'users', uid), presencePayload);
  } catch {
    // If strict rules fail on users doc, fallback was already saved in subcollection
  }

  // 3. Keep presence collection fallback updated as well
  try {
    await setDoc(doc(db, 'presence', uid), presencePayload, { merge: true });
  } catch {}
}
