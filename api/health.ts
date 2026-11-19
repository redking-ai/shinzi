import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const checkFirebase = url.searchParams.get("firebase") === "1" || url.searchParams.get("check") === "firebase";

    if (checkFirebase) {
      try {
        await adminDb.listCollections();
        return Response.json({
          ok: true,
          service: "shinzi-backend",
          firebaseAdmin: "connected",
          firestore: "connected",
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            service: "shinzi-backend",
            error: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 500 }
        );
      }
    }

    return Response.json({
      ok: true,
      service: "shinzi-backend",
    });
  },
};
