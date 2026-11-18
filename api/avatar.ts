
import { adminDb } from "./_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";

const avatarMemoryCache = new Map<string, { buffer: Buffer; mimeType: string }>();

function withTimeout<T>(promise: Promise<T>, ms = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Firestore timeout")), ms)
    ),
  ]);
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    let targetUid: string | null = null;
    let targetAssetId: string | null = null;

    try {
      const url = new URL(request.url);
      const uid = url.searchParams.get("uid");
      const username = url.searchParams.get("u");
      const assetId = url.searchParams.get("assetId");

      targetUid = uid;
      targetAssetId = assetId;

      // Instant RAM return if already assembled
      if (targetAssetId && avatarMemoryCache.has(targetAssetId)) {
        const cached = avatarMemoryCache.get(targetAssetId)!;
        return new Response(cached.buffer, {
          status: 200,
          headers: {
            "Content-Type": cached.mimeType,
            "Content-Length": String(cached.buffer.length),
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      if (!targetUid && username) {
        try {
          const snap = await withTimeout(
            adminDb
              .collection("users")
              .where("username", "==", username.toLowerCase().trim())
              .limit(1)
              .get()
          );
          if (!snap.empty) {
            targetUid = snap.docs[0].id;
            targetAssetId = snap.docs[0].data()?.profileAssetId;
          }
        } catch (uErr) {
          console.warn("Username lookup failed:", uErr);
        }
      }

      if (targetAssetId && avatarMemoryCache.has(targetAssetId)) {
        const cached = avatarMemoryCache.get(targetAssetId)!;
        return new Response(cached.buffer, {
          status: 200,
          headers: {
            "Content-Type": cached.mimeType,
            "Content-Length": String(cached.buffer.length),
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      if (!targetUid && !targetAssetId) {
        return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
      }

      // Check if user has a direct photoURL in firestore
      if (targetUid && !targetAssetId) {
        try {
          const userDoc = await withTimeout(adminDb.collection("users").doc(targetUid).get());
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
        } catch (userErr) {
          console.warn("User doc lookup failed (quota or network):", userErr);
        }
      }

      if (!targetAssetId) {
        return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
      }

      if (avatarMemoryCache.has(targetAssetId)) {
        const cached = avatarMemoryCache.get(targetAssetId)!;
        return new Response(cached.buffer, {
          status: 200,
          headers: {
            "Content-Type": cached.mimeType,
            "Content-Length": String(cached.buffer.length),
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      let assetDoc;
      try {
        assetDoc = await withTimeout(adminDb.collection("assets").doc(targetAssetId).get());
      } catch (assetErr) {
        return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
      }

      if (!assetDoc || !assetDoc.exists) {
        return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
      }

      const asset = assetDoc.data();
      const providerFileId = asset?.providerFileId;
      const ownerUid = asset?.ownerUid || targetUid;
      const mimeType = asset?.mimeType || "image/jpeg";

      // 1. If media is stored via Firestore chunks (supports GIFs / media up to 10MB)
      if (asset?.chunkCount && typeof asset.chunkCount === "number" && asset.chunkCount > 0) {
        let fullBuffer: Buffer = Buffer.alloc(0);
        try {
          const chunkCount = asset.chunkCount;
          const chunkDocs = await withTimeout(
            Promise.all(
              Array.from({ length: chunkCount }, (_, i) =>
                adminDb.collection("mediaChunks").doc(`${targetAssetId}_${i}`).get()
              )
            ),
            3000
          );

          const buffers = chunkDocs.map((doc) => {
            const raw = doc.data()?.data;
            if (Buffer.isBuffer(raw)) return raw;
            if (raw && typeof (raw as any).toBuffer === "function") return (raw as any).toBuffer();
            if (raw instanceof Uint8Array) return Buffer.from(raw);
            if (typeof raw === "string") return Buffer.from(raw, "base64");
            return Buffer.alloc(0);
          });

          fullBuffer = Buffer.concat(buffers);
          if (fullBuffer.length > 0) {
            avatarMemoryCache.set(targetAssetId, { buffer: fullBuffer, mimeType });
          }
        } catch (cErr) {
          console.warn("Failed to read chunks within timeout:", cErr);
          return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
        }

        const totalLength = fullBuffer.length;
        if (totalLength === 0) {
          return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
        }
        const rangeHeader = request.headers.get("Range") || request.headers.get("range");

        if (rangeHeader && rangeHeader.startsWith("bytes=")) {
          const parts = rangeHeader.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

          if (!isNaN(start) && start < totalLength) {
            const chunkEnd = Math.min(end, totalLength - 1);
            const chunk = fullBuffer.subarray(start, chunkEnd + 1);
            return new Response(chunk, {
              status: 206,
              headers: {
                "Content-Range": `bytes ${start}-${chunkEnd}/${totalLength}`,
                "Accept-Ranges": "bytes",
                "Content-Length": String(chunk.length),
                "Content-Type": mimeType,
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        }

        return new Response(fullBuffer, {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(totalLength),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // 2. If media has a direct URL or data URI stored
      if (asset?.mediaUrl && typeof asset.mediaUrl === "string") {
        if (asset.mediaUrl.startsWith("http")) {
          return Response.redirect(asset.mediaUrl, 302);
        }
        if (asset.mediaUrl.startsWith("data:")) {
          const [header, b64] = asset.mediaUrl.split(",");
          const mime = header.split(";")[0].replace("data:", "") || mimeType;
          return new Response(Buffer.from(b64, "base64"), {
            headers: {
              "Content-Type": mime,
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

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
        return Response.redirect(`https://lh3.googleusercontent.com/d/${encodeURIComponent(String(providerFileId))}=s800`, 302);
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
      const fullBuffer = Buffer.from(arrayBuffer);
      const totalLength = fullBuffer.length;
      const rangeHeader = request.headers.get("Range") || request.headers.get("range");

      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

        if (!isNaN(start) && start < totalLength) {
          const chunkEnd = Math.min(end, totalLength - 1);
          const chunk = fullBuffer.subarray(start, chunkEnd + 1);
          return new Response(chunk, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${chunkEnd}/${totalLength}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunk.length),
              "Content-Type": mimeType,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      return new Response(fullBuffer, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(totalLength),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e: any) {
      console.error("Avatar endpoint error:", e);
      if (targetAssetId && avatarMemoryCache.has(targetAssetId)) {
        const cached = avatarMemoryCache.get(targetAssetId)!;
        return new Response(cached.buffer, {
          status: 200,
          headers: {
            "Content-Type": cached.mimeType,
            "Content-Length": String(cached.buffer.length),
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return Response.redirect("https://shinzi.vercel.app/icon-192.png", 302);
    }
  },
};
