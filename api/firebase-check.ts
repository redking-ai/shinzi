import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(): Promise<Response> {
    try {
      const start = Date.now();
      const testData = "A".repeat(600 * 1024);
      await adminDb.collection("mediaChunks").doc("test_doc").set({ data: testData });
      const elapsed = Date.now() - start;

      return Response.json({
        ok: true,
        elapsedMs: elapsed,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }
  },
};
