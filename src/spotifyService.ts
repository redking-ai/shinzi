import { doc, getDoc, setDoc, updateDoc, deleteField, onSnapshot } from 'firebase/firestore';
import { db } from './firebaseConfig';

export interface SpotifyPresenceData {
  isPlaying: boolean;
  trackName: string;
  artistName: string;
  albumArtUrl: string;
  durationMs: number;
  progressMs: number;
  trackUrl: string;
  updatedAt: number;
}

export type SupportedPlatformId = 'spotify' | 'telegram' | 'youtube' | 'facebook';

export interface PlatformConnection {
  platformId: SupportedPlatformId | string;
  username: string;
  displayName: string;
  profileUrl: string;
  accessToken?: string;
  refreshToken?: string;
  displayOnProfile: boolean;
  displayAsStatus?: boolean;
  // YouTube extra fields & toggles
  subscribersCount?: string | number;
  showSubscribers?: boolean;
  // Facebook extra fields & toggles
  followersCount?: string | number;
  friendsCount?: string | number;
  showFollowers?: boolean;
  showFriends?: boolean;
  connectedAt: number;
  presence?: SpotifyPresenceData | null;
}

export interface PlatformMeta {
  id: SupportedPlatformId;
  name: string;
  icon: string;
  placeholder: string;
  profileUrlPrefix: string;
}

export const PLATFORM_REGISTRY: Record<SupportedPlatformId, PlatformMeta> = {
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    icon: 'logos:spotify-icon',
    placeholder: 'Spotify User',
    profileUrlPrefix: 'https://open.spotify.com/user/',
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    icon: 'logos:telegram',
    placeholder: 'username',
    profileUrlPrefix: 'https://t.me/',
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    icon: 'logos:youtube-icon',
    placeholder: 'Channel Name',
    profileUrlPrefix: 'https://youtube.com/',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    icon: 'logos:facebook',
    placeholder: 'Facebook User',
    profileUrlPrefix: 'https://facebook.com/',
  },
};

export function getPlatformMeta(platformId: string): PlatformMeta {
  if (platformId in PLATFORM_REGISTRY) {
    return PLATFORM_REGISTRY[platformId as SupportedPlatformId];
  }
  return {
    id: platformId as SupportedPlatformId,
    name: platformId.charAt(0).toUpperCase() + platformId.slice(1),
    icon: 'lucide:globe',
    placeholder: 'username',
    profileUrlPrefix: '#',
  };
}

export const SPOTIFY_CLIENT_ID = 'fa5ce3a5bd7c4926863809cf6dab28d8';

export function getSpotifyAuthUrl(): string {
  const redirectUri = window.location.origin;
  const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-read-recently-played',
    'user-read-private',
    'user-read-email',
  ].join('%20');
  
  return `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scopes}&show_dialog=true`;
}

export async function fetchSpotifyProfile(accessToken: string): Promise<{ displayName: string; profileUrl: string }> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      return {
        displayName: data.display_name || data.id || 'Spotify User',
        profileUrl: data.external_urls?.spotify || 'https://open.spotify.com',
      };
    }
  } catch (err) {
    console.warn('[spotifyService] Failed to fetch Spotify profile:', err);
  }
  return { displayName: 'Spotify User', profileUrl: 'https://open.spotify.com' };
}

export async function fetchSpotifyCurrentlyPlaying(accessToken: string): Promise<SpotifyPresenceData | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      throw new Error('401');
    }
    if (res.status === 204 || res.status === 200) {
      if (res.status === 204) {
        return {
          isPlaying: false,
          trackName: '',
          artistName: '',
          albumArtUrl: '',
          durationMs: 0,
          progressMs: 0,
          trackUrl: '',
          updatedAt: Date.now(),
        };
      }
      const data = await res.json();
      if (!data || !data.item) {
        return {
          isPlaying: false,
          trackName: '',
          artistName: '',
          albumArtUrl: '',
          durationMs: 0,
          progressMs: 0,
          trackUrl: '',
          updatedAt: Date.now(),
        };
      }
      return {
        isPlaying: Boolean(data.is_playing),
        trackName: data.item.name || '',
        artistName: data.item.artists?.map((a: any) => a.name).join(', ') || '',
        albumArtUrl: data.item.album?.images?.[0]?.url || '',
        durationMs: data.item.duration_ms || 0,
        progressMs: data.progress_ms || 0,
        trackUrl: data.item.external_urls?.spotify || '',
        updatedAt: Date.now(),
      };
    }
  } catch (err: any) {
    if (err?.message === '401') throw err;
    console.warn('[spotifyService] Error fetching currently playing:', err);
  }
  return null;
}

export async function refreshSpotifyAccessToken(
  clientId: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (res.ok) {
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
      };
    }
  } catch (e) {
    console.warn('[spotifyService] Failed to refresh Spotify token:', e);
  }
  return null;
}

export async function updateSpotifyTokens(
  uid: string,
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  const updates: Record<string, any> = {
    'spotify.accessToken': accessToken,
  };
  if (refreshToken) {
    updates['spotify.refreshToken'] = refreshToken;
  }
  await updateDoc(ref, updates);
}

export async function getUserConnections(uid: string): Promise<Record<string, PlatformConnection>> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'platforms', 'connections'));
    if (snap.exists()) {
      return (snap.data() as Record<string, PlatformConnection>) || {};
    }
  } catch (e) {
    console.warn('[spotifyService] Failed to load connections:', e);
  }
  return {};
}

export function subscribeUserConnections(
  uid: string,
  callback: (connections: Record<string, PlatformConnection>) => void
) {
  return onSnapshot(
    doc(db, 'users', uid, 'platforms', 'connections'),
    (snap) => {
      if (snap.exists()) {
        callback((snap.data() as Record<string, PlatformConnection>) || {});
      } else {
        callback({});
      }
    },
    (err) => {
      console.warn('[spotifyService] subscribeUserConnections error:', err);
      callback({});
    }
  );
}

export async function savePlatformConnection(
  uid: string,
  connection: PlatformConnection
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  await setDoc(
    ref,
    {
      [connection.platformId]: connection,
    },
    { merge: true }
  );
}

export async function updatePlatformToggles(
  uid: string,
  platformId: string,
  displayOnProfile: boolean,
  displayAsStatus?: boolean
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  const updateData: Record<string, any> = {
    [`${platformId}.displayOnProfile`]: displayOnProfile,
  };
  if (typeof displayAsStatus === 'boolean') {
    updateData[`${platformId}.displayAsStatus`] = displayAsStatus;
  }
  await updateDoc(ref, updateData);
}

export async function updatePlatformCustomToggle(
  uid: string,
  platformId: string,
  toggleField: string,
  toggleValue: boolean
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  await updateDoc(ref, {
    [`${platformId}.${toggleField}`]: toggleValue,
  });
}

export async function disconnectPlatform(uid: string, platformId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  await updateDoc(ref, {
    [platformId]: deleteField(),
  });
}

export async function updateSpotifyPresence(
  uid: string,
  presence: SpotifyPresenceData | null
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  await updateDoc(ref, {
    'spotify.presence': presence,
  });
}
