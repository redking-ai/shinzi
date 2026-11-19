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

      if (!callId || typeof callId !== "string") {
        return Response.json({ ok: false, error: "Missing or invalid callId" }, { status: 400, headers: CORS_HEADERS });
      }

      const callRef = adminDb.collection("calls").doc(callId);
      const snap = await callRef.get();

      if (snap.exists) {
        const data = snap.data();
        await callRef.update({
          status: "declined",
          endedAt: Date.now(),
        });

        // Also clean activeCall in conversation if present
        if (data?.convId) {
          try {
            await adminDb.collection("conversations").doc(data.convId).update({
              "activeCall.status": "declined",
              "activeCall.endedAt": Date.now(),
            });
          } catch {}
        }
      }

      return Response.json({ ok: true, callId, status: "declined" }, { headers: CORS_HEADERS });
    } catch (err: any) {
      console.error("[api/decline-call] Error:", err);
      return Response.json({ ok: false, error: err.message || "Internal server error" }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
