
import { adminAuth } from "../_lib/firebaseAdmin.js";
import { createOAuthState } from "../_lib/driveOAuth.js";

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

      const idToken = authorization.slice("Bearer ".length);
      const decoded = await adminAuth.verifyIdToken(idToken);

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw new Error("Google OAuth configuration is missing");
      }

      const state = createOAuthState(decoded.uid);
      const googleUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth"
      );

      googleUrl.searchParams.set("client_id", clientId);
      googleUrl.searchParams.set("redirect_uri", redirectUri);
      googleUrl.searchParams.set("response_type", "code");
      googleUrl.searchParams.set(
        "scope",
        "openid email https://www.googleapis.com/auth/drive.file"
      );
      googleUrl.searchParams.set("access_type", "offline");
      googleUrl.searchParams.set("include_granted_scopes", "true");
            const body = await request.json().catch(() => ({}));
      const switchAccount = body?.switchAccount === true;

      googleUrl.searchParams.set(
        "prompt",
        switchAccount ? "select_account consent" : "consent"
      );
      googleUrl.searchParams.set("state", state);

      return Response.json({ url: googleUrl.toString() });
    } catch (error) {
      console.error(
        "Drive OAuth start failed:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return Response.json(
        { error: "Could not start Google authorization" },
        { status: 401 }
      );
    }
  },
};
