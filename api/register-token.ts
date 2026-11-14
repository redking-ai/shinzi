import { adminDb } from './_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

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

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json();
      const { uid, fcmToken, pushSubscription } = body;

      if (!uid) {
        return Response.json({ error: 'Missing uid' }, { status: 400, headers: CORS_HEADERS });
      }

      if (fcmToken && typeof fcmToken === 'string') {
        await adminDb.collection('users').doc(uid).set(
          {
            fcmTokens: FieldValue.arrayUnion(fcmToken),
          },
          { merge: true }
        );
      }

      if (pushSubscription && pushSubscription.endpoint) {
        const subId = Buffer.from(pushSubscription.endpoint).toString('base64').slice(-32).replace(/[/+=]/g, '_');
        await adminDb.collection('users').doc(uid).collection('pushSubscriptions').doc(subId).set(
          {
            ...pushSubscription,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return Response.json({ ok: true, registered: true }, { headers: CORS_HEADERS });
    } catch (err: any) {
      console.error('[register-token] Error:', err);
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
