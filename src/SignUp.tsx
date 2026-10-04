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

const GENDER_OPTIONS = ['Male', 'Female', 'Others'] as const;

export default function SignUp({
  onBack,
  onBusyChange,
}: SignUpProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const {
    isReady: isDriveReady,
    connectDrive,
    uploadFile,
    deleteFile,
  } = useDriveStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState('');
  const [showGenderModal, setShowGenderModal] = useState(false);

  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  const [profileImage, setProfileImage] = useState<ProfileImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedUsername = username.trim().toLowerCase();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const hasNumber = /\d/.test(password);
  const isUsernameValid = /^[a-z0-9_]{3,15}$/.test(normalizedUsername);

  const isValidDate = (d: string, m: string, y: string): boolean => {
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

    const parsedDate = new Date(numY, numM - 1, numD);

    const isRealDate =
      parsedDate.getFullYear() === numY &&
      parsedDate.getMonth() === numM - 1 &&
      parsedDate.getDate() === numD;

    let age = today.getFullYear() - numY;

    if (
      today.getMonth() < numM - 1 ||
      (today.getMonth() === numM - 1 && today.getDate() < numD)
    ) {
      age--;
    }

    return isRealDate && age >= 13;
  };

  const isStep1Valid = isEmail && password.length >= 6 && hasNumber;

  const isStep2Valid =
    profileImage !== null &&
    name.trim().length > 0 &&
    isUsernameValid &&
    isValidDate(day, month, year) &&
    gender !== '';

  const hasEnteredDate = Boolean(day || month || year);

  const handleAvatarPress = () => {
    if (!isSubmitting) {
      fileInputRef.current?.click();
    }
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isSubmitting) return;

    const file = event.target.files?.[0];
    if (!file) return;

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

    if (file.size > 15 * 1024 * 1024) {
      setFormError({
        message: 'Your profile photo must be smaller than 15 MB.',
      });
      event.target.value = '';
      return;
    }

    setFormError(null);

    setProfileImage({
      file,
      uri: URL.createObjectURL(file),
      mimeType: file.type || 'image/jpeg',
      name: file.name,
      size: file.size,
    });

    event.target.value = '';
  };

  const getImageUploadInfo = (
    imageAsset: ProfileImage,
    assetId: string,
  ) => {
    const mimeType = imageAsset.mimeType || 'image/jpeg';
    let extension = 'jpg';

    if (mimeType === 'image/png') {
      extension = 'png';
    } else if (mimeType === 'image/webp') {
      extension = 'webp';
    } else {
      const source = imageAsset.name || imageAsset.uri || '';
      const cleanSource = source.split('?')[0];
      const sourceExtension = cleanSource.split('.').pop()?.toLowerCase();

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

  // ACCOUNT CREATION — existing Firebase and Google Drive flow preserved.
  const executeSignUp = async (): Promise<void> => {
    if (submittingRef.current) return;

    setFormError(null);

    if (!profileImage) {
      setFormError({ message: 'Add a profile photo to continue.' });
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
      // 1. Google Drive permission
      const driveToken = await connectDrive();

      if (!driveToken) {
        setFormError({
          message:
            'Shinzi needs Google Drive access to save your profile photo. Allow access when the Google window opens, then try again.',
          ref: 'drive',
        });
        return;
      }

      // 2. Firebase Authentication account
      stage = 'auth';

      const authResult = await createEmailAuthUser(
        email.trim(),
        password,
        normalizedUsername,
      );

      if (authResult.error || !authResult.user) {
        setFormError({
          message: authResult.error || 'Unable to create your account.',
          ref: authResult.code ? `auth / ${authResult.code}` : 'auth',
        });
        return;
      }

      createdAuthUser = authResult.user;

      // 3. Username availability
      stage = 'username';

      const usernameAvailable = await checkUsernameAvailable(
        normalizedUsername,
      );

      if (!usernameAvailable) {
        throw new Error(
          'That username is already taken. Choose another one.',
        );
      }

      // 4. Generate profile asset ID
      stage = 'assetId';

      const profileAssetId = await generateAssetId(
        ASSET_TYPES.PROFILE_PHOTO,
      );

      createdAssetId = profileAssetId;

      const { fileName, mimeType } = getImageUploadInfo(
        profileImage,
        profileAssetId,
      );

      // 5. Upload profile photo
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
          'Google Drive upload did not return a valid file.',
        );
      }

      uploadedDriveFileId = uploadResult.fileId;

      // 6. Create asset record
      stage = 'assetRecord';

      const asset = await createAssetRecord({
        assetId: profileAssetId,
        ownerUid: createdAuthUser.uid,
        type: ASSET_TYPES.PROFILE_PHOTO,
        visibility: ASSET_VISIBILITY.PUBLIC,
        providerFileId: uploadResult.fileId,
        driveFolderId: uploadResult.folderId,
        fileName: uploadResult.fileName || fileName,
        mimeType: uploadResult.mimeType || mimeType,
        sizeBytes:
          typeof uploadResult.sizeBytes === 'number'
            ? uploadResult.sizeBytes
            : 0,
        version: 1,
        status: 'active',
      });

      if (!asset || asset.assetId !== profileAssetId) {
        throw new Error(
          'Profile asset record could not be created.',
        );
      }

      // 7. Create user profile and username record
      stage = 'profile';

      const profileResult = await createUserProfile(
        createdAuthUser,
        {
          displayName: name.trim(),
          username: normalizedUsername,
          gender,
          profileAssetId,
        },
      );

      if (!profileResult.success) {
        throw new Error(
          profileResult.error ||
            'Unable to create your Shinzi profile.',
        );
      }

      // 8. Success
      stage = 'done';

      void sendVerificationEmailSafe(createdAuthUser);
      setSuccessName(name.trim());

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1600);
      });
    } catch (err) {
      console.error(`[SIGNUP] Failed at "${stage}":`, err);

      // Roll back created resources if a later step fails.
      let cleanupIncomplete = false;

      if (createdAssetId) {
        try {
          await deleteAsset(createdAssetId);
        } catch (assetRollbackError) {
          cleanupIncomplete = true;
          console.error(
            'Asset metadata rollback failed:',
            assetRollbackError,
          );
        }
      }

      if (uploadedDriveFileId) {
        try {
          await deleteFile(uploadedDriveFileId);
        } catch (driveRollbackError) {
          cleanupIncomplete = true;
          console.error(
            'Google Drive rollback failed:',
            driveRollbackError,
          );
        }
      }

      if (createdAuthUser) {
        const authRollback = await deleteCurrentAuthUser(
          createdAuthUser,
        );

        if (!authRollback.success) {
          cleanupIncomplete = true;
        }
      }

      const code = getErrorCode(err);
      const baseMessage = getFriendlyErrorMessage(
        err,
        'Something went wrong while creating your account. Please try again.',
      );

      setFormError({
        message: cleanupIncomplete
          ? `${baseMessage} Some cleanup could not be completed. If you try again with the same email and it says the email is registered, wait a moment or use a different email.`
          : baseMessage,
        ref: code ? `${stage} / ${code}` : stage,
      });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      onBusyChange(false);
    }
  };

  // Clean up the temporary image preview URL.
  useEffect(() => {
    return () => {
      if (profileImage?.uri) {
        URL.revokeObjectURL(profileImage.uri);
      }
    };
  }, [profileImage]);

  const createButtonClass = isSubmitting
    ? 'signup-action-button signup-busy-button'
    : 'signup-action-button';

  return (
    <div className="signup-page">
      <div className="signup-shell">
        {/* HEADER */}
        <header className="signup-header">
          <button
            type="button"
            className="signup-back-button"
            onClick={() => {
              if (isSubmitting) return;

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

          <div className="signup-brand-mark" aria-hidden="true">
            S
          </div>
        </header>

        {/* ERROR */}
        {formError && (
          <div className="signup-banner-wrap">
            <div className="signup-error-banner" role="alert">
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
            <div className="signup-eyebrow">JOIN SHINZI</div>

            <h1 className="signup-title">
              Create your account
            </h1>

            <p className="signup-subtitle">
              Your space to connect, share, and discover.
            </p>

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
                (!hasNumber || password.length < 6)
                  ? 'signup-hint signup-hint-error'
                  : 'signup-hint'
              }
            >
              Use at least 6 characters, including a number.
            </div>

            <button
              type="button"
              className={`${createButtonClass} signup-register-button`}
              disabled={!isStep1Valid || isSubmitting}
              onClick={() => {
                setFormError(null);
                setStep(2);
              }}
            >
              Continue <span aria-hidden="true">→</span>
            </button>

            <p className="signup-footer-note">
              Already have an account?{' '}
              <span>Log in from the welcome screen.</span>
            </p>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="signup-content">
            <div className="signup-eyebrow">ONE LAST STEP</div>

            <h1 className="signup-title">
              Set up your profile
            </h1>

            <p className="signup-subtitle">
              Add a photo and a few details so people can find you.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              className="signup-hidden-file-input"
            />

            {/* PROFILE PHOTO */}
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
                  <span
                    className="signup-person-icon"
                    aria-hidden="true"
                  >
                    ●
                  </span>
                )}

                <span
                  className="signup-pencil-badge"
                  aria-hidden="true"
                >
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
                  username.length > 0 && !isUsernameValid
                    ? 'signup-input-box signup-error-box'
                    : 'signup-input-box'
                }
              >
                <input
                  id="signup-username"
                  className="signup-input"
                  type="text"
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

            {username.length > 0 && !isUsernameValid && (
              <div className="signup-error-text">
                Use 3–15 lowercase letters, numbers, or underscores.
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
                        .slice(0, 2),
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
                        .slice(0, 2),
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
                        .slice(0, 4),
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
                Enter a valid date. You must be at least 13.
              </div>
            ) : (
              <div className="signup-hint signup-date-hint">
                Only used to check that you are 13 or older.
              </div>
            )}

            {/* GENDER */}
            <div className="signup-field-group signup-gender-group">
              <div className="signup-input-label">
                Gender
              </div>

              <button
                type="button"
                className="signup-input-box signup-gender-button"
                onClick={() => setShowGenderModal(true)}
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
            </div>

            {/* CREATE ACCOUNT */}
            <button
              type="button"
              className={`${createButtonClass} signup-register-button`}
              disabled={!isStep2Valid || isSubmitting}
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

              {!isSubmitting && (
                <span aria-hidden="true">→</span>
              )}
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
              if (event.target === event.currentTarget) {
                setShowGenderModal(false);
              }
            }}
          >
            <div className="signup-modal-content">
              <div
                className="signup-modal-handle"
                aria-hidden="true"
              />

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

                  {option === gender && (
                    <span aria-hidden="true">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {successName && (
          <div className="signup-success" role="status">
            <div className="signup-success-orbit">
              <div className="signup-success-mark">✓</div>
            </div>

            <div className="signup-eyebrow">
              WELCOME TO SHINZI
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

      {/* SIGNUP THEME */}
      <style>{`
        .signup-page,
        .signup-page * {
          box-sizing: border-box;
        }

        .signup-page {
          --su-bg: #080612;
          --su-surface: #17102A;
          --su-surface-2: #130D22;
          --su-line: #302344;
          --su-text: #FFFFFF;
          --su-muted: #A6A0B7;
          --su-accent: #20D9FF;
          --su-register: #39265D;
          --su-violet: #762BFF;
          --su-danger: #FF668A;

          width: 100%;
          min-height: 100dvh;
          background:
            radial-gradient(
              ellipse at 50% -12%,
              rgba(118, 43, 255, 0.15),
              transparent 48%
            ),
            var(--su-bg);
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
          padding-bottom: env(safe-area-inset-bottom);
        }

        .signup-page button:focus-visible,
        .signup-page input:focus-visible {
          outline: 2px solid var(--su-accent);
          outline-offset: 3px;
        }

        /* Header */
        .signup-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 22px;
        }

        .signup-back-button {
          width: 42px;
          height: 42px;
          padding: 0;
          border: 1px solid rgba(32, 217, 255, 0.12);
          border-radius: 14px;
          background: rgba(23, 16, 42, 0.82);
          color: var(--su-accent);
          font-size: 26px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .signup-back-button:hover:not(:disabled) {
          background: #21153A;
          border-color: rgba(32, 217, 255, 0.4);
        }

        .signup-back-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .signup-brand-mark {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, #3020A0, #762BFF);
          box-shadow: 0 0 22px rgba(118, 43, 255, 0.26);
          color: #FFFFFF;
          font-weight: 850;
          font-size: 19px;
        }

        /* Error message */
        .signup-banner-wrap {
          padding: 0 24px;
        }

        .signup-error-banner {
          background: rgba(255, 51, 102, 0.09);
          border: 1px solid rgba(255, 102, 138, 0.38);
          border-radius: 14px;
          padding: 13px 15px;
          margin-bottom: 18px;
          color: #FFD8E1;
          font-size: 14px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .signup-error-ref {
          display: block;
          margin-top: 6px;
          color: #C5A0AD;
          font-size: 12px;
          overflow-wrap: anywhere;
        }

        /* Main content */
        .signup-content {
          flex: 1;
          width: 100%;
          padding: 0 24px 26px;
          display: flex;
          flex-direction: column;
        }

        .signup-eyebrow {
          color: var(--su-accent);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 2.2px;
          line-height: 1.4;
          margin-bottom: 9px;
        }

        .signup-title {
          margin: 0 0 8px;
          font-size: clamp(27px, 6vw, 32px);
          font-weight: 800;
          letter-spacing: -0.75px;
          line-height: 1.17;
          color: #FFFFFF;
        }

        .signup-subtitle {
          margin: 0 0 27px;
          max-width: 46ch;
          font-size: 15px;
          line-height: 1.55;
          color: var(--su-muted);
        }

        /* Inputs */
        .signup-field-group {
          width: 100%;
          margin-bottom: 17px;
        }

        .signup-input-label,
        .signup-field-label {
          display: block;
          margin: 0 0 8px 3px;
          color: #F7F4FF;
          font-size: 13px;
          font-weight: 650;
          line-height: 1.35;
        }

        .signup-input-box {
          width: 100%;
          min-height: 56px;
          display: flex;
          flex-direction: row;
          align-items: center;
          background: var(--su-surface);
          border: 1px solid var(--su-line);
          border-radius: 14px;
          overflow: hidden;
          transition:
            border-color 0.16s ease,
            box-shadow 0.16s ease,
            background 0.16s ease;
        }

        .signup-input-box:focus-within {
          border-color: var(--su-accent);
          box-shadow:
            0 0 0 3px rgba(32, 217, 255, 0.09),
            0 0 18px rgba(32, 217, 255, 0.045);
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
          color: #FFFFFF;
          padding: 16px;
          font-size: 15px;
          font-weight: 550;
          font-family: inherit;
        }

        .signup-page .signup-input:focus-visible {
          outline: none;
        }

        .signup-input::placeholder {
          color: #E0D9EE;
          opacity: 0.88;
          font-weight: 550;
        }

        .signup-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        /* Validation hints */
        .signup-hint,
        .signup-error-text {
          margin: -5px 0 16px 3px;
          font-size: 12px;
          line-height: 1.5;
        }

        .signup-hint {
          color: var(--su-muted);
        }

        .signup-hint-error,
        .signup-error-text {
          color: var(--su-danger);
        }

        .signup-date-hint {
          margin-top: 9px;
          margin-bottom: 17px;
        }

        .signup-field-label {
          margin-top: 4px;
        }

        /* Avatar */
        .signup-avatar-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0 0 27px;
        }

        .signup-avatar-button {
          position: relative;
          width: 100px;
          height: 100px;
          padding: 0;
          border: 2px dashed #604982;
          border-radius: 50%;
          background: radial-gradient(
            circle at 30% 20%,
            #2A1B47,
            #17102A 75%
          );
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
          cursor: pointer;
          box-shadow: 0 0 28px rgba(118, 43, 255, 0.1);
          transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .signup-avatar-button:hover:not(:disabled) {
          border-color: var(--su-accent);
          box-shadow: 0 0 24px rgba(32, 217, 255, 0.12);
        }

        .signup-avatar-filled {
          border: 2px solid var(--su-accent);
          box-shadow: 0 0 22px rgba(32, 217, 255, 0.15);
        }

        .signup-avatar-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .signup-avatar-image {
          width: 94px;
          height: 94px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }

        .signup-person-icon {
          color: #9A8BB5;
          font-size: 34px;
          line-height: 1;
        }

        .signup-pencil-badge {
          position: absolute;
          right: -3px;
          bottom: -2px;
          width: 31px;
          height: 31px;
          border-radius: 50%;
          background: linear-gradient(145deg, #3020A0, #762BFF);
          border: 3px solid var(--su-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-size: 15px;
          line-height: 1;
          box-shadow: 0 0 14px rgba(118, 43, 255, 0.25);
        }

        .signup-photo-required {
          color: var(--su-muted);
          font-size: 12px;
          margin-top: 12px;
        }

        .signup-hidden-file-input {
          display: none;
        }

        /* Date of birth */
        .signup-date-row {
          width: 100%;
          display: flex;
          flex-direction: row;
          gap: 9px;
        }

        .signup-date-row .signup-input-box {
          margin-bottom: 0;
        }

        .signup-date-row .signup-input {
          text-align: center;
          padding-left: 8px;
          padding-right: 8px;
          letter-spacing: 0.4px;
        }

        .signup-flex-1 {
          flex: 1;
        }

        .signup-flex-2 {
          flex: 2;
        }

        /* Gender selector */
        .signup-gender-group {
          margin-top: 3px;
          margin-bottom: 21px;
        }

        .signup-gender-button {
          margin-bottom: 0;
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
          font-size: 15px;
          line-height: 1;
        }

        .signup-gender-selected {
          color: #FFFFFF;
        }

        .signup-gender-placeholder {
          color: #E0D9EE;
          opacity: 0.82;
        }

        .signup-chevron {
          color: var(--su-accent);
          font-size: 16px;
          margin-left: 10px;
        }

        /* Register / continue buttons */
        .signup-action-button {
          width: 100%;
          min-height: 55px;
          border: 1px solid rgba(147, 103, 207, 0.45);
          border-radius: 16px;
          background: #39265D;
          color: #FFFFFF;
          padding: 15px 18px;
          font-size: 15px;
          font-weight: 750;
          font-family: inherit;
          cursor: pointer;
          margin-top: 14px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          box-shadow:
            0 0 0 1px rgba(118, 43, 255, 0.07),
            0 7px 22px rgba(57, 38, 93, 0.18);
          transition:
            transform 0.12s ease,
            background 0.16s ease,
            border-color 0.16s ease,
            box-shadow 0.16s ease,
            opacity 0.16s ease;
        }

        .signup-register-button:hover:not(:disabled) {
          background: #493075;
          border-color: rgba(172, 130, 235, 0.7);
          box-shadow:
            0 0 18px rgba(118, 43, 255, 0.15),
            0 7px 24px rgba(57, 38, 93, 0.24);
        }

        .signup-action-button:not(:disabled):active {
          transform: scale(0.99);
        }

        .signup-action-button:disabled {
          background: #21192F;
          color: #81788F;
          border-color: #30253F;
          box-shadow: none;
          cursor: not-allowed;
        }

        .signup-busy-button {
          opacity: 0.88;
          cursor: progress;
        }

        .signup-spinner {
          width: 17px;
          height: 17px;
          border: 2px solid rgba(255, 255, 255, 0.24);
          border-top-color: var(--su-accent);
          border-radius: 50%;
          animation: signup-spin 0.7s linear infinite;
        }

        .signup-footer-note {
          margin: 9px 0 0;
          text-align: center;
          color: #817A93;
          font-size: 12px;
          line-height: 1.5;
        }

        .signup-footer-note span {
          color: #BDB3D1;
        }

        /* Gender bottom sheet */
        .signup-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(3, 1, 10, 0.76);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: signup-fade 0.15s ease;
        }

        .signup-modal-content {
          width: 100%;
          max-width: 620px;
          background: #130D22;
          border: 1px solid rgba(118, 43, 255, 0.24);
          border-bottom: 0;
          border-top-left-radius: 26px;
          border-top-right-radius: 26px;
          padding: 12px 20px calc(22px + env(safe-area-inset-bottom));
          box-shadow: 0 -12px 45px rgba(0, 0, 0, 0.45);
          animation: signup-sheet 0.2s ease-out;
        }

        .signup-modal-handle {
          width: 38px;
          height: 4px;
          border-radius: 99px;
          background: #514363;
          margin: 0 auto 17px;
        }

        .signup-modal-title {
          text-align: center;
          color: var(--su-muted);
          font-size: 13px;
          font-weight: 650;
          padding: 5px 0 13px;
        }

        .signup-modal-option {
          width: 100%;
          border: 0;
          border-top: 1px solid #2A2039;
          background: transparent;
          color: #FFFFFF;
          padding: 18px 10px;
          font-size: 16px;
          font-weight: 550;
          font-family: inherit;
          text-align: center;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .signup-modal-option-selected {
          color: var(--su-accent);
          font-weight: 750;
        }

        .signup-modal-option:hover {
          background: rgba(118, 43, 255, 0.08);
        }

        /* Success screen */
        .signup-success {
          position: fixed;
          inset: 0;
          z-index: 2000;
          background:
            radial-gradient(
              ellipse at 50% 42%,
              rgba(118, 43, 255, 0.18),
              transparent 45%
            ),
            #080612;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 24px;
          text-align: center;
          animation: signup-fade 0.2s ease;
        }

        .signup-success-orbit {
          width: 86px;
          height: 86px;
          border: 1px solid rgba(32, 217, 255, 0.35);
          border-radius: 50%;
          display: grid;
          place-items: center;
          margin-bottom: 9px;
          box-shadow:
            0 0 35px rgba(32, 217, 255, 0.08),
            inset 0 0 25px rgba(32, 217, 255, 0.05);
        }

        .signup-success-mark {
          width: 62px;
          height: 62px;
          border-radius: 50%;
          background: rgba(32, 217, 255, 0.08);
          border: 1px solid var(--su-accent);
          color: var(--su-accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 29px;
          font-weight: 700;
        }

        .signup-success-title {
          margin: 0;
          font-size: 26px;
          font-weight: 850;
          letter-spacing: -0.5px;
          color: #FFFFFF;
        }

        .signup-success-text {
          margin: 0;
          color: var(--su-muted);
          font-size: 15px;
          line-height: 1.5;
        }

        /* Animations */
        @keyframes signup-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes signup-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes signup-sheet {
          from {
            transform: translateY(24px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
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

        /* Desktop */
        @media (min-width: 768px) {
          .signup-page {
            display: block;
            min-height: 100dvh;
          }

          .signup-shell {
            max-width: 620px;
            min-height: 100dvh;
            margin: 0 auto;
          }

          .signup-content {
            padding: 0 40px 32px;
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