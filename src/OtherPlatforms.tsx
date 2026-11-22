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
} from './spotifyService';
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

  const handleConnectSpotify = async () => {
    if (!currentUser) return;
    setAuthConnecting(true);

    // Simulate authenticating Spotify (or using web prompt/dialog)
    const mockSpotifyUser = 'Spotify Lover';
    const mockConnection: PlatformConnection = {
      platformId: 'spotify',
      username: 'spotify_user',
      displayName: mockSpotifyUser,
      profileUrl: 'https://open.spotify.com/user/spotify',
      displayOnProfile: true,
      displayAsStatus: true,
      connectedAt: Date.now(),
      presence: {
        isPlaying: true,
        trackName: 'Noche Eterna - Ultra Slowed',
        artistName: 'Flame Runner, RVNGE',
        albumArtUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150&auto=format&fit=crop&q=80',
        durationMs: 109000, // 01:49
        progressMs: 45000,  // 00:45
        trackUrl: 'https://open.spotify.com',
        updatedAt: Date.now(),
      },
    };

    try {
      await savePlatformConnection(currentUser.uid, mockConnection);
      setShowAddSheet(false);
      setShowAuthConfirm(true);
    } catch (err) {
      console.error('Failed to connect Spotify:', err);
    } finally {
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
