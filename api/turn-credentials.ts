export default {
  async fetch(_request: Request): Promise<Response> {
    const apiKey = process.env.METERED_API_KEY;
    const domain = process.env.METERED_DOMAIN || "service";

    if (apiKey) {
      try {
        const meteredUrl = `https://${domain}.metered.ca/api/v1/turn/credentials?apiKey=${apiKey}`;
        const res = await fetch(meteredUrl);
        if (res.ok) {
          const iceServers = await res.json();
          return Response.json({ ok: true, iceServers }, {
            headers: {
              "Cache-Control": "public, max-age=3600, s-maxage=3600",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      } catch (err) {
        console.warn("[TURN API] Failed to fetch Metered credentials:", err);
      }
    }

    // Default fallback STUN servers
    const fallback = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ];

    return Response.json({ ok: true, iceServers: fallback }, {
      headers: {
        "Cache-Control": "public, max-age=600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
