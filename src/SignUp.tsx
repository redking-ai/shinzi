import React, {
  ChangeEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createEmailAuthUser,
  createUserProfile,
  deleteCurrentAuthUser,
} from './authService';

import { useDriveStore } from './driveStore';

import {
  generateAssetId,
  createAssetRecord,
  deleteAsset,
  ASSET_TYPES,
  ASSET_VISIBILITY,
} from './assetService';


// ============================================================
// TYPES
// ============================================================

interface SignUpProps {
  onBack: () => void;
}

interface ProfileImage {
  file: File;
  uri: string;
  mimeType: string;
  name: string;
  size: number;
}

interface DriveUploadResult {
  fileId: string;
  folderId: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}


// ============================================================
// SIGN UP
// ============================================================

export default function SignUp({
  onBack,
}: SignUpProps) {

  const [step, setStep] = useState(1);

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  // ----------------------------------------------------------
  // GOOGLE DRIVE
  // ----------------------------------------------------------

  const {
    isReady: isDriveReady,
    connectDrive,
    uploadFile,
    deleteFile,
  } = useDriveStore();


  // ----------------------------------------------------------
  // STEP 1
  // ----------------------------------------------------------

  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');


  // ----------------------------------------------------------
  // STEP 2
  // ----------------------------------------------------------

  const [name, setName] =
    useState('');

  const [username, setUsername] =
    useState('');

  const [gender, setGender] =
    useState('');

  const [
    showGenderModal,
    setShowGenderModal,
  ] = useState(false);

  const [day, setDay] =
    useState('');

  const [month, setMonth] =
    useState('');

  const [year, setYear] =
    useState('');

  const [
    profileImage,
    setProfileImage,
  ] = useState<ProfileImage | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);


  // ==========================================================
  // VALIDATION
  // ==========================================================

  const normalizedUsername =
    username.trim().toLowerCase();


  const isEmail =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email.trim()
    );


  const hasNumber =
    /\d/.test(password);


  const isUsernameValid =
    /^[a-z0-9_]{3,15}$/.test(
      normalizedUsername
    );


  // ----------------------------------------------------------
  // DATE VALIDATION
  // ----------------------------------------------------------

  const isValidDate = (
    d: string,
    m: string,
    y: string
  ): boolean => {

    const numD =
      parseInt(d, 10);

    const numM =
      parseInt(m, 10);

    const numY =
      parseInt(y, 10);

    const today =
      new Date();


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


    const parsedDate =
      new Date(
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


    return (
      isRealDate &&
      age >= 13
    );
  };


  const isStep1Valid =
    isEmail &&
    password.length >= 6 &&
    hasNumber;


  const isStep2Valid =
    profileImage !== null &&
    name.trim().length > 0 &&
    isUsernameValid &&
    isValidDate(
      day,
      month,
      year
    ) &&
    gender !== '';


  const hasEnteredDate =
    day.length > 0 ||
    month.length > 0 ||
    year.length > 0;


  // ==========================================================
  // AVATAR PICKER
  // ==========================================================

  const handleAvatarPress =
    () => {

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


    const file =
      event.target.files?.[0];


    if (!file) {
      return;
    }


    if (
      !file.type.startsWith('image/')
    ) {

      window.alert(
        'Please select an image file.'
      );

      event.target.value = '';

      return;
    }


    const maxSize =
      15 * 1024 * 1024;


    if (file.size > maxSize) {

      window.alert(
        'Profile photo must be smaller than 15 MB.'
      );

      event.target.value = '';

      return;
    }


    const uri =
      URL.createObjectURL(file);


    setProfileImage(
      (previous) => {

        if (previous?.uri) {
          URL.revokeObjectURL(
            previous.uri
          );
        }

        return {
          file,
          uri,
          mimeType:
            file.type ||
            'image/jpeg',
          name:
            file.name,
          size:
            file.size,
        };
      }
    );


    // Allow selecting the same file again later.
    event.target.value = '';
  };


  // ==========================================================
  // GET IMAGE INFORMATION
  // ==========================================================

  const getImageUploadInfo = (
    imageAsset: ProfileImage,
    assetId: string
  ) => {

    const mimeType =
      imageAsset?.mimeType ||
      'image/jpeg';


    let extension =
      'jpg';


    if (
      mimeType === 'image/png'
    ) {

      extension = 'png';

    } else if (
      mimeType === 'image/webp'
    ) {

      extension = 'webp';

    } else if (
      mimeType === 'image/heic'
    ) {

      extension = 'heic';

    } else if (
      mimeType === 'image/heif'
    ) {

      extension = 'heif';

    } else {

      const uri =
        imageAsset?.name ||
        imageAsset?.uri ||
        '';


      const cleanUri =
        uri.split('?')[0];


      const uriExtension =
        cleanUri
          .split('.')
          .pop()
          ?.toLowerCase();


      if (
        uriExtension &&
        /^[a-z0-9]{2,5}$/.test(
          uriExtension
        )
      ) {

        extension =
          uriExtension;
      }
    }


    return {
      fileName:
        `${assetId}.${extension}`,

      mimeType,
    };
  };


  // ==========================================================
  // CREATE ACCOUNT
  // ==========================================================

  const executeSignUp =
    async (): Promise<void> => {

      if (isSubmitting) {
        return;
      }


      // --------------------------------------------------------
      // PROFILE PHOTO REQUIRED
      // --------------------------------------------------------

      if (!profileImage) {

        window.alert(
          'Profile Photo Required\n\nPlease select a profile photo before creating your account.'
        );

        return;
      }


      // --------------------------------------------------------
      // DRIVE MUST BE READY
      // --------------------------------------------------------

      if (!isDriveReady) {

        window.alert(
          'Google Drive Not Ready\n\nPlease wait a moment and try again.'
        );

        return;
      }


      setIsSubmitting(true);


      // --------------------------------------------------------
      // ROLLBACK TRACKING
      // --------------------------------------------------------

      let createdAuthUser:
        Awaited<
          ReturnType<
            typeof createEmailAuthUser
          >
        >['user'] = null;

      let createdAssetId:
        string | null = null;

      let uploadedDriveFileId:
        string | null = null;


      try {

        // ======================================================
        // 1. GOOGLE DRIVE PERMISSION
        // ======================================================

        const driveToken =
          await connectDrive();


        if (!driveToken) {

          window.alert(
            'Google Drive Permission Required\n\nShinzi requires Google Drive permission to continue creating your account.'
          );

          return;
        }


        // ======================================================
        // 2. CREATE FIREBASE AUTH USER
        // ======================================================

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

          window.alert(
            `Sign Up Failed\n\n${
              authResult.error ||
              'Unable to create your account.'
            }`
          );

          return;
        }


        createdAuthUser =
          authResult.user;


        // ======================================================
        // 3. GENERATE SHINZI PROFILE ASSET ID
        // ======================================================

        const profileAssetId =
          await generateAssetId(
            ASSET_TYPES.PROFILE_PHOTO
          );


        createdAssetId =
          profileAssetId;


        // ======================================================
        // 4. PREPARE DRIVE FILE
        // ======================================================

        const {
          fileName,
          mimeType,
        } =
          getImageUploadInfo(
            profileImage,
            profileAssetId
          );


        // ======================================================
        // 5. UPLOAD PROFILE PHOTO TO GOOGLE DRIVE
        // ======================================================

        /*
         * The Web version of driveStore accepts a browser
         * readable URI.
         *
         * profileImage.uri is a blob URL created from the
         * user's selected File.
         */

        const uploadResult =
          await uploadFile({
            localUri:
              profileImage.uri,

            fileName,

            mimeType,

            folderType:
              'profiles',
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


        // ======================================================
        // 6. CREATE FIREBASE ASSET RECORD
        // ======================================================

        const asset =
          await createAssetRecord({

            assetId:
              profileAssetId,

            ownerUid:
              createdAuthUser.uid,

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

            version:
              1,

            status:
              'active',
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


        // ======================================================
        // 7. CREATE FIRESTORE USER PROFILE
        // ======================================================

        const profileResult =
          await createUserProfile(
            createdAuthUser,
            {

              displayName:
                name.trim(),

              username:
                normalizedUsername,

              gender,

              dob:
                `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`,

              profileAssetId:
                profileAssetId,
            }
          );


        if (
          !profileResult.success
        ) {

          throw new Error(
            profileResult.error ||
            'Unable to create your Shinzi profile.'
          );
        }


        // ======================================================
        // 8. SUCCESS
        // ======================================================

        /*
         * Firebase Auth has successfully created and signed
         * in the user.
         *
         * App.tsx is listening with onAuthStateChanged().
         *
         * Once Firebase reports the authenticated user,
         * App.tsx automatically replaces this SignUp screen
         * with the authenticated application.
         *
         * We intentionally do NOT manually navigate here.
         */

        window.alert(
          `Account Created!\n\nWelcome to Shinzi Hub, ${name.trim()}!`
        );


        return;

      } catch (err) {

        console.error(
          'Signup error:',
          err
        );


        // ======================================================
        // ROLLBACK 1:
        // DELETE FIRESTORE ASSET RECORD
        // ======================================================

        if (createdAssetId) {

          try {

            await deleteAsset(
              createdAssetId
            );

          } catch (
            assetRollbackError
          ) {

            console.error(
              'Asset metadata rollback failed:',
              assetRollbackError
            );
          }
        }


        // ======================================================
        // ROLLBACK 2:
        // DELETE GOOGLE DRIVE FILE
        // ======================================================

        if (
          uploadedDriveFileId
        ) {

          try {

            await deleteFile(
              uploadedDriveFileId
            );

          } catch (
            driveRollbackError
          ) {

            console.error(
              'Google Drive rollback failed:',
              driveRollbackError
            );
          }
        }


        // ======================================================
        // ROLLBACK 3:
        // DELETE FIREBASE AUTH USER
        // ======================================================

        if (
          createdAuthUser
        ) {

          try {

            await deleteCurrentAuthUser(
              createdAuthUser
            );

          } catch (
            authRollbackError
          ) {

            console.error(
              'Firebase Auth rollback failed:',
              authRollbackError
            );
          }
        }


        // ======================================================
        // SHOW ERROR
        // ======================================================

        const errorMessage =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred during signup.';


        window.alert(
          `Sign Up Failed\n\n${errorMessage}`
        );

      } finally {

        setIsSubmitting(false);
      }
    };


  // ==========================================================
  // CLEAN IMAGE URL WHEN COMPONENT UNMOUNTS
  // ==========================================================

  /*
   * We intentionally keep the object URL while the component
   * is alive because Drive upload needs it.
   *
   * It is revoked when the component is removed.
   */

  React.useEffect(() => {

    return () => {

      if (profileImage?.uri) {
        URL.revokeObjectURL(
          profileImage.uri
        );
      }

    };

  }, [profileImage]);


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <div className="signup-page">

      <div className="signup-shell">

        {/* ==================================================
            HEADER
        ================================================== */}

        <div className="signup-header">

          <button
            type="button"
            className="signup-back-button"
            onClick={() => {

              if (isSubmitting) {
                return;
              }

              if (step === 1) {
                onBack();
              } else {
                setStep(1);
              }

            }}
            disabled={isSubmitting}
          >
            &lt; Back
          </button>


          <div className="signup-step">
            STEP {step}/2
          </div>


          <div
            className="signup-header-spacer"
          />

        </div>


        {/* ==================================================
            STEP 1
        ================================================== */}

        {step === 1 && (

          <div className="signup-content">

            <div className="signup-input-box">

              <input
                className="signup-input"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
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
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="new-password"
                disabled={isSubmitting}
              />

            </div>


            {password.length > 0 &&
              !hasNumber && (

                <div className="signup-error-text">
                  * Password must contain at
                  least 1 number
                </div>

              )}


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
              onClick={() =>
                setStep(2)
              }
            >

              Continue

            </button>

          </div>
        )}


        {/* ==================================================
            STEP 2
        ================================================== */}

        {step === 2 && (

          <div className="signup-content">

            {/* Hidden browser file input */}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              style={{
                display: 'none',
              }}
            />


            {/* Avatar */}

            <div className="signup-avatar-container">

              <button
                type="button"
                className="signup-avatar-button"
                onClick={
                  handleAvatarPress
                }
                disabled={
                  isSubmitting
                }
                aria-label="Choose profile photo"
              >

                {profileImage ? (

                  <img
                    src={
                      profileImage.uri
                    }
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


              {!profileImage && (

                <div className="signup-photo-required">
                  Profile photo required
                </div>

              )}

            </div>


            {/* Display Name */}

            <div className="signup-input-box">

              <input
                className="signup-input"
                type="text"
                placeholder="Display Name"
                value={name}
                onChange={(event) =>
                  setName(
                    event.target.value
                  )
                }
                maxLength={50}
                autoCorrect="off"
                disabled={isSubmitting}
              />

            </div>


            {/* Username */}

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
                placeholder="Username (3-15 chars)"
                value={username}
                onChange={(event) =>
                  setUsername(
                    event.target.value
                  )
                }
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={15}
                disabled={isSubmitting}
              />

            </div>


            {username.length > 0 &&
              !isUsernameValid && (

                <div className="signup-error-text">
                  * 3-15 characters, lowercase
                  letters, numbers, and underscores
                  only
                </div>

              )}


            {/* Date of Birth */}

            <div className="signup-date-row">

              <div className="signup-input-box signup-flex-1">

                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="DD"
                  value={day}
                  onChange={(event) =>
                    setDay(
                      event.target.value.replace(
                        /\D/g,
                        ''
                      ).slice(0, 2)
                    )
                  }
                  maxLength={2}
                  disabled={
                    isSubmitting
                  }
                />

              </div>


              <div className="signup-input-box signup-flex-1">

                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="MM"
                  value={month}
                  onChange={(event) =>
                    setMonth(
                      event.target.value.replace(
                        /\D/g,
                        ''
                      ).slice(0, 2)
                    )
                  }
                  maxLength={2}
                  disabled={
                    isSubmitting
                  }
                />

              </div>


              <div className="signup-input-box signup-flex-2">

                <input
                  className="signup-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY"
                  value={year}
                  onChange={(event) =>
                    setYear(
                      event.target.value.replace(
                        /\D/g,
                        ''
                      ).slice(0, 4)
                    )
                  }
                  maxLength={4}
                  disabled={
                    isSubmitting
                  }
                />

              </div>

            </div>


            {hasEnteredDate &&
              !isValidDate(
                day,
                month,
                year
              ) && (

                <div className="signup-error-text">
                  * Enter a valid calendar date
                  (Min. age 13)
                </div>

              )}


            {/* Gender */}

            <button
              type="button"
              className="signup-input-box signup-gender-button"
              onClick={() =>
                setShowGenderModal(true)
              }
              disabled={isSubmitting}
            >

              <span
                className={
                  gender
                    ? 'signup-gender-selected'
                    : 'signup-gender-placeholder'
                }
              >
                {gender ||
                  'Select Gender'}
              </span>


              <span className="signup-chevron">
                ▼
              </span>

            </button>


            {/* Create Account */}

            <button
              type="button"
              className={
                isStep2Valid &&
                !isSubmitting
                  ? 'signup-continue-button'
                  : 'signup-continue-button signup-disabled-button'
              }
              disabled={
                !isStep2Valid ||
                isSubmitting
              }
              onClick={
                executeSignUp
              }
            >

              {isSubmitting
                ? 'Creating...'
                : 'Create Account'}

            </button>

          </div>
        )}


        {/* ==================================================
            GENDER MODAL
        ================================================== */}

        {showGenderModal && (

          <div
            className="signup-modal-overlay"
            role="dialog"
            aria-modal="true"
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

              {[
                'Male',
                'Female',
                'Others',
              ].map((g) => (

                <button
                  type="button"
                  key={g}
                  className="signup-modal-option"
                  onClick={() => {

                    setGender(g);

                    setShowGenderModal(
                      false
                    );

                  }}
                >

                  {g}

                </button>

              ))}

            </div>

          </div>
        )}

      </div>


      {/* ====================================================
          PAGE STYLES
      ==================================================== */}

      <style>{`

        * {
          box-sizing: border-box;
        }

        .signup-page {
          width: 100%;
          min-height: 100%;
          height: 100%;
          background: #000000;
          color: #ffffff;
          overflow-y: auto;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
        }

        .signup-shell {
          width: 100%;
          max-width: 620px;
          min-height: 100%;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          background: #000000;
        }

        .signup-header {
          width: 100%;
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
          padding:
            18px
            20px
            20px;
        }

        .signup-back-button {
          border: 0;
          background: transparent;
          color: #00D2FF;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 0;
        }

        .signup-back-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .signup-step {
          color: #8E8EA0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 1px;
        }

        .signup-header-spacer {
          width: 50px;
        }

        .signup-content {
          flex: 1;
          width: 100%;
          padding:
            0
            24px
            20px;
          display: flex;
          flex-direction: column;
        }

        .signup-input-box {
          width: 100%;
          min-height: 58px;
          display: flex;
          flex-direction: row;
          align-items: center;
          background: #0D0D12;
          border-radius: 12px;
          border: 1px solid #22222E;
          margin-bottom: 16px;
          overflow: hidden;
          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease;
        }

        .signup-input-box:focus-within {
          border-color: #00D2FF;
          box-shadow:
            0 0 0 1px
            rgba(0, 210, 255, 0.15);
        }

        .signup-error-box {
          border-color: #FF3366;
        }

        .signup-input {
          width: 100%;
          min-width: 0;
          flex: 1;
          border: 0;
          outline: none;
          background: transparent;
          color: #FFFFFF;
          padding:
            17px
            16px;
          font-size: 16px;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
        }

        .signup-input::placeholder {
          color: #8E8EA0;
          opacity: 1;
        }

        .signup-input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .signup-error-text {
          color: #FF3366;
          font-size: 13px;
          line-height: 1.35;
          margin-top: -8px;
          margin-bottom: 16px;
          margin-left: 4px;
        }

        .signup-photo-required {
          color: #FF3366;
          font-size: 12px;
          margin-top: 8px;
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
          margin-bottom: 24px;
        }

        .signup-avatar-button {
          position: relative;
          width: 90px;
          height: 90px;
          padding: 0;
          border: 2px solid #22222E;
          border-radius: 50%;
          background: #14141C;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: visible;
          cursor: pointer;
        }

        .signup-avatar-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .signup-avatar-image {
          width: 86px;
          height: 86px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }

        .signup-person-icon {
          color: #FFFFFF;
          font-size: 34px;
          line-height: 1;
        }

        .signup-pencil-badge {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #8A2BE2;
          border: 2px solid #000000;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-size: 16px;
          line-height: 1;
        }

        .signup-gender-button {
          border: 1px solid #22222E;
          cursor: pointer;
          padding:
            0
            16px;
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
          color: #FFFFFF;
        }

        .signup-gender-placeholder {
          color: #8E8EA0;
        }

        .signup-chevron {
          color: #8E8EA0;
          font-size: 14px;
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
          cursor: pointer;
          margin-top: auto;
          margin-bottom: 20px;
          transition:
            transform 0.1s ease,
            opacity 0.15s ease;
        }

        .signup-continue-button:not(
          :disabled
        ):hover {
          transform: translateY(-1px);
        }

        .signup-continue-button:not(
          :disabled
        ):active {
          transform: translateY(0);
        }

        .signup-disabled-button {
          background: #333333;
          color: #000000;
          opacity: 0.5;
          cursor: not-allowed;
        }

        .signup-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background:
            rgba(
              0,
              0,
              0,
              0.7
            );
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .signup-modal-content {
          width: 100%;
          max-width: 620px;
          background: #14141C;
          border-top-left-radius: 24px;
          border-top-right-radius: 24px;
          padding: 24px;
          box-shadow:
            0 -10px 40px
            rgba(
              0,
              0,
              0,
              0.45
            );
        }

        .signup-modal-option {
          width: 100%;
          border: 0;
          border-bottom: 1px solid #22222E;
          background: transparent;
          color: #FFFFFF;
          padding:
            18px
            10px;
          font-size: 18px;
          text-align: center;
          cursor: pointer;
        }

        .signup-modal-option:last-child {
          border-bottom: 0;
        }

        .signup-modal-option:hover {
          background: #1D1D28;
        }

        @media (min-width: 768px) {

          .signup-page {
            display: flex;
            align-items: center;
            justify-content: center;
            overflow-y: auto;
          }

          .signup-shell {
            min-height: 0;
            width: 100%;
            max-width: 620px;
            border:
              1px solid #171720;
            border-radius: 20px;
            box-shadow:
              0 20px 80px
              rgba(
                0,
                0,
                0,
                0.45
              );
          }

        }

        @media (max-width: 420px) {

          .signup-content {
            padding-left: 18px;
            padding-right: 18px;
          }

          .signup-header {
            padding-left: 16px;
            padding-right: 16px;
          }

        }

      `}</style>

    </div>
  );
}