import { getStorage } from "firebase-admin/storage";
import { getApps, initializeApp, cert } from "firebase-admin/app";

export default {
  async fetch(): Promise<Response> {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) {
        return Response.json({ ok: false, error: "No service account env" });
      }
      const sa = JSON.parse(raw);
      const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(sa) });
      const storage = getStorage(app);
      const gcs = storage.bucket().storage;
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
