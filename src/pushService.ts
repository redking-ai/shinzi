import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebaseConfig';

export const VAPID_PUBLIC_KEY = 'BNWehV8Z7f44UDrA2a8A1b3y7F61JvEkveZJOSGljWPp6EiyNnFubo3BlH00pl3jtfqsh8geehCXkaocKcqaiy8';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function hashEndpoint(endpoint: string): string {
  let hash = 0;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) - hash) + endpoint.charCodeAt(i);
    hash |= 0;
  }
  return `sub_${Math.abs(hash)}`;
}

export async function subscribeToWebPush(uid: string): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });
    }

    if (!subscription) return false;

    const subJson = subscription.toJSON();
    const docId = hashEndpoint(subscription.endpoint);

    const apiBase = typeof window !== 'undefined' && window.location.origin.includes('localhost')
      ? 'https://shinzi.vercel.app'
      : '';

    void fetch(`${apiBase}/api/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid,
        pushSubscription: {
          endpoint: subscription.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        },
      }),
    }).catch(() => {});

    try {
      await setDoc(
        doc(db, 'users', uid, 'pushSubscriptions', docId),
        {
          endpoint: subscription.endpoint,
          keys: subJson.keys,
          updatedAt: serverTimestamp(),
          userAgent: navigator.userAgent,
        },
        { merge: true }
      );
    } catch (e) {
      // Backend registration via /api/register-token already handled it
    }

    return true;
  } catch (err) {
    console.warn('[pushService] Subscription error:', err);
    return false;
  }
}

export async function sendWebPushToUser(params: {
  recipientUid: string;
  title: string;
  text: string;
  icon?: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  try {
    const apiBase = typeof window !== 'undefined' && window.location.origin.includes('localhost')
      ? 'https://shinzi.vercel.app'
      : '';
    void fetch(`${apiBase}/api/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    console.warn('[pushService] Trigger push error:', err);
  }
}
