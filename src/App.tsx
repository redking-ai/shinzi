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


// Assets
import background from './assets/background.png';
import logo from './assets/logo.png';


// ============================================================
// TYPES
// ============================================================

type Screen =
  | 'welcome'
  | 'signup'
  | 'login';


// ============================================================
// APP
// ============================================================

export default function App() {

  // ----------------------------------------------------------
  // AUTHENTICATION STATE
  // ----------------------------------------------------------

  const [user, setUser] =
    useState<User | null>(null);

  const [authLoading, setAuthLoading] =
    useState(true);


  // ----------------------------------------------------------
  // LOCAL SCREEN STATE
  // ----------------------------------------------------------

  const [
    currentScreen,
    setCurrentScreen,
  ] = useState<Screen>('welcome');


  // ----------------------------------------------------------
  // DESKTOP DETECTION
  // ----------------------------------------------------------

  const [isDesktop, setIsDesktop] =
    useState(false);


  // ==========================================================
  // FIREBASE AUTH STATE LISTENER
  // ==========================================================

  useEffect(() => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (firebaseUser) => {

          setUser(firebaseUser);

          setAuthLoading(false);


          /*
           * If a user is authenticated,
           * the authenticated Shinzi app will
           * eventually be rendered here.
           *
           * We do not force the welcome screen
           * when authentication changes.
           */

        }
      );


    return unsubscribe;

  }, []);


  // ==========================================================
  // DESKTOP / MOBILE RESPONSIVE CHECK
  // ==========================================================

  useEffect(() => {

    const mediaQuery =
      window.matchMedia(
        '(min-width: 768px)'
      );


    const updateScreenSize =
      () => {

        setIsDesktop(
          mediaQuery.matches
        );

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
      <div
        style={
          styles.loadingContainer
        }
      >

        <div
          style={
            styles.spinner
          }
        />

      </div>
    );
  }


  // ==========================================================
  // AUTHENTICATED USER
  // ==========================================================

  if (user) {

    return (
      <div
        style={
          styles.mainAppPlaceholder
        }
      >

        <h1
          style={
            styles.placeholderTitle
          }
        >
          Shinzi
        </h1>


        <p
          style={
            styles.placeholderText
          }
        >
          Main Shinzi app coming soon.
        </p>

      </div>
    );
  }


  // ==========================================================
  // SIGN UP
  // ==========================================================

  if (
    currentScreen === 'signup'
  ) {

    return (
      <SignUp
        onBack={() =>
          setCurrentScreen(
            'welcome'
          )
        }
      />
    );
  }


  // ==========================================================
  // LOGIN
  // ==========================================================

  if (
    currentScreen === 'login'
  ) {

    return (
      <div
        style={
          styles.pagePlaceholder
        }
      >

        <h1
          style={
            styles.placeholderTitle
          }
        >
          Log In
        </h1>


        <p
          style={
            styles.placeholderText
          }
        >
          Login page will be connected here.
        </p>


        <button
          style={
            styles.backButton
          }
          onClick={() =>
            setCurrentScreen(
              'welcome'
            )
          }
        >
          Back
        </button>

      </div>
    );
  }


  // ==========================================================
  // RESPONSIVE STYLE VARIANTS
  // ==========================================================

  const safeAreaStyle =
    isDesktop
      ? {
          ...styles.safeArea,
          ...styles.desktopSafeArea,
        }
      : styles.safeArea;


  const heroStyle =
    isDesktop
      ? {
          ...styles.heroSection,
          ...styles.desktopHeroSection,
        }
      : styles.heroSection;


  const logoStyle =
    isDesktop
      ? {
          ...styles.logo,
          ...styles.desktopLogo,
        }
      : styles.logo;


  const titleStyle =
    isDesktop
      ? {
          ...styles.title,
          ...styles.desktopTitle,
        }
      : styles.title;


  const descriptionStyle =
    isDesktop
      ? {
          ...styles.description,
          ...styles.desktopDescription,
        }
      : styles.description;


  const actionStyle =
    isDesktop
      ? {
          ...styles.actionSection,
          ...styles.desktopActionSection,
        }
      : styles.actionSection;


  const signUpStyle =
    isDesktop
      ? {
          ...styles.signUpButton,
          ...styles.desktopButton,
        }
      : styles.signUpButton;


  const logInStyle =
    isDesktop
      ? {
          ...styles.logInButton,
          ...styles.desktopButton,
        }
      : styles.logInButton;


  // ==========================================================
  // WELCOME SCREEN
  // ==========================================================

  return (
    <div
      style={
        styles.container
      }
    >

      <div
        style={{
          ...styles.background,

          backgroundImage:
            `url(${background})`,
        }}
      >

        <div
          style={
            safeAreaStyle
          }
        >

          {/* ==================================================
              HEADER & HERO
          ================================================== */}

          <div
            style={
              heroStyle
            }
          >

            <img
              src={logo}
              alt="Shinzi Hub"
              style={
                logoStyle
              }
            />


            <h1
              style={
                titleStyle
              }
            >

              Welcome to
              <br />
              Shinzi Hub

            </h1>


            <p
              style={
                descriptionStyle
              }
            >

              Join servers, search, or chat.
              <br />
              Tap below to get started.

            </p>

          </div>


          {/* ==================================================
              ACTION BUTTONS
          ================================================== */}

          <div
            style={
              actionStyle
            }
          >

            {/* ==================================================
                REGISTER
            ================================================== */}

            <button
              type="button"
              style={
                signUpStyle
              }
              onClick={() =>
                setCurrentScreen(
                  'signup'
                )
              }
            >
              Register
            </button>


            {/* ==================================================
                LOGIN
            ================================================== */}

            <button
              type="button"
              style={
                logInStyle
              }
              onClick={() =>
                setCurrentScreen(
                  'login'
                )
              }
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

const styles: Record<
  string,
  CSSProperties
> = {

  // ----------------------------------------------------------
  // MAIN CONTAINER
  // ----------------------------------------------------------

  container: {
    width: '100%',
    height: '100dvh',
    minHeight: 0,

    backgroundColor:
      '#000000',

    overflow: 'hidden',
  },


  // ----------------------------------------------------------
  // BACKGROUND
  // ----------------------------------------------------------

  background: {
    width: '100%',
    height: '100%',

    backgroundSize:
      'cover',

    backgroundPosition:
      'center',

    backgroundRepeat:
      'no-repeat',
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

    justifyContent:
      'space-between',

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

    alignItems:
      'center',

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

    flexDirection:
      'column',

    gap: 12,
  },


  // ----------------------------------------------------------
  // REGISTER BUTTON
  // ----------------------------------------------------------

  signUpButton: {
    width: '100%',

    boxSizing:
      'border-box',

    backgroundColor:
      'rgba(10, 10, 14, 0.75)',

    border:
      '1px solid #2E2E42',

    borderRadius: 28,

    paddingTop: 16,
    paddingBottom: 16,

    color: '#FFFFFF',

    fontSize: 16,
    fontWeight: 700,

    cursor: 'pointer',

    transition:
      'transform 0.15s ease, background-color 0.15s ease',
  },


  // ----------------------------------------------------------
  // LOGIN BUTTON
  // ----------------------------------------------------------

  logInButton: {
    width: '100%',

    boxSizing:
      'border-box',

    backgroundColor:
      '#FFFFFF',

    border: 'none',

    borderRadius: 28,

    paddingTop: 16,
    paddingBottom: 16,

    color: '#000000',

    fontSize: 16,
    fontWeight: 700,

    cursor: 'pointer',

    transition:
      'transform 0.15s ease, opacity 0.15s ease',
  },


  // ----------------------------------------------------------
  // DESKTOP
  // ----------------------------------------------------------

  desktopSafeArea: {
    maxWidth: 760,

    paddingLeft: 40,
    paddingRight: 40,

    paddingTop: 40,
    paddingBottom: 40,
  },


  desktopHeroSection: {
    marginTop: 60,
  },


  desktopLogo: {
    width: 150,
    height: 150,

    marginBottom: 30,
  },


  desktopTitle: {
    fontSize: 46,

    lineHeight: 1.15,

    letterSpacing: 0.3,
  },


  desktopDescription: {
    marginTop: 18,

    fontSize: 19,

    lineHeight: 1.5,
  },


  desktopActionSection: {
    width: '100%',

    maxWidth: 560,

    marginLeft: 'auto',
    marginRight: 'auto',

    marginBottom: 30,

    gap: 16,
  },


  desktopButton: {
    paddingTop: 18,
    paddingBottom: 18,

    borderRadius: 32,

    fontSize: 18,
  },


  // ----------------------------------------------------------
  // LOADING
  // ----------------------------------------------------------

  loadingContainer: {
    width: '100%',
    height: '100dvh',

    backgroundColor:
      '#000000',

    display: 'flex',

    justifyContent:
      'center',

    alignItems:
      'center',

    overflow: 'hidden',
  },


  spinner: {
    width: 38,
    height: 38,

    border:
      '4px solid #22222E',

    borderTop:
      '4px solid #00D2FF',

    borderRadius: '50%',

    animation:
      'shinzi-spin 0.8s linear infinite',
  },


  // ----------------------------------------------------------
  // PLACEHOLDER PAGES
  // ----------------------------------------------------------

  pagePlaceholder: {
    width: '100%',
    height: '100dvh',

    boxSizing:
      'border-box',

    backgroundColor:
      '#000000',

    color: '#FFFFFF',

    display: 'flex',

    flexDirection:
      'column',

    justifyContent:
      'center',

    alignItems:
      'center',

    padding: 24,

    overflow: 'hidden',
  },


  mainAppPlaceholder: {
    width: '100%',
    height: '100dvh',

    boxSizing:
      'border-box',

    backgroundColor:
      '#000000',

    color: '#FFFFFF',

    display: 'flex',

    flexDirection:
      'column',

    justifyContent:
      'center',

    alignItems:
      'center',

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

    padding:
      '12px 24px',

    border: 'none',

    borderRadius: 24,

    backgroundColor:
      '#FFFFFF',

    color: '#000000',

    fontSize: 15,

    fontWeight: 700,

    cursor: 'pointer',
  },
};