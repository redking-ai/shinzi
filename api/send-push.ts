import { adminDb, adminMessaging } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const VAPID_PUBLIC_KEY = 'BNWehV8Z7f44UDrA2a8A1b3y7F61JvEkveZJOSGljWPp6EiyNnFubo3BlH00pl3jtfqsh8geehCXkaocKcqaiy8';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'uWcBHce8dCYW6A-s3tdIWhtya_uE7LzepN8q_lVuuFU';

let webpushInstance: any = null;

async function getWebPush() {
  if (!webpushInstance) {
    const wp = await import('web-push');
    webpushInstance = (wp as any).default || wp;
    try {
      webpushInstance.setVapidDetails(
        'mailto:support@shinzi.vercel.app',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
      );
    } catch (e) {
      console.warn('[send-push] setVapidDetails error:', e);
    }
  }
  return webpushInstance;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'GET') {
      return Response.json(
        {
          ok: true,
          service: 'shinzi-web-push',
          timestamp: Date.now(),
        },
        { headers: CORS_HEADERS }
      );
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
    }

    try {
      const wp = await getWebPush();
      const body = await request.json();
      const { recipientUid, title, text, icon, url, tag } = body;

      if (!recipientUid) {
        return Response.json({ error: 'Missing recipientUid' }, { status: 400, headers: CORS_HEADERS });
      }

      // 1. Send Native Android FCM Push (Delivers even when app is killed)
      let fcmSentCount = 0;
      try {
        const userDoc = await adminDb.collection('users').doc(recipientUid).get();
        const fcmTokens: string[] = userDoc.data()?.fcmTokens || [];

        if (fcmTokens.length > 0) {
          const fcmResponse = await adminMessaging.sendEachForMulticast({
            tokens: fcmTokens,
            data: {
              senderName: title || 'Shinzi',
              text: text || 'You received a new message',
              avatarUrl: icon || '',
              convId: tag || 'default',
            },
            android: {
              priority: 'high',
              ttl: 24 * 60 * 60 * 1000,
            },
          });
          fcmSentCount = fcmResponse.successCount;

          const badTokens: string[] = [];
          fcmResponse.responses.forEach((resp, idx) => {
            if (!resp.success && resp.error) {
              const code = resp.error.code;
              if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token'
              ) {
                badTokens.push(fcmTokens[idx]);
              }
            }
          });

          if (badTokens.length > 0) {
            void adminDb
              .collection('users')
              .doc(recipientUid)
              .update({
                fcmTokens: FieldValue.arrayRemove(...badTokens),
              })
              .catch(() => {});
          }
        }
      } catch (fcmErr) {
        console.warn('[send-push] FCM delivery error:', fcmErr);
      }

      // 2. Query recipient's Web Push subscriptions from Firestore
      const subsSnapshot = await adminDb
        .collection('users')
        .doc(recipientUid)
        .collection('pushSubscriptions')
        .get();

      if (subsSnapshot.empty && fcmSentCount === 0) {
        return Response.json(
          { ok: true, sent: 0, reason: 'No subscriptions found' },
          { headers: CORS_HEADERS }
        );
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
          await wp.sendNotification(pushSubscription as any, payload, {
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

      return Response.json({ ok: true, webPushSent: subsSnapshot.size, fcmSent: fcmSentCount }, { headers: CORS_HEADERS });
    } catch (error: any) {
      console.error('[send-push] Execution error:', error);
      return Response.json(
        {
          ok: false,
          error: error?.message || 'Failed to send push',
          stack: error?.stack,
        },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
