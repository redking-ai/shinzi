import { adminDb } from "./_lib/firebaseAdmin.js";

export default {
  async fetch(): Promise<Response> {
    try {
      const results: Record<string, number> = {};
      for (const sizeKb of [100, 200, 350, 500]) {
        const start = Date.now();
        const buf = Buffer.alloc(sizeKb * 1024, 0x42);
        await adminDb.collection("mediaChunks").doc(`bench_${sizeKb}`).set({ data: buf });
        results[`${sizeKb}KB`] = Date.now() - start;
      }

      return Response.json({
        ok: true,
        benchmarks: results,
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
