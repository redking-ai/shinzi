import { useEffect, useState, type CSSProperties } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';

import { auth } from './firebaseConfig';

// Assets
import background from './assets/background.png';
import logo from './assets/logo.png';


// ============================================================
// TYPES
// ============================================================

type Screen = 'welcome' | 'signup' | 'login';


// ============================================================
// APP
// ============================================================

export default function App() {

  // ----------------------------------------------------------
  // AUTHENTICATION STATE
  // ----------------------------------------------------------

  const [user, setUser] = useState<User | null>(null);

  const [authLoading, setAuthLoading] = useState(true);


  // ----------------------------------------------------------
  // LOCAL SCREEN STATE
  //
  // Used only while the user is logged out.
  // ----------------------------------------------------------

  const [currentScreen, setCurrentScreen] =
    useState<Screen>('welcome');


  // ==========================================================
  // FIREBASE AUTH STATE LISTENER
  // ==========================================================

  useEffect(() => {

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {

        setUser(firebaseUser);

        setAuthLoading(false);

        /*
         * If Firebase says the user is authenticated,
         * show the main Shinzi app.
         */
        if (firebaseUser) {
          setCurrentScreen('welcome');
        }

        /*
         * If the user logs out, return to Welcome.
         */
        else {
          setCurrentScreen('welcome');
        }
      }
    );


    // Cleanup Firebase listener
    return unsubscribe;

  }, []);


  // ==========================================================
  // AUTH LOADING
  // ==========================================================

  /*
   * Firebase needs a moment to determine whether an
   * existing authentication session is still valid.
   *
   * We don't want to briefly show Welcome before
   * determining the user's authentication state.
   */

  if (authLoading) {

    return (
      <div style={styles.loadingContainer}>

        <div style={styles.spinner} />

      </div>
    );
  }


  // ==========================================================
  // AUTHENTICATED USER
  // ==========================================================

  /*
   * If Firebase has an authenticated user,
   * the main Shinzi application becomes the root.
   *
   * We will replace this placeholder with the real
   * Shinzi Chat/Main App later.
   */

  if (user) {

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
      <div style={styles.pagePlaceholder}>

        <h1 style={styles.placeholderTitle}>
          Sign Up
        </h1>

        <p style={styles.placeholderText}>
          Signup page will be connected here.
        </p>

        <button
          style={styles.backButton}
          onClick={() => setCurrentScreen('welcome')}
        >
          Back
        </button>

      </div>
    );
  }


  // ==========================================================
  // LOGIN
  // ==========================================================

  if (currentScreen === 'login') {

    return (
      <div style={styles.pagePlaceholder}>

        <h1 style={styles.placeholderTitle}>
          Log In
        </h1>

        <p style={styles.placeholderText}>
          Login page will be connected here.
        </p>

        <button
          style={styles.backButton}
          onClick={() => setCurrentScreen('welcome')}
        >
          Back
        </button>

      </div>
    );
  }


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

        <div style={styles.safeArea}>

          {/* ==================================================
              HEADER & HERO
          ================================================== */}

          <div style={styles.heroSection}>

            <img
              src={logo}
              alt="Shinzi Hub"
              style={styles.logo}
            />

            <h1 style={styles.title}>
              Welcome to
              <br />
              Shinzi Hub
            </h1>

            <p style={styles.description}>
              Join servers, search, or chat.
              <br />
              Tap below to get started.
            </p>

          </div>


          {/* ==================================================
              ACTION BUTTONS
          ================================================== */}

          <div style={styles.actionSection}>

            <button
              style={styles.signUpButton}
              onClick={() =>
                setCurrentScreen('signup')
              }
            >
              Sign up
            </button>


            <button
              style={styles.logInButton}
              onClick={() =>
                setCurrentScreen('login')
              }
            >
              Log in
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

  // ----------------------------------------------------------
  // MAIN CONTAINER
  // ----------------------------------------------------------

  container: {
    width: '100%',
    height: '100dvh',
    minHeight: 0,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },


  // ----------------------------------------------------------
  // BACKGROUND
  // ----------------------------------------------------------

  background: {
    width: '100%',
    height: '100%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },


  // ----------------------------------------------------------
  // SAFE AREA / CONTENT
  // ----------------------------------------------------------

  safeArea: {
    width: '100%',
    height: '100dvh',
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


  // ----------------------------------------------------------
  // HERO
  // ----------------------------------------------------------

  heroSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',

    marginTop: 40,
  },


  logo: {
    width: 100,
    height: 100,

    objectFit: 'contain',

    marginBottom: 24,
  },


  title: {
    margin: 0,

    color: '#FFFFFF',

    fontSize: 28,
    fontWeight: 900,

    textAlign: 'center',

    letterSpacing: 0.5,
    lineHeight: 1.2,

    textTransform: 'none',
  },


  description: {
    margin: 0,
    marginTop: 12,

    color: '#A5A5BA',

    fontSize: 15,
    fontWeight: 400,

    textAlign: 'center',

    lineHeight: 1.47,
  },


  // ----------------------------------------------------------
  // ACTION SECTION
  // ----------------------------------------------------------

  actionSection: {
    width: '100%',
    marginBottom: 20,

    display: 'flex',
    flexDirection: 'column',

    gap: 12,
  },


  // ----------------------------------------------------------
  // SIGN UP BUTTON
  // ----------------------------------------------------------

  signUpButton: {
    width: '100%',

    boxSizing: 'border-box',

    backgroundColor: 'rgba(10, 10, 14, 0.75)',

    border: '1px solid #2E2E42',
    borderRadius: 28,

    paddingTop: 16,
    paddingBottom: 16,

    color: '#FFFFFF',

    fontSize: 16,
    fontWeight: 700,

    cursor: 'pointer',

    transition: 'transform 0.15s ease, background-color 0.15s ease',
  },


  // ----------------------------------------------------------
  // LOGIN BUTTON
  // ----------------------------------------------------------

  logInButton: {
    width: '100%',

    boxSizing: 'border-box',

    backgroundColor: '#FFFFFF',

    border: 'none',
    borderRadius: 28,

    paddingTop: 16,
    paddingBottom: 16,

    color: '#000000',

    fontSize: 16,
    fontWeight: 700,

    cursor: 'pointer',

    transition: 'transform 0.15s ease, opacity 0.15s ease',
  },


  // ----------------------------------------------------------
  // LOADING SCREEN
  // ----------------------------------------------------------

  loadingContainer: {
    width: '100%',
    height: '100dvh',

    backgroundColor: '#000000',

    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',

    overflow: 'hidden',
  },


  spinner: {
    width: 38,
    height: 38,

    border: '4px solid #22222E',
    borderTop: '4px solid #00D2FF',

    borderRadius: '50%',

    animation: 'shinzi-spin 0.8s linear infinite',
  },


  // ----------------------------------------------------------
  // PLACEHOLDER PAGES
  // ----------------------------------------------------------

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