import {
  useEffect,
  useState,
  type CSSProperties,
} from 'react';

import {
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
} from 'firebase/firestore';
import Profile from './Profile';
import OtherProfile from './OtherProfile';
import Settings from './Settings';
import { auth, db } from './firebaseConfig';
import Privacy from './Privacy';
import Terms from './Terms';
import SignUp from './SignUp';
import Login from './Login';
import Chat from './Chat';
import SpotifyConfirmationModal from './SpotifyConfirmationModal';
import {
  SPOTIFY_CLIENT_ID,
  savePlatformConnection,
  fetchSpotifyProfile,
  fetchSpotifyCurrentlyPlaying,
  updateSpotifyPresence,
  subscribeUserConnections,
  refreshSpotifyAccessToken,
  updateSpotifyTokens,
  PlatformConnection,
} from './spotifyService';
import { exchangeCodeForToken } from './spotifyPkce';
import Servers from './Servers';
import NotificationManager from './NotificationManager';
import ErrorBoundary from './ErrorBoundary';
import { AppErrorManager } from './ErrorScreens';
import { getCachedProfile, setCachedProfile, navigateTo } from './profileCache';
import { updateUserPresence } from './presenceService';
import { setActiveUserForTextStyles } from './textStyleService';

import logo from './assets/hero.png';

type Screen = 'welcome' | 'signup' | 'login' | 'terms' | 'privacy';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [currentScreen, setCurrentScreen] =
    useState<Screen>('welcome');

  const [isDesktop, setIsDesktop] =
    useState(false);

  const [currentPath, setCurrentPath] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '/'
  );
  const [currentSearch, setCurrentSearch] = useState(() =>
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const [showSpotifySuccessModal, setShowSpotifySuccessModal] = useState(false);

  // Global Spotify OAuth callback handler (checks for ?code= on any route)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      // Clean query params from URL so refreshing doesn't re-trigger
      window.history.replaceState(null, '', window.location.pathname);

      // Exchange code for token and save connection
      const processCode = async () => {
        try {
          const origin = window.location.origin;
          const redirectUri = origin.includes('vercel.app')
            ? 'https://shinzi.vercel.app/'
            : origin.includes('web.app')
            ? 'https://shinzi-fba29.web.app'
            : origin.startsWith('capacitor://')
            ? 'capacitor://localhost'
            : `${origin}/`;

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
          } catch (tokenErr) {
            console.warn('[App] Spotify token exchange notice:', tokenErr);
          }

          // Resilient save: Always connect user to Spotify and show confirmation modal
          const saveConn = async (u: any) => {
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
            try {
              await savePlatformConnection(u.uid, newConn);
            } catch (saveErr) {
              console.error('[App] Failed to save platform connection:', saveErr);
            }
            try {
              sessionStorage.setItem('spotify_just_connected', 'true');
            } catch {}
            setShowSpotifySuccessModal(true);

            // Trigger Settings -> OtherPlatforms navigation
            try {
              sessionStorage.setItem('spotify_open_platforms', 'true');
            } catch {}
            window.dispatchEvent(new CustomEvent('shinzi-open-other-platforms'));
            if (window.location.pathname.toLowerCase() !== '/settings') {
              navigateTo('/settings');
            }
          };

          if (auth.currentUser) {
            await saveConn(auth.currentUser);
          } else {
            const unsub = onAuthStateChanged(auth, async (u) => {
              if (u) {
                unsub();
                await saveConn(u);
              } else {
                // Showing success screen on web
                setShowSpotifySuccessModal(true);
              }
            });
          }
        } catch (err) {
          console.error('[App] Global Spotify OAuth exchange error:', err);
        }
      };

      processCode();
    }
  }, []);

  // Global Spotify live song poller (catches playing instantly like Discord)
  useEffect(() => {
    if (!user) return;

    let cancel = false;
    let cachedToken: string | null = null;
    let cachedRefreshToken: string | null = null;
    let hasSpotify = false;

    const unsub = subscribeUserConnections(user.uid, (conns) => {
      const sp = conns.spotify;
      if (sp && sp.accessToken) {
        cachedToken = sp.accessToken;
        cachedRefreshToken = sp.refreshToken || null;
        hasSpotify = true;
      } else {
        cachedToken = null;
        cachedRefreshToken = null;
        hasSpotify = false;
      }
    });

    const poll = async () => {
      if (cancel || !hasSpotify || !cachedToken) return;
      try {
        const presence = await fetchSpotifyCurrentlyPlaying(cachedToken);
        if (!cancel && presence !== undefined) {
          await updateSpotifyPresence(user.uid, presence);
        }
      } catch (err: any) {
        if (err?.message === '401' && cachedRefreshToken) {
          try {
            const res = await refreshSpotifyAccessToken(SPOTIFY_CLIENT_ID, cachedRefreshToken);
            if (res?.accessToken) {
              cachedToken = res.accessToken;
              if (res.refreshToken) cachedRefreshToken = res.refreshToken;
              await updateSpotifyTokens(user.uid, res.accessToken, res.refreshToken);
              const fresh = await fetchSpotifyCurrentlyPlaying(res.accessToken);
              if (!cancel && fresh !== undefined) {
                await updateSpotifyPresence(user.uid, fresh);
              }
            }
          } catch {}
        }
      }
    };

    poll();
    // Poll every 4 seconds for lively instant track detection like Discord
    const interval = setInterval(poll, 4000);

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        poll();
      }
    };
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancel = true;
      unsub();
      clearInterval(interval);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname.toLowerCase());
      setCurrentSearch(window.location.search);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // ==========================================================
  // SIGNUP BUSY FLAG
  // ==========================================================
  //
  // Firebase signs the new user in as soon as the Auth account
  // is created, which is the FIRST step of signup. Without this
  // flag, onAuthStateChanged would swap the screen to the main
  // app and unmount <SignUp /> while the profile photo upload
  // and Firestore writes are still running (and would also
  // revoke the photo's object URL).
  //
  // While signup is busy we keep <SignUp /> mounted. When it
  // finishes (success or rollback) it clears the flag and the
  // normal user/no-user routing takes over.
  //
  // ==========================================================

  const [signupBusy, setSignupBusy] =
    useState(false);

const [profileExists, setProfileExists] =
  useState<boolean | null>(() => {
    const user = auth.currentUser;
    if (user && getCachedProfile(user.uid)) return true;
    return null;
  });

  // ==========================================================
  // FIREBASE AUTH & PERSISTENT SESSION BACKUP (Fix #1)
  // ==========================================================

  useEffect(() => {
    const handleAuthRestored = () => {
      if (!auth.currentUser) {
        window.location.reload();
      }
    };
    window.addEventListener('shinzi:authRestored', handleAuthRestored);
    return () => window.removeEventListener('shinzi:authRestored', handleAuthRestored);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUser(firebaseUser);
        setAuthLoading(false);

        if (firebaseUser) {
          // Backup auth session keys to Android vault for persistence across reinstalls (Fix #1)
          try {
            const authItems: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && (k.startsWith('firebase:authUser:') || k === 'shinzi_status_mode' || k.startsWith('shinzi_cache_'))) {
                const val = localStorage.getItem(k);
                if (val) authItems[k] = val;
              }
            }
            if (Object.keys(authItems).length > 0) {
              const ShinziNotification = (window as any).Capacitor?.Plugins?.ShinziNotification;
              if (ShinziNotification?.saveAuthBackup) {
                ShinziNotification.saveAuthBackup({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email || '',
                  authData: JSON.stringify(authItems),
                }).catch(() => {});
              }
            }
          } catch {}
        }
      }
    );

    return unsubscribe;
  }, []);

// Does this signed-in user already have a profile document?
useEffect(() => {
  if (!user) {
    setProfileExists(null);
    return;
  }

  // SignUp is running, so leave it alone until it finishes.
  if (signupBusy) return;

  const cached = getCachedProfile(user.uid);
  if (cached) {
    setProfileExists(true);
    return;
  }

  let cancelled = false;
  setProfileExists(null);

  getDoc(doc(db, 'users', user.uid))
    .then((snap) => {
      if (!cancelled) {
        const exists = snap.exists();
        setProfileExists(exists);
        if (exists) {
          setCachedProfile(user.uid, snap.data());
        }
      }
    })
    .catch(() => {
      // On error, let Profile show its own error and retry button.
      if (!cancelled) setProfileExists(true);
    });

  return () => {
    cancelled = true;
  };
}, [user, signupBusy]);

  // Cleanly sync URL path to /chat when logged in (without causing render-phase state dispatch)
  useEffect(() => {
    if (user && !signupBusy && profileExists) {
      if (currentPath === '/' || currentPath === '/index.html') {
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/chat');
          setCurrentPath('/chat');
        }
      }
    }
  }, [user, signupBusy, profileExists, currentPath]);

  // Sync custom text styles & fonts with cloud account
  useEffect(() => {
    setActiveUserForTextStyles(user?.uid || null);
  }, [user?.uid]);

  // Presence heartbeat & online/offline tracker
  useEffect(() => {
    if (!user?.uid) return;

    const uid = user.uid;

    // Immediately mark active
    void updateUserPresence(uid, true);

    // Heartbeat every 25 seconds to keep lastSeen fresh
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void updateUserPresence(uid, true);
      }
    }, 25000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void updateUserPresence(uid, true);
      } else {
        void updateUserPresence(uid, false);
      }
    };

    const handlePageHide = () => {
      void updateUserPresence(uid, false);
    };

    const handleOnline = () => {
      void updateUserPresence(uid, true);
    };

    const handleOffline = () => {
      void updateUserPresence(uid, false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      void updateUserPresence(uid, false);
    };
  }, [user?.uid]);

  // ==========================================================
  // RESPONSIVE CHECK
  // ==========================================================

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      '(min-width: 768px)'
    );

    const updateScreenSize = () => {
      setIsDesktop(mediaQuery.matches);
    };

    updateScreenSize();

    mediaQuery.addEventListener(
      'change',
      updateScreenSize
    );

    return () => {
      mediaQuery.removeEventListener(
        'change',
        updateScreenSize
      );
    };
  }, []);
  const renderContent = () => {
    // ==========================================================
    // TERMS OF SERVICE
    // ==========================================================

    if (currentPath === '/terms') {
      return <Terms />;
    }

    if (currentPath === '/privacy') {
      return <Privacy />;
    }

    // ==========================================================
    // SHINZI CHAT
    // ==========================================================

    if (currentPath === '/chat') {
      return (
        <ErrorBoundary name="ChatScreen">
          <Chat />
        </ErrorBoundary>
      );
    }

    // ==========================================================
    // SHINZI SERVERS
    // ==========================================================

    if (currentPath === '/servers') {
      return (
        <Servers
          onBack={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              navigateTo('/chat');
            }
          }}
          onOpenChat={() => navigateTo('/chat')}
          onOpenProfile={() => navigateTo('/profile')}
          onOpenNotifications={() => navigateTo('/chat?screen=notifications')}
        />
      );
    }

    // ==========================================================
    // AUTH LOADING
    // ==========================================================

    if (
      authLoading ||
      (user && !signupBusy && profileExists === null)
    ) {
      return (
        <>
          <div style={styles.loadingContainer}>
            <div style={styles.spinner} />
          </div>

          <style>{spinnerAnimation}</style>
        </>
      );
    }

    // ==========================================================
    // PROFILE & MAIN SCREENS FOR LOGGED-IN USERS
    // ==========================================================

    if (user && !signupBusy && profileExists) {
      const params = new URLSearchParams(currentSearch);
      const targetUid = params.get('uid');

      // Another user's profile
      if (
        currentPath === '/profile' &&
        targetUid &&
        targetUid !== user.uid
      ) {
        return (
          <OtherProfile
            targetUid={targetUid}
            onClose={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('/chat');
              }
            }}
            onOpenChat={(uid) => {
              navigateTo(`/chat?user=${encodeURIComponent(uid)}`);
            }}
          />
        );
      }

      // Settings
      if (currentPath === '/settings') {
        return (
          <Settings
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('/profile');
              }
            }}
          />
        );
      }

      // Your own profile
      if (currentPath === '/profile') {
        return <Profile />;
      }

      // Auto-navigate to chat for logged-in users visiting root / other screens
      return (
        <ErrorBoundary name="ChatScreen">
          <Chat />
        </ErrorBoundary>
      );
    }

    // ==========================================================
    // SIGN UP
    // ==========================================================

    if (
      currentScreen === 'signup' ||
      (user && profileExists === false)
    ) {
      return (
        <SignUp
          onBack={async () => {
            if (auth.currentUser) {
              await signOut(auth);
            }

            setCurrentScreen('welcome');
          }}
          onBusyChange={setSignupBusy}
        />
      );
    }

    // ==========================================================
    // LOGIN
    // ==========================================================

    if (currentScreen === 'login') {
      return (
        <Login
          onBack={() => {
            setCurrentScreen('welcome');
          }}
        />
      );
    }

    // ==========================================================
    // RESPONSIVE STYLES
    // ==========================================================

    const safeAreaStyle: CSSProperties = {
      ...styles.safeArea,
      ...(isDesktop ? styles.desktopSafeArea : {}),
    };

    const heroStyle: CSSProperties = {
      ...styles.heroSection,
      ...(isDesktop ? styles.desktopHeroSection : {}),
    };

    const logoStyle: CSSProperties = {
      ...styles.logo,
      ...(isDesktop ? styles.desktopLogo : {}),
    };

    const titleStyle: CSSProperties = {
      ...styles.title,
      ...(isDesktop ? styles.desktopTitle : {}),
    };

    const descriptionStyle: CSSProperties = {
      ...styles.description,
      ...(isDesktop ? styles.desktopDescription : {}),
    };

    const actionStyle: CSSProperties = {
      ...styles.actionSection,
      ...(isDesktop ? styles.desktopActionSection : {}),
    };

    const signUpStyle: CSSProperties = {
      ...styles.signUpButton,
      ...(isDesktop ? styles.desktopButton : {}),
    };

    const logInStyle: CSSProperties = {
      ...styles.logInButton,
      ...(isDesktop ? styles.desktopButton : {}),
    };

    // ==========================================================
    // WELCOME SCREEN
    // ==========================================================

    return (
      <div style={styles.container}>
        <div style={styles.background}>
          <div style={safeAreaStyle}>
            {/* HERO */}
            <div style={heroStyle}>
              <img
                src={logo}
                alt="Shinzi Hub"
                style={logoStyle}
              />

              <h1 style={titleStyle}>
                Welcome to
                <br />
                Shinzi Hub
              </h1>

              <p style={descriptionStyle}>
                Join servers, search, or chat.
                <br />
                Tap below to get started.
              </p>
            </div>

            {/* BUTTONS */}
            <div style={actionStyle}>
              <button
                type="button"
                style={signUpStyle}
                onClick={() => {
                  setCurrentScreen('signup');
                }}
              >
                Register
              </button>

              <button
                type="button"
                style={logInStyle}
                onClick={() => {
                  setCurrentScreen('login');
                }}
              >
                Log In
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppErrorManager currentUid={user?.uid || null}>
      <NotificationManager currentUid={user?.uid || null} />
      {renderContent()}
      {showSpotifySuccessModal && (
        <SpotifyConfirmationModal onClose={() => setShowSpotifySuccessModal(false)} />
      )}
    </AppErrorManager>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles: Record<string, CSSProperties> = {
  container: {
    width: '100%',
    height: '100dvh',
    minHeight: 0,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },

  background: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },

  safeArea: {
    width: '100%',
    height: '100dvh',
    position: 'relative',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    paddingBottom: 20,
    maxWidth: 700,
    margin: '0 auto',
  },

  heroSection: {
  position: 'absolute',
  top: '50%',
  left: 24,
  right: 24,
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginTop: 0,
},

  logo: {
    width: 120,
    height: 120,
    objectFit: 'contain',
    marginBottom: 24,
  },

  title: {
    margin: 0,
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: 900,
    textAlign: 'center',
    letterSpacing: 0.5,
    lineHeight: 1.2,
  },

  description: {
    margin: 0,
    marginTop: 12,
    color: '#888888',
    fontSize: 16,
    fontWeight: 400,
    textAlign: 'center',
    lineHeight: 1.47,
  },

 actionSection: {
  position: 'absolute',
  left: 24,
  right: 24,
  bottom: 20,
  width: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
},

    signUpButton: {
    width: '100%',
    boxSizing: 'border-box',

    // Active/Primary Button — Pure White with Pure Black text
    backgroundColor: '#FFFFFF',
    border: '1px solid #FFFFFF',
    boxShadow: 'none',

    borderRadius: 28,
    paddingTop: 16,
    paddingBottom: 16,
    color: '#000000',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },

  logInButton: {
    width: '100%',
    boxSizing: 'border-box',

    // Secondary Button — Pure Black with White text
    backgroundColor: '#000000',
    border: '1px solid #333333',
    boxShadow: 'none',

    borderRadius: 28,
    paddingTop: 16,
    paddingBottom: 16,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },

  desktopSafeArea: {
  maxWidth: 1100,
  paddingLeft: 60,
  paddingRight: 60,
  paddingTop: 40,
  paddingBottom: 40,
},

desktopLogo: {
  width: 190,
  height: 190,
  marginBottom: 34,
},

desktopTitle: {
  fontSize: 58,
  lineHeight: 1.12,
  letterSpacing: 0.3,
},

desktopDescription: {
  marginTop: 20,
  fontSize: 20,
  lineHeight: 1.5,
},

desktopActionSection: {
  left: 60,
  right: 60,
  bottom: 40,
  width: 'auto',
  maxWidth: 760,
  marginLeft: 'auto',
  marginRight: 'auto',

  display: 'flex',
  flexDirection: 'row',
  gap: 20,
},

desktopButton: {
  flex: 1,
  width: 'auto',
  paddingTop: 20,
  paddingBottom: 20,
  borderRadius: 34,
  fontSize: 19,
},

  desktopHeroSection: {
    marginTop: 0,
  },


  loadingContainer: {
    width: '100%',
    height: '100dvh',
    backgroundColor: '#000000',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  // The keyframes below existed before but were never
  // applied, so the spinner never actually spun.
  spinner: {
    width: 38,
    height: 38,
    border: '4px solid #222222',
    borderTop: '4px solid #FFFFFF',
    borderRadius: '50%',
    animation: 'shinzi-spin 0.8s linear infinite',
  },

  pagePlaceholder: {
    width: '100%',
    height: '100dvh',
    boxSizing: 'border-box',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    overflow: 'hidden',
  },

  mainAppPlaceholder: {
    width: '100%',
    height: '100dvh',
    boxSizing: 'border-box',
    backgroundColor: '#000000',
    color: '#FFFFFF',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  placeholderTitle: {
    margin: 0,
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 800,
  },

  placeholderText: {
    color: '#888888',
    fontSize: 15,
    marginTop: 10,
  },

  backButton: {
    marginTop: 20,
    padding: '12px 24px',
    border: '1px solid #FFFFFF',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    color: '#000000',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
};

const spinnerAnimation = `
@keyframes shinzi-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
`;
