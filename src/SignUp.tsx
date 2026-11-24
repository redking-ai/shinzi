import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebaseConfig';

import {
  createEmailAuthUser,
  createUserProfile,
  deleteCurrentAuthUser,
  checkUsernameAvailable,
  sendVerificationEmailSafe,
  getFriendlyErrorMessage,
  getErrorCode,
} from './authService';

import { useDriveStore } from './driveStore';

import {
  generateAssetId,
  createAssetRecord,
  deleteAsset,
  ASSET_TYPES,
  ASSET_VISIBILITY,
} from './assetService';
import { ArrowLeft, Pencil, AlertTriangle, Copy, Check, X } from 'lucide-react';
import { DateTimePickerModal } from './DateTimePickerModal';

interface SignUpProps {
  onBack: () => void;

  // Tells App that signup is running so it keeps this screen
  // mounted even though Firebase signs the new user in as
  // soon as the Auth account exists.
  onBusyChange: (busy: boolean) => void;
}

interface ProfileImage {
  file: File;
  uri: string;
  mimeType: string;
  name: string;
  size: number;
}


const SIGNUP_IMAGE_DB = 'shinzi-signup-storage';
const SIGNUP_IMAGE_STORE = 'drafts';
const SIGNUP_IMAGE_KEY = 'profile-photo';

function openSignupImageDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SIGNUP_IMAGE_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(SIGNUP_IMAGE_STORE)) {
        db.createObjectStore(SIGNUP_IMAGE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearSignupImage(): Promise<void> {
  const db = await openSignupImageDB();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        SIGNUP_IMAGE_STORE,
        'readwrite'
      );

      transaction.objectStore(SIGNUP_IMAGE_STORE).delete(
        SIGNUP_IMAGE_KEY
      );

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}


interface FormError {
  message: string;
  ref?: string;
}

const GENDER_OPTIONS = [
  'Male',
  'Female',
  'Others',
] as const;

export default function SignUp({
  onBack,
  onBusyChange,
}: SignUpProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formError, setFormError] =
    useState<FormError | null>(null);

  const [successName, setSuccessName] =
    useState<string | null>(null);

  // Guards against a double tap before state has updated.
  const submittingRef = useRef(false);
  const resumeStartedRef = useRef(false);
const [draftRestored, setDraftRestored] = useState(false);

  const {
    isReady: isDriveReady,
    connectDrive,
    uploadFile,
    deleteFile,
  } = useDriveStore();

  // STEP 1
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // STEP 2
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState('');
  const [showGenderModal, setShowGenderModal] =
    useState(false);

  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [profileImage, setProfileImage] =
    useState<ProfileImage | null>(null);

  const [photoDiagnosticError, setPhotoDiagnosticError] = useState<{
    title: string;
    stage: 'selection' | 'reading' | 'upload';
    fileName?: string;
    fileSize?: string;
    fileType?: string;
    errorMessage: string;
    technicalDetails?: string;
  } | null>(null);
  const [copiedError, setCopiedError] = useState(false);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const normalizedUsername =
    username.trim().toLowerCase();

  const isEmail =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email.trim()
    );

  const hasNumber = /\d/.test(password);

  const isUsernameValid =
    /^[a-z0-9_]{3,15}$/.test(
      normalizedUsername
    );

  const isValidDate = (
    d: string,
    m: string,
    y: string
  ): boolean => {
    const numD = parseInt(d, 10);
    const numM = parseInt(m, 10);
    const numY = parseInt(y, 10);

    const today = new Date();

    if (
      !numD ||
      !numM ||
      !numY ||
      numM < 1 ||
      numM > 12 ||
      numY < 1920 ||
      numY > today.getFullYear()
    ) {
      return false;
    }

    const parsedDate = new Date(
      numY,
      numM - 1,
      numD
    );

    const isRealDate =
      parsedDate.getFullYear() === numY &&
      parsedDate.getMonth() === numM - 1 &&
      parsedDate.getDate() === numD;

    let age =
      today.getFullYear() - numY;

    if (
      today.getMonth() < numM - 1 ||
      (
        today.getMonth() === numM - 1 &&
        today.getDate() < numD
      )
    ) {
      age--;
    }

    return isRealDate && age >= 13;
  };

  const isStep1Valid =
    isEmail &&
    password.length >= 6 &&
    hasNumber;

  const isStep2Valid =
    profileImage !== null &&
    name.trim().length > 0 &&
    isUsernameValid &&
    isValidDate(day, month, year) &&
    gender !== '';

  const hasEnteredDate =
    day.length > 0 ||
    month.length > 0 ||
    year.length > 0;

  // ----------------------------------------------------------
  // AVATAR PICKER
  // ----------------------------------------------------------

  const handleAvatarPress = () => {
    if (isSubmitting) {
      return;
    }
    setPhotoDiagnosticError(null);
    fileInputRef.current?.click();
  };

  const handleImageChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (isSubmitting) {
      return;
    }

    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }

    const file = fileList[0];
    if (!file) {
      setPhotoDiagnosticError({
        title: 'No File Selected',
        stage: 'selection',
        errorMessage: 'The file selection did not return a valid file. Please try choosing a photo again.',
      });
      return;
    }

    const maxSize = 15 * 1024 * 1024;
    const formattedSize = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;

    if (file.size > maxSize) {
      setPhotoDiagnosticError({
        title: 'Photo File Too Large',
        stage: 'selection',
        fileName: file.name,
        fileSize: formattedSize,
        fileType: file.type || 'unknown',
        errorMessage: `The selected photo (${formattedSize}) is larger than the 15 MB limit. Please select a photo smaller than 15 MB.`,
      });
      setFormError({
        message: 'Your profile photo must be smaller than 15 MB.',
      });
      return;
    }

    let resolvedMime = file.type || 'image/jpeg';
    if (!resolvedMime.startsWith('image/')) {
      if (/\.png$/i.test(file.name)) resolvedMime = 'image/png';
      else if (/\.webp$/i.test(file.name)) resolvedMime = 'image/webp';
      else if (/\.gif$/i.test(file.name)) resolvedMime = 'image/gif';
      else resolvedMime = 'image/jpeg';
    }

    // 1. Instant fallback preview (URL.createObjectURL) so the preview never stays blank
    let immediatePreviewUri = '';
    try {
      immediatePreviewUri = URL.createObjectURL(file);
    } catch (urlErr) {
      console.warn('[SIGNUP_PHOTO] createObjectURL failed:', urlErr);
    }

    if (immediatePreviewUri) {
      setProfileImage({
        file,
        uri: immediatePreviewUri,
        mimeType: resolvedMime,
        name: file.name,
        size: file.size,
      });
      setFormError(null);
      setPhotoDiagnosticError(null);
    }

    // 2. Read into Base64 Data URL for persistent memory storage & upload
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      if (dataUri) {
        setProfileImage({
          file,
          uri: dataUri,
          mimeType: resolvedMime,
          name: file.name,
          size: file.size,
        });
        setFormError(null);
        setPhotoDiagnosticError(null);
      }
      // ONLY clear input value after FileReader finishes successfully
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      console.error('[SIGNUP_PHOTO] FileReader error:', reader.error);
      if (!immediatePreviewUri) {
        setPhotoDiagnosticError({
          title: 'Photo Read Error',
          stage: 'reading',
          fileName: file.name,
          fileSize: formattedSize,
          fileType: file.type || resolvedMime,
          errorMessage: 'The browser could not read this file from your computer disk.',
          technicalDetails: reader.error?.message || 'Detached file handle or read access error',
        });
        setFormError({
          message: 'Could not read the selected file. Please try another image.',
        });
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.readAsDataURL(file);
  };

  // ----------------------------------------------------------
  // IMAGE INFORMATION
  // ----------------------------------------------------------

  const getImageUploadInfo = (
    imageAsset: ProfileImage,
    assetId: string
  ) => {
    const mimeType =
      imageAsset.mimeType || 'image/jpeg';

    let extension = 'jpg';

    if (mimeType === 'image/png') {
      extension = 'png';
    } else if (mimeType === 'image/webp') {
      extension = 'webp';
    } else {
      const source =
        imageAsset.name ||
        imageAsset.uri ||
        '';

      const cleanSource =
        source.split('?')[0];

      const sourceExtension =
        cleanSource
          .split('.')
          .pop()
          ?.toLowerCase();

      if (
        sourceExtension &&
        /^[a-z0-9]{2,5}$/.test(
          sourceExtension
        )
      ) {
        extension = sourceExtension;
      }
    }

    return {
      fileName: `${assetId}.${extension}`,
      mimeType,
    };
  };

  // ----------------------------------------------------------
  // CREATE ACCOUNT
  // ----------------------------------------------------------

  const executeSignUp =
    async (): Promise<void> => {
      if (submittingRef.current) {
        return;
      }

      setFormError(null);

      if (!profileImage) {
        setFormError({
          message:
            'Add a profile photo to continue.',
        });

        return;
      }

      if (!isDriveReady) {
        setFormError({
          message:
            'Google Drive is still loading. Wait a moment and try again.',
        });

        return;
      }

      submittingRef.current = true;
      setIsSubmitting(true);
      onBusyChange(true);

      let stage = 'drive';

      let createdAuthUser: User | null = null;
      let createdAssetId: string | null = null;
      let uploadedDriveFileId: string | null = null;
   let activeUser: User | null = null;
    let redirecting = false;

      try {
      

// 1. FIREBASE AUTH USER
// ----------------------------------------------------

stage = 'auth';

activeUser = auth.currentUser;

if (!activeUser) {
  const authResult = await createEmailAuthUser(
    email.trim(),
    password,
    normalizedUsername
  );

  if (authResult.error || !authResult.user) {
    setFormError({
      message:
        authResult.error ||
        'Unable to create your account.',
      ref: authResult.code
        ? `auth / ${authResult.code}`
        : 'auth',
    });

    return;
  }

  createdAuthUser = authResult.user;
  activeUser = authResult.user;
}

if (!activeUser) {
  throw new Error(
    'You are not signed in. Please try again.'
  );
}

// ----------------------------------------------------
// 2. SAVE SIGNUP DETAILS BEFORE GOOGLE REDIRECT
// ----------------------------------------------------

sessionStorage.setItem(
  'shinzi_signup_draft',
  JSON.stringify({
    name,
    username,
    gender,
    day,
    month,
    year,
  })
);
sessionStorage.setItem(
  'shinzi_signup_resume',
  'true'
);

// ----------------------------------------------------
// 3. GOOGLE DRIVE PERMISSION
// ----------------------------------------------------

stage = 'drive';

const driveToken = await connectDrive();

if (!driveToken) {
  redirecting = true;
  return;
} 

       
 

        // ----------------------------------------------------
        // 3. USERNAME AVAILABILITY
        // ----------------------------------------------------

        stage = 'username';

        const usernameAvailable =
          await checkUsernameAvailable(
            normalizedUsername
          );

        if (!usernameAvailable) {
          throw new Error(
            'That username is already taken. Choose another one.'
          );
        }

        // ----------------------------------------------------
        // 4. PROFILE ASSET ID
        // ----------------------------------------------------

        stage = 'assetId';

        const profileAssetId =
          await generateAssetId(
            ASSET_TYPES.PROFILE_PHOTO
          );

        createdAssetId =
          profileAssetId;

          const imageToUpload = profileImage;

if (!imageToUpload) {
  throw new Error(
    'Your profile photo is missing. Please select it again.'
  );
}

const {
  fileName,
  mimeType,
} = getImageUploadInfo(
  imageToUpload,
  profileAssetId
);
          
         
       

        // ----------------------------------------------------
        // 5. UPLOAD PROFILE PHOTO
        // ----------------------------------------------------

        stage = 'upload';

    

const uploadResult =
  await uploadFile({
    file: imageToUpload.file,
    localUri: imageToUpload.uri,
    fileName,
    mimeType,
    folderType: 'profiles',
  });
         
         

        if (
          !uploadResult ||
          !uploadResult.fileId ||
          !uploadResult.folderId
        ) {
          throw new Error(
            'Google Drive upload did not return a valid file.'
          );
        }

        uploadedDriveFileId =
          uploadResult.fileId;

        // ----------------------------------------------------
        // 6. ASSET RECORD
        // ----------------------------------------------------

        stage = 'assetRecord';
 
   if (!activeUser) {
  throw new Error(
    'You are not signed in. Please try again.'
  );
}

        const asset =
          await createAssetRecord({
            assetId: profileAssetId,

            ownerUid: activeUser.uid,
              

            type:
              ASSET_TYPES.PROFILE_PHOTO,

            visibility:
              ASSET_VISIBILITY.PUBLIC,

            providerFileId:
              uploadResult.fileId,

            driveFolderId:
              uploadResult.folderId,

            fileName:
              uploadResult.fileName ||
              fileName,

            mimeType:
              uploadResult.mimeType ||
              mimeType,

            sizeBytes:
              typeof uploadResult.sizeBytes ===
              'number'
                ? uploadResult.sizeBytes
                : 0,

            version: 1,

            status: 'active',
          });

        if (
          !asset ||
          asset.assetId !==
            profileAssetId
        ) {
          throw new Error(
            'Profile asset record could not be created.'
          );
        }

        // ----------------------------------------------------
        // 7. USER PROFILE + USERNAME
        // ----------------------------------------------------

        stage = 'profile';

        const profileResult =
        await createUserProfile(
  activeUser,  
            
            {
              displayName:
                name.trim(),

              username:
                normalizedUsername,

              gender,

              profileAssetId,
            }
          );

        if (!profileResult.success) {
          throw new Error(
            profileResult.error ||
              'Unable to create your Shinzi profile.'
          );
        }

        // ----------------------------------------------------
        // 8. SUCCESS
        // ----------------------------------------------------

        stage = 'done';

 await clearSignupImage();
sessionStorage.removeItem('shinzi_signup_draft');
sessionStorage.removeItem('shinzi_signup_resume');

        void sendVerificationEmailSafe(
  activeUser
);

        setSuccessName(
          name.trim()
        );

        await new Promise<void>(
          (resolve) => {
            window.setTimeout(
              resolve,
              1600
            );
          }
        );

      } catch (err) {
        console.error(
          `[SIGNUP] Failed at "${stage}":`,
          err
        );

        // ----------------------------------------------------
        // ROLLBACK
        // ----------------------------------------------------

        let cleanupIncomplete =
          false;

        if (createdAssetId) {
          try {
            await deleteAsset(
              createdAssetId
            );
          } catch (
            assetRollbackError
          ) {
            cleanupIncomplete =
              true;

            console.error(
              'Asset metadata rollback failed:',
              assetRollbackError
            );
          }
        }

        if (uploadedDriveFileId) {
          try {
            await deleteFile(
              uploadedDriveFileId
            );
          } catch (
            driveRollbackError
          ) {
            cleanupIncomplete =
              true;

            console.error(
              'Google Drive rollback failed:',
              driveRollbackError
            );
          }
        }

        if (createdAuthUser) {
          const authRollback =
            await deleteCurrentAuthUser(
              createdAuthUser
            );

          if (
            !authRollback.success
          ) {
            cleanupIncomplete =
              true;
          }
        }

        if (stage === 'upload' || stage === 'assetId' || stage === 'assetRecord') {
          const errDetail = err instanceof Error ? err.message : String(err);
          setPhotoDiagnosticError({
            title: 'Photo Upload Failed',
            stage: 'upload',
            fileName: profileImage?.name,
            fileSize: profileImage ? `${(profileImage.size / (1024 * 1024)).toFixed(2)} MB` : undefined,
            fileType: profileImage?.mimeType,
            errorMessage: 'Google Drive photo upload encountered a problem during account creation.',
            technicalDetails: errDetail,
          });
        }

        const code =
          getErrorCode(err);

        const baseMessage =
          getFriendlyErrorMessage(
            err,
            'Something went wrong while creating your account. Please try again.'
          );

        setFormError({
          message:
            cleanupIncomplete
              ? `${baseMessage} Some cleanup could not be completed. If you try again with the same email and it says the email is registered, wait a moment or use a different email.`
              : baseMessage,

          ref: code
            ? `${stage} / ${code}`
            : stage,
        });

      } finally {
  if (!redirecting) {
    submittingRef.current = false;
    setIsSubmitting(false);
    onBusyChange(false);
  }
}
        
    };

// Back from Google: restore the text fields, and if the
// account already exists, go straight to step 2.

useEffect(() => {
  let cancelled = false;

  const restoreDraft = async () => {
    try {
      const raw = sessionStorage.getItem('shinzi_signup_draft');

      if (raw) {
        const d = JSON.parse(raw);

        if (cancelled) return;

        setName(d.name ?? '');
        setUsername(d.username ?? '');
        setGender(d.gender ?? '');
        setDay(d.day ?? '');
        setMonth(d.month ?? '');
        setYear(d.year ?? '');
      }

      // Do NOT restore profile photo draft from IndexedDB across page reloads/refreshes.
      // Every time user comes to step 2 or refreshes, start with no photo so user uploads fresh.
      void clearSignupImage();
      setDraftRestored(true);

    
    } catch (error) {
      console.error('[SIGNUP] Could not restore draft:', error);
    }
  };

  void restoreDraft();

  const unsubscribe = onAuthStateChanged(auth, async (u) => {
  if (!u || cancelled) return;

  setStep(2);
    

});

  return () => {
    cancelled = true;
    unsubscribe();
  };
}, []);


useEffect(() => {
  if (!draftRestored || !isDriveReady || !profileImage) {
    return;
  }

  if (sessionStorage.getItem('shinzi_signup_resume') !== 'true') {
    return;
  }

  if (resumeStartedRef.current) return;

  if (
    !name.trim() ||
    !/^[a-z0-9_]{3,15}$/.test(username.trim().toLowerCase()) ||
    !isValidDate(day, month, year) ||
    !gender
  ) {
    return;
  }

  resumeStartedRef.current = true;
  void executeSignUp();
}, [
  draftRestored,
  isDriveReady,
  profileImage,
  name,
  username,
  day,
  month,
  year,
  gender,
]);


  
 

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  const createButtonClass =
    isSubmitting
      ? 'signup-continue-button signup-busy-button'
      : isStep2Valid
        ? 'signup-continue-button'
        : 'signup-continue-button signup-disabled-button';

  return (
    <div className="signup-page">
      <div className="signup-shell">

        {/* CLEAN HEADER — NO STEP INDICATOR */}
        <div className="signup-header">
          <button
            type="button"
            className="signup-back-button"
            onClick={() => {
              if (isSubmitting) {
                return;
              }

              setFormError(null);

              if (step === 1) {
                onBack();
              } else {
                setStep(1);
              }
            }}
            disabled={isSubmitting}
            aria-label="Back"
          >
            <ArrowLeft size={24} color="#FFFFFF" strokeWidth={2} />
          </button>
        </div>

        {/* ERROR */}

        {formError && (
          <div className="signup-banner-wrap">
            <div
              className="signup-error-banner"
              role="alert"
            >
              {formError.message}

              {formError.ref && (
                <span className="signup-error-ref">
                  Reference:{' '}
                  {formError.ref}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ================================================== */}
        {/* STEP 1 */}
        {/* ================================================== */}

        {step === 1 && (
          <div className="signup-content">

            <h1 className="signup-title">
              Create your account
            </h1>

            <p className="signup-subtitle">
              Choose the email and password
              you will log in with.
            </p>

             {/* EMAIL */}

<div className="signup-field-group">
  <label
    className="signup-input-label"
    htmlFor="signup-email"
  >
    Email
  </label>

  <div className="signup-input-box">
    <input
      id="signup-email"
      className="signup-input"
      type="email"
      aria-label="Email"
      placeholder="Enter an email address"
      value={email}
      onChange={(event) =>
        setEmail(event.target.value)
      }
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="email"
      disabled={isSubmitting}
    />
  </div>
</div>

{/* PASSWORD */}

<div className="signup-field-group">
  <label
    className="signup-input-label"
    htmlFor="signup-password"
  >
    Password
  </label>

  <div className="signup-input-box">
    <input
      id="signup-password"
      className="signup-input"
      type="password"
       placeholder="Enter a password"
      aria-label="Password"
      value={password}
      onChange={(event) =>
        setPassword(event.target.value)
      }
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="new-password"
      disabled={isSubmitting}
    />
  </div>
</div>

            <div
              className={
                password.length > 0 &&
                (
                  !hasNumber ||
                  password.length < 6
                )
                  ? 'signup-hint signup-hint-error'
                  : 'signup-hint'
              }
            >
              Use at least 6 characters,
              including a number.
            </div>

            <button
              type="button"
              className={
                isStep1Valid
                  ? 'signup-continue-button'
                  : 'signup-continue-button signup-disabled-button'
              }
              disabled={
                !isStep1Valid ||
                isSubmitting
              }
              onClick={() => {
                setFormError(null);
                setStep(2);
              }}
            >
              Continue
            </button>

          </div>
        )}

        {/* ================================================== */}
        {/* STEP 2 */}
        {/* ================================================== */}

        {step === 2 && (
          <div className="signup-content">

            <h1 className="signup-title">
              Set up your profile
            </h1>

            <p className="signup-subtitle">
              Add a photo and a few
              details so people can
              find you.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/*,.png,.jpg,.jpeg,.webp,.gif,.jfif,.bmp,.heic"
              onChange={handleImageChange}
              style={{
                display: 'none',
              }}
            />

            {/* AVATAR */}

            <div className="signup-avatar-container">

              <button
                type="button"
                className={
                  profileImage
                    ? 'signup-avatar-button signup-avatar-filled'
                    : 'signup-avatar-button'
                }
                onClick={handleAvatarPress}
                disabled={isSubmitting}
                aria-label="Choose profile photo"
              >
                {profileImage ? (
                  <img
                    src={profileImage.uri}
                    alt="Profile preview"
                    className="signup-avatar-image"
                  />
                ) : (
                  <span className="signup-person-icon">
                    ●
                  </span>
                )}

                <span className="signup-pencil-badge">
                  <Pencil size={15} color="#000000" strokeWidth={2.5} />
                </span>
              </button>

              <div className="signup-photo-required">
                {profileImage
                  ? 'Tap to change photo'
                  : 'Profile photo required'}
              </div>

              {photoDiagnosticError && (
                <button
                  type="button"
                  onClick={() => setPhotoDiagnosticError({ ...photoDiagnosticError })}
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    textAlign: 'left',
                    width: '100%',
                    maxWidth: '320px',
                    margin: '8px auto 0 auto',
                  }}
                >
                  <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
                  <span><strong>Photo error:</strong> {photoDiagnosticError.title} (tap for error details)</span>
                </button>
              )}

              {formError && (
                <div style={{ color: '#ff3366', fontSize: '13px', marginTop: '6px', textAlign: 'center' }}>
                  {formError.message}
                </div>
              )}

            </div>

            {/* DISPLAY NAME */}

            <div className="signup-field-group">
  <label
    className="signup-input-label"
    htmlFor="signup-display-name"
  >
    Display name
  </label>

  <div className="signup-input-box">
    <input
      id="signup-display-name"
      className="signup-input"
      type="text"
      aria-label="Display name"
        placeholder="Enter your name"
      value={name}
      onChange={(event) =>
        setName(event.target.value)
      }
      maxLength={50}
      autoCorrect="off"
      disabled={isSubmitting}
    />
  </div>
</div>

            {/* USERNAME */}

            <div className="signup-field-group">
  <label
    className="signup-input-label"
    htmlFor="signup-username"
  >
    Username
  </label>

  <div
    className={
      username.length > 0 &&
      !isUsernameValid
        ? 'signup-input-box signup-error-box'
        : 'signup-input-box'
    }
  >
    <input
      id="signup-username"
      className="signup-input"
      type="text"
      aria-label="Username"
        placeholder="Enter a username"
      value={username}
      onChange={(event) =>
        setUsername(event.target.value)
      }
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="off"
      maxLength={15}
      disabled={isSubmitting}
    />
  </div>
</div>      

            {username.length > 0 &&
              !isUsernameValid && (
                <div className="signup-error-text">
                  Use 3–15 lowercase
                  letters, numbers, or
                  underscores.
                </div>
              )}

            {/* DATE OF BIRTH */}

            <div className="signup-field-label">
              Date of birth
            </div>

            <div
              className="signup-date-row"
              onClick={() => setShowDatePicker(true)}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-label="Open date of birth picker"
            >
              <div className="signup-input-box signup-flex-1">
                <input
                  className="signup-input"
                  type="text"
                  readOnly
                  placeholder="DD"
                  aria-label="Day of birth"
                  value={day}
                  style={{ cursor: 'pointer' }}
                />
              </div>

              <div className="signup-input-box signup-flex-1">
                <input
                  className="signup-input"
                  type="text"
                  readOnly
                  placeholder="MM"
                  aria-label="Month of birth"
                  value={month}
                  style={{ cursor: 'pointer' }}
                />
              </div>

              <div className="signup-input-box signup-flex-2">
                <input
                  className="signup-input"
                  type="text"
                  readOnly
                  placeholder="YYYY"
                  aria-label="Year of birth"
                  value={year}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            </div>

            {hasEnteredDate &&
            !isValidDate(
              day,
              month,
              year
            ) ? (
              <div className="signup-error-text">
                Enter a valid date.
                You must be at
                least 13.
              </div>
            ) : (
              <div className="signup-hint">
                Only used to check
                that you are 13 or
                older.
              </div>
            )}

            {/* GENDER */}

            <button
              type="button"
              className="signup-input-box signup-gender-button"
              onClick={() =>
                setShowGenderModal(
                  true
                )
              }
              disabled={isSubmitting}
              aria-haspopup="dialog"
            >
              <span
                className={
                  gender
                    ? 'signup-gender-selected'
                    : 'signup-gender-placeholder'
                }
              >
                {gender ||
                  'Select gender'}
              </span>

              <span
                className="signup-chevron"
                aria-hidden="true"
              >
                ▾
              </span>
            </button>

            {/* CREATE ACCOUNT */}

            <button
              type="button"
              className={
                createButtonClass
              }
              disabled={
                !isStep2Valid ||
                isSubmitting
              }
              onClick={
                executeSignUp
              }
            >
              {isSubmitting && (
                <span
                  className="signup-spinner"
                  aria-hidden="true"
                />
              )}

              {isSubmitting
                ? 'Creating account…'
                : 'Create account'}
            </button>

          </div>
        )}

        {/* ================================================== */}
        {/* GENDER MODAL */}
        {/* ================================================== */}

        {showGenderModal && (
          <div
            className="signup-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Select gender"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setShowGenderModal(
                  false
                );
              }
            }}
          >
            <div className="signup-modal-content">

              <div className="signup-modal-title">
                Select gender
              </div>

              {GENDER_OPTIONS.map(
                (option) => (
                  <button
                    type="button"
                    key={option}
                    className={
                      option === gender
                        ? 'signup-modal-option signup-modal-option-selected'
                        : 'signup-modal-option'
                    }
                    aria-pressed={
                      option === gender
                    }
                    onClick={() => {
                      setGender(
                        option
                      );
                      setShowGenderModal(
                        false
                      );
                    }}
                  >
                    {option}
                  </button>
                )
              )}

            </div>
          </div>
        )}

        {/* ================================================== */}
        {/* DATE OF BIRTH PICKER MODAL */}
        {/* ================================================== */}

        {showDatePicker && (
          <DateTimePickerModal
            title="Date of birth"
            showTime={false}
            initialValue={
              year && month && day
                ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                : '2005-01-01'
            }
            onConfirm={() => {}}
            onConfirmDate={(d, m, y) => {
              setDay(String(d).padStart(2, '0'));
              setMonth(String(m).padStart(2, '0'));
              setYear(String(y));
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
          />
        )}

        {/* ================================================== */}
        {/* PHOTO ERROR / DIAGNOSTIC SCREEN */}
        {/* ================================================== */}
        {photoDiagnosticError && (
          <div
            className="signup-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Profile photo error details"
            style={{ alignItems: 'center', padding: '16px', zIndex: 1100 }}
          >
            <div
              className="signup-modal-content"
              style={{
                borderRadius: '20px',
                padding: '24px',
                background: '#18181b',
                border: '1px solid #ef4444',
                maxWidth: '520px',
                width: '100%',
                boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={20} color="#ef4444" />
                  </div>
                  <h3 style={{ margin: 0, color: '#ffffff', fontSize: '18px', fontWeight: 700 }}>
                    {photoDiagnosticError.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPhotoDiagnosticError(null)}
                  style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}
                  aria-label="Close error screen"
                >
                  <X size={20} />
                </button>
              </div>

              <p style={{ color: '#e4e4e7', fontSize: '14px', lineHeight: 1.5, margin: '0 0 16px 0' }}>
                {photoDiagnosticError.errorMessage}
              </p>

              {/* Technical breakdown box */}
              <div
                style={{
                  background: '#09090b',
                  borderRadius: '12px',
                  padding: '14px',
                  border: '1px solid #27272a',
                  fontSize: '12px',
                  color: '#a1a1aa',
                  fontFamily: 'monospace',
                  marginBottom: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  wordBreak: 'break-all',
                }}
              >
                <div><strong style={{ color: '#f43f5e' }}>Stage:</strong> {photoDiagnosticError.stage}</div>
                {photoDiagnosticError.fileName && (
                  <div><strong style={{ color: '#ffffff' }}>File Name:</strong> {photoDiagnosticError.fileName}</div>
                )}
                {photoDiagnosticError.fileSize && (
                  <div><strong style={{ color: '#ffffff' }}>File Size:</strong> {photoDiagnosticError.fileSize}</div>
                )}
                {photoDiagnosticError.fileType && (
                  <div><strong style={{ color: '#ffffff' }}>MIME Type:</strong> {photoDiagnosticError.fileType}</div>
                )}
                {photoDiagnosticError.technicalDetails && (
                  <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px solid #27272a', color: '#fb7185' }}>
                    <strong>System Cause:</strong> {photoDiagnosticError.technicalDetails}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const textToCopy = `[Shinzi Photo Error]\nTitle: ${photoDiagnosticError.title}\nStage: ${photoDiagnosticError.stage}\nFile: ${photoDiagnosticError.fileName || 'N/A'}\nSize: ${photoDiagnosticError.fileSize || 'N/A'}\nType: ${photoDiagnosticError.fileType || 'N/A'}\nReason: ${photoDiagnosticError.errorMessage}\nDetails: ${photoDiagnosticError.technicalDetails || 'None'}`;
                    void navigator.clipboard.writeText(textToCopy);
                    setCopiedError(true);
                    setTimeout(() => setCopiedError(false), 2500);
                  }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px',
                    borderRadius: '10px',
                    background: '#27272a',
                    color: '#ffffff',
                    border: '1px solid #3f3f46',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {copiedError ? <Check size={16} color="#22c55e" /> : <Copy size={16} />}
                  {copiedError ? 'Copied Details!' : 'Copy Error Details'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPhotoDiagnosticError(null);
                    setTimeout(() => {
                      fileInputRef.current?.click();
                    }, 100);
                  }}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    color: '#000000',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 700,
                  }}
                >
                  Choose Another Photo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================== */}
        {/* SUCCESS */}
        {/* ================================================== */}

        {successName && (
          <div
            className="signup-success"
            role="status"
          >
            <div
              className="signup-success-mark"
              aria-hidden="true"
            >
              ✓
            </div>

            <h2 className="signup-success-title">
              Account created
            </h2>

            <p className="signup-success-text">
              Welcome to Shinzi Hub,{' '}
              {successName}.
            </p>
          </div>
        )}

      </div>

      <style>{`
        .signup-page,
        .signup-page * {
          box-sizing: border-box;
        }

        .signup-page {
          --su-bg: #000000;
--su-surface: #000000;
--su-surface-2: #0a0a0a;
--su-line: #222222;
--su-line-strong: #282828;
--su-text: #FFFFFF;
--su-muted: #888888;
--su-accent: #5865F2;
--su-violet: #FFFFFF;
--su-danger: #FF3366;

          width: 100%;
          min-height: 100dvh;
          height: 100%;
          background: var(--su-bg);
          color: var(--su-text);
          overflow-y: auto;

          font-family:
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Roboto,
            Helvetica,
            Arial,
            sans-serif;

          -webkit-font-smoothing: antialiased;
          text-align: left;
        }

        .signup-shell {
          width: 100%;
          max-width: 620px;
          min-height: 100dvh;
          margin: 0 auto;

          display: flex;
          flex-direction: column;

          background: var(--su-bg);

          padding-bottom:
            env(safe-area-inset-bottom);
        }

        .signup-page button:focus-visible,
        .signup-page input:focus-visible {
          outline: 2px solid var(--su-accent);
          outline-offset: 2px;
        }

        /* ==============================================
           CLEAN HEADER
           ============================================== */

        .signup-header {
          width: 100%;
          display: flex;
          align-items: center;

          padding:
            22px 24px 18px;
        }

        .signup-back-button {
          border: 0;
          background: transparent;

          color: #FFFFFF;

          font-size: 24px;
          font-weight: 400;
          line-height: 1;

          cursor: pointer;

          padding: 2px 0;

          width: 40px;
          height: 40px;

          display: flex;
          align-items: center;
          justify-content: flex-start;
          transition: opacity 0.15s ease;
        }

        .signup-back-button:hover {
          opacity: 0.85;
        }

        .signup-back-button:active {
          opacity: 0.65;
        }

        .signup-back-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ==============================================
           ERROR
           ============================================== */

        .signup-banner-wrap {
          padding: 0 24px;
        }

        .signup-error-banner {
          background:
            rgba(255, 51, 102, 0.1);

          border:
            1px solid
            rgba(255, 51, 102, 0.4);

          border-radius: 12px;

          padding: 12px 14px;

          margin-bottom: 18px;

          color: #FFD3DD;

          font-size: 14px;
          line-height: 1.45;
        }

        .signup-error-ref {
          display: block;

          margin-top: 6px;

          color: #C08A98;

          font-size: 12px;
        }

        /* ==============================================
           CONTENT
           ============================================== */

        .signup-content {
          flex: 1;

          width: 100%;

          padding:
            0 24px 20px;

          display: flex;
          flex-direction: column;
        }

        .signup-title {
          margin:
            0 0 6px;

          font-size: 26px;
          font-weight: 800;

          letter-spacing: -0.3px;
          line-height: 1.2;

          color: var(--su-text);
        }

        .signup-subtitle {
          margin:
            0 0 24px;

          max-width: 46ch;

          font-size: 15px;
          line-height: 1.45;

          color: var(--su-muted);
        }

        /* ==============================================
           INPUTS
           ============================================== */
/* ==============================================
   LABELED INPUT GROUPS
   ============================================== */

.signup-field-group {
  width: 100%;
  margin-bottom: 18px;
}

.signup-input-label {
  display: block;

  margin:
    0 0 8px 4px;

  color:
    var(--su-text);

  font-size: 14px;
  font-weight: 600;

  line-height: 1.3;
}

        .signup-input-box {
          width: 100%;
          min-height: 58px;

          display: flex;
          flex-direction: row;
          align-items: center;

          background:
            var(--su-surface);

          border:
            1px solid
            var(--su-line);

          border-radius: 12px;

          margin-bottom: 10px;

          overflow: hidden;

          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease;
        }

        .signup-input-box:focus-within {
          border-color:
            var(--su-accent);

          box-shadow: 0 0 0 3px rgba(32, 217, 255, 0.14);
        }

        .signup-error-box {
          border-color:
            var(--su-danger);
        }

        .signup-input {
          width: 100%;
          min-width: 0;
          flex: 1;

          border: 0;
          outline: none;

          background: transparent;

          color:
            var(--su-text);

          padding:
            17px 16px;

          font-size: 16px;
          font-family: inherit;
        }

        .signup-page
        .signup-input:focus-visible {
          outline: none;
        }

        .signup-input::placeholder {
          color:
            var(--su-muted);

          opacity: 1;
        }

        .signup-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
     /* ==============================================
   CHROME / ANDROID AUTOFILL
   ============================================== */

.signup-input:-webkit-autofill,
.signup-input:-webkit-autofill:hover,
.signup-input:-webkit-autofill:focus,
.signup-input:-webkit-autofill:active {
  -webkit-text-fill-color: var(--su-text);

  -webkit-box-shadow:
    0 0 0 1000px var(--su-surface) inset;

  box-shadow:
    0 0 0 1000px var(--su-surface) inset;

  caret-color: var(--su-text);

  transition:
    background-color 9999s ease-out;
}

        /* ==============================================
           HINTS
           ============================================== */

        .signup-hint,
        .signup-error-text {
          margin:
            -6px 0 16px 4px;

          font-size: 13px;
          line-height: 1.4;
        }

        .signup-hint {
          color:
            var(--su-muted);
        }

        .signup-hint-error,
        .signup-error-text {
          color:
            var(--su-danger);
        }

        .signup-field-label {
          margin:
            4px 0 8px 4px;

          font-size: 14px;
          font-weight: 600;

          color:
            var(--su-text);
        }

        /* ==============================================
           AVATAR
           ============================================== */

        .signup-photo-required {
          color:
            var(--su-muted);

          font-size: 13px;

          margin-top: 10px;
        }

        .signup-avatar-container {
          display: flex;
          flex-direction: column;
          align-items: center;

          margin-bottom: 26px;
        }

        .signup-avatar-button {
          position: relative;

          width: 96px;
          height: 96px;

          padding: 0;

          border:
            2px dashed
            var(--su-line-strong);

          border-radius: 50%;

          background:
            var(--su-surface-2);

          display: flex;
          align-items: center;
          justify-content: center;

          overflow: visible;

          cursor: pointer;
        }

        .signup-avatar-filled {
          border:
            2px solid
            var(--su-accent);
        }

        .signup-avatar-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .signup-avatar-image {
          width: 90px;
          height: 90px;

          border-radius: 50%;

          object-fit: cover;

          display: block;
        }

        .signup-person-icon {
          color:
            var(--su-muted);

          font-size: 34px;
          line-height: 1;
        }

        .signup-pencil-badge {
          position: absolute;

          right: -2px;
          bottom: -2px;

          width: 30px;
          height: 30px;

          border-radius: 50%;

          background: #FFFFFF !important;

          border:
            2px solid
            var(--su-bg);

          display: flex;
          align-items: center;
          justify-content: center;

          color: #000000 !important;

          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        }

        /* ==============================================
           DATE
           ============================================== */

        .signup-date-row {
          width: 100%;

          display: flex;
          flex-direction: row;

          gap: 8px;
        }

        .signup-flex-1 {
          flex: 1;
        }

        .signup-flex-2 {
          flex: 2;
        }

        /* ==============================================
           GENDER
           ============================================== */

        .signup-gender-button {
          border:
            1px solid
            var(--su-line);

          color:
            var(--su-text);

          font-family: inherit;

          cursor: pointer;

          padding:
            0 16px;

          text-align: left;
        }

        .signup-gender-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .signup-gender-selected,
        .signup-gender-placeholder {
          flex: 1;

          font-size: 16px;
          line-height: 1;
        }

        .signup-gender-selected {
          color:
            var(--su-text);
        }

        .signup-gender-placeholder {
          color:
            var(--su-muted);
        }

        .signup-chevron {
          color:
            var(--su-muted);

          font-size: 16px;

          margin-left: 10px;
        }

        /* ==============================================
           BUTTON
           ============================================== */

        .signup-continue-button {
          width: 100%;

          border: 1px solid #FFFFFF;

border-radius: 28px;

background: #FFFFFF;

color: #000000;

box-shadow: none;

          padding: 16px;

          min-height: 54px;

          font-size: 16px;
          font-weight: 700;
          font-family: inherit;

          cursor: pointer;

          margin-top: auto;
          margin-bottom: 20px;

          display: flex;
          align-items: center;
          justify-content: center;

          gap: 10px;

          transition:
            transform 0.1s ease,
            opacity 0.15s ease;
        }

        /* Step 1 button spacing */
        .signup-content
        .signup-hint
        + .signup-continue-button {
          margin-top: 30px;
        }

        .signup-continue-button:not(:disabled):active {
          transform:
            scale(0.99);
        }

        .signup-disabled-button {
  background: #000000;
  border-color: #282828;
  color: #777777;
  box-shadow: none;
  cursor: not-allowed;
}
        

        .signup-busy-button {
          opacity: 0.85;
          cursor: progress;
        }

        .signup-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(88, 101, 242, 0.22);
  border-top-color: #5865F2;
  border-radius: 50%;
  animation: signup-spin 0.7s linear infinite;
  flex-shrink: 0;
}

        /* ==============================================
           GENDER MODAL
           ============================================== */

        .signup-modal-overlay {
          position: fixed;
          inset: 0;

          z-index: 1000;

          background:
            rgba(0, 0, 0, 0.7);

          display: flex;
          align-items: flex-end;
          justify-content: center;

          animation:
            signup-fade
            0.15s ease;
        }

        .signup-modal-content {
          width: 100%;
          max-width: 620px;

          background:
            var(--su-surface-2);

          border-top-left-radius: 24px;
          border-top-right-radius: 24px;

          padding:
            12px 20px
            calc(
              20px +
              env(safe-area-inset-bottom)
            );

          box-shadow:
            0 -10px 40px
            rgba(0, 0, 0, 0.45);

          animation:
            signup-sheet
            0.2s ease-out;
        }

        .signup-modal-title {
          text-align: center;

          color:
            var(--su-muted);

          font-size: 14px;

          padding:
            8px 0 12px;
        }

        .signup-modal-option {
          width: 100%;

          border: 0;

          border-top:
            1px solid
            var(--su-line);

          background: transparent;

          color:
            var(--su-text);

          padding:
            18px 10px;

          font-size: 18px;
          font-family: inherit;

          text-align: center;

          cursor: pointer;
        }

        .signup-modal-option-selected {
          color:
            var(--su-accent);

          font-weight: 700;
        }

        .signup-modal-option:hover {
          background:
            #111111;
        }

        /* ==============================================
           SUCCESS
           ============================================== */

        .signup-success {
          position: fixed;
          inset: 0;

          z-index: 2000;

          background:
            #000000;

          display: flex;
          flex-direction: column;

          align-items: center;
          justify-content: center;

          gap: 12px;

          padding: 24px;

          text-align: center;

          animation:
            signup-fade
            0.2s ease;
        }

        .signup-success-mark {
          width: 64px;
          height: 64px;

          border-radius: 50%;

          border:
            2px solid
            var(--su-accent);

          color:
            var(--su-accent);

          display: flex;
          align-items: center;
          justify-content: center;

          font-size: 30px;

          margin-bottom: 6px;
        }

        .signup-success-title {
          margin: 0;

          font-size: 24px;
          font-weight: 800;
        }

        .signup-success-text {
          margin: 0;

          color:
            var(--su-muted);

          font-size: 15px;
        }

        /* ==============================================
           ANIMATIONS
           ============================================== */

        @keyframes signup-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes signup-fade {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        @keyframes signup-sheet {
          from {
            transform:
              translateY(24px);

            opacity: 0;
          }

          to {
            transform:
              translateY(0);

            opacity: 1;
          }
        }

        /* ==============================================
           REDUCED MOTION
           ============================================== */

        @media (prefers-reduced-motion: reduce) {
          .signup-page *,
          .signup-modal-overlay,
          .signup-modal-content,
          .signup-success {
            animation-duration:
              0.01ms !important;

            transition-duration:
              0.01ms !important;
          }
        }

        /* ==============================================
           DESKTOP (PC ONLY)
           ============================================== */

        @media (min-width: 768px) {
          .signup-page {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 100dvh;
            padding: 40px 20px;
            background: #000000;
          }

          .signup-shell {
            width: 100%;
            max-width: 520px;
            min-height: auto;
            margin: 0 auto;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            background: #000000;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
            overflow: hidden;
          }

          .signup-content {
            max-width: 100%;
            margin: 0;
            padding: 10px 32px 32px;
          }

          .signup-header {
            padding: 24px 32px 10px;
          }

          .signup-banner-wrap {
            padding: 0 32px;
          }

          .signup-continue-button {
            margin-top: 32px;
            margin-bottom: 0;
          }
        }
      `}</style>
    </div>
  );
}