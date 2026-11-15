import { adminDb, adminMessaging } from './_lib/firebaseAdmin.js';
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
      const { convId, text, senderUid, senderName } = body;

      if (!convId || !text || !senderUid) {
        return Response.json({ error: 'Missing required fields' }, { status: 400, headers: CORS_HEADERS });
      }

      const convRef = adminDb.collection('conversations').doc(convId);
      const convDoc = await convRef.get();
      if (!convDoc.exists) {
        return Response.json({ error: 'Conversation not found' }, { status: 404, headers: CORS_HEADERS });
      }

      const convData = convDoc.data() || {};
      const memberIds: string[] = convData.memberIds || [];
      const recipientUid = memberIds.find((m) => m !== senderUid);

      const messageData = {
        type: 'text',
        text,
        senderId: senderUid,
        senderName: senderName || 'You',
        createdAt: Date.now(),
        editedAt: null,
        deleted: false,
      };

      const msgRef = await convRef.collection('messages').add(messageData);

      await convRef.update({
        lastMessageId: msgRef.id,
        lastMessageText: text,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastSenderId: senderUid,
        lastSenderName: senderName || 'You',
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Send push notification to recipient if exists
      if (recipientUid) {
        const userDoc = await adminDb.collection('users').doc(recipientUid).get();
        const fcmTokens: string[] = userDoc.data()?.fcmTokens || [];

        if (fcmTokens.length > 0) {
          await adminMessaging.sendEachForMulticast({
            tokens: fcmTokens,
            data: {
              senderName: senderName || 'Friend',
              text,
              convId,
              senderUid,
            },
            android: {
              priority: 'high',
              ttl: 24 * 60 * 60 * 1000,
            },
          }).catch((err) => console.warn('[send-reply] FCM error:', err));
        }
      }

      return Response.json({ ok: true, messageId: msgRef.id }, { headers: CORS_HEADERS });
    } catch (err: any) {
      console.error('[send-reply] Error:', err);
      return Response.json({ ok: false, error: err.message }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
