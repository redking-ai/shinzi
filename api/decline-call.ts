import { adminDb } from "./_lib/firebaseAdmin.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = await request.json().catch(() => ({}));
      const callId = body.callId;
      const convId = body.convId;

      if (!callId || typeof callId !== "string") {
        return Response.json({ ok: false, error: "Missing or invalid callId" }, { status: 400, headers: CORS_HEADERS });
      }

      // 1. If convId is provided directly, update conversations/{convId} IMMEDIATELY
      if (convId && typeof convId === "string") {
        try {
          await adminDb.collection("conversations").doc(convId).update({
            "activeCall.status": "declined",
            "activeCall.endedAt": Date.now(),
          });
        } catch (e) {
          console.warn("[decline-call] Direct convId update failed:", e);
        }
      }

      // 2. Query any conversation where activeCall.id matches callId
      try {
        const convSnap = await adminDb.collection("conversations").where("activeCall.id", "==", callId).get();
        for (const doc of convSnap.docs) {
          await doc.ref.update({
            "activeCall.status": "declined",
            "activeCall.endedAt": Date.now(),
          }).catch(() => {});
        }
      } catch (e) {
        console.warn("[decline-call] Conv query by activeCall.id failed:", e);
      }

      // 3. Also update calls/{callId} doc
      try {
        const callRef = adminDb.collection("calls").doc(callId);
        await callRef.set({
          status: "declined",
          endedAt: Date.now(),
        }, { merge: true });
      } catch (e) {
        console.warn("[decline-call] Call doc update failed:", e);
      }

      return Response.json({ ok: true, callId, status: "declined" }, { headers: CORS_HEADERS });
    } catch (err: any) {
      console.error("[api/decline-call] Error:", err);
      return Response.json({ ok: false, error: err.message || "Internal server error" }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
