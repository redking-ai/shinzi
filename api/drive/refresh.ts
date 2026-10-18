
import { adminAuth, adminDb } from "../_lib/firebaseAdmin.js";
import { decryptRefreshToken } from "../_lib/driveOAuth.js";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } }
      );
    }

    try {
      const authorization = request.headers.get("Authorization");

      if (!authorization?.startsWith("Bearer ")) {
        return Response.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      const decoded = await adminAuth.verifyIdToken(
        authorization.slice("Bearer ".length)
      );

      const tokenDoc = await adminDb
        .collection("privateDriveTokens")
        .doc(decoded.uid)
        .get();

      const encryptedToken = tokenDoc.get("encryptedRefreshToken");

      if (typeof encryptedToken !== "string") {
        return Response.json(
          { error: "Google Drive is not connected" },
          { status: 404 }
        );
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error("Google OAuth configuration is missing");
      }

      const refreshToken = decryptRefreshToken(encryptedToken);

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
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
        }
      );

      const tokens = await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        typeof tokens.access_token !== "string"
      ) {
        console.error("Google token refresh failed:", tokens.error);

        return Response.json(
          { error: "Google authorization expired; reconnect Drive" },
          { status: 401 }
        );
      }

      return Response.json({
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in ?? 3600,
      });
    } catch (error) {
      console.error(
        "Drive token refresh failed:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return Response.json(
        { error: "Could not refresh Google authorization" },
        { status: 401 }
      );
    }
  },
};
