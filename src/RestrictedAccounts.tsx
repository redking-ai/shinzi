import { useState, useEffect } from 'react';
import { ArrowLeft, UserX } from 'lucide-react';
import { auth, db } from './firebaseConfig';
import { collection, doc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { getAbsoluteApiUrl } from './apiUtils';

interface BlockedUserItem {
  id: string;
  targetUid: string;
  displayName?: string;
  username?: string;
  photoURL?: string;
  createdAt?: any;
}

interface RestrictedAccountsProps {
  onBack: () => void;
}

export default function RestrictedAccounts({ onBack }: RestrictedAccountsProps) {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setBlockedUsers([]);
      setLoading(false);
      return;
    }

    const blockedRef = collection(db, 'users', currentUser.uid, 'blocked');
    const unsubscribe = onSnapshot(
      blockedRef,
      (snapshot) => {
        const list: BlockedUserItem[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            targetUid: data.targetUid || d.id,
            displayName: data.displayName || data.username || 'User',
            username: data.username || '',
            photoURL: data.photoURL || '',
            createdAt: data.createdAt,
          });
        });
        setBlockedUsers(list);
        setLoading(false);
      },
      (err) => {
        console.warn('[RestrictedAccounts] Error listening to blocked users:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleUnblock = async (targetUid: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    setUnblockingId(targetUid);
    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'blocked', targetUid));
    } catch (e) {
      console.warn('[RestrictedAccounts] Failed to unblock user:', e);
    } finally {
      setUnblockingId(null);
    }
  };

  const formatDate = (val: any): string => {
    if (!val) return '';
    try {
      let d: Date;
      if (typeof val === 'number') {
        d = new Date(val);
      } else if (val?.toDate && typeof val.toDate === 'function') {
        d = val.toDate();
      } else if (val?.seconds) {
        d = new Date(val.seconds * 1000);
      } else {
        d = new Date(val);
      }
      if (isNaN(d.getTime())) return '';
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      return `${day}/${month}/${year}`;
    } catch {
      return '';
    }
  };

  return (
    <div className="sh-restricted-page">
      <div className="sh-settings-header">
        <div className="sh-settings-header-left">
          <button
            type="button"
            className="sh-settings-back-btn"
            onClick={onBack}
            aria-label="Back to settings"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="sh-settings-title">Restricted accounts</h1>
        </div>
        <div className="sh-settings-header-spacer" />
      </div>

      <div className="sh-settings-content">
        {loading ? (
          <div className="sh-restricted-empty">
            <span className="shc-spinner" />
          </div>
        ) : blockedUsers.length === 0 ? (
          <div className="sh-restricted-empty">
            <div className="sh-restricted-empty-icon-wrap">
              <UserX size={44} color="#949ba4" />
            </div>
            <p className="sh-restricted-empty-text">No user blocked yet</p>
          </div>
        ) : (
          <div className="sh-settings-section">
            <div className="sh-settings-card">
              {blockedUsers.map((item) => {
                const formattedDate = formatDate(item.createdAt);
                return (
                  <div key={item.id} className="sh-restricted-row">
                    <div className="sh-restricted-avatar-wrap">
                      <img
                        src={getAbsoluteApiUrl(item.photoURL) || '/icon-192.png'}
                        alt=""
                        className="sh-restricted-avatar"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/icon-192.png';
                        }}
                      />
                    </div>

                    <div className="sh-restricted-details">
                      <div className="sh-restricted-name">{item.displayName || 'User'}</div>
                      <div className="sh-restricted-meta">
                        <span className="sh-restricted-username">
                          {item.username ? `@${item.username}` : ''}
                        </span>
                        {formattedDate && (
                          <span className="sh-restricted-since">
                            since - {formattedDate}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="sh-restricted-unblock-btn"
                      disabled={unblockingId === item.targetUid}
                      onClick={() => void handleUnblock(item.targetUid)}
                    >
                      <UserX size={15} />
                      <span>Unblock</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
