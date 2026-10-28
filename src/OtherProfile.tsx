
import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
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
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(
    () => auth.currentUser,
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return unsubscribe;
  }, []);

  const targetUid =
    targetUidProp ||
    new URLSearchParams(window.location.search).get('uid') ||
    '';

  const [userData, setUserData] = useState<AnyRecord | null>(() => {
    return targetUid ? getCachedProfile(targetUid) : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    return targetUid ? !getCachedProfile(targetUid) : true;
  });
  const [avatar, setAvatar] = useState<string>(() => {
    const cached = targetUid ? getCachedProfile(targetUid) : null;
    if (cached?.profileAssetId) {
      const meta = getCachedAssetMeta(cached.profileAssetId);
      if (meta?.providerFileId && typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(`shinzi_drive_${meta.providerFileId}`);
        if (stored) return stored;
      }
    }
    return String(cached?.photoURL ?? '');
  });
  const [banner, setBanner] = useState<string>(() => {
    const cached = targetUid ? getCachedProfile(targetUid) : null;
    if (cached?.bannerAssetId) {
      const meta = getCachedAssetMeta(cached.bannerAssetId);
      if (meta?.providerFileId && typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(`shinzi_drive_${meta.providerFileId}`);
        if (stored) return stored;
      }
    }
    return String(cached?.bannerUrl ?? '');
  });
  const [tab, setTab] = useState<ProfileTab>('Social');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFriend] = useState(false);

  const [mutualFriendsCount, setMutualFriendsCount] = useState<number>(0);
  const [mutualServersCount, setMutualServersCount] = useState<number>(0);
  const [loadingMutuals, setLoadingMutuals] = useState<boolean>(true);

  useEffect(() => {
    if (!currentUser || !targetUid) {
      setMutualFriendsCount(0);
      setMutualServersCount(0);
      setLoadingMutuals(false);
      return;
    }

    let cancelled = false;

    async function computeMutuals() {
      setLoadingMutuals(true);
      try {
        const [myFriendsSnap, targetFriendsSnap] = await Promise.all([
          getDocs(collection(db, 'users', currentUser!.uid, 'friends')).catch(
            () => null,
          ),
          getDocs(collection(db, 'users', targetUid, 'friends')).catch(
            () => null,
          ),
        ]);

        if (cancelled) return;

        let calculatedMutualFriends = 0;
        if (myFriendsSnap && targetFriendsSnap) {
          const myFriendIds = new Set(myFriendsSnap.docs.map((d) => d.id));
          calculatedMutualFriends = targetFriendsSnap.docs.filter((d) =>
            myFriendIds.has(d.id),
          ).length;
        }

        let calculatedMutualServers = 0;
        try {
          const myServersSnap = await getDocs(
            query(
              collection(db, 'servers'),
              where('memberIds', 'array-contains', currentUser!.uid),
            ),
          );
          if (!cancelled && myServersSnap && !myServersSnap.empty) {
            calculatedMutualServers = myServersSnap.docs.filter((docSnap) => {
              const members = docSnap.data()?.memberIds;
              return Array.isArray(members) && members.includes(targetUid);
            }).length;
          }
        } catch {
          calculatedMutualServers = 0;
        }

        if (!cancelled) {
          setMutualFriendsCount(calculatedMutualFriends);
          setMutualServersCount(calculatedMutualServers);
        }
      } finally {
        if (!cancelled) {
          setLoadingMutuals(false);
        }
      }
    }

    void computeMutuals();

    return () => {
      cancelled = true;
    };
  }, [currentUser, targetUid]);

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
      navigateTo('/profile');
      return;
    }

    setLoading((prev) => (getCachedProfile(targetUid) ? false : prev));
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
        setLoading(false);
        return;
      }

      const data = snap.data() as AnyRecord;

      setUserData(data);
      setCachedProfile(targetUid, data);
      setAvatar((prev) => prev || String(data.photoURL ?? ''));
      setBanner((prev) => prev || String(data.bannerUrl ?? ''));
      setLoading(false); // Reveal profile immediately

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
        if (typeof id !== 'string' || !id.trim()) {
          return '';
        }

        const trimmedId = id.trim();

        try {
          let data = getCachedAssetMeta(trimmedId);

          if (!data) {
            const snap = await getDoc(
              doc(db, 'assets', trimmedId)
            );

            if (!snap.exists()) return '';
            data = snap.data() as AnyRecord;
            setCachedAssetMeta(trimmedId, data);
          }

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
    userData?.profileAssetId,
    userData?.bannerAssetId,
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
      navigateTo('/profile');
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
   <div className="sh-other-profile-actions">
  {!isFriend && (
    <button
      type="button"
      className="sh-other-add-friend"
      onClick={() => {
        // Friend request system will be connected later.
        setError('Friend requests are not connected yet.');
      }}
    >
      <span aria-hidden="true"></span>
      Add Friend
    </button>
  )}

  <button
    type="button"
    className="sh-other-action-button"
    onClick={() => {
      setError('Chat will be connected when chat.tsx is ready.');
    }}
  >
    <span aria-hidden="true"></span>
    {!isFriend && <span className="sh-other-action-label">Message</span>}
  </button>

  <button
    type="button"
    className="sh-other-action-button"
    onClick={() => {
      setError('Calling is not connected yet.');
    }}
  >
    <span aria-hidden="true"></span>
    {!isFriend && <span className="sh-other-action-label">Call</span>}
  </button>
</div>

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
                loading="eager"
                decoding="async"
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

            {userData.pronouns && (
  <p className="sh-pronouns">
    {String(userData.pronouns)}
  </p>
)}
          </div>
        </div>

        {userData.bubleText && (
          <div className="sh-profile-bubble">
            {String(userData.bubleText).replace(/^\+\s*/, '')}
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
              <div className="sh-stat-tile">
                <strong>{Number(stats.friendsCount) || 0}</strong>
                <span>Friends</span>
              </div>
              <div className="sh-stat-tile">
                <strong>{Number(stats.followersCount) || 0}</strong>
                <span>Followers</span>
              </div>
              <div className="sh-stat-tile">
                <strong>
                  {loadingMutuals ? '…' : mutualFriendsCount}
                </strong>
                <span>Mutual friends</span>
              </div>
              <div className="sh-stat-tile">
                <strong>
                  {loadingMutuals ? '…' : mutualServersCount}
                </strong>
                <span>Mutual servers</span>
              </div>
              <div className="sh-stat-tile">
                <strong>{Number(stats.serversJoined) || 0}</strong>
                <span>Servers joined</span>
              </div>
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
    </main>
  );
}
