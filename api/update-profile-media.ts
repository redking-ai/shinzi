import { adminDb, adminAuth, adminStorage } from "./_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";
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

      let type = "avatar";
      let fileBuffer: Buffer | null = null;
      let fileName = "media";
      let mimeType = "image/jpeg";
      let providerFileId: string | null = null;
      let driveFolderId: string | null = null;
      let assetId = "";

      const contentType = request.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        type = (formData.get("type") as string) || "avatar";
        const file = formData.get("file") as File | null;
        if (file && typeof file.arrayBuffer === "function") {
          fileBuffer = Buffer.from(await file.arrayBuffer());
          fileName = file.name || "media";
          mimeType = file.type || "image/jpeg";
        }
      } else {
        const body: Record<string, unknown> = await request.json().catch(() => ({}));
        type = typeof body.type === "string" ? body.type : "avatar";
        fileName = typeof body.fileName === "string" ? body.fileName : "media";
        mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
        providerFileId = typeof body.providerFileId === "string" ? body.providerFileId : null;
        driveFolderId = typeof body.driveFolderId === "string" ? body.driveFolderId : null;
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

      const ext =
        mimeType.includes("gif") ? "gif" :
        mimeType.includes("png") ? "png" :
        mimeType.includes("webp") ? "webp" :
        mimeType.includes("mp4") ? "mp4" :
        mimeType.includes("webm") ? "webm" : "jpg";

      let mediaUrl = "";

      // 1. Try Firebase Cloud Storage
      if (fileBuffer && fileBuffer.length > 0) {
        try {
          const bucket = adminStorage.bucket();
          const destination = `${isBanner ? "banners" : "profiles"}/${uid}_${Date.now()}.${ext}`;
          const gcsFile = bucket.file(destination);
          await gcsFile.save(fileBuffer, {
            contentType: mimeType,
            resumable: false,
            metadata: {
              cacheControl: "public, max-age=31536000",
            },
          });
          try {
            await gcsFile.makePublic();
          } catch {}
          mediaUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;
        } catch (stErr) {
          console.warn("[update-profile-media] Firebase Storage upload note:", stErr);
        }
      }

      // 2. Try Server-Side Google Drive Upload if user has connected Drive
      if (!mediaUrl && fileBuffer && fileBuffer.length > 0) {
        try {
          const tokenDoc = await adminDb.collection("privateDriveTokens").doc(uid).get();
          const encToken = tokenDoc.get("encryptedRefreshToken");
          const clientId = process.env.GOOGLE_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

          if (typeof encToken === "string" && clientId && clientSecret) {
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
              const { access_token } = await tokenRes.json();
              const driveInitRes = await fetch(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${access_token}`,
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Type": mimeType,
                    "X-Upload-Content-Length": String(fileBuffer.length),
                  },
                  body: JSON.stringify({
                    name: `${finalAssetId}.${ext}`,
                    mimeType,
                  }),
                }
              );

              const location = driveInitRes.headers.get("Location");
              if (location) {
                const putRes = await fetch(location, {
                  method: "PUT",
                  headers: { "Content-Type": mimeType },
                  body: fileBuffer,
                });

                if (putRes.ok) {
                  const driveFile = await putRes.json();
                  if (driveFile?.id) {
                    providerFileId = driveFile.id;
                    await fetch(
                      `https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions`,
                      {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${access_token}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ role: "reader", type: "anyone" }),
                      }
                    ).catch(() => {});
                    mediaUrl = `https://lh3.googleusercontent.com/d/${driveFile.id}=s800`;
                  }
                }
              }
            }
          }
        } catch (driveErr) {
          console.warn("[update-profile-media] Server-side Drive upload note:", driveErr);
        }
      }

      // 3. Fallback: Base64 data URI if under 850KB (stored safely within Firestore 1MB doc limit)
      if (!mediaUrl && fileBuffer && fileBuffer.length <= 850 * 1024) {
        mediaUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
      }

      // 4. Fallback if providerFileId was already supplied
      if (!mediaUrl && providerFileId) {
        mediaUrl = `https://lh3.googleusercontent.com/d/${providerFileId}=s800`;
      }

      if (!mediaUrl) {
        return Response.json(
          { ok: false, error: "Failed to store media file. Please try a file under 10MB." },
          { status: 400 }
        );
      }

      // 5. Create or update asset record in 'assets' collection using Admin SDK
      const assetRef = adminDb.collection("assets").doc(finalAssetId);
      await assetRef.set(
        {
          ownerUid: uid,
          type: assetType,
          visibility: "public",
          provider: providerFileId ? "google_drive" : "firebase_storage",
          providerFileId: providerFileId || "",
          driveFolderId: driveFolderId || "",
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

      // 6. Update user profile document in 'users' collection using Admin SDK
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

      // 7. If updating avatar, update conversation memberProfiles across all conversations
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
