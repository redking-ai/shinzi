import { adminDb, adminAuth } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return Response.json(
          { ok: false, error: "Unauthorized: Missing or invalid Authorization header." },
          { status: 401 }
        );
      }

      const idToken = authHeader.slice(7).trim();
      let decodedToken;
      try {
        decodedToken = await adminAuth.verifyIdToken(idToken);
      } catch (authErr) {
        console.error("[update-profile-media] Token verification failed:", authErr);
        return Response.json(
          { ok: false, error: "Unauthorized: Invalid authentication token." },
          { status: 401 }
        );
      }

      const uid = decodedToken.uid;
      const body = await request.json();
      const {
        type,
        assetId,
        providerFileId,
        driveFolderId,
        fileName,
        mimeType,
        sizeBytes,
        dataUriPreview,
      } = body;

      if (!type || (type !== "avatar" && type !== "banner")) {
        return Response.json(
          { ok: false, error: 'Invalid or missing media type (must be "avatar" or "banner").' },
          { status: 400 }
        );
      }

      if (!assetId || typeof assetId !== "string") {
        return Response.json(
          { ok: false, error: "Missing or invalid assetId." },
          { status: 400 }
        );
      }

      if (!providerFileId || typeof providerFileId !== "string") {
        return Response.json(
          { ok: false, error: "Missing or invalid providerFileId." },
          { status: 400 }
        );
      }

      const isBanner = type === "banner";
      const assetType = isBanner ? "banner" : "profile_photo";

      // 1. Create or update asset record in 'assets' collection using Admin SDK
      const assetRef = adminDb.collection("assets").doc(assetId);
      await assetRef.set(
        {
          ownerUid: uid,
          type: assetType,
          visibility: "public",
          provider: "google_drive",
          providerFileId: providerFileId.trim(),
          driveFolderId: typeof driveFolderId === "string" ? driveFolderId.trim() : "",
          fileName: typeof fileName === "string" ? fileName.trim() : `${assetType}.jpg`,
          mimeType: typeof mimeType === "string" ? mimeType.trim() : "image/jpeg",
          sizeBytes: typeof sizeBytes === "number" && Number.isFinite(sizeBytes) ? sizeBytes : 0,
          version: 1,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 2. Update user profile document in 'users' collection using Admin SDK
      const userRef = adminDb.collection("users").doc(uid);
      const mediaUrl =
        typeof dataUriPreview === "string" && dataUriPreview.length > 0
          ? dataUriPreview
          : `https://lh3.googleusercontent.com/d/${providerFileId}=s800`;

      const userUpdates = isBanner
        ? {
            bannerAssetId: assetId,
            bannerUrl: mediaUrl,
            updatedAt: FieldValue.serverTimestamp(),
          }
        : {
            profileAssetId: assetId,
            photoURL: mediaUrl,
            updatedAt: FieldValue.serverTimestamp(),
          };

      await userRef.set(userUpdates, { merge: true });

      return Response.json({
        ok: true,
        assetId,
        mediaUrl,
        type,
      });
    } catch (err: unknown) {
      console.error("[update-profile-media] Internal error:", err);
      const message = err instanceof Error ? err.message : "Internal server error";
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  },
};
