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
import { useDriveStore, type DriveFolderType } from './driveStore';
import MediaCropModal from './MediaCropModal';
import Settings from './Settings';
import {
  getCachedProfile,
  setCachedProfile,
  invalidateCachedProfile,
  getCachedAssetMeta,
  setCachedAssetMeta,
  navigateTo,
} from './profileCache';
import { updateUserPresence, type OnlineStatusMode } from './presenceService';
import { applyTextStyles, validateTextStyleSyntax, renderStyledContent } from './textStyleService';
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

function isMediaVideo(url?: string | null): boolean {
  if (!url) return false;
  const decoded = decodeURIComponent(url).toLowerCase();
  return (
    decoded.includes('video/') ||
    decoded.includes('.mp4') ||
    decoded.includes('.webm') ||
    decoded.includes('mime=video') ||
    decoded.includes('ext=mp4')
  );
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
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Online / DND / Ghost Status System (Discord style)

  const [statusMode, setStatusMode] = useState<OnlineStatusMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('shinzi_status_mode') as OnlineStatusMode;
      if (saved === 'online' || saved === 'dnd' || saved === 'ghost') return saved;
    }
    const user = auth.currentUser;
    const cached = user ? getCachedProfile(user.uid) : null;
    if (cached?.onlineStatusMode) return cached.onlineStatusMode as OnlineStatusMode;
    return 'online';
  });

  const [showStatusSheet, setShowStatusSheet] = useState(false);

  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Compute effective visual status:
  // If user explicitly chose 'dnd' -> always red Do Not Disturb block
  // If user explicitly chose 'ghost' -> always gray Ghost icon
  // If user chose 'online' -> green when online, gray when browser goes offline
  const effectiveStatus: 'online' | 'offline' | 'dnd' | 'ghost' =
    statusMode === 'dnd'
      ? 'dnd'
      : statusMode === 'ghost'
      ? 'ghost'
      : isBrowserOnline
      ? 'online'
      : 'offline';

  const handleSelectStatus = async (newMode: OnlineStatusMode) => {
    setStatusMode(newMode);
    try {
      localStorage.setItem('shinzi_status_mode', newMode);
    } catch {}
    setShowStatusSheet(false);

    if (currentUser?.uid) {
      try {
        await updateUserPresence(currentUser.uid, isBrowserOnline, newMode);
        const cached = getCachedProfile(currentUser.uid) || {};
        setCachedProfile(currentUser.uid, {
          ...cached,
          onlineStatusMode: newMode,
        });
      } catch (err) {
        console.warn('Could not update status mode in Firestore:', err);
      }
    }
  };

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
      if (fallbackAvatar) setProfileImageUri(fallbackAvatar);
      if (fallbackBanner) setBannerImageUri(fallbackBanner);

      const profileAssetId = userData.profileAssetId;
      const bannerAssetId = userData.bannerAssetId;

      if (!profileAssetId && !bannerAssetId) {
        setProfileImageUri(fallbackAvatar);
        setBannerImageUri(fallbackBanner);
        setAssetLoading(false);
        return;
      }

      // Only show loading placeholder if there is no image at all yet
      if (!fallbackAvatar && profileAssetId) {
        setAssetLoading(true);
      }

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

          if (
            (asset.mimeType && String(asset.mimeType).startsWith('video/')) ||
            isMediaVideo(asset.mediaUrl) ||
            isMediaVideo(asset.fileName)
          ) {
            console.info('[PROFILE IMAGE] Video assets are deprecated and disabled.');
            return '';
          }

          if (asset.mediaUrl && typeof asset.mediaUrl === 'string') {
            return asset.mediaUrl;
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

    const syntaxCheck = validateTextStyleSyntax(displayName);
    if (!syntaxCheck.isValid) {
      setError(syntaxCheck.error || 'Name is unsupported. Please enter a space, e.g. (ts ashetic)');
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

      const finalDisplayName = applyTextStyles(displayName);

      const updates: AnyRecord = {
        displayName: finalDisplayName,
        bio: editForm.bio.trim().slice(0, 300),
        bubleText: editForm.bubleText.trim().replace(/^\+\s*/, '').slice(0, 100),
        pronouns: editForm.pronouns.trim().slice(0, 20),
        updatedAt: serverTimestamp(),
      };

      if (usernameChanged) {
        const lastChanged = dateValue(userData.usernameLastChanged);
        const twoDays = 2 * 24 * 60 * 60 * 1000;

        if (
          lastChanged &&
          Date.now() - lastChanged.getTime() < twoDays
        ) {
          const daysLeft = Math.ceil(
            (twoDays - (Date.now() - lastChanged.getTime())) /
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


  // Handle selected file from input (Avatar or Banner)
  const handleMediaFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'avatar' | 'banner'
  ) => {
    const rawFile = e.target.files?.[0];
    e.target.value = '';
    if (!rawFile || !currentUser) return;

    // Immediately copy the picked file into memory so Android Chrome never revokes permissions
    let file: File;
    try {
      const buffer = await rawFile.arrayBuffer();
      file = new File([buffer], rawFile.name, {
        type: rawFile.type || 'application/octet-stream',
        lastModified: rawFile.lastModified || Date.now(),
      });
    } catch (readErr) {
      console.warn('[handleMediaFileSelect] Direct buffer read failed, using raw handle:', readErr);
      file = rawFile;
    }

    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
    const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);

    if (isVideo) {
      setError('Videos are not supported. Please choose an image (PNG, JPG, WebP) or animated GIF (up to 10MB).');
      return;
    }

    if (!isImage && !isGif) {
      setError('Please choose an image (PNG, JPG, WebP) or animated GIF.');
      return;
    }

    // GIF selected: upload directly to keep all animated frames and timing intact!
    if (isGif) {
      if (file.size > 10 * 1024 * 1024) {
        setError('GIFs must be under 10MB.');
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      await uploadMediaFile(file, type, previewUrl);
      return;
    }

    // Static image selected (PNG, JPG, WebP): open interactive crop modal
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
      // 1. File size check
      if (file.size > 10 * 1024 * 1024) {
        throw new Error(`[File Size] File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed is 10MB.`);
      }

      // 2. Note old asset and Drive file ID before proceeding
      const isBanner = type === 'banner';
      const folderType: DriveFolderType = isBanner ? 'banners' : 'profiles';
      const oldDriveFileId = isBanner
        ? ((userData as any)?.bannerDriveFileId || null)
        : ((userData as any)?.avatarDriveFileId || null);

      // 3. Drive session check
      setMediaUploadStatus(`Connecting Google Drive…`);
      const hasSession = drive.hasActiveSession || (await drive.getValidAccessToken());
      if (!hasSession) {
        const token = await drive.connectDrive(false);
        if (!token) {
          throw new Error('[Drive Auth] Google Drive authorization required.');
        }
      }

      const isGifFile = file.type === 'image/gif' || /\.gif$/i.test(file.name);
      const fileMime = file.type || (
        isGifFile ? 'image/gif' :
        file.name.endsWith('.png') ? 'image/png' :
        file.name.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
      );

      // 4. Resumable chunked upload directly to Google Drive (with Drive offset recovery)
      setMediaUploadStatus(`Uploading ${type} to Google Drive…`);
      const uploadedFile = await drive.uploadFile({
        file,
        fileName: file.name,
        mimeType: fileMime,
        folderType,
      });

      if (!uploadedFile?.fileId) {
        throw new Error('[Drive Upload] Google Drive upload completed without returning a file ID.');
      }

      // 5. Update profile and save asset record via serverless API
      setMediaUploadStatus(`Saving profile metadata…`);
      const assetId = `ast_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const idToken = await currentUser.getIdToken();
      const apiRes = await fetch('/api/update-profile-media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          type,
          assetId,
          providerFileId: uploadedFile.fileId,
          driveFolderId: uploadedFile.folderId,
          fileName: file.name,
          mimeType: fileMime,
          sizeBytes: uploadedFile.sizeBytes || file.size,
          dataUriPreview:
            dataUriPreview && dataUriPreview.length < 500000
              ? dataUriPreview
              : undefined,
        }),
      });

      if (!apiRes.ok) {
        const errorText = await apiRes.text().catch(() => '');
        throw new Error(`[Metadata API] Server returned status ${apiRes.status}: ${errorText || 'Failed to save media metadata.'}`);
      }

      const resData = await apiRes.json();
      if (!resData.ok) {
        throw new Error(`[Metadata API] Failed to save media metadata: ${resData.error || 'Unknown error'}`);
      }

      // 6. Update state for instant view with cache-busting asset ID
      let finalUrl = resData.mediaUrl || dataUriPreview || `https://lh3.googleusercontent.com/d/${uploadedFile.fileId}=s800`;
      const cacheBustSep = finalUrl.includes('?') ? '&' : '?';
      const cacheBustedUrl = `${finalUrl}${cacheBustSep}v=${assetId}`;

      if (type === 'banner') {
        setBannerImageUri(cacheBustedUrl);
      } else {
        setProfileImageUri(cacheBustedUrl);
      }

      // Invalidate caches so Chat and other views immediately see new photo
      invalidateCachedProfile(currentUser.uid);
      if (typeof window !== 'undefined') {
        try {
          if (type === 'avatar') {
            localStorage.setItem(`shinzi_avatar_${currentUser.uid}`, finalUrl);
          }
          sessionStorage.removeItem(`shinzi_profile_${currentUser.uid}`);
        } catch {}
      }

      await loadProfile();

      // 7. Delete old Drive file only after metadata API confirms the new image
      const fileIdToDelete = resData.oldDriveFileId || oldDriveFileId;
      if (fileIdToDelete && fileIdToDelete !== uploadedFile.fileId) {
        try {
          await drive.deleteFile(fileIdToDelete);
        } catch (delErr) {
          console.warn('[PROFILE] Old Drive file delete failed:', delErr);
        }
      }

      // Background cleanup pass for any orphaned files in this folder
      drive.cleanOldFiles(folderType, uploadedFile.fileId).catch((cleanErr) => {
        console.warn('[PROFILE] Background cleanOldFiles error:', cleanErr);
      });

    } catch (uploadErr) {
      console.error('[PROFILE] Media upload failed:', uploadErr);
      setError(messageOf(uploadErr));
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
            bannerImageUri && !isMediaVideo(bannerImageUri)
              ? {
                  backgroundImage:
                    `linear-gradient(180deg, transparent, #00000099), url("${bannerImageUri}")`,
                }
              : undefined
          }
        >
          {(!bannerImageUri || isMediaVideo(bannerImageUri)) && (
            <div className="sh-banner-glow" />
          )}

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
                onClick={() => setShowSettings(true)}
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
            <div
              className="sh-avatar-wrap"
              onClick={() => {
                if (!isEditing) {
                  setShowStatusSheet(true);
                }
              }}
              style={{ cursor: isEditing ? 'default' : 'pointer' }}
              title={isEditing ? 'Edit Profile' : 'Change Online Status'}
            >
              {assetLoading && !profileImageUri ? (
                <div className="sh-avatar sh-avatar-skeleton" />
              ) : profileImageUri && !isMediaVideo(profileImageUri) ? (
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

              {/* Status Badge (Online green, DND red block, Ghost gray) */}
              <div
                className={`sh-status-badge sh-status-${effectiveStatus}`}
                title={`Status: ${effectiveStatus === 'dnd' ? 'Do Not Disturb' : effectiveStatus === 'ghost' ? 'Ghost' : effectiveStatus}`}
              >
                {effectiveStatus === 'dnd' && <div className="sh-status-dnd-bar" />}
              </div>

              {/* Root-style Avatar Pencil Edit Button (Only visible in editing mode, placed cleanly on the avatar) */}
              {isEditing && (
                <button
                  type="button"
                  className="sh-avatar-edit-overlay"
                  onClick={(e) => {
                    e.stopPropagation();
                    avatarInputRef.current?.click();
                  }}
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
            <h2>{renderStyledContent(userData.displayName || 'Shinzi User')}</h2>
            <p className="sh-username">
              {userData.username || 'username'}
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
                Username can be changed up to 2 days per change.
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
          onClick={() => {
            navigateTo('/servers');
          }}
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
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {assetLoading && !profileImageUri ? (
              <div className="shc-avatar shc-avatar-nav shc-avatar-skeleton" />
            ) : profileImageUri && !isMediaVideo(profileImageUri) ? (
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
          </div>
        </button>
      </nav>

      {/* Hidden file inputs for avatar & banner selection (Images and GIFs only) */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => void handleMediaFileSelect(e, 'avatar')}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
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

      {/* Discord-style Drag & Zoom Cropper Modal with Box Scaler & 3x3 Grid */}
      {cropModalData && (
        <MediaCropModal
          imageSrc={cropModalData.imageSrc}
          cropShape="rect"
          aspect={cropModalData.type === 'avatar' ? 1 : 16 / 9}
          title={cropModalData.type === 'avatar' ? 'Edit Image' : 'Edit Banner'}
          onConfirm={({ file, dataUri }) => {
            void uploadMediaFile(file, cropModalData.type, dataUri);
          }}
          onCancel={() => setCropModalData(null)}
        />
      )}

      {showSettings && (
        <Settings onBack={() => setShowSettings(false)} />
      )}

      {/* Change Online Status Bottom Sheet (IMG-20261110-WA0003.jpg) */}
      {showStatusSheet && (
        <div
          className="sh-status-sheet-overlay"
          onClick={() => setShowStatusSheet(false)}
        >
          <div
            className="sh-status-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sh-status-sheet-handle" />
            <h3 className="sh-status-sheet-title">Change Online Status</h3>

            <div className="sh-status-sheet-section">Online Status</div>

            <div className="sh-status-options-card">
              {/* Online Mode */}
              <div
                className={`sh-status-option ${statusMode === 'online' ? 'sh-status-option-selected' : ''}`}
                onClick={() => handleSelectStatus('online')}
              >
                <div className="sh-status-option-left">
                  <span className="sh-status-dot-green" />
                  <span className="sh-status-option-name">Online</span>
                </div>
                <div className="sh-status-radio">
                  {statusMode === 'online' && <div className="sh-status-radio-inner" />}
                </div>
              </div>

              {/* Do Not Disturb Mode */}
              <div
                className={`sh-status-option ${statusMode === 'dnd' ? 'sh-status-option-selected' : ''}`}
                onClick={() => handleSelectStatus('dnd')}
              >
                <div className="sh-status-option-left">
                  <div className="sh-status-dot-dnd">
                    <span className="sh-status-dot-dnd-bar" />
                  </div>
                  <span className="sh-status-option-name">Do Not Disturb</span>
                </div>
                <div className="sh-status-radio">
                  {statusMode === 'dnd' && <div className="sh-status-radio-inner" />}
                </div>
              </div>

              {/* Ghost Mode (Invisible) */}
              <div
                className={`sh-status-option ${statusMode === 'ghost' ? 'sh-status-option-selected' : ''}`}
                onClick={() => handleSelectStatus('ghost')}
              >
                <div className="sh-status-option-left">
                  <span className="sh-status-dot-ghost" />
                  <span className="sh-status-option-name">Ghost</span>
                </div>
                <div className="sh-status-radio">
                  {statusMode === 'ghost' && <div className="sh-status-radio-inner" />}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
