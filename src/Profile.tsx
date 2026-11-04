import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Server,
  Sparkles,
} from 'lucide-react';
import { auth, db } from './firebaseConfig';
import { useDriveStore } from './driveStore';
import {
  generateAssetId,
  createAssetRecord,
  deleteAsset,
  getAsset,
  ASSET_TYPES,
  ASSET_VISIBILITY,
} from './assetService';
import MediaCropModal from './MediaCropModal';
import {
  getCachedProfile,
  setCachedProfile,
  getCachedAssetMeta,
  setCachedAssetMeta,
  navigateTo,
} from './profileCache';
import './Profile.css';

type AnyRecord = Record<string, any>;

const usernamePattern = /^[a-z0-9_]{3,15}$/;

function dateValue(value: any): Date | null {
  if (!value) return null;

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function dateLabel(value: any): string {
  const date = dateValue(value);

  return date
    ? date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : 'October 2026';
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function Profile() {
  const drive = useDriveStore();
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(
    () => auth.currentUser,
  );
  const [authLoading, setAuthLoading] = useState(() => !auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const [userData, setUserData] = useState<AnyRecord | null>(() => {
    const user = auth.currentUser;
    return user ? getCachedProfile(user.uid) : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    const user = auth.currentUser;
    return user ? !getCachedProfile(user.uid) : true;
  });
  const [assetLoading, setAssetLoading] = useState(false);
const [assetError, setAssetError] = useState('');
const [retryAssets, setRetryAssets] = useState(0);
 const [showAssetError, setShowAssetError] = useState(false);

// only reveal the error if it is still there after 10 seconds
useEffect(() => {
  if (!assetError) {
    setShowAssetError(false);
    return;
  }
  const t = setTimeout(() => setShowAssetError(true), 10000);
  return () => clearTimeout(t);
}, [assetError]);
  const [profileImageUri, setProfileImageUri] = useState<string>(() => {
    const user = auth.currentUser;
    const cached = user ? getCachedProfile(user.uid) : null;
    if (cached?.profileAssetId) {
      const meta = getCachedAssetMeta(cached.profileAssetId);
      if (meta?.providerFileId && typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(`shinzi_drive_${meta.providerFileId}`);
        if (stored) return stored;
      }
    }
    return String(cached?.photoURL ?? '');
  });
  const [bannerImageUri, setBannerImageUri] = useState<string>(() => {
    const user = auth.currentUser;
    const cached = user ? getCachedProfile(user.uid) : null;
    if (cached?.bannerAssetId) {
      const meta = getCachedAssetMeta(cached.bannerAssetId);
      if (meta?.providerFileId && typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(`shinzi_drive_${meta.providerFileId}`);
        if (stored) return stored;
      }
    }
    return String(cached?.bannerUrl ?? '');
  });
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Media cropping & upload state
  const [mediaUploadLoading, setMediaUploadLoading] = useState(false);
  const [mediaUploadStatus, setMediaUploadStatus] = useState('');
  const [cropModalData, setCropModalData] = useState<{
    imageSrc: string;
    type: 'avatar' | 'banner';
  } | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  const [editForm, setEditForm] = useState({
    displayName: '',
    username: '',
    bio: '',
    bubleText: '',
     pronouns: '',
  });

  const resetEditForm = useCallback((data: AnyRecord) => {
    setEditForm({
      displayName: String(data.displayName ?? ''),
      username: String(data.username ?? ''),
      bio: String(data.bio ?? ''),
      bubleText: String(data.bubleText ?? ''),
      pronouns: String(data.pronouns ?? ''),
    });
  }, []);

  const hasChanges = useMemo(() => {
    if (!userData) return false;
    const currentDisplayName = String(userData.displayName ?? '').trim();
    const currentUsername = String(userData.username ?? '').trim().toLowerCase();
    const currentBio = String(userData.bio ?? '').trim();
    const currentPronouns = String(userData.pronouns ?? '').trim();
    const currentBubble = String(userData.bubleText ?? '').trim().replace(/^\+\s*/, '');

    const newDisplayName = editForm.displayName.trim();
    const newUsername = editForm.username.trim().toLowerCase();
    const newBio = editForm.bio.trim();
    const newPronouns = editForm.pronouns.trim();
    const newBubble = editForm.bubleText.trim().replace(/^\+\s*/, '');

    return (
      newDisplayName !== currentDisplayName ||
      newUsername !== currentUsername ||
      newBio !== currentBio ||
      newPronouns !== currentPronouns ||
      newBubble !== currentBubble
    );
  }, [editForm, userData]);

  const loadProfile = useCallback(async () => {
    if (!currentUser) {
      setUserData(null);
      setLoading(false);
      return;
    }

    // Only show full blocking loading state if no cached data is present
    setLoading((prevLoading) => {
      const cached = getCachedProfile(currentUser.uid);
      return cached ? false : prevLoading;
    });
    setError('');

    try {
      const snap = await getDoc(doc(db, 'users', currentUser.uid));

      if (!snap.exists()) {
        setUserData(null);
        return;
      }

      const data = snap.data() as AnyRecord;
      setUserData(data);
      setCachedProfile(currentUser.uid, data);
      resetEditForm(data);
    } catch (e) {
      console.error('[PROFILE] Failed to load user document:', e);
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [currentUser, resetEditForm]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Load profile and banner assets from Firestore and Google Drive.
  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      setAssetError('');

      if (!userData) {
        setProfileImageUri('');
        setBannerImageUri('');
        setAssetLoading(false);
        return;
      }

      const fallbackAvatar = String(userData.photoURL ?? '');
      const fallbackBanner = String(userData.bannerUrl ?? '');

      // Keep previously loaded image to prevent UI flicker while fetching
      setProfileImageUri((prev) => prev || fallbackAvatar);
      setBannerImageUri((prev) => prev || fallbackBanner);

      const profileAssetId = userData.profileAssetId;
      const bannerAssetId = userData.bannerAssetId;

      if (!profileAssetId && !bannerAssetId) {
        setProfileImageUri(fallbackAvatar);
        setBannerImageUri(fallbackBanner);
        setAssetLoading(false);
        return;
      }

      setAssetLoading(true);

      const loadAsset = async (
        assetId: unknown,
        kind: 'profile' | 'banner',
      ): Promise<string> => {
        if (typeof assetId !== 'string' || !assetId.trim()) {
          console.info(`[PROFILE IMAGE] No ${kind} asset ID found.`);
          return '';
        }

        const trimmedAssetId = assetId.trim();

        try {
          let asset = getCachedAssetMeta(trimmedAssetId);

          if (!asset) {
            const snap = await getDoc(doc(db, 'assets', trimmedAssetId));

            if (!snap.exists()) {
              console.error(
                `[PROFILE IMAGE] ${kind} asset document not found:`,
                trimmedAssetId,
              );
              return '';
            }

            asset = snap.data() as AnyRecord;
            setCachedAssetMeta(trimmedAssetId, asset);
          }

          console.info(`[PROFILE IMAGE] ${kind} asset metadata:`, {
            assetId,
            status: asset.status,
            provider: asset.provider,
            providerFileIdPresent: Boolean(asset.providerFileId),
            mimeType: asset.mimeType,
            visibility: asset.visibility,
          });

          if (asset.status !== 'active') {
            console.error(
              `[PROFILE IMAGE] ${kind} asset is not active:`,
              asset.status,
            );
            return '';
          }

          if (asset.provider !== 'google_drive') {
            console.error(
              `[PROFILE IMAGE] Unexpected ${kind} provider:`,
              asset.provider,
            );
            return '';
          }

          if (
            typeof asset.providerFileId !== 'string' ||
            !asset.providerFileId.trim()
          ) {
            console.error(
              `[PROFILE IMAGE] ${kind} asset has no providerFileId.`,
            );
            return '';
          }

          if (
            asset.mimeType &&
            !String(asset.mimeType).startsWith('image/') &&
            !String(asset.mimeType).startsWith('video/')
          ) {
            console.error(
              `[PROFILE IMAGE] ${kind} file is not an image or video:`,
              asset.mimeType,
            );
            return '';
          }

          const dataUri = await drive.getFileDataUri(
            asset.providerFileId,
          );

          if (drive.hasActiveSession) {
            void drive.makeFilePublic(asset.providerFileId);
          }

          if (
            !dataUri.startsWith('data:image/') &&
            !dataUri.startsWith('data:video/') &&
            !dataUri.startsWith('https://')
          ) {
            console.error(
              `[PROFILE IMAGE] ${kind} download did not return a valid data URI.`,
            );
            return '';
          }

          return dataUri;
        } catch (e) {
          console.error(
            `[PROFILE IMAGE] Failed to load ${kind} asset "${assetId}":`,
            e,
          );

          if (!cancelled) {
            setAssetError(
              'The profile image could not be loaded. The connected Google account may not have access to this file.',
            );
          }

          return '';
        }
      };

      try {
        const [avatarUri, bannerUri] = await Promise.all([
          loadAsset(profileAssetId, 'profile'),
          loadAsset(bannerAssetId, 'banner'),
        ]);

        if (!cancelled) {
          setProfileImageUri(avatarUri || fallbackAvatar);
          setBannerImageUri(bannerUri || fallbackBanner);

          if (avatarUri && currentUser?.uid && userData?.photoURL !== avatarUri) {
            updateDoc(doc(db, 'users', currentUser.uid), {
              photoURL: avatarUri,
            }).catch(() => {});
          }
        }
      } finally {
        if (!cancelled) {
          setAssetLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [
    userData?.profileAssetId,
    userData?.bannerAssetId,
    userData?.photoURL,
    userData?.bannerUrl,
    drive.hasActiveSession,
    drive.getFileDataUri,
    retryAssets,
  ]);

  const cancelEditing = () => {
    if (userData) {
      resetEditForm(userData);
    }

    setIsEditing(false);
    setError('');
  };

  const saveProfile = async () => {
    if (!currentUser || !userData || saving) return;

    const displayName = editForm.displayName.trim();
    const username = editForm.username.trim().toLowerCase();

    if (!displayName) {
      setError('Display name cannot be empty.');
      return;
    }

    if (displayName.length > 50) {
      setError('Display name cannot exceed 50 characters.');
      return;
    }

    if (!usernamePattern.test(username)) {
      setError(
        'Username must be 3–15 characters using lowercase letters, numbers, or underscores.',
      );
      return;
    }

    setSaving(true);
    setError('');

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const oldUsername = String(userData.username ?? '').toLowerCase();
      const usernameChanged = username !== oldUsername;
      const batch = writeBatch(db);

      const updates: AnyRecord = {
        displayName,
        bio: editForm.bio.trim().slice(0, 300),
        bubleText: editForm.bubleText.trim().replace(/^\+\s*/, '').slice(0, 100),
        pronouns: editForm.pronouns.trim().slice(0, 20),
        updatedAt: serverTimestamp(),
      };

      if (usernameChanged) {
        const lastChanged = dateValue(userData.usernameLastChanged);
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        if (
          lastChanged &&
          Date.now() - lastChanged.getTime() < thirtyDays
        ) {
          const daysLeft = Math.ceil(
            (thirtyDays - (Date.now() - lastChanged.getTime())) /
              (24 * 60 * 60 * 1000),
          );

          throw new Error(
            `You can change your username again in about ${daysLeft} day(s).`,
          );
        }

        const newUsernameRef = doc(db, 'usernames', username);
        const newUsernameSnap = await getDoc(newUsernameRef);

        if (
          newUsernameSnap.exists() &&
          newUsernameSnap.data().uid !== currentUser.uid
        ) {
          throw new Error('That username is already taken.');
        }

        // Delete only a reservation owned by this user.
        if (oldUsername && oldUsername !== username) {
          const oldUsernameRef = doc(db, 'usernames', oldUsername);
          const oldUsernameSnap = await getDoc(oldUsernameRef);

          if (
            oldUsernameSnap.exists() &&
            oldUsernameSnap.data().uid === currentUser.uid
          ) {
            batch.delete(oldUsernameRef);
          }
        }

        // An existing reservation belonging to this user does not
        // need to be recreated; the rules prohibit reservation updates.
        if (!newUsernameSnap.exists()) {
          batch.set(newUsernameRef, {
            uid: currentUser.uid,
            username,
            updatedAt: serverTimestamp(),
          });
        }

        updates.username = username;
        updates.usernameLastChanged = serverTimestamp();
      }

      batch.update(userRef, updates);
      await batch.commit();

      setIsEditing(false);
      await loadProfile();
    } catch (e) {
      console.error('[PROFILE] Failed to save profile:', e);
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  // Helper to delete an old Google Drive file & asset record
  const cleanupOldDriveAsset = async (oldAssetId?: string) => {
    if (!oldAssetId) return;
    try {
      const assetRecord = await getAsset(oldAssetId);
      if (assetRecord?.providerFileId) {
        await drive.deleteFile(assetRecord.providerFileId);
      }
      await deleteAsset(oldAssetId);
    } catch (delErr) {
      console.warn('[PROFILE] Non-critical cleanup error for old asset:', delErr);
    }
  };

  // Handle selected file from input (Avatar or Banner)
  const handleMediaFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'avatar' | 'banner'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      setError('Please choose an image (PNG, JPG) or short video (MP4, WebM).');
      return;
    }

    // Video validation: max 8MB, max 10 seconds
    if (isVideo) {
      if (file.size > 8 * 1024 * 1024) {
        setError('Profile videos must be under 8MB.');
        return;
      }

      // Check duration strictly
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      const objectUrl = URL.createObjectURL(file);
      videoEl.src = objectUrl;

      videoEl.onloadedmetadata = async () => {
        const duration = videoEl.duration;
        URL.revokeObjectURL(objectUrl);
        if (typeof duration === 'number' && !isNaN(duration) && duration > 10.0) {
          setError(`Video is ${Math.round(duration)} seconds long. Maximum allowed is 10 seconds.`);
          return;
        }

        // Read video as data URL for instant feedback and upload
        const reader = new FileReader();
        reader.onload = async () => {
          await uploadMediaFile(file, type, reader.result as string);
        };
        reader.readAsDataURL(file);
      };

      videoEl.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setError('Unable to read video file.');
      };
      return;
    }

    // Image selected: open interactive crop modal
    const reader = new FileReader();
    reader.onload = () => {
      setCropModalData({
        imageSrc: reader.result as string,
        type,
      });
    };
    reader.readAsDataURL(file);
  };

  // Upload cropped image or video to Google Drive and update profile
  const uploadMediaFile = async (
    file: File,
    type: 'avatar' | 'banner',
    dataUriPreview?: string
  ) => {
    if (!currentUser) return;
    setMediaUploadLoading(true);
    setMediaUploadStatus(`Uploading ${type}…`);
    setError('');

    try {
      if (!drive.hasActiveSession) {
        const token = await drive.connectDrive(true);
        if (!token) {
          throw new Error('Google Drive connection cancelled.');
        }
      }

      // 1. Upload to user's Google Drive
      const isBanner = type === 'banner';
      const folderType = isBanner ? 'banners' : 'profiles';
      const uploadedFile = await drive.uploadFile({
        file,
        fileName: file.name,
        mimeType: file.type || (file.name.endsWith('.png') ? 'image/png' : 'image/jpeg'),
        folderType,
      });

      // 2. Make file publicly accessible for profile display
      try {
        await drive.makeFilePublic(uploadedFile.fileId);
      } catch (pubErr) {
        console.warn('Public permission error:', pubErr);
      }

      // 3. Save asset record & update user profile in Firestore
      const assetType = isBanner ? ASSET_TYPES.BANNER : ASSET_TYPES.PROFILE_PHOTO;
      const newAssetId = await generateAssetId(assetType);
      const oldAssetId = isBanner ? userData?.bannerAssetId : userData?.profileAssetId;

      // We use our serverless API (/api/update-profile-media) which runs Firebase Admin SDK.
      // This has full administrator privileges and NEVER gets blocked by Firestore client rules!
      const idToken = await currentUser.getIdToken();
      let savedViaServer = false;

      try {
        const apiRes = await fetch('/api/update-profile-media', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            type,
            assetId: newAssetId,
            providerFileId: uploadedFile.fileId,
            driveFolderId: uploadedFile.folderId,
            fileName: file.name,
            mimeType: file.type || (file.name.endsWith('.png') ? 'image/png' : 'image/jpeg'),
            sizeBytes: file.size,
            dataUriPreview,
          }),
        });

        if (apiRes.ok) {
          savedViaServer = true;
          console.info('[PROFILE] Successfully updated profile media via Firebase Admin serverless API.');
        } else {
          const errData = await apiRes.json().catch(() => ({}));
          console.warn('[PROFILE] Serverless update failed, falling back to direct write:', errData);
        }
      } catch (srvErr) {
        console.warn('[PROFILE] Network error contacting /api/update-profile-media:', srvErr);
      }

      // If serverless endpoint wasn't reached, fallback to direct client Firestore write
      if (!savedViaServer) {
        await createAssetRecord({
          assetId: newAssetId,
          ownerUid: currentUser.uid,
          type: assetType,
          visibility: ASSET_VISIBILITY.PUBLIC,
          providerFileId: uploadedFile.fileId,
          driveFolderId: uploadedFile.folderId,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        });

        const userRef = doc(db, 'users', currentUser.uid);
        const profileUpdates: AnyRecord = isBanner
          ? {
              bannerAssetId: newAssetId,
              bannerUrl: dataUriPreview || `https://lh3.googleusercontent.com/d/${uploadedFile.fileId}=s800`,
              updatedAt: serverTimestamp(),
            }
          : {
              profileAssetId: newAssetId,
              photoURL: dataUriPreview || `https://lh3.googleusercontent.com/d/${uploadedFile.fileId}=s800`,
              updatedAt: serverTimestamp(),
            };

        await updateDoc(userRef, profileUpdates);
      }

      // Cache locally for instant feedback
      if (isBanner) {
        setBannerImageUri(dataUriPreview || `https://lh3.googleusercontent.com/d/${uploadedFile.fileId}=s800`);
      } else {
        setProfileImageUri(dataUriPreview || `https://lh3.googleusercontent.com/d/${uploadedFile.fileId}=s800`);
      }

      // 5. Clean up the old asset from Drive so storage stays safe and clean
      if (oldAssetId && oldAssetId !== newAssetId) {
        void cleanupOldDriveAsset(oldAssetId);
      }

      await loadProfile();
    } catch (uploadErr) {
      console.error('[PROFILE] Media upload failed:', uploadErr);
      const msg = messageOf(uploadErr);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
        setError(
          'Missing or insufficient permissions: Firebase rules blocked this profile update. Please publish firestore.rules in Firebase Console (Rules tab -> Publish).'
        );
      } else {
        setError(msg);
      }
    } finally {
      setMediaUploadLoading(false);
      setMediaUploadStatus('');
      setCropModalData(null);
    }
  };

  if (loading || authLoading) {
    return (
      <main className="sh-profile-page sh-profile-loading">
        <div className="sh-profile-state">Loading profile…</div>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="sh-profile-page">
        <div className="sh-profile-state">
          Please log in to view your profile.
        </div>
      </main>
    );
  }

  if (!userData) {
    return (
      <main className="sh-profile-page">
        <div className="sh-profile-state">
          Your profile could not be found.
          {error && <p>{error}</p>}
          <button
            type="button"
            className="sh-button"
            onClick={() => void loadProfile()}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="sh-profile-page">
      <section className="sh-profile-card">
        <div
          className="sh-profile-banner"
          style={
            bannerImageUri && !bannerImageUri.includes('video/')
              ? {
                  backgroundImage:
                    `linear-gradient(180deg, transparent, #00000099), url("${bannerImageUri}")`,
                }
              : undefined
          }
        >
          {bannerImageUri && bannerImageUri.includes('video/') ? (
            <video
              className="sh-banner-video"
              src={bannerImageUri}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : !bannerImageUri ? (
            <div className="sh-banner-glow" />
          ) : null}

          {(assetLoading || (assetError && !showAssetError)) && (
            <span className="sh-asset-status">Loading images…</span>
          )}

          {/* Root-style Banner Pencil Edit Button (Only visible in editing mode; settings gear hidden in editing mode) */}
          <div className="sh-banner-edit-overlay">
            {isEditing ? (
              <button
                type="button"
                className="sh-banner-edit-btn"
                title="Change banner"
                aria-label="Change banner"
                onClick={() => bannerInputRef.current?.click()}
              >
                <Pencil size={18} />
              </button>
            ) : (
              <button
                type="button"
                className="sh-banner-settings-button"
                title="Settings"
                aria-label="Settings"
                onClick={() =>
                  setError(
                    'Settings are not connected to this profile screen yet.',
                  )
                }
              >
                ⚙
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="sh-profile-alert" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {assetError && showAssetError && (
          <div className="sh-profile-alert" role="alert">
            <span>{assetError}</span>

            <div className="sh-drive-recovery-actions">
              <button
                type="button"
                className="sh-button sh-button-muted"
                disabled={assetLoading}
                onClick={() => setRetryAssets((value) => value + 1)}
              >
                {assetLoading ? 'Retrying…' : 'Retry images'}
              </button>

              <button
                type="button"
                className="sh-button"
                disabled={!drive.isReady || drive.isConnecting}
                onClick={async () => {
                  try {
                    const token = await drive.connectDrive(true);

                    if (token) {
                      setAssetError('');
                      setRetryAssets((value) => value + 1);
                    } else {
                      setAssetError(
                        'Google account selection was cancelled. Please try again.',
                      );
                    }
                  } catch (e) {
                    console.error('[PROFILE] Drive account switch failed:', e);
                    setAssetError(messageOf(e));
                  }
                }}
              >
                {drive.isConnecting
                  ? 'Connecting…'
                  : 'Switch Google account'}
              </button>
            </div>
          </div>
        )}

        <div className="sh-profile-identity">
          <div className="sh-avatar-thought-row">
            <div className="sh-avatar-wrap">
              {assetLoading && !profileImageUri ? (
                <div className="sh-avatar sh-avatar-skeleton" />
              ) : profileImageUri && profileImageUri.includes('video/') ? (
                <video
                  className="sh-avatar-video"
                  src={profileImageUri}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : profileImageUri ? (
                <img
                  className="sh-avatar"
                  src={profileImageUri}
                  alt="Profile"
                  loading="eager"
                  decoding="async"
                  onError={() => {
                    console.error(
                      '[PROFILE IMAGE] Browser could not render the profile image.',
                    );
                    setProfileImageUri('');
                  }}
                />
              ) : (
                <div className="sh-avatar sh-avatar-fallback">
                  {String(userData.displayName ?? '?')
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}

              {/* Root-style Avatar Pencil Edit Button (Only visible in editing mode, placed cleanly on the avatar) */}
              {isEditing && (
                <button
                  type="button"
                  className="sh-avatar-edit-overlay"
                  onClick={() => avatarInputRef.current?.click()}
                  title="Change avatar"
                  aria-label="Change avatar"
                >
                  <div className="sh-avatar-edit-btn">
                    <Pencil size={16} />
                  </div>
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="sh-profile-bubble sh-bubble-editing">
                {!editForm.bubleText && <Plus size={16} aria-hidden="true" />}
                <input
                  className="sh-bubble-input"
                  aria-label="Thought"
                  placeholder="Add thought"
                  maxLength={100}
                  value={editForm.bubleText}
                  onChange={(e) =>
                    setEditForm((v) => ({
                      ...v,
                      bubleText: e.target.value.replace(/^\+\s*/, ''),
                    }))
                  }
                />
              </div>
            ) : userData.bubleText ? (
              <div className="sh-profile-bubble">
                {String(userData.bubleText).replace(/^\+\s*/, '')}
              </div>
            ) : (
              <button
                type="button"
                className="sh-profile-bubble sh-bubble-add"
                onClick={() => {
                  setError('');
                  setIsEditing(true);
                }}
              >
                <Plus size={16} aria-hidden="true" />
                <span>Add thought</span>
              </button>
            )}
          </div>

          <div className="sh-identity-copy">
            <h2>{userData.displayName || 'Shinzi User'}</h2>
            <p className="sh-username">
              @{userData.username || 'username'}
            </p>
            {userData.pronouns && (
              <p className="sh-pronouns">
                {String(userData.pronouns)}
              </p>
            )}
          </div>
        </div>

        {!isEditing && (
          <div className="sh-profile-edit-action">
            <button
              type="button"
              className="sh-profile-edit-button"
              onClick={() => {
                setError('');
                setIsEditing(true);
              }}
            >
              <Pencil size={15} aria-hidden="true" />
              <span>Edit Profile</span>
            </button>
          </div>
        )}
     

        {isEditing ? (
          <section className="sh-edit-panel">
            <label>
              Display name
              <input
                maxLength={50}
                value={editForm.displayName}
                onChange={(e) =>
                  setEditForm((v) => ({
                    ...v,
                    displayName: e.target.value,
                  }))
                }
              />
            </label>

            <label>
              Username
              <input
                maxLength={15}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={editForm.username}
                onChange={(e) =>
                  setEditForm((v) => ({
                    ...v,
                    username: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, ''),
                  }))
                }
              />
              <small>
                3–15 lowercase letters, numbers, or underscores.
                Username changes are limited to once every 30 days.
              </small>
            </label>

            <label>
              Bio
              <textarea
                maxLength={300}
                rows={3}
                value={editForm.bio}
                onChange={(e) =>
                  setEditForm((v) => ({
                    ...v,
                    bio: e.target.value,
                  }))
                }
              />
            </label>

                        <label>
              Pronouns
              <input
                maxLength={20}
                placeholder="Add your pronouns"
                value={editForm.pronouns}
                onChange={(e) =>
                  setEditForm((v) => ({ ...v, pronouns: e.target.value }))
                }
              />
            </label>
              

            <div className="sh-edit-actions">
              <button
                type="button"
                className="sh-button sh-button-muted"
                disabled={saving}
                onClick={cancelEditing}
              >
                Cancel
              </button>

              <button
                type="button"
                className={`sh-button ${!hasChanges || saving ? 'sh-button-disabled' : ''}`}
                disabled={!hasChanges || saving}
                onClick={() => {
                  if (!hasChanges || saving) return;
                  void saveProfile();
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <p className="sh-muted-note">
              Profile image and banner editing are not available in
              this form yet.
            </p>
          </section>
        ) : (
              <div className="sh-profile-content">
                <div className="sh-profile-info-card">
                  {userData.bio ? (
                    <div className="sh-info-card-section">
                      <h3 className="sh-info-card-label">Bio</h3>
                      <p className="sh-bio-text">{userData.bio}</p>
                    </div>
                  ) : null}

                  <div className="sh-info-card-section">
                    <h3 className="sh-info-card-label">Joined Shinzi</h3>
                    <p className="sh-joined-text">
                      {dateLabel(userData.createdAt || currentUser?.metadata?.creationTime)}
                    </p>
                  </div>
                </div>
              </div>
        )}
      </section>

      <nav className="sh-profile-bottom-nav" aria-label="Main navigation">
        <button
          type="button"
          onClick={() => setError('AI is not connected yet.')}
          aria-label="AI"
        >
          <Sparkles size={22} />
        </button>

        <button
          type="button"
          onClick={() => setError('Servers are not connected yet.')}
          aria-label="Servers"
        >
          <Server size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            navigateTo('/chat');
          }}
          aria-label="Chat"
        >
          <MessageCircle size={23} />
        </button>

        <button
          type="button"
          onClick={() => {
            navigateTo('/chat?screen=search');
          }}
          aria-label="Search"
        >
          <Search size={22} />
        </button>

        <button
          type="button"
          className="sh-bottom-active shc-bottom-profile-btn"
          aria-label="Profile"
        >
          {assetLoading && !profileImageUri ? (
            <div className="shc-avatar shc-avatar-nav shc-avatar-skeleton" />
          ) : profileImageUri ? (
            <img
              src={profileImageUri}
              alt="Profile"
              className="shc-avatar-nav"
            />
          ) : (
            <div className="shc-avatar shc-avatar-nav">
              <span>
                {String(userData?.displayName ?? '?')
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
            </div>
          )}
        </button>
      </nav>

      {/* Hidden file inputs for avatar & banner selection */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
        style={{ display: 'none' }}
        onChange={(e) => void handleMediaFileSelect(e, 'avatar')}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
        style={{ display: 'none' }}
        onChange={(e) => void handleMediaFileSelect(e, 'banner')}
      />

      {/* Loading overlay during Drive upload */}
      {mediaUploadLoading && (
        <div className="sh-media-upload-progress">
          <span className="shc-spinner" />
          <span>{mediaUploadStatus || 'Uploading media…'}</span>
        </div>
      )}

      {/* Discord/Root-style Drag & Zoom Cropper Modal */}
      {cropModalData && (
        <MediaCropModal
          imageSrc={cropModalData.imageSrc}
          cropShape={cropModalData.type === 'avatar' ? 'round' : 'rect'}
          aspect={cropModalData.type === 'avatar' ? 1 : 16 / 9}
          title={cropModalData.type === 'avatar' ? 'Edit Avatar' : 'Edit Banner'}
          onConfirm={({ file, dataUri }) => {
            void uploadMediaFile(file, cropModalData.type, dataUri);
          }}
          onCancel={() => setCropModalData(null)}
        />
      )}
    </main>
  );
}
