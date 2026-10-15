
import { useCallback, useEffect, useState } from 'react';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from './firebaseConfig';
import { useDriveStore } from './DriveStore';
import './Profile.css';

type AnyRecord = Record<string, any>;
type ProfileTab = 'Personal' | 'Social';

function pronouns(gender: string): string {
  if (gender?.toLowerCase() === 'male') return 'He/Him';
  if (gender?.toLowerCase() === 'female') return 'She/Her';
  return '';
}

function dateLabel(value: any): string {
  if (!value) return 'A Shinzi member';

  const date =
    typeof value.toDate === 'function'
      ? value.toDate()
      : typeof value.seconds === 'number'
        ? new Date(value.seconds * 1000)
        : null;

  return date
    ? date.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : 'A Shinzi member';
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function OtherProfile({
  targetUid: targetUidProp,
  onBack,
}: {
  targetUid?: string;
  onBack?: () => void;
}) {
  const drive = useDriveStore();
  const currentUser = auth.currentUser;

  const targetUid =
    targetUidProp ||
    new URLSearchParams(window.location.search).get('uid') ||
    '';

  const [userData, setUserData] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState('');
  const [banner, setBanner] = useState('');
  const [tab, setTab] = useState<ProfileTab>('Social');
  const [menuOpen, setMenuOpen] = useState(false);

  const [relationship, setRelationship] = useState({
    favourite: false,
    blocked: false,
    muted: false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    if (!targetUid) {
      setError(
        'No profile was selected. Open a profile using /profile?uid=USER_ID.'
      );
      setLoading(false);
      return;
    }

    if (currentUser && targetUid === currentUser.uid) {
      window.location.replace('/profile');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const snap = await getDoc(
        doc(db, 'users', targetUid)
      );

      if (!snap.exists()) {
        setUserData(null);
        setError(
          'This profile does not exist or is not available.'
        );
        return;
      }

      const data = snap.data() as AnyRecord;

      setUserData(data);
      setAvatar(String(data.photoURL ?? ''));
      setBanner(String(data.bannerUrl ?? ''));

      if (currentUser) {
        const [fav, block, mute] = await Promise.all([
          getDoc(
            doc(
              db,
              'users',
              currentUser.uid,
              'favourites',
              targetUid
            )
          ),
          getDoc(
            doc(
              db,
              'users',
              currentUser.uid,
              'blocked',
              targetUid
            )
          ),
          getDoc(
            doc(
              db,
              'users',
              currentUser.uid,
              'muted',
              targetUid
            )
          ),
        ]);

        setRelationship({
          favourite: fav.exists(),
          blocked: block.exists(),
          muted: mute.exists(),
        });
      } else {
        setRelationship({
          favourite: false,
          blocked: false,
          muted: false,
        });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [targetUid, currentUser]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      if (!userData) return;

      const loadAsset = async (
        id: unknown
      ): Promise<string> => {
        if (
          typeof id !== 'string' ||
          !id ||
          !drive.hasActiveSession
        ) {
          return '';
        }

        try {
          const snap = await getDoc(
            doc(db, 'assets', id)
          );

          if (!snap.exists()) return '';

          const data = snap.data() as AnyRecord;

          if (
            data.status !== 'active' ||
            data.provider !== 'google_drive' ||
            !data.providerFileId ||
            (
              data.mimeType &&
              !String(data.mimeType).startsWith('image/')
            )
          ) {
            return '';
          }

          return await drive.getFileDataUri(
            String(data.providerFileId)
          );
        } catch (e) {
          console.warn(
            'Unable to load other profile asset:',
            e
          );
          return '';
        }
      };

      const [avatarUri, bannerUri] = await Promise.all([
        loadAsset(userData.profileAssetId),
        loadAsset(userData.bannerAssetId),
      ]);

      if (!cancelled) {
        if (avatarUri) setAvatar(avatarUri);
        if (bannerUri) setBanner(bannerUri);
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

  const toggleRelationship = async (
    kind: 'favourite' | 'blocked' | 'muted'
  ) => {
    if (!currentUser) {
      setError(
        'Log in to manage favourites, mute, or block.'
      );
      return;
    }

    if (currentUser.uid === targetUid) {
      setError("You can't manage a relationship with yourself.");
      return;
    }

    if (busy) return;

    const collectionName =
      kind === 'favourite'
        ? 'favourites'
        : kind === 'blocked'
          ? 'blocked'
          : 'muted';

    const active = relationship[kind];

    setBusy(true);
    setError('');

    try {
      const relationshipRef = doc(
        db,
        'users',
        currentUser.uid,
        collectionName,
        targetUid
      );

      if (active) {
        await deleteDoc(relationshipRef);
      } else {
        await setDoc(relationshipRef, {
          uid: targetUid,
          createdAt: serverTimestamp(),
        });
      }

      setRelationship((previous) => ({
        ...previous,
        [kind]: !active,
      }));

      setMenuOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (onBack) {
      onBack();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign('/profile');
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

  if (!userData) {
    return (
      <main className="sh-profile-page">
        <header className="sh-profile-topbar">
          <button
            className="sh-icon-button"
            onClick={goBack}
            aria-label="Go back"
          >
            ←
          </button>

          <h1>Profile</h1>
        </header>

        <div className="sh-profile-state">
          {error || 'Profile unavailable.'}

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

  const stats = userData.socialStats ?? {};

  return (
    <main className="sh-profile-page">
      <header className="sh-profile-topbar">
        <button
          className="sh-icon-button"
          onClick={goBack}
          aria-label="Go back"
        >
          ←
        </button>

        <h1>Profile</h1>

        <div className="sh-top-actions">
          <button
            className="sh-icon-button"
            title="More actions"
            aria-label="More profile actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋯
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="sh-profile-menu" role="menu">
          <button
            role="menuitem"
            disabled={busy || !currentUser}
            onClick={() =>
              void toggleRelationship('favourite')
            }
          >
            {relationship.favourite
              ? '★ Remove favourite'
              : '☆ Add to favourites'}
          </button>

          <button
            role="menuitem"
            disabled={busy || !currentUser}
            onClick={() =>
              void toggleRelationship('muted')
            }
          >
            {relationship.muted
              ? 'Unmute user'
              : 'Mute user'}
          </button>

          <button
            role="menuitem"
            className="sh-danger-action"
            disabled={busy || !currentUser}
            onClick={() =>
              void toggleRelationship('blocked')
            }
          >
            {relationship.blocked
              ? 'Unblock user'
              : 'Block user'}
          </button>
        </div>
      )}

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
            banner
              ? {
                  backgroundImage:
                    `linear-gradient(180deg, transparent, #09090f99), url("${banner}")`,
                }
              : undefined
          }
        >
          {!banner && <div className="sh-banner-glow" />}
        </div>

        <div className="sh-profile-identity">
          <div className="sh-avatar-wrap">
            {avatar ? (
              <img
                className="sh-avatar"
                src={avatar}
                alt={`${userData.displayName || 'User'} profile`}
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

        <nav
          className="sh-profile-tabs"
          aria-label="Profile sections"
        >
          <button
            className={tab === 'Personal' ? 'active' : ''}
            onClick={() => setTab('Personal')}
          >
            Personal
          </button>

          <button
            className={tab === 'Social' ? 'active' : ''}
            onClick={() => setTab('Social')}
          >
            Social
          </button>
        </nav>

        {tab === 'Personal' ? (
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
                    (item: AnyRecord, index: number) => (
                      <div
                        className="sh-platform-row"
                        key={`${item.handle ?? 'platform'}-${index}`}
                      >
                        <span
                          className="sh-platform-dot"
                          style={{
                            background:
                              item.color || '#4DA8DA',
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
                Friends: stats.friendsCount ?? 0,
                Followers: stats.followersCount ?? 0,
                'Mutual friends': stats.mutualFriends ?? 0,
                'Mutual servers': stats.mutualServers ?? 0,
                'Servers joined': stats.serversJoined ?? 0,
              }).map(([label, value]) => (
                <div
                  className="sh-stat-tile"
                  key={label}
                >
                  <strong>{Number(value) || 0}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sh-profile-footer-actions">
          <span
            className={
              relationship.favourite ? 'sh-status-on' : ''
            }
          >
            {relationship.favourite ? '★ Favourite' : ''}
          </span>

          <span
            className={
              relationship.muted ? 'sh-status-on' : ''
            }
          >
            {relationship.muted ? 'Muted' : ''}
          </span>

          <span
            className={
              relationship.blocked ? 'sh-status-danger' : ''
            }
          >
            {relationship.blocked ? 'Blocked' : ''}
          </span>
        </div>
      </section>

      {!drive.hasActiveSession && (
        <div className="sh-drive-note">
          <div>
            <strong>Private profile images</strong>

            <p>
              Connect Google Drive to load images stored in
              your private Drive.
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
