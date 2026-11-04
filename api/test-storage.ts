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
      
      const bucketName = `shinzi-hub-media-${sa.project_id}`;
      let created = false;
      try {
        const [bucket] = await gcs.createBucket(bucketName, {
          location: "US-CENTRAL1",
          standard: true,
        });
        created = true;
      } catch (createErr: unknown) {
        const msg = createErr instanceof Error ? createErr.message : String(createErr);
        return Response.json({ ok: false, step: "createBucket", error: msg });
      }

      return Response.json({
        ok: true,
        created,
        bucketName,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: msg });
    }
  }
};
