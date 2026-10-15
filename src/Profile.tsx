
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import { useDriveStore } from './driveStore';
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

function pronouns(gender: string): string {
  if (gender?.toLowerCase() === 'male') return 'He/Him';
  if (gender?.toLowerCase() === 'female') return 'She/Her';

  return '';
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function Profile() {
  const drive = useDriveStore();
  const currentUser = auth.currentUser;

  const [userData, setUserData] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetLoading, setAssetLoading] = useState(false);
  const [profileImageUri, setProfileImageUri] = useState('');
  const [bannerImageUri, setBannerImageUri] = useState('');
  const [activeTab, setActiveTab] = useState<ProfileTab>('Personal');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [editForm, setEditForm] = useState({
    displayName: '',
    username: '',
    bio: '',
    bubleText: '',
  });

  const loadProfile = useCallback(async () => {
    if (!currentUser) {
      setUserData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const snap = await getDoc(
        doc(db, 'users', currentUser.uid)
      );

      if (!snap.exists()) {
        setUserData(null);
        return;
      }

      const data = snap.data() as AnyRecord;

      setUserData(data);

      setEditForm({
        displayName: String(data.displayName ?? ''),
        username: String(data.username ?? ''),
        bio: String(data.bio ?? ''),
        bubleText: String(data.bubleText ?? ''),
      });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      if (!userData) {
        setProfileImageUri('');
        setBannerImageUri('');
        setAssetLoading(false);
        return;
      }

      setAssetLoading(true);

      const avatar = String(userData.photoURL ?? '');
      const banner = String(userData.bannerUrl ?? '');

      const loadAsset = async (
        assetId: unknown
      ): Promise<string> => {
        if (typeof assetId !== 'string' || !assetId) {
          return '';
        }

        try {
          const snap = await getDoc(
            doc(db, 'assets', assetId)
          );

          if (!snap.exists()) return '';

          const asset = snap.data() as AnyRecord;

          if (
            asset.status !== 'active' ||
            asset.provider !== 'google_drive' ||
            !asset.providerFileId
          ) {
            return '';
          }

          // Never open Google consent automatically when
          // the profile page renders.
          if (!drive.hasActiveSession) return '';

          if (
            asset.mimeType &&
            !String(asset.mimeType).startsWith('image/')
          ) {
            return '';
          }

          return await drive.getFileDataUri(
            String(asset.providerFileId)
          );
        } catch (e) {
          console.warn('Unable to load profile asset:', e);
          return '';
        }
      };

      try {
        const [avatarUri, bannerUri] = await Promise.all([
          loadAsset(userData.profileAssetId),
          loadAsset(userData.bannerAssetId),
        ]);

        if (!cancelled) {
          setProfileImageUri(avatarUri || avatar);
          setBannerImageUri(bannerUri || banner);
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
    userData,
    drive.hasActiveSession,
    drive.getFileDataUri,
  ]);

  const stats = useMemo(
    () => ({
      friendsCount: Number(
        userData?.socialStats?.friendsCount ?? 0
      ),
      followersCount: Number(
        userData?.socialStats?.followersCount ?? 0
      ),
      mutualFriends: Number(
        userData?.socialStats?.mutualFriends ?? 0
      ),
      mutualServers: Number(
        userData?.socialStats?.mutualServers ?? 0
      ),
      serversJoined: Number(
        userData?.socialStats?.serversJoined ?? 0
      ),
    }),
    [userData]
  );

  const saveProfile = async () => {
    if (!currentUser || !userData || saving) return;

    const displayName = editForm.displayName.trim();
    const username = editForm.username.trim().toLowerCase();

    if (!displayName) {
      setError('Display name cannot be empty.');
      return;
    }

    if (!usernamePattern.test(username)) {
      setError(
        'Username must be 3–15 characters using lowercase letters, numbers, or underscores.'
      );
      return;
    }

    setSaving(true);
    setError('');

    try {
      const userRef = doc(db, 'users', currentUser.uid);

      const oldUsername = String(
        userData.username ?? ''
      ).toLowerCase();

      const usernameChanged = username !== oldUsername;
      const batch = writeBatch(db);

      const updates: AnyRecord = {
        displayName,
        bio: editForm.bio.trim().slice(0, 300),
        bubleText: editForm.bubleText.trim().slice(0, 100),
        updatedAt: serverTimestamp(),
      };

      if (usernameChanged) {
        const lastChanged = dateValue(
          userData.usernameLastChanged
        );

        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        if (
          lastChanged &&
          Date.now() - lastChanged.getTime() < thirtyDays
        ) {
          const daysLeft = Math.ceil(
            (
              thirtyDays -
              (Date.now() - lastChanged.getTime())
            ) /
              (24 * 60 * 60 * 1000)
          );

          throw new Error(
            `You can change your username again in about ${daysLeft} day(s).`
          );
        }

        const newUsernameRef = doc(
          db,
          'usernames',
          username
        );

        const newUsernameSnap = await getDoc(
          newUsernameRef
        );

        if (
          newUsernameSnap.exists() &&
          newUsernameSnap.data().uid !== currentUser.uid
        ) {
          throw new Error('That username is already taken.');
        }

        if (oldUsername) {
          batch.delete(
            doc(db, 'usernames', oldUsername)
          );
        }

        batch.set(newUsernameRef, {
          uid: currentUser.uid,
          username,
          updatedAt: serverTimestamp(),
        });

        updates.username = username;
        updates.usernameLastChanged = serverTimestamp();
      }

      batch.update(userRef, updates);

      await batch.commit();

      setIsEditing(false);

      await loadProfile();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="sh-profile-page">
        <div className="sh-profile-state">
          Loading profile…
        </div>
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
      <header className="sh-profile-topbar">
        <button
          className="sh-icon-button"
          onClick={() => window.history.back()}
          aria-label="Go back"
        >
          ←
        </button>

        <h1>Profile</h1>

        <div className="sh-top-actions">
          {isEditing ? (
            <button
              className="sh-icon-button sh-accent"
              disabled={saving}
              onClick={() => void saveProfile()}
              aria-label="Save profile"
            >
              ✓
            </button>
          ) : (
            <button
              className="sh-icon-button sh-accent"
              onClick={() => {
                setError('');
                setIsEditing(true);
              }}
              aria-label="Edit profile"
            >
              ✎
            </button>
          )}

          <button
            className="sh-icon-button"
            title="Settings"
            onClick={() =>
              setError(
                'Settings are not connected to this profile screen yet.'
              )
            }
          >
            ⚙
          </button>
        </div>
      </header>

      {error && (
        <div className="sh-profile-alert" role="alert">
          <span>{error}</span>

          <button
            onClick={() => setError('')}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <section className="sh-profile-card">
        <div
          className="sh-profile-banner"
          style={
            bannerImageUri
              ? {
                  backgroundImage:
                    `linear-gradient(180deg, transparent, #09090f99), url("${bannerImageUri}")`,
                }
              : undefined
          }
        >
          {!bannerImageUri && (
            <div className="sh-banner-glow" />
          )}

          {assetLoading && (
            <span className="sh-asset-status">
              Loading images…
            </span>
          )}
        </div>

        <div className="sh-profile-identity">
          <div className="sh-avatar-wrap">
            {profileImageUri ? (
              <img
                className="sh-avatar"
                src={profileImageUri}
                alt="Profile"
              />
            ) : (
              <div className="sh-avatar sh-avatar-fallback">
                {String(
                  userData.displayName ?? '?'
                )
                  .slice(0, 1)
                  .toUpperCase()}
              </div>
            )}
          </div>

          <div className="sh-identity-copy">
            <h2>
              {userData.displayName || 'Shinzi User'}{' '}
              <span className="sh-beta-badge">
                BETA
              </span>
            </h2>

            <p className="sh-username">
              @{userData.username || 'username'}
            </p>

            <p className="sh-pronouns">
              {pronouns(String(userData.gender ?? ''))}
            </p>
          </div>
        </div>

        {userData.bubleText && (
          <div className="sh-profile-bubble">
            {String(userData.bubleText)}
          </div>
        )}

        {isEditing ? (
          <section className="sh-edit-panel">
            <label>
              Display name

              <input
                maxLength={40}
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
                3–15 lowercase letters, numbers, or
                underscores. Username changes are limited
                to once every 30 days.
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
              Profile bubble

              <input
                maxLength={100}
                value={editForm.bubleText}
                onChange={(e) =>
                  setEditForm((v) => ({
                    ...v,
                    bubleText: e.target.value,
                  }))
                }
              />
            </label>

            <div className="sh-edit-actions">
              <button
                className="sh-button sh-button-muted"
                onClick={() => {
                  setIsEditing(false);
                  setError('');
                }}
              >
                Cancel
              </button>

              <button
                className="sh-button"
                disabled={saving}
                onClick={() => void saveProfile()}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <p className="sh-muted-note">
              Profile image, banner, and visual style
              syncing are not edited here. No fake upload
              action is shown.
            </p>
          </section>
        ) : (
          <>
            <nav
              className="sh-profile-tabs"
              aria-label="Profile sections"
            >
              <button
                className={
                  activeTab === 'Personal' ? 'active' : ''
                }
                onClick={() => setActiveTab('Personal')}
              >
                Personal
              </button>

              <button
                className={
                  activeTab === 'Social' ? 'active' : ''
                }
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
                                background:
                                  item.color || '#4DA8DA',
                              }}
                            >
                              {String(
                                item.iconName ?? '•'
                              )
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
                                {item.handle ||
                                  'No handle provided'}{' '}

                                {item.verified && (
                                  <span className="sh-verified">
                                    ✓ verified
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        )
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
                <h3>Social stats</h3>

                <div className="sh-stats-grid">
                  {Object.entries({
                    Friends: stats.friendsCount,
                    Followers: stats.followersCount,
                    'Mutual friends': stats.mutualFriends,
                    'Mutual servers': stats.mutualServers,
                    'Servers joined': stats.serversJoined,
                  }).map(([label, value]) => (
                    <div
                      className="sh-stat-tile"
                      key={label}
                    >
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {!drive.hasActiveSession && (
        <div className="sh-drive-note">
          <div>
            <strong>Private profile images</strong>

            <p>
              Connect Google Drive to load profile/banner
              images stored in your private Drive.
            </p>
          </div>

          <button
            className="sh-button"
            disabled={!drive.isReady || drive.isConnecting}
            onClick={async () => {
              const token = await drive.connectDrive();

              if (token) {
                await loadProfile();
              } else {
                setError(
                  'Google Drive connection was cancelled or could not be completed.'
                );
              }
            }}
          >
            {drive.isConnecting
              ? 'Connecting…'
              : drive.isReady
                ? 'Connect Drive'
                : 'Loading Google…'}
          </button>
        </div>
      )}
    </main>
  );
}
