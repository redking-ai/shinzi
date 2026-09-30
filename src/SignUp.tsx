import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import type { User } from 'firebase/auth';

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

  const [profileImage, setProfileImage] =
    useState<ProfileImage | null>(null);

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

    let age = today.getFullYear() - numY;

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

    fileInputRef.current?.click();
  };

  const handleImageChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (isSubmitting) {
      return;
    }

    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

   const supportedImageTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

if (!supportedImageTypes.includes(file.type)) {
  setFormError({
    message:
      'This image format is not supported. Please choose a JPG, PNG, or WebP image.',
  });

  event.target.value = '';
  return;
}

    const maxSize = 15 * 1024 * 1024;

    if (file.size > maxSize) {
      setFormError({
        message: 'Your profile photo must be smaller than 15 MB.',
      });

      event.target.value = '';
      return;
    }

    setFormError(null);

    // The previous object URL is revoked by the cleanup
    // effect below when profileImage changes.
    setProfileImage({
      file,
      uri: URL.createObjectURL(file),
      mimeType: file.type || 'image/jpeg',
      name: file.name,
      size: file.size,
    });

    event.target.value = '';
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

      const cleanSource = source.split('?')[0];

      const sourceExtension =
        cleanSource
          .split('.')
          .pop()
          ?.toLowerCase();

      if (
        sourceExtension &&
        /^[a-z0-9]{2,5}$/.test(sourceExtension)
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
  //
  // Order matters:
  //
  //  1. Google Drive permission   (must be the first thing
  //                                run from the tap, so the
  //                                browser allows the popup)
  //  2. Firebase Auth user        (signs the user in)
  //  3. Username availability     (needs auth to read)
  //  4. Asset ID
  //  5. Drive upload
  //  6. Firestore /assets record
  //  7. Firestore /users + /usernames in ONE batch
  //  8. Verification email (only after everything worked)
  //
  // If anything after step 2 fails, everything created so
  // far is rolled back: asset record, Drive file, then the
  // Auth user LAST (Firestore deletes still need auth).
  //
  // ----------------------------------------------------------

  const executeSignUp =
    async (): Promise<void> => {
      if (submittingRef.current) {
        return;
      }

      setFormError(null);

      if (!profileImage) {
        setFormError({
          message: 'Add a profile photo to continue.',
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

      try {
        // ----------------------------------------------------
        // 1. GOOGLE DRIVE PERMISSION
        // ----------------------------------------------------

        const driveToken = await connectDrive();

        if (!driveToken) {
          setFormError({
            message:
              'Shinzi needs Google Drive access to save your profile photo. Allow access when the Google window opens, then try again.',
            ref: 'drive',
          });

          return;
        }

        // ----------------------------------------------------
        // 2. FIREBASE AUTH USER
        // ----------------------------------------------------

        stage = 'auth';

        const authResult =
          await createEmailAuthUser(
            email.trim(),
            password,
            normalizedUsername
          );

        if (
  authResult.error ||
  !authResult.user
) {
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

        // ----------------------------------------------------
        // 3. USERNAME AVAILABILITY (signed in now)
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

        createdAssetId = profileAssetId;

        const { fileName, mimeType } =
          getImageUploadInfo(
            profileImage,
            profileAssetId
          );

        // ----------------------------------------------------
        // 5. UPLOAD PROFILE PHOTO
        // ----------------------------------------------------

        stage = 'upload';

        const uploadResult = await uploadFile({
          file: profileImage.file,
          localUri: profileImage.uri,
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

        uploadedDriveFileId = uploadResult.fileId;

        // ----------------------------------------------------
        // 6. ASSET RECORD
        // ----------------------------------------------------

        stage = 'assetRecord';

        const asset = await createAssetRecord({
          assetId: profileAssetId,

          ownerUid: createdAuthUser.uid,

          type: ASSET_TYPES.PROFILE_PHOTO,

          visibility: ASSET_VISIBILITY.PUBLIC,

          providerFileId: uploadResult.fileId,

          driveFolderId: uploadResult.folderId,

          fileName:
            uploadResult.fileName || fileName,

          mimeType:
            uploadResult.mimeType || mimeType,

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
          asset.assetId !== profileAssetId
        ) {
          throw new Error(
            'Profile asset record could not be created.'
          );
        }

        // ----------------------------------------------------
        // 7. USER PROFILE + USERNAME (one batch)
        // ----------------------------------------------------

        stage = 'profile';

        // Date of birth is only used above to check the
        // 13+ requirement. It is not stored on purpose.
        const profileResult =
          await createUserProfile(
            createdAuthUser,
            {
              displayName: name.trim(),

              username: normalizedUsername,

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

        void sendVerificationEmailSafe(
          createdAuthUser
        );

        setSuccessName(name.trim());

        // Let the confirmation show briefly before App
        // switches to the main screen.
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1600);
        });

      } catch (err) {
        console.error(
          `[SIGNUP] Failed at "${stage}":`,
          err
        );

        // ----------------------------------------------------
        // ROLLBACK (asset record -> Drive file -> Auth user)
        // ----------------------------------------------------

        let cleanupIncomplete = false;

        if (createdAssetId) {
          try {
            await deleteAsset(createdAssetId);
          } catch (assetRollbackError) {
            cleanupIncomplete = true;

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
          } catch (driveRollbackError) {
            cleanupIncomplete = true;

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

          if (!authRollback.success) {
            cleanupIncomplete = true;
          }
        }

        const code = getErrorCode(err);

        const baseMessage =
          getFriendlyErrorMessage(
            err,
            'Something went wrong while creating your account. Please try again.'
          );

        setFormError({
          message: cleanupIncomplete
            ? `${baseMessage} Some cleanup could not be completed. If you try again with the same email and it says the email is registered, wait a moment or use a different email.`
            : baseMessage,

          ref: code
            ? `${stage} / ${code}`
            : stage,
        });

      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
        onBusyChange(false);
      }
    };

  // ----------------------------------------------------------
  // CLEAN OBJECT URL
  // ----------------------------------------------------------

  useEffect(() => {
    return () => {
      if (profileImage?.uri) {
        URL.revokeObjectURL(profileImage.uri);
      }
    };
  }, [profileImage]);

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  const createButtonClass = isSubmitting
    ? 'signup-continue-button signup-busy-button'
    : isStep2Valid
      ? 'signup-continue-button'
      : 'signup-continue-button signup-disabled-button';

  return (
    <div className="signup-page">
      <div className="signup-shell">

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
    ←
  </button>
</div>

{formError && (
  ...
)}

{/* STEP 1 */}
{step === 1 && (
  ...
)}

{/* STEP 2 */}
{step === 2 && (
  ...
)}

        {formError && (
          <div
            className="signup-banner-wrap"
          >
            <div
              className="signup-error-banner"
              role="alert"
            >
              {formError.message}

              {formError.ref && (
                <span className="signup-error-ref">
                  Reference: {formError.ref}
                </span>
              )}
            </div>
          </div>
        )}

        {/* STEP 1 */}

        {step === 1 && (
          <div className="signup-content">

            <h1 className="signup-title">
              Create your account
            </h1>

            <p className="signup-subtitle">
              Choose the email and password you will
              log in with.
            </p>

            <div className="signup-input-box">
              <input
                className="signup-input"
                type="email"
                placeholder="Email address"
                aria-label="Email address"
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

            <div className="signup-input-box">
              <input
                className="signup-input"
                type="password"
                placeholder="Password"
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

            <div
              className={
                password.length > 0 &&
                (!hasNumber ||
                  password.length < 6)
                  ? 'signup-hint signup-hint-error'
                  : 'signup-hint'
              }
            >
              Use at least 6 characters, including a
              number.
            </div>

            <button
              type="button"
              className={
                isStep1Valid
                  ? 'signup-continue-button'
                  : 'signup-continue-button signup-disabled-button'
              }
              disabled={
                !isStep1Valid || isSubmitting
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

        {/* STEP 2 */}

        {step === 2 && (
          <div className="signup-content">

            <h1 className="signup-title">
              Set up your profile
            </h1>

            <p className="signup-subtitle">
              Add a photo and a few details so people
              can find you.
            </p>

            <input
  ref={fileInputRef}
  type="file"
  accept="image/jpeg,image/png,image/webp"
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
                  ✎
                </span>
              </button>

              <div className="signup-photo-required">
                {profileImage
                  ? 'Tap to change photo'
                  : 'Profile photo required'}
              </div>

            </div>

            {/* DISPLAY NAME */}

            <div className="signup-input-box">
              <input
                className="signup-input"
                type="text"
                placeholder="Display name"
                aria-label="Display name"
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                maxLength={50}
                autoCorrect="off"
                disabled={isSubmitting}
              />
            </div>

            {/* USERNAME */}

            <div
              className={
                username.length > 0 &&
                !isUsernameValid
                  ? 'signup-input-box signup-error-box'
                  : 'signup-input-box'
              }
            >
              <input
                className="signup-input"
                type="text"
                placeholder="Username (3–15 characters)"
                aria-label="Username"
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

            {username.length > 0 &&
              !isUsernameValid && (
                <div className="signup-error-text">
                  Use 3–15 lowercase letters,
                  numbers, or underscores.
                </div>
              )}

            {/* DATE OF BIRTH */}

            <div className="signup-field-label">
              Date of birth
            </div>

            <div className="signup-date-row">

              <div className="signup-input-box signup-flex-1">
                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="DD"
                  aria-label="Day of birth"
                  value={day}
                  onChange={(event) =>
                    setDay(
                      event.target.value
                        .replace(/\D/g, '')
                        .slice(0, 2)
                    )
                  }
                  maxLength={2}
                  disabled={isSubmitting}
                />
              </div>

              <div className="signup-input-box signup-flex-1">
                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM"
                  aria-label="Month of birth"
                  value={month}
                  onChange={(event) =>
                    setMonth(
                      event.target.value
                        .replace(/\D/g, '')
                        .slice(0, 2)
                    )
                  }
                  maxLength={2}
                  disabled={isSubmitting}
                />
              </div>

              <div className="signup-input-box signup-flex-2">
                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY"
                  aria-label="Year of birth"
                  value={year}
                  onChange={(event) =>
                    setYear(
                      event.target.value
                        .replace(/\D/g, '')
                        .slice(0, 4)
                    )
                  }
                  maxLength={4}
                  disabled={isSubmitting}
                />
              </div>

            </div>

            {hasEnteredDate &&
            !isValidDate(day, month, year) ? (
              <div className="signup-error-text">
                Enter a valid date. You must be at
                least 13.
              </div>
            ) : (
              <div className="signup-hint">
                Only used to check that you are 13 or
                older.
              </div>
            )}

            {/* GENDER */}

            <button
              type="button"
              className="signup-input-box signup-gender-button"
              onClick={() =>
                setShowGenderModal(true)
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
                {gender || 'Select gender'}
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
              className={createButtonClass}
              disabled={
                !isStep2Valid || isSubmitting
              }
              onClick={executeSignUp}
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

        {/* GENDER MODAL */}

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
                setShowGenderModal(false);
              }
            }}
          >
            <div className="signup-modal-content">

              <div className="signup-modal-title">
                Select gender
              </div>

              {GENDER_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={
                    option === gender
                      ? 'signup-modal-option signup-modal-option-selected'
                      : 'signup-modal-option'
                  }
                  aria-pressed={option === gender}
                  onClick={() => {
                    setGender(option);
                    setShowGenderModal(false);
                  }}
                >
                  {option}
                </button>
              ))}

            </div>
          </div>
        )}

        {/* SUCCESS */}

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
              Welcome to Shinzi Hub, {successName}.
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
          --su-surface: #0D0D12;
          --su-surface-2: #14141C;
          --su-line: #22222E;
          --su-line-strong: #34344A;
          --su-text: #FFFFFF;
          --su-muted: #8E8EA0;
          --su-accent: #00D2FF;
          --su-violet: #8A2BE2;
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
          padding-bottom: env(safe-area-inset-bottom);
        }

        .signup-page button:focus-visible,
        .signup-page input:focus-visible {
          outline: 2px solid var(--su-accent);
          outline-offset: 2px;
        }

         .signup-header {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 22px 24px 18px;
}

         .signup-back-button {
  border: 0;
  background: transparent;
  color: var(--su-accent);
  font-size: 30px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  padding: 2px 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.signup-back-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

        .signup-banner-wrap {
          padding: 0 24px;
        }

        .signup-error-banner {
          background: rgba(255, 51, 102, 0.1);
          border: 1px solid rgba(255, 51, 102, 0.4);
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

        .signup-content {
          flex: 1;
          width: 100%;
          padding: 0 24px 20px;
          display: flex;
          flex-direction: column;
        }

        .signup-title {
          margin: 0 0 6px;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.3px;
          line-height: 1.2;
          color: var(--su-text);
        }

        .signup-subtitle {
          margin: 0 0 24px;
          max-width: 46ch;
          font-size: 15px;
          line-height: 1.45;
          color: var(--su-muted);
        }

        .signup-input-box {
          width: 100%;
          min-height: 58px;
          display: flex;
          flex-direction: row;
          align-items: center;
          background: var(--su-surface);
          border-radius: 12px;
          border: 1px solid var(--su-line);
          margin-bottom: 10px;
          overflow: hidden;
          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease;
        }

        .signup-input-box:focus-within {
          border-color: var(--su-accent);
          box-shadow: 0 0 0 3px rgba(0, 210, 255, 0.14);
        }

        .signup-error-box {
          border-color: var(--su-danger);
        }

        .signup-input {
          width: 100%;
          min-width: 0;
          flex: 1;
          border: 0;
          outline: none;
          background: transparent;
          color: var(--su-text);
          padding: 17px 16px;
          font-size: 16px;
          font-family: inherit;
        }

        .signup-page .signup-input:focus-visible {
          outline: none;
        }

        .signup-input::placeholder {
          color: var(--su-muted);
          opacity: 1;
        }

        .signup-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .signup-hint,
        .signup-error-text {
          margin: -6px 0 16px 4px;
          font-size: 13px;
          line-height: 1.4;
        }

        .signup-hint {
          color: var(--su-muted);
        }

        .signup-hint-error,
        .signup-error-text {
          color: var(--su-danger);
        }

        .signup-field-label {
          margin: 4px 0 8px 4px;
          font-size: 14px;
          font-weight: 600;
          color: var(--su-text);
        }

        .signup-photo-required {
          color: var(--su-muted);
          font-size: 13px;
          margin-top: 10px;
        }

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
          border: 2px dashed var(--su-line-strong);
          border-radius: 50%;
          background: var(--su-surface-2);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
          cursor: pointer;
        }

        .signup-avatar-filled {
          border: 2px solid var(--su-accent);
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
          color: var(--su-muted);
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
          background: var(--su-violet);
          border: 2px solid var(--su-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-size: 15px;
          line-height: 1;
        }

        .signup-gender-button {
          border: 1px solid var(--su-line);
          color: var(--su-text);
          font-family: inherit;
          cursor: pointer;
          padding: 0 16px;
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
          color: var(--su-text);
        }

        .signup-gender-placeholder {
          color: var(--su-muted);
        }

        .signup-chevron {
          color: var(--su-muted);
          font-size: 16px;
          margin-left: 10px;
        }

        .signup-continue-button {
          width: 100%;
          border: 0;
          border-radius: 28px;
          background: #FFFFFF;
          color: #000000;
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
.signup-content .signup-hint + .signup-continue-button {
  margin-top: 30px;
}

        .signup-continue-button:not(:disabled):active {
          transform: scale(0.99);
        }

        .signup-disabled-button {
          background: #22222C;
          color: #6E6E80;
          cursor: not-allowed;
        }

        .signup-busy-button {
          opacity: 0.85;
          cursor: progress;
        }

        .signup-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(0, 0, 0, 0.25);
          border-top-color: #000000;
          border-radius: 50%;
          animation: signup-spin 0.7s linear infinite;
        }

        .signup-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: signup-fade 0.15s ease;
        }

        .signup-modal-content {
          width: 100%;
          max-width: 620px;
          background: var(--su-surface-2);
          border-top-left-radius: 24px;
          border-top-right-radius: 24px;
          padding:
            12px 20px
            calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.45);
          animation: signup-sheet 0.2s ease-out;
        }

        .signup-modal-title {
          text-align: center;
          color: var(--su-muted);
          font-size: 14px;
          padding: 8px 0 12px;
        }

        .signup-modal-option {
          width: 100%;
          border: 0;
          border-top: 1px solid var(--su-line);
          background: transparent;
          color: var(--su-text);
          padding: 18px 10px;
          font-size: 18px;
          font-family: inherit;
          text-align: center;
          cursor: pointer;
        }

        .signup-modal-option-selected {
          color: var(--su-accent);
          font-weight: 700;
        }

        .signup-modal-option:hover {
          background: #1D1D28;
        }

        .signup-success {
          position: fixed;
          inset: 0;
          z-index: 2000;
          background: #000000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 24px;
          text-align: center;
          animation: signup-fade 0.2s ease;
        }

        .signup-success-mark {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: 2px solid var(--su-accent);
          color: var(--su-accent);
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
          color: var(--su-muted);
          font-size: 15px;
        }

        @keyframes signup-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes signup-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes signup-sheet {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .signup-page *,
          .signup-modal-overlay,
          .signup-modal-content,
          .signup-success {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }

                @media (min-width: 768px) {
          .signup-page {
            display: block;
            width: 100%;
            min-height: 100dvh;
          }

          .signup-shell {
            width: 100%;
            max-width: none;
            min-height: 100dvh;
            margin: 0;
            border: none;
            border-radius: 0;
            box-shadow: none;
          }

          .signup-content {
            max-width: 760px;
            margin-left: auto;
            margin-right: auto;
            padding-left: 40px;
            padding-right: 40px;
          }

          .signup-header {
            padding-left: 40px;
            padding-right: 40px;
          }

          .signup-banner-wrap {
            padding-left: 40px;
            padding-right: 40px;
          }
        }
      `}</style>
    </div>
  );
}
