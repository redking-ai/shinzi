import { adminDb } from './_lib/firebaseAdmin.js';

const SPOTIFY_CLIENT_ID = 'fa5ce3a5bd7c4926863809cf6dab28d8';

export default {
  async fetch(request: Request): Promise<Response> {
    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
    }

    try {
      const body = (await request.json().catch(() => ({}))) as any;
      const { uid, code, redirectUri, codeVerifier } = body;

      if (!uid) {
        return Response.json({ error: 'Missing uid' }, { status: 400, headers: CORS_HEADERS });
      }

      let accessToken = '';
      let displayName = 'Sab Official';
      let profileUrl = 'https://open.spotify.com';
      let currentPlaying: any = null;

      if (code && redirectUri) {
        try {
          const params = new URLSearchParams({
            client_id: SPOTIFY_CLIENT_ID,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier || '',
          });

          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
          });

          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            accessToken = tokenData.access_token || '';

            if (accessToken) {
              const profRes = await fetch('https://api.spotify.com/v1/me', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (profRes.ok) {
                const profData = await profRes.json();
                if (profData.display_name) displayName = profData.display_name;
                if (profData.external_urls?.spotify) profileUrl = profData.external_urls.spotify;
              }

              const playRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (playRes.ok && playRes.status === 200) {
                const playData = await playRes.json();
                if (playData?.item) {
                  currentPlaying = {
                    isPlaying: Boolean(playData.is_playing),
                    trackName: playData.item.name || '',
                    artistName: playData.item.artists?.map((a: any) => a.name).join(', ') || '',
                    albumArtUrl: playData.item.album?.images?.[0]?.url || '',
                    durationMs: playData.item.duration_ms || 0,
                    progressMs: playData.progress_ms || 0,
                    trackUrl: playData.item.external_urls?.spotify || '',
                    updatedAt: Date.now(),
                  };
                }
              }
            }
          }
        } catch (e) {
          console.warn('[api/spotify-connect] Token exchange notice:', e);
        }
      }

      const newConn = {
        platformId: 'spotify',
        username: displayName,
        displayName: displayName,
        profileUrl: profileUrl,
        accessToken: accessToken || undefined,
        displayOnProfile: true,
        displayAsStatus: true,
        connectedAt: Date.now(),
        presence: currentPlaying,
      };

      await adminDb
        .collection('users')
        .doc(uid)
        .collection('platforms')
        .doc('connections')
        .set(
          {
            spotify: newConn,
          },
          { merge: true }
        );

      return Response.json({ ok: true, connection: newConn }, { headers: CORS_HEADERS });
    } catch (err: any) {
      console.error('[api/spotify-connect] Error:', err);
      return Response.json({ error: err.message || 'Internal error' }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
