import { auth, db } from './firebaseConfig';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  deleteUser,
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
// CREATE FIREBASE AUTH USER
// ============================================================
//
// This function ONLY creates the Firebase Authentication user.
//
// It does NOT create the Firestore profile yet.
//
// This is intentional.
//
// New signup flow:
//
// Auth user
//   ↓
// UID
//   ↓
// Google Drive upload
//   ↓
// Shinzi asset record
//   ↓
// Firestore user profile
//
// ============================================================

export const createEmailAuthUser = async (
  email: string,
  password: string,
  username: string
): Promise<AuthResult> => {
  try {
    // --------------------------------------------------
    // BASIC VALIDATION
    // --------------------------------------------------

    if (
      typeof email !== 'string' ||
      !email.trim()
    ) {
      return {
        user: null,
        error: 'Email is required.',
      };
    }

    if (
      typeof password !== 'string' ||
      !password
    ) {
      return {
        user: null,
        error: 'Password is required.',
      };
    }

    if (
      typeof username !== 'string' ||
      !username.trim()
    ) {
      return {
        user: null,
        error: 'Username is required.',
      };
    }


    // --------------------------------------------------
    // NORMALIZE USERNAME
    // --------------------------------------------------

    const cleanUsername =
      username
        .trim()
        .toLowerCase();


    // --------------------------------------------------
    // USERNAME FORMAT
    // --------------------------------------------------

    if (
      !/^[a-z0-9_]{3,15}$/.test(
        cleanUsername
      )
    ) {
      return {
        user: null,
        error:
          'Username must be 3–15 characters and contain only lowercase letters, numbers, and underscores.',
      };
    }


    // --------------------------------------------------
    // FAST USERNAME PRE-CHECK
    // --------------------------------------------------

    const usernameRef =
      doc(
        db,
        'usernames',
        cleanUsername
      );

    const usernameSnap =
      await getDoc(usernameRef);

    if (usernameSnap.exists()) {
      return {
        user: null,
        error: 'Username is already taken.',
      };
    }


    // --------------------------------------------------
    // CREATE FIREBASE AUTH USER
    // --------------------------------------------------

    const userCredential: UserCredential =
      await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

    const user =
      userCredential.user;


    // --------------------------------------------------
    // EMAIL VERIFICATION
    // --------------------------------------------------

    try {
      await sendEmailVerification(
        user
      );
    } catch (emailError: unknown) {
      // Email verification failure should NOT
      // invalidate an otherwise successful account.

      console.warn(
        'Email verification could not be sent immediately:',
        emailError
      );
    }


    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return {
      user,
      error: null,
    };

  } catch (error: unknown) {
    console.error(
      'Auth User Creation Error:',
      error
    );

    return {
      user: null,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to create account.',
    };
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
// together in one Firestore batch.
//
// ============================================================

export const createUserProfile = async (
  user: User | null,
  profileData: ProfileData | null
): Promise<ProfileResult> => {
  try {

    // --------------------------------------------------
    // VALIDATE AUTH USER
    // --------------------------------------------------

    if (
      !user ||
      !user.uid
    ) {
      return {
        success: false,
        error: 'Authenticated user is required.',
      };
    }


    // --------------------------------------------------
    // VALIDATE PROFILE DATA
    // --------------------------------------------------

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


    // --------------------------------------------------
    // NORMALIZE USERNAME
    // --------------------------------------------------

    const cleanUsername =
      profileData.username
        .trim()
        .toLowerCase();


    // --------------------------------------------------
    // VALIDATE USERNAME
    // --------------------------------------------------

    if (
      !/^[a-z0-9_]{3,15}$/.test(
        cleanUsername
      )
    ) {
      return {
        success: false,
        error:
          'Username must be 3–15 characters and contain only lowercase letters, numbers, and underscores.',
      };
    }


    // --------------------------------------------------
    // PROFILE ASSET VALIDATION
    // --------------------------------------------------

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


    // --------------------------------------------------
    // REFERENCES
    // --------------------------------------------------

    const usernameRef =
      doc(
        db,
        'usernames',
        cleanUsername
      );

    const userRef =
      doc(
        db,
        'users',
        user.uid
      );


    // --------------------------------------------------
    // FINAL USERNAME CHECK
    // --------------------------------------------------
    //
    // This protects against the normal race where
    // two clients checked the username at the same
    // time.
    //
    // Firestore security rules should ALSO enforce
    // the reservation atomically.
    //
    // --------------------------------------------------

    const usernameSnap =
      await getDoc(usernameRef);

    if (usernameSnap.exists()) {
      return {
        success: false,
        error: 'Username is already taken.',
      };
    }


    // --------------------------------------------------
    // USER PROFILE DATA
    // --------------------------------------------------

    const userData = {

      displayName:
        profileData.displayName
          .trim(),

      username:
        cleanUsername,

      gender:
        profileData.gender,

      // ------------------------------------------------
      // REAL SHINZI PROFILE ASSET
      // ------------------------------------------------

      profileAssetId:
        profileData.profileAssetId,

      // Kept for compatibility with older UI/code.
      // The actual profile image reference is now
      // profileAssetId.
      photoURL:
        null,

      profileDriveFileId:
        null,

      bannerUrl:
        null,

      bubleText:
        '',

      bio:
        '',

      createdAt:
        serverTimestamp(),

      usernameLastChanged:
        null,

      socialStats: {
        friendsCount: 0,
        followersCount: 0,
        mutualFriends: 0,
        mutualServers: 0,
        serversJoined: 0,
      },
    };


    // --------------------------------------------------
    // FIRESTORE BATCH
    // --------------------------------------------------

    const batch =
      writeBatch(db);


    // User profile
    batch.set(
      userRef,
      userData
    );


    // Username reservation
    batch.set(
      usernameRef,
      {
        uid: user.uid,
      }
    );


    // --------------------------------------------------
    // COMMIT
    // --------------------------------------------------

    await batch.commit();


    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return {
      success: true,
      error: null,
    };

  } catch (error: unknown) {

    console.error(
      'User Profile Creation Error:',
      error
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to create user profile.',
    };
  }
};


// ============================================================
// DELETE CURRENT AUTH USER
// ============================================================
//
// Used for signup rollback.
//
// Example:
//
// Auth created
// ↓
// Drive upload fails
// ↓
// Delete Auth account
//
// This prevents an orphan Firebase Auth account.
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

    await deleteUser(
      user
    );

    return {
      success: true,
      error: null,
    };

  } catch (error: unknown) {

    console.error(
      'Auth Rollback Error:',
      error
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to roll back account.',
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

    const user =
      userCredential.user;

    return {
      user,
      error: null,
      unverified:
        !user.emailVerified,
    };

  } catch (error: unknown) {

    console.error(
      'Login Error:',
      error
    );

    return {
      user: null,

      error:
        error instanceof Error
          ? error.message
          : 'Failed to log in.',

      unverified: false,
    };
  }
};