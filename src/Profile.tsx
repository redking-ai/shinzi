import { useCallback, useEffect, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
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
  getCachedProfile,
  setCachedProfile,
  getCachedAssetMeta,
  setCachedAssetMeta,
  navigateTo,
} from './profileCache';
import './Profile.css';

type AnyRecord = Record<string, any>;
type ProfileTab = 'Personal' | 'Social';

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

  return null;
}

function dateLabel(value: any): string {
  const date = dateValue(value);

  return date
    ? date.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : 'A Shinzi member';
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
  const [activeTab, setActiveTab] = useState<ProfileTab>('Personal');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
            !String(asset.mimeType).startsWith('image/')
          ) {
            console.error(
              `[PROFILE IMAGE] ${kind} file is not an image:`,
              asset.mimeType,
            );
            return '';
          }

          const dataUri = await drive.getFileDataUri(
            asset.providerFileId,
          );

          if (!dataUri.startsWith('data:image/')) {
            console.error(
              `[PROFILE IMAGE] ${kind} download did not return an image data URI.`,
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
            bannerImageUri
              ? {
                  backgroundImage:
                    `linear-gradient(180deg, transparent, #08061299), url("${bannerImageUri}")`,
                }
              : undefined
          }
        >
          {!bannerImageUri && <div className="sh-banner-glow" />}

          {(assetLoading || (assetError && !showAssetError)) && (
            <span className="sh-asset-status">Loading images…</span>
          )}

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
          <div className="sh-avatar-wrap">
            {profileImageUri ? (
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
              <Pencil size={20} aria-hidden="true" />
              <span>Edit Profile</span>
            </button>
          </div>
        )}

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
                className="sh-button"
                disabled={saving}
                onClick={() => void saveProfile()}
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
          <>
            <nav
              className="sh-profile-tabs"
              aria-label="Profile sections"
            >
              <button
                type="button"
                className={activeTab === 'Personal' ? 'active' : ''}
                onClick={() => setActiveTab('Personal')}
              >
                Personal
              </button>

              <button
                type="button"
                className={activeTab === 'Social' ? 'active' : ''}
                onClick={() => setActiveTab('Social')}
              >
                Social
              </button>
            </nav>

            {activeTab === 'Personal' ? (
              <div className="sh-profile-content">
                <section className="sh-info-section">
                  <h3>About me</h3>
                  <p className="sh-bio">
                    {userData.bio ||
                      'This user has not added a bio yet.'}
                  </p>
                </section>

                <section className="sh-info-section">
                  <h3>Member since</h3>
                  <p>{dateLabel(userData.createdAt)}</p>
                </section>

                <section className="sh-info-section">
                  <h3>Other platforms</h3>

                  {Array.isArray(userData.otherPlatforms) &&
                  userData.otherPlatforms.length ? (
                    <div className="sh-platform-list">
                      {userData.otherPlatforms.map(
                        (item: AnyRecord, i: number) => (
                          <div
                            className="sh-platform-row"
                            key={`${item.handle ?? 'platform'}-${i}`}
                          >
                            <span
                              className="sh-platform-dot"
                              style={{
                                background: item.color || '#762BFF',
                              }}
                            >
                              {String(item.iconName ?? '•')
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>

                            <div>
                              <strong>
                                {item.platformName ||
                                  item.platform ||
                                  'Platform'}
                              </strong>
                              <p>
                                {item.handle || 'No handle provided'}{' '}
                                {item.verified && (
                                  <span className="sh-verified">
                                    ✓ verified
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="sh-muted-note">
                      No other platforms added.
                    </p>
                  )}
                </section>
              </div>
            ) : (
              <div className="sh-profile-content">
                <section className="sh-info-section">
                  <p className="sh-muted-note">
                    No social statistics to display.
                  </p>
                </section>
              </div>
            )}
          </>
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
          {profileImageUri ? (
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
    </main>
  );
}
