import {
  useState,
  type CSSProperties,
} from 'react';

import {
  loginUser,
  sendPasswordReset,
} from './authService';

interface LoginProps {
  onBack: () => void;
}

export default function Login({
  onBack,
}: LoginProps) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');

  // Forgot Password States
  const [showForgotModal, setShowForgotModal] =
    useState(false);

  const [resetEmail, setResetEmail] =
    useState('');

  const [resetSent, setResetSent] =
    useState(false);

  const [sendingReset, setSendingReset] =
    useState(false);

  // Login state
  const [loggingIn, setLoggingIn] =
    useState(false);

  // Password validation
  const hasNumber = /\d/.test(password);

  // ======================================================
  // LOGIN
  // ======================================================

  const handleFirebaseLogin = async () => {
    if (loggingIn) return;

    const email = identity.trim();

    if (!email) {
      window.alert(
        'Login Failed\n\nPlease enter your email address.'
      );
      return;
    }

    if (!password) {
      window.alert(
        'Login Failed\n\nPlease enter your password.'
      );
      return;
    }

    if (!hasNumber) {
      window.alert(
        'Login Failed\n\nYour password must contain at least 1 number.'
      );
      return;
    }

    try {
      setLoggingIn(true);

      const { user, error } =
        await loginUser(
          email,
          password
        );

      if (error) {
        window.alert(
          `Login Failed\n\n${error}`
        );
        return;
      }

      if (!user) {
        window.alert(
          'Login Failed\n\nFirebase did not return a user account.'
        );
        return;
      }

      /*
       * IMPORTANT:
       *
       * We do NOT manually navigate to ChatScreen here.
       *
       * App.tsx listens to Firebase's
       * onAuthStateChanged().
       *
       * Once Firebase authentication succeeds,
       * App.tsx automatically changes the screen.
       */

      window.alert(
        `Success\n\nWelcome back, ${user.email}!`
      );

    } catch (error: unknown) {
      console.error(
        'Login error:',
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong while logging in.';

      window.alert(
        `Login Failed\n\n${message}`
      );

    } finally {
      setLoggingIn(false);
    }
  };

  // ======================================================
  // FORGOT PASSWORD
  // ======================================================

  const handleSendReset = async () => {
    if (sendingReset) return;

    const email =
      resetEmail.trim();

    if (!email) {
      window.alert(
        'Invalid Email\n\nPlease enter your registered email address.'
      );
      return;
    }

    if (!email.includes('@')) {
      window.alert(
        'Invalid Email\n\nPlease enter a valid email address.'
      );
      return;
    }

    try {
      setSendingReset(true);

      const result =
        await sendPasswordReset(
          email
        );

      if (!result.success) {
        window.alert(
          `Reset Failed\n\n${
            result.error ||
            'Unable to send the password reset email.'
          }`
        );
        return;
      }

      setResetSent(true);

    } catch (error: unknown) {
      console.error(
        'Password reset error:',
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to send the password reset email.';

      window.alert(
        `Reset Failed\n\n${message}`
      );

    } finally {
      setSendingReset(false);
    }
  };

  // ======================================================
  // CLOSE FORGOT PASSWORD MODAL
  // ======================================================

  const closeForgotModal = () => {
    if (sendingReset) return;

    setShowForgotModal(false);
    setResetSent(false);
    setResetEmail('');
  };

  // ======================================================
  // OPEN FORGOT PASSWORD MODAL
  // ======================================================

  const openForgotModal = () => {
    setResetSent(false);
    setResetEmail('');
    setShowForgotModal(true);
  };

  return (
    <div style={styles.container}>

      {/* ==================================================
          HEADER
      ================================================== */}

      <div style={styles.header}>

        <button
          type="button"
          onClick={onBack}
          disabled={loggingIn}
          style={{
            ...styles.backButton,
            ...(loggingIn
              ? styles.disabledControl
              : {}),
          }}
          aria-label="Back"
        >
          ←
        </button>

      </div>

      {/* ==================================================
          CONTENT
      ================================================== */}

      <div style={styles.content}>

        {/* ==================================================
            WELCOME
        ================================================== */}

        <div style={styles.welcomeSection}>

          <div style={styles.welcomeTitle}>
            WELCOME BACK
          </div>

          <div style={styles.welcomeSubtitle}>
            We're so excited to see you again!
          </div>

        </div>

        {/* ==================================================
            EMAIL
        ================================================== */}

        <div style={styles.fieldGroup}>

          <label
            htmlFor="login-email"
            style={styles.inputLabel}
          >
            Email
          </label>

          <div className="login-input-box" style={styles.inputBox}>

            <input
              id="login-email"
              className="login-input"
              type="email"
              aria-label="Email"
              placeholder="Enter your email address"
              value={identity}
              onChange={(event) =>
                setIdentity(
                  event.target.value
                )
              }
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              disabled={loggingIn}
              style={styles.input}
            />

          </div>

        </div>

        {/* ==================================================
            PASSWORD
        ================================================== */}

        <div style={styles.fieldGroup}>

          <label
            htmlFor="login-password"
            style={styles.inputLabel}
          >
            Password
          </label>

          <div className="login-input-box" style={styles.inputBox}>

            <input
              id="login-password"
              className="login-input"
              type="password"
              aria-label="Password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="current-password"
              disabled={loggingIn}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  identity &&
                  password &&
                  hasNumber
                ) {
                  void handleFirebaseLogin();
                }
              }}
              style={styles.input}
            />

          </div>

        </div>

        {/* ==================================================
            PASSWORD NUMBER WARNING
        ================================================== */}

        {password.length > 0 &&
          !hasNumber && (
            <div style={styles.errorText}>
              * Password must contain at least 1 number
            </div>
          )}

        {/* ==================================================
            FORGOT PASSWORD
        ================================================== */}

        <button
          type="button"
          onClick={openForgotModal}
          disabled={loggingIn}
          style={{
            ...styles.forgotButton,
            ...(loggingIn
              ? styles.disabledControl
              : {}),
          }}
        >
          Forgot Password?
        </button>

        {/* ==================================================
            LOG IN
        ================================================== */}

        <button
          type="button"
          disabled={
            !identity ||
            !password ||
            !hasNumber ||
            loggingIn
          }
          onClick={() => {
            void handleFirebaseLogin();
          }}
          style={{
            ...styles.continueBtn,
            ...(
              !identity ||
              !password ||
              !hasNumber ||
              loggingIn
            )
              ? styles.disabledBtn
              : {},
          }}
        >
          {loggingIn
            ? 'Logging in...'
            : 'Log In'}
        </button>

      </div>

      {/* ==================================================
          FORGOT PASSWORD MODAL
      ================================================== */}

      {showForgotModal && (
        <div
          style={styles.modalBg}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeForgotModal();
            }
          }}
        >

          <div style={styles.modalContent}>

            {!resetSent ? (
              <>
                  <button
  type="button"
  onClick={closeForgotModal}
  disabled={sendingReset}
  style={{
    ...styles.modalBackButton,
    ...(sendingReset
      ? styles.disabledControl
      : {}),
  }}
  aria-label="Back"
>
  ←
</button>
                <div style={styles.modalTitle}>
                  Reset Password
                </div>

                 <div style={styles.modalSub}>
  You'll receive an email with a password
  reset link. Open it and follow the
  instructions to create a new password.
</div>

                {/* Reset email */}

                <div style={styles.inputBox}>

                  <input
                    className="login-input"
                    type="email"
                    placeholder="Enter your registered email"
                    value={resetEmail}
                    onChange={(event) =>
                      setResetEmail(
                        event.target.value
                      )
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="email"
                    disabled={sendingReset}
                    style={styles.input}
                  />

                </div>

                {/* Send reset */}

                <button
                  type="button"
                  disabled={
                    !resetEmail ||
                    sendingReset
                  }
                  onClick={() => {
                    void handleSendReset();
                  }}
                  style={{
                    ...styles.continueBtn,
                    ...styles.resetButton,
                    ...(
                      !resetEmail ||
                      sendingReset
                    )
                      ? styles.disabledBtn
                      : {},
                  }}
                >
                  {sendingReset
                    ? 'Sending...'
                    : 'Send Reset Link'}
                </button>
                                      </>

                        ) : (
              
<>
  <div style={styles.successContent}>
    <div style={styles.modalTitle}>
      Email Sent! ✉️
    </div>

    <div style={styles.successText}>
      If an account matches that email address,
      you'll receive a password reset link.
      Check your inbox, spam folder, and follow
      the instructions to reset your password.
    </div>

    <button
      type="button"
      onClick={closeForgotModal}
      disabled={sendingReset}
      style={{
        ...styles.doneButton,
        ...(sendingReset ? styles.disabledBtn : {}),
      }}
    >
      Done
    </button>
  </div>
</>

            )}

          </div>
        </div>
      )}

      {/* ==================================================
          PLACEHOLDER STYLING
      ================================================== */}

      <style>{`
        .login-input::placeholder {
          color: #A6A2B5;
          opacity: 1;
          font-weight: 400;
        }

        .login-input:disabled::placeholder {
          opacity: 0.55;
        }
          .login-input:focus {
  outline: none;
}

.login-input:focus-visible {
  outline: none;
}

.login-input:focus-visible {
  outline: none;
}

.login-input:focus {
  caret-color: #FFFFFF;
}

.login-input:focus {
  outline: none;
}

.login-input:focus {
  color: #FFFFFF;
}
.login-input-box {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.login-input-box:focus-within {
  border-color: #20D9FF;
  box-shadow: 0 0 0 3px rgba(32, 217, 255, 0.14);
}
      `}</style>

    </div>
  );
}

// ======================================================
// STYLES
// ======================================================

const styles: Record<
  string,
  CSSProperties
> = {

  container: {
    minHeight: '100vh',
    width: '100%',
    backgroundColor: '#080612',
    color: '#FFFFFF',
    boxSizing: 'border-box',
  },

  // ====================================================
  // HEADER
  // ====================================================

  header: {
    display: 'flex',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 10,
    boxSizing: 'border-box',
  },

  backButton: {
    border: 'none',
    background: 'transparent',
    color: '#00D2FF',
    fontSize: 30,
    fontWeight: 400,
    padding: 0,
    cursor: 'pointer',
    lineHeight: 1,
  },

  // ====================================================
  // CONTENT
  // ====================================================

  content: {
    minHeight:
      'calc(100vh - 80px)',

    display: 'flex',
    flexDirection: 'column',

    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 10,

    boxSizing: 'border-box',
  },

  // ====================================================
  // WELCOME
  // ====================================================

  welcomeSection: {
    marginBottom: 30,
  },

  welcomeTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: -0.3,
    lineHeight: 1.2,
    marginBottom: 6,
  },

  welcomeSubtitle: {
    color: '#8E8EA0',
    fontSize: 15,
    fontWeight: 400,
    lineHeight: 1.45,
  },

  // ====================================================
  // FIELD GROUP
  // ====================================================

  fieldGroup: {
    width: '100%',
    marginBottom: 22,
  },

  inputLabel: {
    display: 'block',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 8,
    marginLeft: 4,
    lineHeight: 1.3,
  },

  // ====================================================
  // INPUT
  // ====================================================

 inputBox: {
  backgroundColor: '#17102A',
  borderRadius: 12,
  border: '1px solid #39265D',
  marginBottom: 0,
  overflow: 'hidden',
}, 

  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    color: '#FFFFFF',

    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 18,
    paddingBottom: 18,

    fontSize: 16,
    fontFamily: 'inherit',
  },

  // ====================================================
  // ERROR
  // ====================================================

  errorText: {
    color: '#FF3366',
    fontSize: 13,
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },

  // ====================================================
  // FORGOT PASSWORD
  // ====================================================

  forgotButton: {
    alignSelf: 'flex-start',
    border: 'none',
    background: 'transparent',
    color: '#00D2FF',
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 24,
    marginLeft: 4,
    padding: 0,
    cursor: 'pointer',
  },

  // ====================================================
  // LOG IN BUTTON
  // ====================================================

  continueBtn: {
    width: '100%',
    border: '1px solid rgba(118, 43, 255, 0.8)',
background: 'linear-gradient(90deg, #3020A0, #762BFF)',
color: '#FFFFFF',
boxShadow: '0 0 14px rgba(118, 43, 255, 0.22)',
    borderRadius: 28,

    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 20,
    paddingRight: 20,

    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'inherit',

    cursor: 'pointer',

    marginTop: 30,
    marginBottom: 20,

    boxSizing: 'border-box',
  },

  resetButton: {
    marginTop: 0,
    marginBottom: 10,
  },

  disabledBtn: {
  background: '#211B30',
  border: '1px solid #302641',
  color: '#777184',
  boxShadow: 'none',
  opacity: 1,
  cursor: 'not-allowed',
},

  disabledControl: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  // ====================================================
  // FORGOT PASSWORD MODAL
  // ====================================================

  modalBg: {
    position: 'fixed',
    inset: 0,

    backgroundColor:
      'rgba(0, 0, 0, 0.8)',

    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',

    zIndex: 1000,
  },

  modalContent: {
  width: '100%',
  maxHeight: '85dvh',
  flexShrink: 0,

  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',

  backgroundColor: '#14141C',

  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,

  padding: 24,
  paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',

  boxSizing: 'border-box',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
},

  modalTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 12,
    textAlign: 'center',
  },

  modalSub: {
  color: '#A5A5BA',
  fontSize: 14,
  textAlign: 'center',
  marginTop: 0,
  marginBottom: 24,
  lineHeight: 1.5,
  flexShrink: 0,
},

  cancelBtn: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#8E8EA0',

    fontSize: 16,
    fontWeight: 600,

    paddingTop: 16,
    paddingBottom: 16,

    cursor: 'pointer',
    fontFamily: 'inherit',
  },

modalBackButton: {
  alignSelf: 'flex-start',

  border: 'none',
  background: 'transparent',

  color: '#00D2FF',

  fontSize: 30,
  fontWeight: 400,

  padding: 0,
  marginBottom: 10,

  cursor: 'pointer',
  lineHeight: 1,
  },
 
successContent: {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  width: '100%',
  minHeight: 0,
  gap: 12,
  boxSizing: 'border-box',
},

successText: {
  color: '#A5A5BA',
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.5,
  textAlign: 'center',
  width: '100%',
  margin: '0 0 12px',
  boxSizing: 'border-box',
},

doneButton: {
  width: '100%',
  flexShrink: 0,
  border: 'none',
  backgroundColor: '#FFFFFF',
  color: '#000000',
  borderRadius: 28,
  padding: '16px 20px',
  fontSize: 16,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxSizing: 'border-box',
   },
};