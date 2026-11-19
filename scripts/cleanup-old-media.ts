import { adminDb, adminAuth } from "./_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    try {
      const authHeader =
        request.headers.get("authorization") ||
        request.headers.get("Authorization") ||
        "";
      if (!authHeader.startsWith("Bearer ")) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
      }

      const idToken = authHeader.slice(7).trim();
      const decoded = await adminAuth.verifyIdToken(idToken);
      const uid = decoded.uid;

      const userDoc = await adminDb.collection("users").doc(uid).get();
      const userData = userDoc.data() || {};
      const activeProfileAssetId = userData.profileAssetId || "";
      const activeBannerAssetId = userData.bannerAssetId || "";

      let activeProfileDriveId = "";
      let activeBannerDriveId = "";

      if (activeProfileAssetId) {
        const aDoc = await adminDb.collection("assets").doc(activeProfileAssetId).get();
        activeProfileDriveId = aDoc.data()?.providerFileId || "";
      }
      if (activeBannerAssetId) {
        const bDoc = await adminDb.collection("assets").doc(activeBannerAssetId).get();
        activeBannerDriveId = bDoc.data()?.providerFileId || "";
      }

      const deletedItems: string[] = [];

      // 1. Clean up unused Firestore assets & chunks
      const userAssetsSnap = await adminDb
        .collection("assets")
        .where("ownerUid", "==", uid)
        .get();

      for (const doc of userAssetsSnap.docs) {
        const aId = doc.id;
        if (aId !== activeProfileAssetId && aId !== activeBannerAssetId) {
          const aData = doc.data();
          if (aData?.chunkCount && typeof aData.chunkCount === "number") {
            const chunkDeletes = Array.from({ length: aData.chunkCount }, (_, i) =>
              adminDb.collection("mediaChunks").doc(`${aId}_${i}`).delete().catch(() => {})
            );
            await Promise.all(chunkDeletes);
          }
          await doc.ref.delete().catch(() => {});
          deletedItems.push(`firestore_asset:${aId}`);
        }
      }

      // 2. Clean up Google Drive orphaned files
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
              const tokenData = await tokenRes.json();
              const accessToken = tokenData.access_token;

              if (accessToken) {
                // Find Shinzi folders (Profiles, Banners) and root ast_ files
                const listRes = await fetch(
                  `https://www.googleapis.com/drive/v3/files?q=trashed=false&fields=files(id,name,parents,mimeType)&pageSize=100`,
                  {
                    headers: { Authorization: `Bearer ${accessToken}` },
                  }
                );

                if (listRes.ok) {
                  const listData = await listRes.json();
                  const files: Array<{ id: string; name: string; parents?: string[] }> = listData.files || [];

                  // Find Shinzi subfolders
                  const profileFolder = files.find((f) => f.name === "Profiles");
                  const bannerFolder = files.find((f) => f.name === "Banners");

                  for (const f of files) {
                    const isProfileFile = profileFolder && f.parents?.includes(profileFolder.id);
                    const isBannerFile = bannerFolder && f.parents?.includes(bannerFolder.id);
                    const isRootAstFile = f.name.startsWith("ast_") && f.name.endsWith(".gif");

                    let shouldDelete = false;

                    if (isProfileFile && f.id !== activeProfileDriveId) {
                      shouldDelete = true;
                    } else if (isBannerFile && f.id !== activeBannerDriveId) {
                      shouldDelete = true;
                    } else if (isRootAstFile) {
                      shouldDelete = true;
                    }

                    if (shouldDelete) {
                      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${accessToken}` },
                      }).catch(() => {});
                      deletedItems.push(`drive_file:${f.name}(${f.id})`);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (driveErr) {
        console.warn("[cleanup-old-media] Drive cleanup error:", driveErr);
      }

      return Response.json(
        { ok: true, deletedCount: deletedItems.length, deletedItems },
        { headers: CORS_HEADERS }
      );
    } catch (err: unknown) {
      console.error("[cleanup-old-media] Error:", err);
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "Cleanup failed" },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
