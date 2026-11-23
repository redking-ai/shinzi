import { useState, useEffect } from 'react';
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
  updatePlatformCustomToggle,
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

const ALL_SUPPORTED_PLATFORMS: SupportedPlatformId[] = ['spotify', 'telegram', 'youtube', 'facebook'];
const YOUTUBE_CLIENT_ID = '1063333455169-7psq1nsn3855b631n212kceh6u3ef3ei.apps.googleusercontent.com';
const FACEBOOK_APP_ID = '1614970446979837';

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

        // 1. YouTube OAuth Callback (state === youtube_*)
        if (state && state.startsWith('youtube_')) {
          (async () => {
            try {
              let channelName = 'YouTube Channel';
              let channelUrl = 'https://youtube.com';
              let subscriberCount = '0';

              try {
                const res = await fetch(
                  'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                    },
                  }
                );
                if (res.ok) {
                  const data = await res.json();
                  const item = data.items?.[0];
                  if (item) {
                    channelName = item.snippet?.title || channelName;
                    const customUrl = item.snippet?.customUrl;
                    channelUrl = customUrl
                      ? `https://youtube.com/${customUrl}`
                      : `https://youtube.com/channel/${item.id}`;
                    subscriberCount = item.statistics?.hiddenSubscriberCount
                      ? 'Hidden'
                      : Number(item.statistics?.subscriberCount || 0).toLocaleString();
                  }
                }
              } catch (ytErr) {
                console.warn('[OtherPlatforms] Failed fetching YouTube channel info:', ytErr);
              }

              const newConn: PlatformConnection = {
                platformId: 'youtube',
                username: channelName,
                displayName: channelName,
                profileUrl: channelUrl,
                accessToken,
                displayOnProfile: true,
                showSubscribers: true,
                subscribersCount: subscriberCount,
                connectedAt: Date.now(),
              };

              await savePlatformConnection(currentUser.uid, newConn);
              setConnections((prev) => ({ ...prev, youtube: newConn }));
              setShowAuthConfirm(true);
            } catch (err) {
              console.error('[OtherPlatforms] Error saving YouTube connection:', err);
            }
          })();
          return;
        }

        // 2. Facebook OAuth Callback (state === facebook_*)
        if (state && state.startsWith('facebook_')) {
          (async () => {
            try {
              let fbName = 'Facebook User';
              let fbUrl = 'https://facebook.com';
              let friendsCount: string | number | undefined;
              let followersCount: string | number | undefined;

              try {
                const res = await fetch(
                  `https://graph.facebook.com/v20.0/me?fields=id,name,link,friends&access_token=${accessToken}`
                );
                if (res.ok) {
                  const data = await res.json();
                  if (data.name) fbName = data.name;
                  if (data.link) fbUrl = data.link;
                  else if (data.id) fbUrl = `https://facebook.com/${data.id}`;
                  if (data.friends?.summary?.total_count !== undefined) {
                    friendsCount = Number(data.friends.summary.total_count).toLocaleString();
                  }
                }
              } catch (fbErr) {
                console.warn('[OtherPlatforms] Failed fetching Facebook info:', fbErr);
              }

              const newConn: PlatformConnection = {
                platformId: 'facebook',
                username: fbName,
                displayName: fbName,
                profileUrl: fbUrl,
                accessToken,
                displayOnProfile: true,
                showFollowers: true,
                showFriends: true,
                followersCount: followersCount || '0',
                friendsCount: friendsCount || '0',
                connectedAt: Date.now(),
              };

              await savePlatformConnection(currentUser.uid, newConn);
              setConnections((prev) => ({ ...prev, facebook: newConn }));
              setShowAuthConfirm(true);
            } catch (err) {
              console.error('[OtherPlatforms] Error saving Facebook connection:', err);
            }
          })();
          return;
        }

        // 3. Spotify OAuth Token Callback
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

  const handleCustomToggle = async (platformId: string, field: string, currentVal: boolean) => {
    if (!currentUser) return;
    const conn = connections[platformId];
    if (!conn) return;

    const newVal = !currentVal;

    // Optimistically update local state
    setConnections((prev) => ({
      ...prev,
      [platformId]: {
        ...prev[platformId],
        [field]: newVal,
      },
    }));

    try {
      await updatePlatformCustomToggle(currentUser.uid, platformId, field, newVal);
    } catch (e) {
      console.warn('Failed to update custom toggle:', e);
      // Revert on error
      setConnections((prev) => ({
        ...prev,
        [platformId]: {
          ...prev[platformId],
          [field]: currentVal,
        },
      }));
    }
  };

  const handleConnectYouTube = () => {
    if (!currentUser) return;
    setShowAddSheet(false);
    const redirectUri = 'https://shinzi.vercel.app/';
    const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=${scope}&state=youtube_${currentUser.uid}&include_granted_scopes=true&prompt=consent`;
    window.location.href = authUrl;
  };

  const handleConnectFacebook = () => {
    if (!currentUser) return;
    setShowAddSheet(false);
    const redirectUri = 'https://shinzi.vercel.app/';
    const authUrl = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=public_profile,user_friends&state=facebook_${currentUser.uid}`;
    window.location.href = authUrl;
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

  const handleConnectTelegram = () => {
    setShowAddSheet(false);
    if ((window as any).Telegram?.Login?.auth) {
      (window as any).Telegram.Login.auth(
        { bot_id: '9290212203', request_access: true },
        async (user: any) => {
          if (!user || !currentUser) return;
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
            setShowAuthConfirm(true);
          } catch (err) {
            console.error('Failed to save Telegram connection:', err);
          }
        }
      );
    } else {
      window.open(
        `https://oauth.telegram.org/auth?bot_id=9290212203&origin=${encodeURIComponent(window.location.origin)}`,
        'telegram_oauth',
        'width=550,height=470'
      );
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

                  {/* YouTube extra toggle: Show subscribers */}
                  {conn.platformId === 'youtube' && (
                    <div className="sh-op-toggle-row" style={{ marginTop: 8 }}>
                      <span className="sh-op-toggle-label">Show subscribers</span>
                      <label className="sh-op-switch">
                        <input
                          type="checkbox"
                          checked={conn.showSubscribers !== false}
                          onChange={() => handleCustomToggle('youtube', 'showSubscribers', conn.showSubscribers !== false)}
                        />
                        <span className="sh-op-slider" />
                      </label>
                    </div>
                  )}

                  {/* Facebook extra toggles: Show followers & Show friends */}
                  {conn.platformId === 'facebook' && (
                    <>
                      <div className="sh-op-toggle-row" style={{ marginTop: 8 }}>
                        <span className="sh-op-toggle-label">Show followers</span>
                        <label className="sh-op-switch">
                          <input
                            type="checkbox"
                            checked={conn.showFollowers !== false}
                            onChange={() => handleCustomToggle('facebook', 'showFollowers', conn.showFollowers !== false)}
                          />
                          <span className="sh-op-slider" />
                        </label>
                      </div>

                      <div className="sh-op-toggle-row" style={{ marginTop: 8 }}>
                        <span className="sh-op-toggle-label">Show friends</span>
                        <label className="sh-op-switch">
                          <input
                            type="checkbox"
                            checked={conn.showFriends !== false}
                            onChange={() => handleCustomToggle('facebook', 'showFriends', conn.showFriends !== false)}
                          />
                          <span className="sh-op-slider" />
                        </label>
                      </div>
                    </>
                  )}
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
                      disabled={authConnecting}
                      onClick={() => {
                        if (pId === 'spotify') {
                          void handleConnectSpotify();
                        } else if (pId === 'telegram') {
                          handleConnectTelegram();
                        } else if (pId === 'youtube') {
                          handleConnectYouTube();
                        } else if (pId === 'facebook') {
                          handleConnectFacebook();
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



      {/* Auth Confirmation Dialog (IMG-20261123-WA0003) */}
      {showAuthConfirm && (
        <SpotifyConfirmationModal
          onClose={() => setShowAuthConfirm(false)}
        />
      )}
    </div>
  );
}
