import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Icon } from '@iconify/react';
import { auth } from './firebaseConfig';
import {
  PlatformConnection,
  SupportedPlatformId,
  getPlatformMeta,
  subscribeUserConnections,
  getUserConnections,
  updatePlatformToggles,
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

const ALL_SUPPORTED_PLATFORMS: SupportedPlatformId[] = ['spotify', 'instagram', 'x', 'telegram'];

export default function OtherPlatforms({ onBack }: OtherPlatformsProps) {
  const [connections, setConnections] = useState<Record<string, PlatformConnection>>({});
  const [loading, setLoading] = useState(true);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showAuthConfirm, setShowAuthConfirm] = useState(false);
  const [authConnecting, setAuthConnecting] = useState(false);
  const [connectModalPlatform, setConnectModalPlatform] = useState<SupportedPlatformId | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const telegramWidgetRef = useRef<HTMLDivElement | null>(null);

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
          let refreshToken = '';
          let displayName = 'Sab Official';
          let profileUrl = 'https://open.spotify.com';
          let currentPlaying = null;

          try {
            const tokenRes = await exchangeCodeForToken(SPOTIFY_CLIENT_ID, code, redirectUri);
            if (tokenRes?.accessToken) {
              accessToken = tokenRes.accessToken;
              if (tokenRes.refreshToken) refreshToken = tokenRes.refreshToken;
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
            refreshToken: refreshToken || undefined,
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
      const state = hashParams.get('state');
      if (accessToken) {
        window.history.replaceState(null, '', window.location.pathname);

        if (state && state.startsWith('instagram_')) {
          (async () => {
            try {
              let igName = 'Instagram User';
              try {
                const res = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${accessToken}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.name) igName = data.name;
                }
              } catch {}

              const cleanUser = igName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
              const newConn: PlatformConnection = {
                platformId: 'instagram',
                username: cleanUser,
                displayName: `@${cleanUser}`,
                profileUrl: `https://instagram.com/${cleanUser}`,
                displayOnProfile: true,
                displayAsStatus: true,
                connectedAt: Date.now(),
              };

              await savePlatformConnection(currentUser.uid, newConn);
              setConnections((prev) => ({ ...prev, instagram: newConn }));
              setShowAuthConfirm(true);
            } catch (e) {
              console.error('[OtherPlatforms] Error saving Instagram token:', e);
            }
          })();
        } else {
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
              setConnections((prev) => ({ ...prev, spotify: newConn }));
              setShowAuthConfirm(true);
            } catch (e) {
              console.error('[OtherPlatforms] Error saving Spotify OAuth token:', e);
            }
          })();
        }
      }
    }
  }, [currentUser]);

  // Mount Telegram Login Widget dynamically when Telegram modal is open
  useEffect(() => {
    if (connectModalPlatform === 'telegram' && telegramWidgetRef.current) {
      telegramWidgetRef.current.innerHTML = '';

      (window as any).onTelegramAuth = async (user: any) => {
        if (!currentUser) return;
        try {
          const uname = user.username || user.first_name || 'Telegram User';
          const newConn: PlatformConnection = {
            platformId: 'telegram',
            username: uname,
            displayName: user.username ? `@${user.username}` : user.first_name,
            profileUrl: user.username ? `https://t.me/${user.username}` : `https://t.me/Shinzi_connect_bot`,
            displayOnProfile: true,
            displayAsStatus: true,
            connectedAt: Date.now(),
          };
          await savePlatformConnection(currentUser.uid, newConn);
          setConnections((prev) => ({ ...prev, telegram: newConn }));
          setConnectModalPlatform(null);
        } catch (err) {
          console.error('Failed to save Telegram connection:', err);
        }
      };

      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.setAttribute('data-telegram-login', 'Shinzi_connect_bot');
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-radius', '8');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      script.setAttribute('data-request-access', 'write');
      script.async = true;
      telegramWidgetRef.current.appendChild(script);
    }
  }, [connectModalPlatform, currentUser]);

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

    const reloadConnections = async () => {
      try {
        const fresh = await getUserConnections(currentUser.uid);
        if (fresh && Object.keys(fresh).length > 0) {
          setConnections(fresh);
        }
      } catch {}
    };

    const unsub = subscribeUserConnections(currentUser.uid, (data) => {
      setConnections(data);
      setLoading(false);
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reloadConnections();
      }
    };
    const onFocus = () => {
      reloadConnections();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      unsub();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentUser]);

  const handleToggle = async (platformId: string, field: 'displayOnProfile' | 'displayAsStatus', currentVal: boolean) => {
    if (!currentUser) return;
    const conn = connections[platformId];
    if (!conn) return;

    const newProfile = field === 'displayOnProfile' ? !currentVal : conn.displayOnProfile;
    const newStatus = field === 'displayAsStatus' ? !currentVal : conn.displayAsStatus;

    // Optimistically update local state so toggle flips instantly
    setConnections((prev) => ({
      ...prev,
      [platformId]: {
        ...prev[platformId],
        displayOnProfile: newProfile,
        displayAsStatus: newStatus,
      },
    }));

    try {
      await updatePlatformToggles(currentUser.uid, platformId, newProfile, newStatus);
    } catch (e) {
      console.warn('Failed to update toggle:', e);
      // Revert on error
      setConnections((prev) => ({
        ...prev,
        [platformId]: {
          ...prev[platformId],
          displayOnProfile: conn.displayOnProfile,
          displayAsStatus: conn.displayAsStatus,
        },
      }));
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
      await redirectToSpotifyAuthorize(SPOTIFY_CLIENT_ID, redirectUri, currentUser.uid);
    } catch (err) {
      console.error('Failed to redirect to Spotify:', err);
      setAuthConnecting(false);
    }
  };

  const handleOpenConnectModal = (pId: SupportedPlatformId) => {
    setShowAddSheet(false);
    setConnectModalPlatform(pId);
    setUsernameInput('');
    setInputError(null);
    setShowManualInput(pId === 'x');
  };

  const handleConnectInstagram = () => {
    if (!currentUser) return;
    const redirectUri = getCleanRedirectUri();
    const appId = '1614970446979837';
    const url = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=public_profile&state=instagram_${currentUser.uid}`;
    window.location.href = url;
  };

  const handleConfirmConnectUsername = async () => {
    if (!currentUser || !connectModalPlatform) return;
    setInputError(null);
    const cleanUser = usernameInput.trim().replace(/^@+/, '').replace(/^https?:\/\/[^\/]+\//, '').replace(/\/$/, '');

    if (!cleanUser) {
      setInputError('Please enter a username.');
      return;
    }

    if (connectModalPlatform === 'x') {
      const validRegex = /^[a-zA-Z0-9_]{1,15}$/;
      if (!validRegex.test(cleanUser)) {
        setInputError('Username not found or invalid. X usernames must be 1-15 characters and contain only letters, numbers, and underscores.');
        return;
      }
    }

    setSavingUsername(true);
    try {
      const meta = getPlatformMeta(connectModalPlatform);
      const profileUrl = `${meta.profileUrlPrefix}${cleanUser}`;
      const displayName = `@${cleanUser}`;

      const newConn: PlatformConnection = {
        platformId: connectModalPlatform,
        username: cleanUser,
        displayName: displayName,
        profileUrl: profileUrl,
        displayOnProfile: true,
        displayAsStatus: true,
        connectedAt: Date.now(),
      };

      await savePlatformConnection(currentUser.uid, newConn);
      setConnections((prev) => ({
        ...prev,
        [connectModalPlatform]: newConn,
      }));
      setConnectModalPlatform(null);
      setUsernameInput('');
      setShowManualInput(false);
    } catch (e) {
      console.error('Failed to connect platform username:', e);
      setInputError('Failed to save connection. Please try again.');
    } finally {
      setSavingUsername(false);
    }
  };

  const hasConnections = Object.keys(connections).length > 0;
  const availablePlatforms = ALL_SUPPORTED_PLATFORMS.filter((pId) => !connections[pId]);

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
        {/* Platforms Header with + icon */}
        <div className="sh-op-subhead-row">
          <span className="sh-op-subhead-title">Platforms</span>
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
              const meta = getPlatformMeta(conn.platformId);
              return (
                <div key={conn.platformId} className="sh-op-card">
                  {/* Top Row: Platform Icon + Display Name */}
                  <div className="sh-op-card-top">
                    <div className="sh-op-card-user-info">
                      <Icon icon={meta.icon} width={24} height={24} />
                      <span className="sh-op-card-display-name">
                        {conn.displayName || conn.username || meta.name}
                      </span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="sh-op-card-divider" />

                  {/* Toggle: Display on profile */}
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add New Platform Bottom Sheet Modal */}
      {showAddSheet && (
        <div className="sh-op-sheet-overlay" onClick={() => setShowAddSheet(false)}>
          <div className="sh-op-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sh-op-sheet-handle" />
            <h3 className="sh-op-sheet-title">Add New Platform</h3>

            <div className="sh-op-sheet-list">
              {availablePlatforms.length === 0 ? (
                /* All platforms already connected */
                <div className="sh-op-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
                  <p className="sh-op-empty-text">All platforms connected. There is no platform left.</p>
                </div>
              ) : (
                availablePlatforms.map((pId) => {
                  const meta = getPlatformMeta(pId);
                  return (
                    <button
                      key={pId}
                      type="button"
                      className="sh-op-sheet-item"
                      disabled={authConnecting || savingUsername}
                      onClick={() => {
                        if (pId === 'spotify') {
                          void handleConnectSpotify();
                        } else {
                          handleOpenConnectModal(pId);
                        }
                      }}
                    >
                      <div className="sh-op-sheet-item-left">
                        <Icon icon={meta.icon} width={26} height={26} />
                        <span className="sh-op-sheet-item-name">{meta.name}</span>
                      </div>
                      <Icon icon="lucide:chevron-right" width={18} height={18} color="#949ba4" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Connect Platform Modal (Instagram direct OAuth, Telegram direct widget, X with format & existence validation) */}
      {connectModalPlatform && (
        <div className="sh-op-modal-overlay" onClick={() => !savingUsername && setConnectModalPlatform(null)}>
          <div className="sh-op-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sh-op-modal-header">
              <Icon icon={getPlatformMeta(connectModalPlatform).icon} width={32} height={32} />
              <div>
                <h3 className="sh-op-modal-title">Connect {getPlatformMeta(connectModalPlatform).name}</h3>
                <p className="sh-op-modal-desc">
                  {connectModalPlatform === 'instagram'
                    ? 'Log in directly with your Instagram account'
                    : connectModalPlatform === 'telegram'
                    ? 'Log in directly via Telegram'
                    : 'Enter your X username to connect'}
                </p>
              </div>
            </div>

            {/* Direct Login Options for Instagram */}
            {connectModalPlatform === 'instagram' && !showManualInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button
                  type="button"
                  className="sh-op-direct-btn sh-op-direct-btn-instagram"
                  onClick={handleConnectInstagram}
                >
                  <Icon icon="skill-icons:instagram" width={22} height={22} />
                  <span>Log in with Instagram</span>
                </button>
                <div className="sh-op-divider-or">
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="sh-op-modal-btn-cancel"
                  style={{ textAlign: 'center', width: '100%' }}
                  onClick={() => setShowManualInput(true)}
                >
                  Enter username manually
                </button>
              </div>
            )}

            {/* Direct Login Options for Telegram (@Shinzi_connect_bot) */}
            {connectModalPlatform === 'telegram' && !showManualInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <div ref={telegramWidgetRef} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />
                <div className="sh-op-divider-or" style={{ width: '100%' }}>
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="sh-op-modal-btn-cancel"
                  style={{ textAlign: 'center', width: '100%' }}
                  onClick={() => setShowManualInput(true)}
                >
                  Enter username manually
                </button>
              </div>
            )}

            {/* Typebox for X and Manual Fallback with live error checking */}
            {(connectModalPlatform === 'x' || showManualInput) && (
              <>
                <div className={`sh-op-modal-input-wrap ${inputError ? 'has-error' : ''}`}>
                  <span className="sh-op-modal-input-prefix">@</span>
                  <input
                    type="text"
                    className="sh-op-modal-input"
                    placeholder={getPlatformMeta(connectModalPlatform).placeholder}
                    value={usernameInput}
                    onChange={(e) => {
                      setUsernameInput(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && usernameInput.trim()) {
                        void handleConfirmConnectUsername();
                      }
                    }}
                    autoFocus
                  />
                </div>

                {inputError && (
                  <div className="sh-op-modal-error">{inputError}</div>
                )}

                <div className="sh-op-modal-actions">
                  <button
                    type="button"
                    className="sh-op-modal-btn-cancel"
                    disabled={savingUsername}
                    onClick={() => {
                      if (showManualInput && connectModalPlatform !== 'x') {
                        setShowManualInput(false);
                      } else {
                        setConnectModalPlatform(null);
                      }
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="sh-op-modal-btn-continue"
                    disabled={savingUsername || !usernameInput.trim()}
                    onClick={() => void handleConfirmConnectUsername()}
                  >
                    {savingUsername ? 'Connecting…' : 'Continue'}
                  </button>
                </div>
              </>
            )}
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
