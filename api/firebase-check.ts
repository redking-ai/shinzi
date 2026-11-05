import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(): Promise<Response> {
    try {
      const start = Date.now();
      const rawBuf = Buffer.alloc(700 * 1024, 0x41);
      await adminDb.collection("mediaChunks").doc("test_buf").set({ data: rawBuf });
      const elapsed = Date.now() - start;

      return Response.json({
        ok: true,
        type: "buffer",
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
