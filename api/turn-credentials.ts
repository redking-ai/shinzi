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

    // Default fallback configured STUN and TURN servers
    const fallback = [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
          "stun:stun.cloudflare.com:3478",
          "stun:stun.relay.metered.ca:80",
        ],
      },
      {
        urls: [
          "turn:global.relay.metered.ca:80",
          "turn:global.relay.metered.ca:80?transport=tcp",
          "turn:global.relay.metered.ca:443",
          "turn:global.relay.metered.ca:443?transport=tcp",
          "turns:global.relay.metered.ca:443",
          "turns:global.relay.metered.ca:443?transport=tcp",
          "turn:in.relay.metered.ca:80",
          "turn:in.relay.metered.ca:80?transport=tcp",
          "turn:in.relay.metered.ca:443",
          "turn:in.relay.metered.ca:443?transport=tcp",
          "turns:in.relay.metered.ca:443",
          "turns:in.relay.metered.ca:443?transport=tcp",
        ],
        username: "3ec1f3c4e5e23310a5b3ff5c",
        credential: "GU++lCeiZwMovCB8",
      },
    ];

    return Response.json({ ok: true, iceServers: fallback }, {
      headers: {
        "Cache-Control": "public, max-age=600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
