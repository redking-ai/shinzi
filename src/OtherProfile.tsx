
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { ArrowLeft, Ban, Clock3, Ellipsis, FileText, MessageCircle, Phone, UserPlus, UserRound, VolumeX } from 'lucide-react';
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
  if (!value) return 'October 2026';

  let date: Date | null = null;
  if (typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value.seconds === 'number') {
    date = new Date(value.seconds * 1000);
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) date = parsed;
  }

  return date
    ? date.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : 'October 2026';
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function OtherProfile({
  targetUid: targetUidProp,
  onClose,
}: {
  targetUid?: string;
  onClose?: () => void;
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
    blocked: false,
    muted: false,
  });

  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const noteSaveTimer = useRef<number | null>(null);

  // Private note loading with localStorage fallback
  useEffect(() => {
    if (!currentUser || !targetUid) {
      setNoteText('');
      return;
    }
    const localKey = `shinzi_note_${currentUser.uid}_${targetUid}`;
    try {
      const localVal = localStorage.getItem(localKey);
      if (localVal !== null) setNoteText(localVal);
    } catch {}

    getDoc(doc(db, 'users', currentUser.uid, 'notes', targetUid))
      .then((snap) => {
        if (snap.exists()) {
          const val = String(snap.data()?.noteText ?? '');
          setNoteText(val);
          try {
            localStorage.setItem(localKey, val);
          } catch {}
        }
      })
      .catch((err) => {
        console.error('[NOTE] Error loading note:', err);
      });
  }, [currentUser, targetUid]);

  const handleNoteChange = (val: string) => {
    const text = val.slice(0, 250);
    setNoteText(text);
    if (!currentUser || !targetUid) return;
    const localKey = `shinzi_note_${currentUser.uid}_${targetUid}`;
    try {
      localStorage.setItem(localKey, text);
    } catch {}

    if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = window.setTimeout(async () => {
      try {
        await setDoc(doc(db, 'users', currentUser.uid, 'notes', targetUid), {
          noteText: text,
          updatedAt: serverTimestamp(),
        });
        setNoteSaved(true);
        setTimeout(() => setNoteSaved(false), 2000);
      } catch (err) {
        console.error('[NOTE] Error saving note:', err);
      }
    }, 600);
  };

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
        const [block, mute] = await Promise.all([
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
          blocked: block.exists(),
          muted: mute.exists(),
        });
      } else {
        setRelationship({
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

          try {
            const dataUri = await drive.getFileDataUri(
              String(data.providerFileId)
            );
            if (dataUri) return dataUri;
          } catch {}

          // Fallback to Google Drive public image CDN
          return `https://lh3.googleusercontent.com/d/${encodeURIComponent(String(data.providerFileId))}=s800`;
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
        } else if (userData?.photoURL) {
          setAvatar(String(userData.photoURL));
        } else {
          setAvatar('');
        }
        if (bannerUri) {
          setBanner(bannerUri);
        } else if (userData?.bannerUrl) {
          setBanner(String(userData.bannerUrl));
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
    drive.getFileDataUri,
  ]);

  const toggleRelationship = async (
    kind: 'blocked' | 'muted'
  ) => {
    if (!currentUser) {
      setError(
        'Log in to mute or block.'
      );
      return;
    }

    if (currentUser.uid === targetUid) {
      setError("You can't manage a relationship with yourself.");
      return;
    }

    if (busy) return;

    const collectionName = kind === 'blocked' ? 'blocked' : 'muted';

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
    if (onClose) {
      onClose();
      return;
    }
    navigateTo(`/chat?user=${encodeURIComponent(targetUid)}`);
  };

  if (loading) {
    return (
      <main className="sh-profile-page sh-other-profile-page">
        <div className="sh-profile-banner" style={{ height: 60 }} />
        <div className="sh-profile-state">
          Loading profile…
        </div>
      </main>
    );
  }

  if (!userData) {
    return (
      <main className="sh-profile-page sh-other-profile-page">
        <div className="sh-profile-banner" style={{ height: 60 }} />
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
            className="sh-banner-back-button"
            onClick={() => window.history.back()}
            title="Go back"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
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
            <button role="menuitem" disabled={busy || !currentUser} onClick={() => void toggleRelationship('muted')}>
              <VolumeX size={16} aria-hidden="true" />
              <span>{relationship.muted ? 'Unmute user' : 'Mute user'}</span>
            </button>
            <button role="menuitem" className="sh-danger-action" disabled={busy || !currentUser} onClick={() => void toggleRelationship('blocked')}>
              <Ban size={16} aria-hidden="true" />
              <span>{relationship.blocked ? 'Unblock user' : 'Block user'}</span>
            </button>
          </div>
        )}

        <div className="sh-profile-identity">
          <div className="sh-avatar-thought-row">
            <div className="sh-avatar-wrap">
              {avatar ? (
                <img
                  className="sh-avatar"
                  src={avatar}
                  alt={`${userData.displayName || 'User'} profile`}
                  loading="eager"
                  decoding="async"
                  onError={() => setAvatar('')}
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

            {userData.bubleText && (
              <div className="sh-profile-bubble">
                {String(userData.bubleText).replace(/^\+\s*/, '')}
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
          <div className="sh-profile-info-card">
            <div className="sh-info-card-section">
              <h3 className="sh-info-card-label">Bio</h3>
              <p className="sh-bio-text">
                {userData.bio ? (
                  userData.bio
                ) : (
                  <span className="sh-bio-empty">No bio added yet.</span>
                )}
              </p>
            </div>

            <div className="sh-info-card-section">
              <h3 className="sh-info-card-label">Joined Shinzi</h3>
              <p className="sh-joined-text">{dateLabel(userData.createdAt)}</p>
            </div>

            {currentUser && currentUser.uid !== targetUid && (
              <div className="sh-info-card-section sh-profile-note-section">
                <div className="sh-profile-note-header">
                  <h3 className="sh-info-card-label">Note (only visible to you)</h3>
                  {noteSaved && <span className="sh-note-saved-badge">Saved</span>}
                </div>
                <div className="sh-profile-note-box">
                  <textarea
                    className="sh-profile-note-input"
                    placeholder="Click to add a note"
                    maxLength={250}
                    rows={2}
                    value={noteText}
                    onChange={(e) => handleNoteChange(e.target.value)}
                  />
                  <FileText size={16} className="sh-profile-note-icon" aria-hidden="true" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sh-profile-footer-actions">
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
