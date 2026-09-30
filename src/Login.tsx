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

      const { user, error } = await loginUser(
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
       * App.tsx should listen to Firebase's
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

    const email = resetEmail.trim();

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
        await sendPasswordReset(email);

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
        >
          ←
         </button>

        <div style={styles.stepText}>
          LOG IN
        </div>

        <div style={styles.headerSpacer} />

      </div>

      {/* ==================================================
          CONTENT
      ================================================== */}

      <div style={styles.content}>

        {/* Email */}

        <div style={styles.inputBox}>

          <input
            type="email"
            placeholder="Email"
            value={identity}
            onChange={(event) =>
              setIdentity(event.target.value)
            }
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
            disabled={loggingIn}
            style={styles.input}
          />

        </div>

        {/* Password */}

        <div style={styles.inputBox}>

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
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

        {/* Password number warning */}

        {password.length > 0 &&
          !hasNumber && (
            <div style={styles.errorText}>
              * Password must contain at least 1 number
            </div>
          )}

        {/* Forgot Password */}

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

        {/* Continue */}

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
            : 'Continue'}
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
              event.target === event.currentTarget
            ) {
              closeForgotModal();
            }
          }}
        >

          <div style={styles.modalContent}>

            {!resetSent ? (
              <>
                <div style={styles.modalTitle}>
                  Reset Password
                </div>

                <div style={styles.modalSub}>
                  Note: For password reset you will
                  get an email. You must verify your
                  email address to reset your password.
                </div>

                {/* Reset email */}

                <div style={styles.inputBox}>

                  <input
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
                <div style={styles.modalTitle}>
                  Email Sent! ✉️
                </div>

                <div style={styles.modalSub}>
                  A password reset email has been
                  sent to the address you entered.
                  Check your inbox and follow the
                  instructions to reset your password.
                </div>
              </>
            )}

            {/* Close */}

            <button
              type="button"
              onClick={closeForgotModal}
              disabled={sendingReset}
              style={{
                ...styles.cancelBtn,
                ...(sendingReset
                  ? styles.disabledControl
                  : {}),
              }}
            >
              Close
            </button>

          </div>

        </div>
      )}

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
    backgroundColor: '#000000',
    color: '#FFFFFF',
    boxSizing: 'border-box',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 30,
    boxSizing: 'border-box',
  },

  backButton: {
    border: 'none',
    background: 'transparent',
    color: '#00D2FF',
    fontSize: 26,
    fontWeight: 400,
    padding: 0,
    cursor: 'pointer',
  },

  stepText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 1,
  },

  headerSpacer: {
    width: 50,
  },

  content: {
    minHeight:
      'calc(100vh - 100px)',
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 20,
    boxSizing: 'border-box',
  },

  inputBox: {
    backgroundColor: '#0D0D12',
    borderRadius: 12,
    border: '1px solid #22222E',
    marginBottom: 10,
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

  errorText: {
    color: '#FF3366',
    fontSize: 13,
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },

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

  continueBtn: {
    width: '100%',
    border: 'none',
    backgroundColor: '#FFFFFF',
    color: '#000000',
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
    backgroundColor: '#333333',
    color: '#000000',
    opacity: 0.7,
    cursor: 'not-allowed',
  },

  disabledControl: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },

  modalBg: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    zIndex: 1000,
  },

  modalContent: {
    width: '100%',
    backgroundColor: '#14141C',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    boxSizing: 'border-box',
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
    marginBottom: 24,
    lineHeight: 20,
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
};
