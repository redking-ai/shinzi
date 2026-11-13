import * as webpushModule from 'web-push';
import { adminDb } from './_lib/firebaseAdmin.js';

const webpush = (webpushModule as any).default || webpushModule;

export const VAPID_PUBLIC_KEY = 'BNWehV8Z7f44UDrA2a8A1b3y7F61JvEkveZJOSGljWPp6EiyNnFubo3BlH00pl3jtfqsh8geehCXkaocKcqaiy8';
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'uWcBHce8dCYW6A-s3tdIWhtya_uE7LzepN8q_lVuuFU';

try {
  webpush.setVapidDetails(
    'mailto:support@shinzi.vercel.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('[send-push] setVapidDetails error:', e);
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      return Response.json({
        ok: true,
        service: 'shinzi-web-push',
        vapidConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
      });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const body = await request.json();
      const { recipientUid, title, text, icon, url, tag } = body;

      if (!recipientUid) {
        return Response.json({ error: 'Missing recipientUid' }, { status: 400 });
      }

      // Query recipient's push subscriptions from Firestore
      const subsSnapshot = await adminDb
        .collection('users')
        .doc(recipientUid)
        .collection('pushSubscriptions')
        .get();

      if (subsSnapshot.empty) {
        return Response.json({ ok: true, sent: 0, reason: 'No subscriptions found' });
      }

      const payload = JSON.stringify({
        title: title || 'Shinzi',
        body: text || 'You received a new message',
        icon: icon || '/icon-192.png',
        badge: '/icon-192.png',
        url: url || '/',
        tag: tag || `shinzi-${Date.now()}`,
      });

      const promises = subsSnapshot.docs.map(async (docItem) => {
        const subData = docItem.data();
        const pushSubscription = {
          endpoint: subData.endpoint,
          keys: subData.keys,
        };

        try {
          await webpush.sendNotification(pushSubscription as any, payload, {
            TTL: 86400, // 24 hours
            urgency: 'high',
          });
        } catch (err: any) {
          // If subscription is expired or unsubscribed, remove from Firestore
          if (err.statusCode === 404 || err.statusCode === 410) {
            await docItem.ref.delete().catch(() => {});
          }
        }
      });

      await Promise.allSettled(promises);

      return Response.json({ ok: true, sent: subsSnapshot.size });
    } catch (error: any) {
      console.error('Send push error:', error);
      return Response.json(
        { ok: false, error: error?.message || 'Failed to send push' },
        { status: 500 }
      );
    }
  },
};
