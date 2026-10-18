
import { adminDb } from "../_lib/firebaseAdmin.js";
import {
  encryptRefreshToken,
  verifyOAuthState,
} from "../_lib/driveOAuth.js";

const SITE_URL = "https://shinzi.vercel.app";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "GET" } }
      );
    }

    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const oauthError = requestUrl.searchParams.get("error");

    const fail = (reason: string) =>
      Response.redirect(
        `${SITE_URL}/?drive=error&reason=${encodeURIComponent(reason)}`,
        303
      );

    if (oauthError) return fail("authorization_denied");
    if (!code || !state) return fail("missing_parameters");

    try {
      const verifiedState = verifyOAuthState(state);
      if (!verifiedState) return fail("invalid_or_expired_state");

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error("Google OAuth configuration is missing");
      }

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        }
      );

      const tokens = await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        typeof tokens.access_token !== "string"
      ) {
        console.error("Google token exchange failed:", tokens.error);
        return fail("token_exchange_failed");
      }

      const tokenDoc = adminDb
        .collection("privateDriveTokens")
        .doc(verifiedState.uid);

      // Google may omit refresh_token when an account has already
      // granted access. Preserve an existing refresh token in that case.
      if (typeof tokens.refresh_token === "string") {
        await tokenDoc.set(
          {
            encryptedRefreshToken: encryptRefreshToken(
              tokens.refresh_token
            ),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } else {
        const existing = await tokenDoc.get();

        if (!existing.exists) {
          return fail("refresh_token_missing_reconnect_required");
        }
      }

      return Response.redirect(
        `${SITE_URL}/?drive=connected`,
        303
      );
    } catch (error) {
      console.error(
        "Drive OAuth callback failed:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return fail("callback_failed");
    }
  },
};
