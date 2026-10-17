
import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(): Promise<Response> {
    try {
      // Check that Firebase Admin can access Firestore.
      await adminDb.listCollections();

      return Response.json({
        ok: true,
        service: "shinzi-backend",
        firebaseAdmin: "connected",
        firestore: "connected",
      });
    } catch (error) {
      console.error(
        "Firebase Admin check failed:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return Response.json(
        {
          ok: false,
          error: "Firebase Admin connection failed",
        },
        { status: 500 }
      );
    }
  },
};
