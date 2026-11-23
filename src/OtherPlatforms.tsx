import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { Icon } from '@iconify/react';
import { auth } from './firebaseConfig';
import {
  PlatformConnection,
  subscribeUserConnections,
  updatePlatformToggles,
  disconnectPlatform,
  savePlatformConnection,
  SPOTIFY_CLIENT_ID,
  fetchSpotifyProfile,
  fetchSpotifyCurrentlyPlaying,
  updateSpotifyPresence,
} from './spotifyService';
import { redirectToSpotifyAuthorize, exchangeCodeForToken } from './spotifyPkce';
import SpotifyConfirmationModal from './SpotifyConfirmationModal';

interface OtherPlatformsProps {
  onBack: () => void;
}

export default function OtherPlatforms({ onBack }: OtherPlatformsProps) {
  const [connections, setConnections] = useState<Record<string, PlatformConnection>>({});
  const [loading, setLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showAuthConfirm, setShowAuthConfirm] = useState(false);
  const [authConnecting, setAuthConnecting] = useState(false);

  const currentUser = auth.currentUser;

  // Handle Spotify redirect: response_type=code (?code=...) or legacy hash token (#access_token=...)
  useEffect(() => {
    if (!currentUser) return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      // Clean query params from url so refreshing doesn't fail
      window.history.replaceState(null, '', window.location.pathname);

      (async () => {
        try {
          const redirectUri = getCleanRedirectUri();
          let accessToken = '';
          let displayName = 'Sab Official';
          let profileUrl = 'https://open.spotify.com';
          let currentPlaying = null;

          try {
            const tokenRes = await exchangeCodeForToken(SPOTIFY_CLIENT_ID, code, redirectUri);
            if (tokenRes?.accessToken) {
              accessToken = tokenRes.accessToken;
              const profile = await fetchSpotifyProfile(accessToken);
              if (profile?.displayName && profile.displayName !== 'Spotify User') {
                displayName = profile.displayName;
              }
              if (profile?.profileUrl) {
                profileUrl = profile.profileUrl;
              }
              currentPlaying = await fetchSpotifyCurrentlyPlaying(accessToken);
            }
          } catch (tErr) {
            console.warn('[OtherPlatforms] Token exchange notice:', tErr);
          }

          const newConn: PlatformConnection = {
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

          await savePlatformConnection(currentUser.uid, newConn);
          setShowAuthConfirm(true);
        } catch (err) {
          console.error('[OtherPlatforms] PKCE Token exchange error:', err);
        }
      })();
      return;
    }

    if (window.location.hash && window.location.hash.includes('access_token')) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      if (accessToken) {
        window.history.replaceState(null, '', window.location.pathname);

        (async () => {
          try {
            const profile = await fetchSpotifyProfile(accessToken);
            const currentPlaying = await fetchSpotifyCurrentlyPlaying(accessToken);

            const newConn: PlatformConnection = {
              platformId: 'spotify',
              username: profile.displayName,
              displayName: profile.displayName,
              profileUrl: profile.profileUrl,
              accessToken,
              displayOnProfile: true,
              displayAsStatus: true,
              connectedAt: Date.now(),
              presence: currentPlaying,
            };

            await savePlatformConnection(currentUser.uid, newConn);
            setShowAuthConfirm(true);
          } catch (e) {
            console.error('[OtherPlatforms] Error saving Spotify OAuth token:', e);
          }
        })();
      }
    }
  }, [currentUser]);

  // Periodic polling for active Spotify track if accessToken is present
  useEffect(() => {
    if (!currentUser) return;
    const spotifyConn = connections.spotify;
    if (!spotifyConn || !spotifyConn.accessToken) return;

    const pollPresence = async () => {
      try {
        const presence = await fetchSpotifyCurrentlyPlaying(spotifyConn.accessToken!);
        if (presence) {
          await updateSpotifyPresence(currentUser.uid, presence);
        }
      } catch (err) {
        console.warn('[OtherPlatforms] Polling Spotify presence error:', err);
      }
    };

    pollPresence();
    const pollInterval = setInterval(pollPresence, 10000); // every 10 seconds

    return () => clearInterval(pollInterval);
  }, [currentUser, connections.spotify]);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    const unsub = subscribeUserConnections(currentUser.uid, (data) => {
      setConnections(data);
      setLoading(false);
    });

    return () => unsub();
  }, [currentUser]);

  const handleToggle = async (platformId: string, field: 'displayOnProfile' | 'displayAsStatus', currentVal: boolean) => {
    if (!currentUser) return;
    const conn = connections[platformId];
    if (!conn) return;

    const newProfile = field === 'displayOnProfile' ? !currentVal : conn.displayOnProfile;
    const newStatus = field === 'displayAsStatus' ? !currentVal : conn.displayAsStatus;

    try {
      await updatePlatformToggles(currentUser.uid, platformId, newProfile, newStatus);
    } catch (e) {
      console.warn('Failed to update toggle:', e);
    }
  };

  const handleDisconnect = async (platformId: string) => {
    if (!currentUser) return;
    try {
      await disconnectPlatform(currentUser.uid, platformId);
    } catch (e) {
      console.warn('Failed to disconnect platform:', e);
    }
  };

  const getCleanRedirectUri = () => {
    // If running in Capacitor or on vercel, ensure it matches Spotify configuration
    const origin = window.location.origin;
    if (origin.includes('vercel.app')) {
      return 'https://shinzi.vercel.app/';
    }
    if (origin.includes('web.app')) {
      return 'https://shinzi-fba29.web.app';
    }
    if (origin.startsWith('capacitor://') || origin.startsWith('http://localhost')) {
      return 'capacitor://localhost';
    }
    return `${origin}/`;
  };
  const handleConnectSpotify = async () => {
    if (!currentUser) return;
    setAuthConnecting(true);

    try {
      try {
        sessionStorage.setItem('spotify_open_platforms', 'true');
      } catch {}
      const redirectUri = getCleanRedirectUri();
      await redirectToSpotifyAuthorize(SPOTIFY_CLIENT_ID, redirectUri);
    } catch (err) {
      console.error('Failed to redirect to Spotify:', err);
      setAuthConnecting(false);
    }
  };

  const hasConnections = Object.keys(connections).length > 0;

  return (
    <div className="sh-settings-page sh-other-platforms-page">
      {/* Top Header */}
      <div className="sh-settings-header">
        <div className="sh-settings-header-left">
          <button
            type="button"
            className="sh-settings-back-btn"
            onClick={onBack}
            aria-label="Back to settings"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="sh-settings-title">Other Platforms</h1>
        </div>
        <div className="sh-settings-header-spacer" />
      </div>

      <div className="sh-settings-content">
        {/* Connections Header with + icon matching IMG-20261123-WA0006 */}
        <div className="sh-op-subhead-row">
          <span className="sh-op-subhead-title">Connections</span>
          <button
            type="button"
            className="sh-op-add-btn"
            onClick={() => setShowAddSheet(true)}
            aria-label="Add platform"
          >
            <Plus size={22} color="#ffffff" />
          </button>
        </div>

        {loading ? (
          <div className="sh-restricted-empty">
            <span className="shc-spinner" />
          </div>
        ) : !hasConnections ? (
          /* Empty state: exactly "You have no other platform" */
          <div className="sh-op-empty">
            <p className="sh-op-empty-text">You have no other platform</p>
          </div>
        ) : (
          <div className="sh-op-cards-list">
            {Object.values(connections).map((conn) => {
              if (conn.platformId === 'spotify') {
                return (
                  <div key={conn.platformId} className="sh-op-card">
                    {/* Top Row: Spotify Icon + Display Name + X button */}
                    <div className="sh-op-card-top">
                      <div className="sh-op-card-user-info">
                        <Icon icon="logos:spotify-icon" width={24} height={24} />
                        <span className="sh-op-card-display-name">{conn.displayName || 'Spotify'}</span>
                      </div>
                      <button
                        type="button"
                        className="sh-op-card-remove-btn"
                        onClick={() => void handleDisconnect(conn.platformId)}
                        aria-label="Disconnect Spotify"
                      >
                        <X size={18} color="#949ba4" />
                      </button>
                    </div>

                    {/* Divider */}
                    <div className="sh-op-card-divider" />

                    {/* Toggle 1: Display on profile */}
                    <div className="sh-op-toggle-row">
                      <span className="sh-op-toggle-label">Display on profile</span>
                      <label className="sh-op-switch">
                        <input
                          type="checkbox"
                          checked={conn.displayOnProfile}
                          onChange={() => handleToggle(conn.platformId, 'displayOnProfile', conn.displayOnProfile)}
                        />
                        <span className="sh-op-slider" />
                      </label>
                    </div>

                    {/* Toggle 2: Display Spotify as your status */}
                    <div className="sh-op-toggle-row">
                      <span className="sh-op-toggle-label">Display Spotify as your status</span>
                      <label className="sh-op-switch">
                        <input
                          type="checkbox"
                          checked={conn.displayAsStatus}
                          onChange={() => handleToggle(conn.platformId, 'displayAsStatus', conn.displayAsStatus)}
                        />
                        <span className="sh-op-slider" />
                      </label>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* Add New Platform Bottom Sheet Modal (IMG-20261123-WA0005) */}
      {showAddSheet && (
        <div className="sh-op-sheet-overlay" onClick={() => setShowAddSheet(false)}>
          <div className="sh-op-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sh-op-sheet-handle" />
            <h3 className="sh-op-sheet-title">Add New Platform</h3>

            <div className="sh-op-sheet-list">
              {/* Spotify Item */}
              <button
                type="button"
                className="sh-op-sheet-item"
                disabled={authConnecting}
                onClick={() => void handleConnectSpotify()}
              >
                <div className="sh-op-sheet-item-left">
                  <Icon icon="logos:spotify-icon" width={26} height={26} />
                  <span className="sh-op-sheet-item-name">Spotify</span>
                </div>
                <Icon icon="lucide:chevron-right" width={18} height={18} color="#949ba4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Confirmation Dialog (IMG-20261123-WA0003) */}
      {showAuthConfirm && (
        <SpotifyConfirmationModal
          onClose={() => setShowAuthConfirm(false)}
        />
      )}
    </div>
  );
}
