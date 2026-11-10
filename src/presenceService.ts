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
export function getUserEffectiveStatus(userDoc?: Record<string, any> | null): EffectiveStatus {
  if (!userDoc) return 'offline';

  const mode: OnlineStatusMode = userDoc.onlineStatusMode || 'online';

  if (mode === 'ghost') return 'ghost';
  if (mode === 'dnd') return 'dnd';

  const lastSeen = Number(userDoc.lastSeen || 0);
  const isRecent = Date.now() - lastSeen < 60000;
  const isActivelyOnline = userDoc.isOnline !== false && isRecent;

  return isActivelyOnline ? 'online' : 'offline';
}

/**
 * Updates the user's presence state in Firestore.
 */
export async function updateUserPresence(
  uid: string,
  isOnline: boolean,
  mode?: OnlineStatusMode
) {
  if (!uid) return;

  const now = Date.now();
  const payload: Record<string, any> = {
    isOnline,
    lastSeen: now,
    updatedAt: serverTimestamp(),
  };

  if (mode) {
    payload.onlineStatusMode = mode;
  }

  try {
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (err) {
    // If updateDoc fails (e.g. strict rule restriction), update presence collection fallback
    try {
      await setDoc(
        doc(db, 'presence', uid),
        {
          isOnline,
          lastSeen: now,
          ...(mode ? { onlineStatusMode: mode } : {}),
        },
        { merge: true }
      );
    } catch {}
  }
}
