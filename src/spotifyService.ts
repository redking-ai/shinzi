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

export interface PlatformConnection {
  platformId: 'spotify';
  username: string;
  displayName: string;
  profileUrl: string;
  displayOnProfile: boolean;
  displayAsStatus: boolean;
  connectedAt: number;
  presence?: SpotifyPresenceData | null;
}

// Client-side Spotify Integration and Demo Simulation Support
const SPOTIFY_CLIENT_ID = '3ec1f3c4e5e23310a5b3ff5c'; // fallback or user-provided clientId

export function getSpotifyAuthUrl(redirectUri: string): string {
  const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-read-recently-played',
  ].join('%20');
  
  return `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${scopes}&show_dialog=true`;
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
  displayAsStatus: boolean
): Promise<void> {
  const ref = doc(db, 'users', uid, 'platforms', 'connections');
  await updateDoc(ref, {
    [`${platformId}.displayOnProfile`]: displayOnProfile,
    [`${platformId}.displayAsStatus`]: displayAsStatus,
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
