import { adminDb, adminAuth } from "./_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "./_lib/driveOAuth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // ========================================================
    // POST / DELETE: Delete Media / File from Google Drive
    // ========================================================
    if (request.method === "POST" || request.method === "DELETE") {
      try {
        const body = await request.json().catch(() => ({}));
        const fileId = body.fileId || url.searchParams.get("fileId");
        const ownerUid = body.ownerUid || url.searchParams.get("ownerUid");
        const authHeader =
          request.headers.get("authorization") ||
          request.headers.get("Authorization") ||
          "";

        if (!fileId) {
          return Response.json(
            { ok: false, error: "fileId is required" },
            { status: 400, headers: CORS_HEADERS }
          );
        }

        let requesterUid = "";
        if (authHeader.startsWith("Bearer ")) {
          try {
            const decoded = await adminAuth.verifyIdToken(authHeader.slice(7).trim());
            requesterUid = decoded.uid;
          } catch {}
        }

        const targetOwnerUid = ownerUid || requesterUid;
        if (!targetOwnerUid) {
          return Response.json(
            { ok: false, error: "ownerUid or valid authorization is required" },
            { status: 401, headers: CORS_HEADERS }
          );
        }

        const tokenDoc = await adminDb
          .collection("privateDriveTokens")
          .doc(targetOwnerUid)
          .get();

        if (!tokenDoc.exists) {
          return Response.json(
            { ok: false, error: "User Drive token not found" },
            { status: 404, headers: CORS_HEADERS }
          );
        }

        const encToken = tokenDoc.data()?.encryptedRefreshToken;
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (!encToken || !clientId || !clientSecret) {
          return Response.json(
            { ok: false, error: "OAuth config or token missing" },
            { status: 500, headers: CORS_HEADERS }
          );
        }

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

        if (!tokenRes.ok) {
          return Response.json(
            { ok: false, error: "Failed to refresh Drive token" },
            { status: 502, headers: CORS_HEADERS }
          );
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const delRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        return Response.json(
          { ok: delRes.ok || delRes.status === 404, deleted: true },
          { headers: CORS_HEADERS }
        );
      } catch (err: unknown) {
        console.error("[api/media] Delete error:", err);
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : "Delete failed" },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // ========================================================
    // GET / HEAD: Stream or Download Media from Google Drive
    // ========================================================
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    try {
      const fileId = url.searchParams.get("fileId");
      const ownerUid = url.searchParams.get("ownerUid");
      const download = url.searchParams.get("dl") === "1" || url.searchParams.get("download") === "true";
      const fileName = url.searchParams.get("name") || "download";

      if (!fileId) {
        return new Response("fileId required", { status: 400, headers: CORS_HEADERS });
      }

      let accessToken = "";
      if (ownerUid) {
        const tokenDoc = await adminDb
          .collection("privateDriveTokens")
          .doc(ownerUid)
          .get();

        if (tokenDoc.exists) {
          const encToken = tokenDoc.data()?.encryptedRefreshToken;
          const clientId = process.env.GOOGLE_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

          if (encToken && clientId && clientSecret) {
            try {
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
                accessToken = tokenData.access_token || "";
              }
            } catch (authErr) {
              console.warn("[api/media] Token refresh failed:", authErr);
            }
          }
        }
      }

      let driveRes: Response | null = null;
      if (accessToken) {
        try {
          driveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (fetchErr) {
          console.warn("[api/media] Authenticated fetch error:", fetchErr);
        }
      }

      // If no access token or OAuth request returned 401/403/404, fall back to Google public Drive CDN
      if (!driveRes || !driveRes.ok) {
        try {
          // 1. Try Google User Content CDN (instant for images, photos, GIFs, thumbnails)
          const lh3Res = await fetch(
            `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s0`
          );
          if (lh3Res.ok && (lh3Res.headers.get("content-type") || "").startsWith("image/")) {
            driveRes = lh3Res;
          }
        } catch {}

        if (!driveRes || !driveRes.ok) {
          try {
            // 2. Try Google Drive direct export download
            const publicRes = await fetch(
              `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
              { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
            );
            if (publicRes.ok) {
              driveRes = publicRes;
            }
          } catch {}
        }
      }

      if (!driveRes || !driveRes.ok) {
        return Response.json(
          {
            ok: false,
            unavailable: true,
            error: "File is unavailable. Please ask sender to send again.",
          },
          { status: 410, headers: CORS_HEADERS }
        );
      }

      const mimeType = driveRes.headers.get("content-type") || "application/octet-stream";
      const arrayBuffer = await driveRes.arrayBuffer();
      const fullBuffer = Buffer.from(arrayBuffer);
      const totalLength = fullBuffer.length;
      const rangeHeader = request.headers.get("Range") || request.headers.get("range");

      const disposition = download
        ? `attachment; filename="${encodeURIComponent(fileName)}"`
        : `inline; filename="${encodeURIComponent(fileName)}"`;

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
              ...CORS_HEADERS,
              "Content-Range": `bytes ${start}-${chunkEnd}/${totalLength}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunk.length),
              "Content-Type": mimeType,
              "Content-Disposition": disposition,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }

      return new Response(fullBuffer, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": mimeType,
          "Content-Length": String(totalLength),
          "Content-Disposition": disposition,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400, s-maxage=604800",
        },
      });
    } catch (err: unknown) {
      console.error("[api/media] Stream error:", err);
      return new Response(
        `Media error: ${err instanceof Error ? err.message : "Unknown error"}`,
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
