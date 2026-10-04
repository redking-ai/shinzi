import {
  useEffect,
  useState,
  type CSSProperties,
} from 'react';

import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

import { auth } from './firebaseConfig';
import SignUp from './SignUp';
import Login from './Login';

import background from './assets/background.png';
import logo from './assets/logo.png';

type Screen = 'welcome' | 'signup' | 'login';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [currentScreen, setCurrentScreen] =
    useState<Screen>('welcome');

  const [isDesktop, setIsDesktop] =
    useState(false);

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

  // ==========================================================
  // FIREBASE AUTH
  // ==========================================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUser(firebaseUser);
        setAuthLoading(false);
      }
    );

    return unsubscribe;
  }, []);

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

  // ==========================================================
  // AUTH LOADING
  // ==========================================================

  if (authLoading) {
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
  // AUTHENTICATED USER
  // ==========================================================

  if (user && !signupBusy) {
    return (
      <div style={styles.mainAppPlaceholder}>
        <h1 style={styles.placeholderTitle}>
          Shinzi
        </h1>

        <p style={styles.placeholderText}>
          Main Shinzi app coming soon.
        </p>
      </div>
    );
  }

  // ==========================================================
  // SIGN UP
  // ==========================================================

  if (currentScreen === 'signup') {
    return (
      <SignUp
        onBack={() => {
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
      <div
        style={{
          ...styles.background,
          backgroundImage: `url(${background})`,
        }}
      >
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
}

// ============================================================
// STYLES
// ============================================================

const styles: Record<string, CSSProperties> = {
  container: {
    width: '100%',
    height: '100dvh',
    minHeight: 0,
    backgroundColor: '#080612',
    overflow: 'hidden',
  },

  background: {
    width: '100%',
    height: '100%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
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
    color: '#A5A5BA',
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

    // Register — Deep Purple
    backgroundColor: '#39265D',
    border: '1px solid rgba(164, 104, 255, 0.65)',
    boxShadow: '0 0 10px rgba(130, 65, 220, 0.16)',

    borderRadius: 28,
    paddingTop: 16,
    paddingBottom: 16,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },

  logInButton: {
    width: '100%',
    boxSizing: 'border-box',

    // Log In — Blue-Purple Gradient
    background: 'linear-gradient(110deg, #3020A0 0%, #762BFF 100%)',
    border: '1px solid rgba(32, 217, 255, 0.55)',
    boxShadow: '0 0 12px rgba(118, 43, 255, 0.24)',

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
    backgroundColor: '#080612',
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
    border: '4px solid #22222E',
    borderTop: '4px solid #20D9FF',
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
    color: '#A5A5BA',
    fontSize: 15,
    marginTop: 10,
  },

  backButton: {
    marginTop: 20,
    padding: '12px 24px',
    border: 'none',
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
