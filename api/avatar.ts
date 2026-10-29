
import { adminDb } from "./_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const uid = url.searchParams.get("uid");
      const username = url.searchParams.get("u");
      const assetId = url.searchParams.get("assetId");

      let targetUid = uid;
      let targetAssetId = assetId;

      if (!targetUid && username) {
        const snap = await adminDb
          .collection("users")
          .where("username", "==", username.toLowerCase().trim())
          .limit(1)
          .get();
        if (!snap.empty) {
          targetUid = snap.docs[0].id;
          targetAssetId = snap.docs[0].data()?.profileAssetId;
        }
      }

      if (!targetUid && !targetAssetId) {
        return new Response("User ID or asset ID required", { status: 400 });
      }

      // Check if user has a direct photoURL in firestore
      if (targetUid && !targetAssetId) {
        const userDoc = await adminDb.collection("users").doc(targetUid).get();
        if (userDoc.exists) {
          const udata = userDoc.data();
          if (udata?.photoURL && typeof udata.photoURL === "string") {
            if (udata.photoURL.startsWith("http")) {
              return Response.redirect(udata.photoURL, 302);
            }
            if (udata.photoURL.startsWith("data:")) {
              const [header, b64] = udata.photoURL.split(",");
              const mime = header.split(";")[0].replace("data:", "") || "image/jpeg";
              return new Response(Buffer.from(b64, "base64"), {
                headers: {
                  "Content-Type": mime,
                  "Cache-Control": "public, max-age=86400, s-maxage=604800",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
          }
          targetAssetId = udata?.profileAssetId;
        }
      }

      if (!targetAssetId) {
        return new Response("No profile asset associated with user", { status: 404 });
      }

      const assetDoc = await adminDb.collection("assets").doc(targetAssetId).get();
      if (!assetDoc.exists) {
        return new Response("Asset document not found", { status: 404 });
      }

      const asset = assetDoc.data();
      const providerFileId = asset?.providerFileId;
      const ownerUid = asset?.ownerUid || targetUid;
      const mimeType = asset?.mimeType || "image/jpeg";

      if (!providerFileId) {
        return new Response("Provider file ID not found", { status: 404 });
      }

      if (!ownerUid) {
        return new Response("Owner UID not found", { status: 404 });
      }

      // Fetch owner's encrypted refresh token
      const tokenDoc = await adminDb
        .collection("privateDriveTokens")
        .doc(ownerUid)
        .get();

      if (!tokenDoc.exists) {
        return new Response("User Google Drive token not found", { status: 404 });
      }

      const encryptedToken = tokenDoc.data()?.encryptedRefreshToken;
      if (typeof encryptedToken !== "string") {
        return new Response("Encrypted refresh token missing", { status: 404 });
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return new Response("Server Google OAuth configuration is missing", { status: 500 });
      }

      const refreshToken = decryptRefreshToken(encryptedToken);

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return new Response(`Failed to refresh Drive token: ${errText}`, { status: 502 });
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      if (!accessToken) {
        return new Response("Failed to obtain access token", { status: 502 });
      }

      // Stream file directly from Google Drive API
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerFileId)}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!driveRes.ok) {
        const driveErr = await driveRes.text();
        return new Response(`Failed to download Drive file: ${driveErr}`, {
          status: driveRes.status,
        });
      }

      const arrayBuffer = await driveRes.arrayBuffer();

      return new Response(arrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e: any) {
      console.error("Avatar endpoint error:", e);
      return new Response(`Server error: ${e?.message || e}`, { status: 500 });
    }
  },
};
