import { auth, db } from './firebaseConfig';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
  signOut,
  type User,
  type UserCredential,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';


// ============================================================
// TYPES
// ============================================================

export interface AuthResult {
  user: User | null;
  error: string | null;
  code: string | null;
}

export interface LoginResult {
  user: User | null;
  error: string | null;
  unverified: boolean;
}

export interface ProfileData {
  displayName: string;
  username: string;
  gender: string;
  profileAssetId: string;
  [key: string]: unknown;
}

export interface ProfileResult {
  success: boolean;
  error: string | null;
}


// ============================================================
// CONSTANTS
// ============================================================

const USERNAME_PATTERN = /^[a-z0-9_]{3,15}$/;

const USERNAME_FORMAT_ERROR =
  'Username must be 3–15 characters and contain only lowercase letters, numbers, and underscores.';


// ============================================================
// FRIENDLY ERRORS
// ============================================================
//
// Firebase error messages look like
// "Firebase: Error (auth/email-already-in-use)."
// which is not something a user should read.
// These helpers turn known error codes into plain sentences.
//
// ============================================================

const FRIENDLY_ERRORS: Record<string, string> = {
  'auth/email-already-in-use':
    'That email is already registered. Go back and use a different email, or log in instead.',

  'auth/invalid-email':
    'That email address is not valid.',

  'auth/weak-password':
    'That password is too weak. Use at least 6 characters, including a number.',

  'auth/network-request-failed':
    'Network error. Check your connection and try again.',

  'auth/too-many-requests':
    'Too many attempts. Wait a moment and try again.',

  'auth/operation-not-allowed':
    'Email sign-up is not enabled for this app yet.',

  'auth/invalid-credential':
    'Incorrect email or password.',

  'auth/wrong-password':
    'Incorrect email or password.',

  'auth/user-not-found':
    'Incorrect email or password.',

  'auth/user-disabled':
    'This account has been disabled.',

  'auth/requires-recent-login':
    'Please log in again to continue.',

  'permission-denied':
    'The server rejected this request (permission denied). Try again, and contact support if it keeps happening.',

  unavailable:
    'The server is temporarily unavailable. Try again in a moment.',
};

export const getErrorCode = (
  error: unknown
): string | null => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error
  ) {
    const code =
      (error as { code?: unknown }).code;

    return typeof code === 'string'
      ? code
      : null;
  }

  return null;
};

export const getFriendlyErrorMessage = (
  error: unknown,
  fallback =
    'Something went wrong. Please try again.'
): string => {
  const code = getErrorCode(error);

  if (code && FRIENDLY_ERRORS[code]) {
    return FRIENDLY_ERRORS[code];
  }

  // Plain Errors (Drive, validation, etc.) already
  // carry a readable message. Firebase errors that
  // have a code but no friendly mapping fall back.
  if (
    !code &&
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
};


// ============================================================
// CREATE FIREBASE AUTH USER
// ============================================================
//
// This function ONLY creates the Firebase Authentication user.
//
// It does NOT touch Firestore.
//
// IMPORTANT:
// The old "fast username pre-check" was removed from here.
// Firestore rules require request.auth != null to read
// /usernames, and no user is signed in until
// createUserWithEmailAndPassword() succeeds, so that read
// always failed with "Missing or insufficient permissions".
//
// The username is now checked AFTER sign-in through
// checkUsernameAvailable(), and uniqueness is enforced
// atomically by the Firestore rules on the batch commit.
//
// The verification email is no longer sent from here.
// It is sent by sendVerificationEmailSafe() only after the
// whole signup succeeded, so a failed signup never emails
// a user about an account that was rolled back.
//
// `username` is still validated for format so the caller
// signature stays the same.
//
// ============================================================

export const createEmailAuthUser = async (
  email: string,
  password: string,
  username: string
): Promise<AuthResult> => {
  try {
    if (
      typeof email !== 'string' ||
      !email.trim()
    ) {
      return {
        user: null,
        error: 'Email is required.',
        code: null,
      };
    }

    if (
      typeof password !== 'string' ||
      !password
    ) {
      return {
        user: null,
        error: 'Password is required.',
        code: null,
      };
    }

    if (
      typeof username !== 'string' ||
      !username.trim()
    ) {
      return {
        user: null,
        error: 'Username is required.',
        code: null,
      };
    }

    const cleanUsername =
      username.trim().toLowerCase();

    if (!USERNAME_PATTERN.test(cleanUsername)) {
      return {
        user: null,
        error: USERNAME_FORMAT_ERROR,
        code: null,
      };
    }

    const userCredential: UserCredential =
      await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

    return {
      user: userCredential.user,
      error: null,
      code: null,
    };

  } catch (error: unknown) {
    console.error(
      '🔥 AUTH USER CREATION ERROR:',
      error
    );

    const code = getErrorCode(error);

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      '🔥 Firebase error code:',
      code
    );

    console.error(
      '🔥 Firebase error message:',
      message
    );

    return {
      user: null,
      error: getFriendlyErrorMessage(
        error,
        'Failed to create account.'
      ),
      code,
    };
  }
};


// ============================================================
// USERNAME AVAILABILITY (AUTHENTICATED)
// ============================================================
//
// Must be called AFTER the Firebase Auth user exists,
// because /usernames reads require request.auth != null.
//
// This is only a convenience check so the user hears
// "taken" early. The real guarantee is the Firestore rule
// on /usernames create (!exists(...)) evaluated atomically
// when the batch is committed.
//
// ============================================================

export const checkUsernameAvailable = async (
  username: string
): Promise<boolean> => {
  const cleanUsername =
    String(username || '')
      .trim()
      .toLowerCase();

  if (!USERNAME_PATTERN.test(cleanUsername)) {
    throw new Error(USERNAME_FORMAT_ERROR);
  }

  const snapshot = await getDoc(
    doc(db, 'usernames', cleanUsername)
  );

  return !snapshot.exists();
};


// ============================================================
// EMAIL VERIFICATION
// ============================================================
//
// Never throws. A failure to send the email must not
// invalidate an otherwise successful account.
//
// ============================================================

export const sendVerificationEmailSafe = async (
  user: User | null
): Promise<boolean> => {
  if (!user) {
    return false;
  }

  try {
    await sendEmailVerification(user);
    return true;
  } catch (error: unknown) {
    console.warn(
      'Email verification could not be sent:',
      error
    );

    return false;
  }
};


// ============================================================
// CREATE FIRESTORE USER PROFILE
// ============================================================
//
// IMPORTANT:
//
// This runs AFTER the Firebase Auth user exists.
//
// profileAssetId should contain the REAL Shinzi asset ID:
//
// shz-Ph12345
//
// The username reservation and user profile are committed
// together in ONE Firestore batch. The rules use
// existsAfter()/getAfter() to require both documents.
//
// NOTE ON DOB:
// profileData.dob is intentionally NOT stored here.
// /users is readable by every signed-in user, so a date of
// birth must not go in that document. If you decide to
// store it, use an owner-only document with its own rule.
//
// ============================================================

export const createUserProfile = async (
  user: User | null,
  profileData: ProfileData | null
): Promise<ProfileResult> => {
  let checkedUsername: string | null = null;

  try {

    if (
      !user ||
      !user.uid
    ) {
      return {
        success: false,
        error: 'Authenticated user is required.',
      };
    }

    if (!profileData) {
      return {
        success: false,
        error: 'Profile information is missing.',
      };
    }

    if (
      !profileData.displayName ||
      !profileData.username ||
      !profileData.gender
    ) {
      return {
        success: false,
        error:
          'Required profile information is missing.',
      };
    }

    const cleanUsername =
      profileData.username
        .trim()
        .toLowerCase();

    if (!USERNAME_PATTERN.test(cleanUsername)) {
      return {
        success: false,
        error: USERNAME_FORMAT_ERROR,
      };
    }

    if (
      !profileData.profileAssetId ||
      typeof profileData.profileAssetId !== 'string'
    ) {
      return {
        success: false,
        error:
          'A valid profile asset ID is required.',
      };
    }

    checkedUsername = cleanUsername;

    const usernameRef =
      doc(db, 'usernames', cleanUsername);

    const userRef =
      doc(db, 'users', user.uid);

    // Final check for the normal race where two people
    // pick the same username at the same time. The rules
    // still enforce it atomically at commit.
    const usernameSnap =
      await getDoc(usernameRef);

    if (usernameSnap.exists()) {
      return {
        success: false,
        error: 'That username is already taken. Please choose another one.',
      };
    }

    const userData = {

      displayName:
        profileData.displayName.trim(),

      username:
        cleanUsername,

      gender:
        profileData.gender,

      profileAssetId:
        profileData.profileAssetId,

      // Kept for compatibility with older UI/code.
      // The actual profile image reference is
      // profileAssetId.
      photoURL: null,

      profileDriveFileId: null,

      bannerUrl: null,

      bubleText: '',

      bio: '',

      createdAt: serverTimestamp(),

      usernameLastChanged: null,

      socialStats: {
        friendsCount: 0,
        followersCount: 0,
        mutualFriends: 0,
        mutualServers: 0,
        serversJoined: 0,
      },
    };

    const batch = writeBatch(db);

    // User profile
    batch.set(userRef, userData);

    // Username reservation (same batch, same commit)
    batch.set(usernameRef, {
      uid: user.uid,
    });

    await batch.commit();

    return {
      success: true,
      error: null,
    };

  } catch (error: unknown) {

    console.error(
      'User Profile Creation Error:',
      error
    );

    // A denied batch usually means someone else
    // reserved the username a moment ago.
    if (
      getErrorCode(error) === 'permission-denied' &&
      checkedUsername
    ) {
      try {
        const takenSnap = await getDoc(
          doc(db, 'usernames', checkedUsername)
        );

        if (takenSnap.exists()) {
          return {
            success: false,
            error:
              'That username was just taken. Please choose another one.',
          };
        }
      } catch {
        // Fall through to the generic message.
      }
    }

    return {
      success: false,
      error: getFriendlyErrorMessage(
        error,
        'Failed to create your Shinzi profile.'
      ),
    };
  }
};


// ============================================================
// DELETE CURRENT AUTH USER
// ============================================================
//
// Used for signup rollback.
//
// Never throws. If the account cannot be deleted, the user
// is signed out so they are not left half-signed-in with
// no profile, and success: false is returned.
//
// ============================================================

export const deleteCurrentAuthUser = async (
  user: User | null = auth.currentUser
): Promise<ProfileResult> => {

  if (
    !user ||
    !user.uid
  ) {
    return {
      success: false,
      error: 'No authenticated user to delete.',
    };
  }

  try {

    await deleteUser(user);

    return {
      success: true,
      error: null,
    };

  } catch (error: unknown) {

    console.error(
      'Auth Rollback Error:',
      error
    );

    try {
      await signOut(auth);
    } catch (signOutError: unknown) {
      console.error(
        'Sign-out after failed rollback also failed:',
        signOutError
      );
    }

    return {
      success: false,
      error: getFriendlyErrorMessage(
        error,
        'Failed to roll back account.'
      ),
    };
  }
};


// ============================================================
// LOGIN
// ============================================================

export const loginUser = async (
  email: string,
  password: string
): Promise<LoginResult> => {

  try {

    const userCredential: UserCredential =
      await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

    const user = userCredential.user;

    return {
      user,
      error: null,
      unverified: !user.emailVerified,
    };

  } catch (error: unknown) {

    console.error(
      'Login Error:',
      error
    );

    return {
      user: null,

      error: getFriendlyErrorMessage(
        error,
        'Failed to log in.'
      ),

      unverified: false,
    };
  }
};


