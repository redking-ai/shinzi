// PKCE (Proof Key for Code Exchange) for Spotify Authorization Code Flow

function generateRandomString(length: number): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function redirectToSpotifyAuthorize(clientId: string, redirectUri: string) {
  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);

  try {
    localStorage.setItem('spotify_code_verifier', verifier);
  } catch {}
  try {
    sessionStorage.setItem('spotify_code_verifier', verifier);
  } catch {}
  try {
    document.cookie = `spotify_code_verifier=${encodeURIComponent(verifier)}; path=/; max-age=1800; SameSite=Lax`;
  } catch {}

  const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-read-recently-played',
    'user-read-private',
    'user-read-email',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: scopes,
    show_dialog: 'true',
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  let verifier = '';
  try {
    verifier = localStorage.getItem('spotify_code_verifier') || sessionStorage.getItem('spotify_code_verifier') || '';
    if (!verifier && typeof document !== 'undefined') {
      const match = document.cookie.match(/spotify_code_verifier=([^;]+)/);
      if (match) verifier = decodeURIComponent(match[1]);
    }
  } catch {}

  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[spotifyPkce] Token exchange failed response:', errorText);
    throw new Error(`Failed to exchange code for token: ${errorText}`);
  }

  const data = await response.json();
  try {
    localStorage.removeItem('spotify_code_verifier');
  } catch {}

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}
