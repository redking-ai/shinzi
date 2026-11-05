import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(): Promise<Response> {
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
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  },
};
