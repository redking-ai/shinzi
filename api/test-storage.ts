import { Storage } from "@google-cloud/storage";

export default {
  async fetch(): Promise<Response> {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) {
        return Response.json({ ok: false, error: "No service account env" });
      }
      const sa = JSON.parse(raw);
      const gcs = new Storage({ credentials: sa, projectId: sa.project_id });
      const [buckets] = await gcs.getBuckets();
      const bucketNames = buckets.map(b => b.name);
      return Response.json({
        ok: true,
        projectId: sa.project_id,
        bucketNames,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: msg });
    }
  }
};
