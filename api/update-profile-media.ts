import { adminDb, adminAuth } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "Method not allowed. Use POST." },
        { status: 405, headers: CORS_HEADERS }
      );
    }

    try {
      const authHeader =
        request.headers.get("authorization") ||
        request.headers.get("Authorization") ||
        "";
      if (!authHeader.startsWith("Bearer ")) {
        return Response.json(
          { ok: false, error: "Unauthorized: Missing or invalid Authorization header." },
          { status: 401, headers: CORS_HEADERS }
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
          { status: 401, headers: CORS_HEADERS }
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
      let subChunkOffset = 0;

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        type = (formData.get("type") as string) || "avatar";
        assetId = (formData.get("assetId") as string) || "";
        const chunkIndexStr = formData.get("chunkIndex") as string | null;
        const totalChunksStr = formData.get("totalChunks") as string | null;
        const subChunkOffsetStr = formData.get("subChunkOffset") as string | null;
        chunkIndex = chunkIndexStr !== null ? parseInt(chunkIndexStr, 10) : 0;
        totalChunks = totalChunksStr !== null ? parseInt(totalChunksStr, 10) : 1;
        subChunkOffset = subChunkOffsetStr !== null ? parseInt(subChunkOffsetStr, 10) : 0;

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
        const providerFileId = typeof body.providerFileId === "string" ? body.providerFileId : "";
        const driveFolderId = typeof body.driveFolderId === "string" ? body.driveFolderId : "";
        const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : 0;

        if (providerFileId) {
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

          const mediaUrl = `/api/avatar?assetId=${finalAssetId}&ext=${ext}&mime=${encodeURIComponent(mimeType)}`;

          const assetRef = adminDb.collection("assets").doc(finalAssetId);
          await assetRef.set({
            ownerUid: uid,
            type: assetType,
            visibility: "public",
            provider: "google_drive",
            providerFileId,
            driveFolderId: driveFolderId || null,
            fileName,
            mimeType,
            sizeBytes,
            mediaUrl,
            version: 1,
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          const userRef = adminDb.collection("users").doc(uid);
          const currentUserDoc = await userRef.get();
          const currentUData = currentUserDoc.data() || {};
          const oldAssetId = isBanner ? currentUData.bannerAssetId : currentUData.profileAssetId;
          const oldDriveFileId = isBanner
            ? (currentUData.bannerDriveFileId || null)
            : (currentUData.avatarDriveFileId || null);

          const userUpdates = isBanner
            ? {
                bannerAssetId: finalAssetId,
                bannerUrl: mediaUrl,
                bannerDriveFileId: providerFileId,
                updatedAt: FieldValue.serverTimestamp(),
              }
            : {
                profileAssetId: finalAssetId,
                photoURL: mediaUrl,
                avatarDriveFileId: providerFileId,
                updatedAt: FieldValue.serverTimestamp(),
              };

          await userRef.set(userUpdates, { merge: true });

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

          if (oldAssetId && oldAssetId !== finalAssetId) {
            try {
              const oldAssetDoc = await adminDb.collection("assets").doc(oldAssetId).get();
              if (oldAssetDoc.exists) {
                const oldData = oldAssetDoc.data();
                if (oldData?.chunkCount && typeof oldData.chunkCount === "number") {
                  const chunkDeletes = Array.from({ length: oldData.chunkCount }, (_, i) =>
                    adminDb.collection("mediaChunks").doc(`${oldAssetId}_${i}`).delete().catch(() => {})
                  );
                  await Promise.all(chunkDeletes);
                }
                await adminDb.collection("assets").doc(oldAssetId).delete().catch(() => {});
              }
            } catch (e) {
              console.warn("[update-profile-media] Old asset delete error:", e);
            }
          }

          return Response.json(
            {
              ok: true,
              completed: true,
              assetId: finalAssetId,
              mediaUrl,
              type,
              oldDriveFileId,
              providerFileId,
            },
            { headers: CORS_HEADERS }
          );
        }

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

      // Fast sub-chunking: split incoming chunk into 800KB raw Buffer pieces (native binary in Firestore, limit 1MB)
      const SUB_CHUNK_SIZE = 800 * 1024;
      const subChunks: Buffer[] = [];
      if (fileBuffer && fileBuffer.length > 0) {
        for (let offset = 0; offset < fileBuffer.length; offset += SUB_CHUNK_SIZE) {
          subChunks.push(
            fileBuffer.subarray(offset, Math.min(offset + SUB_CHUNK_SIZE, fileBuffer.length))
          );
        }
      }

      // If this is an intermediate client chunk of a multi-part upload
      if (totalChunks > 1 && chunkIndex < totalChunks - 1) {
        if (subChunks.length === 0) {
          return Response.json(
            { ok: false, error: "Empty chunk payload." },
            { status: 400, headers: CORS_HEADERS }
          );
        }

        // Save raw binary Buffer sub-chunks to Firestore in parallel
        await Promise.all(
          subChunks.map((sub, idx) => {
            const globalIndex = subChunkOffset + idx;
            return adminDb
              .collection("mediaChunks")
              .doc(`${finalAssetId}_${globalIndex}`)
              .set({
                data: sub,
                index: globalIndex,
                ownerUid: uid,
                assetId: finalAssetId,
                createdAt: FieldValue.serverTimestamp(),
              });
          })
        );

        const nextSubChunkOffset = subChunkOffset + subChunks.length;

        return Response.json(
          {
            ok: true,
            completed: false,
            chunkIndex,
            totalChunks,
            assetId: finalAssetId,
            nextSubChunkOffset,
          },
          { headers: CORS_HEADERS }
        );
      }

      let mediaUrl = "";

      // Single small file (<= 700KB): store inline data URI for instant 0-RTT load
      if (totalChunks <= 1 && fileBuffer && fileBuffer.length <= 700 * 1024) {
        mediaUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
      } else {
        // Multi-part completion OR single file > 700KB: write final sub-chunks to Firestore
        if (subChunks.length > 0) {
          await Promise.all(
            subChunks.map((sub, idx) => {
              const globalIndex = subChunkOffset + idx;
              return adminDb
                .collection("mediaChunks")
                .doc(`${finalAssetId}_${globalIndex}`)
                .set({
                  data: sub,
                  index: globalIndex,
                  ownerUid: uid,
                  assetId: finalAssetId,
                  createdAt: FieldValue.serverTimestamp(),
                });
            })
          );
        }

        const totalSubChunks = subChunkOffset + subChunks.length;
        mediaUrl = `/api/avatar?assetId=${finalAssetId}&ext=${ext}&mime=${encodeURIComponent(mimeType)}`;

        // Update asset record in 'assets' collection
        const assetRef = adminDb.collection("assets").doc(finalAssetId);
        await assetRef.set(
          {
            ownerUid: uid,
            type: assetType,
            visibility: "public",
            provider: "firestore_chunks",
            chunkCount: totalSubChunks,
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
      }

      if (!mediaUrl) {
        return Response.json(
          { ok: false, error: "Failed to store media file. Please try a file under 10MB." },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      // If inline data URI, save asset record as well
      if (mediaUrl.startsWith("data:")) {
        const assetRef = adminDb.collection("assets").doc(finalAssetId);
        await assetRef.set(
          {
            ownerUid: uid,
            type: assetType,
            visibility: "public",
            provider: "data_uri",
            chunkCount: 1,
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
      }

      // Update user profile document in 'users' collection
      const userRef = adminDb.collection("users").doc(uid);
      const currentUserDoc = await userRef.get();
      const currentUData = currentUserDoc.data() || {};
      const oldAssetId = isBanner ? currentUData.bannerAssetId : currentUData.profileAssetId;

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

      // Clean up previous media asset & chunks to save storage and prevent file accumulation
      if (oldAssetId && oldAssetId !== finalAssetId) {
        try {
          const oldAssetDoc = await adminDb.collection("assets").doc(oldAssetId).get();
          if (oldAssetDoc.exists) {
            const oldData = oldAssetDoc.data();
            if (oldData?.chunkCount && typeof oldData.chunkCount === "number") {
              const chunkDeletes = Array.from({ length: oldData.chunkCount }, (_, i) =>
                adminDb.collection("mediaChunks").doc(`${oldAssetId}_${i}`).delete().catch(() => {})
              );
              await Promise.all(chunkDeletes);
            }
            if (oldData?.providerFileId) {
              try {
                const tokenDoc = await adminDb.collection("privateDriveTokens").doc(uid).get();
                if (tokenDoc.exists) {
                  const encToken = tokenDoc.data()?.encryptedRefreshToken;
                  const clientId = process.env.GOOGLE_CLIENT_ID;
                  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
                  if (encToken && clientId && clientSecret) {
                    const refreshToken = decryptRefreshToken(encToken);
                    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        refresh_token: refreshToken,
                        grant_type: "refresh_token",
                      }),
                    });
                    if (tokenRes.ok) {
                      const tData = await tokenRes.json();
                      if (tData.access_token) {
                        await fetch(
                          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(oldData.providerFileId)}`,
                          {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${tData.access_token}` },
                          }
                        ).catch(() => {});
                      }
                    }
                  }
                }
              } catch (driveDelErr) {
                console.warn("[update-profile-media] Old Drive file delete error:", driveDelErr);
              }
            }
            await adminDb.collection("assets").doc(oldAssetId).delete().catch(() => {});
          }
        } catch (cleanupErr) {
          console.warn("[update-profile-media] Cleanup error:", cleanupErr);
        }
      }

      // If updating avatar, update conversation memberProfiles across all active conversations
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

      return Response.json(
        {
          ok: true,
          completed: true,
          assetId: finalAssetId,
          mediaUrl,
          type,
        },
        { headers: CORS_HEADERS }
      );
    } catch (err: unknown) {
      console.error("[update-profile-media] Internal error:", err);
      const message = err instanceof Error ? err.message : "Internal server error";
      return Response.json(
        { ok: false, error: message },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
