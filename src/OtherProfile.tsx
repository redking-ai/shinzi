
import { useCallback, useEffect, useState } from 'react';
import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { Clock3, Ellipsis, MessageCircle, Phone, UserPlus, UserRound } from 'lucide-react';
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
}: {
  targetUid?: string;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [friendState, setFriendState] = useState({
    friend: false,
    outgoing: false,
    incoming: false,
  });
  const [friendActionBusy, setFriendActionBusy] = useState(false);

  useEffect(() => {
    if (!currentUser || !targetUid || currentUser.uid === targetUid) {
      setFriendState({ friend: false, outgoing: false, incoming: false });
      return undefined;
    }

    const friendRef = doc(db, 'users', currentUser.uid, 'friends', targetUid);
    const outgoingRef = doc(db, 'friendRequests', `${currentUser.uid}_${targetUid}`);
    const incomingRef = doc(db, 'friendRequests', `${targetUid}_${currentUser.uid}`);
    const unsubscribers = [
      onSnapshot(friendRef, (snap) =>
        setFriendState((previous) => ({ ...previous, friend: snap.exists() })),
      ),
      onSnapshot(outgoingRef, (snap) =>
        setFriendState((previous) => ({
          ...previous,
          outgoing: snap.exists() && snap.data()?.status === 'pending',
        })),
      ),
      onSnapshot(incomingRef, (snap) =>
        setFriendState((previous) => ({
          ...previous,
          incoming: snap.exists() && snap.data()?.status === 'pending',
        })),
      ),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
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
        if (avatarUri) {
          setAvatar(avatarUri);
        } else if (targetUid) {
          setAvatar(`/api/avatar?uid=${encodeURIComponent(targetUid)}`);
        }
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

  const sendFriendRequest = async () => {
    if (!currentUser || !userData || friendActionBusy) return;
    setFriendActionBusy(true);
    setError('');
    try {
      const myProfile = getCachedProfile(currentUser.uid);
      await setDoc(doc(db, 'friendRequests', `${currentUser.uid}_${targetUid}`), {
        fromUid: currentUser.uid,
        toUid: targetUid,
        fromProfile: {
          displayName: myProfile?.displayName || currentUser.displayName || 'User',
          username: myProfile?.username || '',
        },
        toProfile: {
          displayName: userData.displayName || userData.username || 'User',
          username: userData.username || '',
        },
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFriendActionBusy(false);
    }
  };

  const acceptIncomingFriendRequest = async () => {
    if (!currentUser || !userData || friendActionBusy) return;
    setFriendActionBusy(true);
    setError('');
    try {
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, 'friendRequests', `${targetUid}_${currentUser.uid}`);
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists() || requestSnap.data()?.status !== 'pending') {
          throw new Error('This friend request is no longer pending.');
        }
        transaction.set(doc(db, 'users', currentUser.uid, 'friends', targetUid), {
          uid: targetUid,
          username: userData.username || '',
          displayName: userData.displayName || userData.username || 'User',
          addedAt: serverTimestamp(),
        }, { merge: true });
        transaction.set(doc(db, 'users', targetUid, 'friends', currentUser.uid), {
          uid: currentUser.uid,
          username: '',
          displayName: currentUser.displayName || 'User',
          addedAt: serverTimestamp(),
        }, { merge: true });
        transaction.update(requestRef, {
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFriendActionBusy(false);
    }
  };

  const openMessage = () => {
    navigateTo(`/chat?user=${encodeURIComponent(targetUid)}`);
  };

  if (loading) {
    return (
      <main className="sh-profile-page sh-other-profile-page">
        <div className="sh-profile-state">
          Loading profile…
        </div>
      </main>
    );
  }

  if (!userData) {
    return (
      <main className="sh-profile-page sh-other-profile-page">
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

  return (
    <main className="sh-profile-page sh-other-profile-page">
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
          <button
            type="button"
            className="sh-banner-settings-button"
            title="More actions"
            aria-label="More profile actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Ellipsis size={22} />
          </button>
        </div>

        {menuOpen && (
          <div className="sh-profile-menu sh-other-profile-menu" role="menu">
            <button role="menuitem" disabled={busy || !currentUser} onClick={() => void toggleRelationship('favourite')}>
              {relationship.favourite ? '★ Remove favourite' : '☆ Add to favourites'}
            </button>
            <button role="menuitem" disabled={busy || !currentUser} onClick={() => void toggleRelationship('muted')}>
              {relationship.muted ? 'Unmute user' : 'Mute user'}
            </button>
            <button role="menuitem" className="sh-danger-action" disabled={busy || !currentUser} onClick={() => void toggleRelationship('blocked')}>
              {relationship.blocked ? 'Unblock user' : 'Block user'}
            </button>
          </div>
        )}

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
              <p className="sh-pronouns">{String(userData.pronouns)}</p>
            )}
          </div>
        </div>

        {userData.bubleText && (
          <div className="sh-profile-bubble">
            {String(userData.bubleText).replace(/^\+\s*/, '')}
          </div>
        )}

        {currentUser?.uid !== targetUid && (
          <div className="sh-other-profile-actions">
            {friendState.friend ? (
              <>
                <button type="button" className="sh-other-action-button" onClick={openMessage}>
                  <MessageCircle size={18} aria-hidden="true" /> Message
                </button>
                <button type="button" className="sh-other-action-button" onClick={() => setError('Calling is not connected yet.')}>
                  <Phone size={18} aria-hidden="true" /> Call
                </button>
              </>
            ) : friendState.outgoing ? (
              <button type="button" className="sh-other-pending-button" disabled>
                <span className="sh-profile-user-clock" aria-hidden="true">
                  <UserRound size={18} />
                  <Clock3 size={9} />
                </span>
                Request Pending
              </button>
            ) : friendState.incoming ? (
              <button type="button" className="sh-other-add-friend" disabled={friendActionBusy} onClick={() => void acceptIncomingFriendRequest()}>
                <UserPlus size={18} aria-hidden="true" /> {friendActionBusy ? 'Accepting…' : 'Accept Request'}
              </button>
            ) : (
              <button type="button" className="sh-other-add-friend" disabled={!currentUser || friendActionBusy} onClick={() => void sendFriendRequest()}>
                <UserPlus size={18} aria-hidden="true" /> {friendActionBusy ? 'Sending…' : 'Add Friend'}
              </button>
            )}

            {!friendState.friend && (
              <>
                <button type="button" className="sh-other-action-button" onClick={openMessage}>
                  <MessageCircle size={18} aria-hidden="true" /> Message
                </button>
                <button type="button" className="sh-other-action-button" onClick={() => setError('Calling is not connected yet.')}>
                  <Phone size={18} aria-hidden="true" /> Call
                </button>
              </>
            )}
          </div>
        )}

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

        </div>

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
