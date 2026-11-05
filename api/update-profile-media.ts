import { adminDb, adminAuth } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "Method not allowed. Use POST." },
        { status: 405 }
      );
    }

    try {
      const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
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

      let type = "avatar";
      let fileBuffer: Buffer | null = null;
      let fileName = "media";
      let mimeType = "image/jpeg";
      let assetId = "";

      const contentType = request.headers.get("content-type") || "";
      let chunkIndex = 0;
      let totalChunks = 1;

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        type = (formData.get("type") as string) || "avatar";
        assetId = (formData.get("assetId") as string) || "";
        const chunkIndexStr = formData.get("chunkIndex") as string | null;
        const totalChunksStr = formData.get("totalChunks") as string | null;
        chunkIndex = chunkIndexStr !== null ? parseInt(chunkIndexStr, 10) : 0;
        totalChunks = totalChunksStr !== null ? parseInt(totalChunksStr, 10) : 1;

        const file = formData.get("file") as File | null;
        if (file && typeof file.arrayBuffer === "function") {
          fileBuffer = Buffer.from(await file.arrayBuffer());
          fileName = (formData.get("fileName") as string) || file.name || "media";
          mimeType = (formData.get("mimeType") as string) || file.type || "image/jpeg";
        }
      } else {
        const body: Record<string, unknown> = await request.json().catch(() => ({}));
        type = typeof body.type === "string" ? body.type : "avatar";
        fileName = typeof body.fileName === "string" ? body.fileName : "media";
        mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
        assetId = typeof body.assetId === "string" ? body.assetId : "";

        if (typeof body.base64Data === "string" && body.base64Data) {
          const raw = body.base64Data.replace(/^data:[^;]+;base64,/, "");
          fileBuffer = Buffer.from(raw, "base64");
        }
      }

      if (type !== "avatar" && type !== "banner") {
        type = "avatar";
      }

      const isBanner = type === "banner";
      const assetType = isBanner ? "banner" : "profile_photo";
      const finalAssetId = assetId.trim() || `ast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const extFromFileName = fileName.split(".").pop()?.toLowerCase() || "";
      const ext =
        mimeType.includes("gif") || extFromFileName === "gif" ? "gif" :
        mimeType.includes("png") || extFromFileName === "png" ? "png" :
        mimeType.includes("webp") || extFromFileName === "webp" ? "webp" :
        mimeType.includes("mp4") || extFromFileName === "mp4" ? "mp4" :
        mimeType.includes("webm") || extFromFileName === "webm" ? "webm" : "jpg";

      if (!mimeType || mimeType === "application/octet-stream") {
        if (ext === "gif") mimeType = "image/gif";
        else if (ext === "png") mimeType = "image/png";
        else if (ext === "webp") mimeType = "image/webp";
        else if (ext === "mp4") mimeType = "video/mp4";
        else if (ext === "webm") mimeType = "video/webm";
        else mimeType = "image/jpeg";
      }

      // Handle intermediate chunks for large files (e.g. 8.14MB GIFs / animations)
      if (totalChunks > 1 && chunkIndex < totalChunks - 1) {
        if (!fileBuffer || fileBuffer.length === 0) {
          return Response.json(
            { ok: false, error: "Empty chunk payload." },
            { status: 400 }
          );
        }

        await adminDb
          .collection("mediaChunks")
          .doc(`${finalAssetId}_${chunkIndex}`)
          .set({
            data: fileBuffer.toString("base64"),
            index: chunkIndex,
            ownerUid: uid,
            assetId: finalAssetId,
            createdAt: FieldValue.serverTimestamp(),
          });

        return Response.json({
          ok: true,
          completed: false,
          chunkIndex,
          totalChunks,
          assetId: finalAssetId,
        });
      }

      let mediaUrl = "";

      if (totalChunks > 1 && chunkIndex === totalChunks - 1) {
        // Final chunk received
        if (fileBuffer && fileBuffer.length > 0) {
          await adminDb
            .collection("mediaChunks")
            .doc(`${finalAssetId}_${chunkIndex}`)
            .set({
              data: fileBuffer.toString("base64"),
              index: chunkIndex,
              ownerUid: uid,
              assetId: finalAssetId,
              createdAt: FieldValue.serverTimestamp(),
            });
        }

        mediaUrl = `/api/avatar?assetId=${finalAssetId}`;
      } else if (fileBuffer && fileBuffer.length > 0) {
        // Single chunk upload
        if (fileBuffer.length <= 750 * 1024) {
          mediaUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
        } else {
          await adminDb
            .collection("mediaChunks")
            .doc(`${finalAssetId}_0`)
            .set({
              data: fileBuffer.toString("base64"),
              index: 0,
              ownerUid: uid,
              assetId: finalAssetId,
              createdAt: FieldValue.serverTimestamp(),
            });
          totalChunks = 1;
          mediaUrl = `/api/avatar?assetId=${finalAssetId}`;
        }
      }

      if (!mediaUrl) {
        return Response.json(
          { ok: false, error: "Failed to store media file. Please try a file under 10MB." },
          { status: 400 }
        );
      }

      // Update asset record in 'assets' collection
      const assetRef = adminDb.collection("assets").doc(finalAssetId);
      await assetRef.set(
        {
          ownerUid: uid,
          type: assetType,
          visibility: "public",
          provider: totalChunks > 1 || !mediaUrl.startsWith("data:") ? "firestore_chunks" : "data_uri",
          chunkCount: totalChunks,
          fileName,
          mimeType,
          sizeBytes: fileBuffer ? fileBuffer.length : 0,
          mediaUrl,
          version: 1,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Update user profile document in 'users' collection
      const userRef = adminDb.collection("users").doc(uid);
      const userUpdates = isBanner
        ? {
            bannerAssetId: finalAssetId,
            bannerUrl: mediaUrl,
            updatedAt: FieldValue.serverTimestamp(),
          }
        : {
            profileAssetId: finalAssetId,
            photoURL: mediaUrl,
            updatedAt: FieldValue.serverTimestamp(),
          };

      await userRef.set(userUpdates, { merge: true });

      // If updating avatar, update conversation memberProfiles across all conversations
      if (!isBanner) {
        try {
          const convsSnap = await adminDb
            .collection("conversations")
            .where("memberIds", "array-contains", uid)
            .get();

          if (!convsSnap.empty) {
            const batch = adminDb.batch();
            convsSnap.forEach((convDoc) => {
              batch.update(convDoc.ref, {
                [`memberProfiles.${uid}.photoURL`]: mediaUrl,
                [`memberProfiles.${uid}.profileAssetId`]: finalAssetId,
              });
            });
            await batch.commit();
          }
        } catch (convErr) {
          console.warn("[update-profile-media] Could not update conversations:", convErr);
        }
      }

      return Response.json({
        ok: true,
        completed: true,
        assetId: finalAssetId,
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
