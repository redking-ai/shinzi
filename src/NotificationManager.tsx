import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { navigateTo } from './profileCache';
import { subscribeToWebPush } from './pushService';

interface InAppToast {
  id: string;
  convId?: string;
  senderUid: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  messageId?: string;
  kind?: 'dm' | 'friend_request';
  targetUrl?: string;
}

interface NotificationManagerProps {
  currentUid: string | null;
}

// Rock-solid notification dispatcher for mobile Chrome & desktop
function playNotificationSound() {
  try {
    const audio = new Audio('/sounds/notification.mp3');
    audio.play().catch(() => {});
  } catch {}
}

async function dispatchOSNotification(title: string, options: Record<string, any>) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    // Use ServiceWorker registration (Required by Chrome on Android)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          ...options,
          badge: '/icon-192.png',
          vibrate: [200, 100, 200],
        } as any);
        return;
      }
    }

    // Fallback for desktop Safari/Firefox
    if (typeof window.Notification === 'function') {
      new window.Notification(title, options as any);
    }
  } catch (err) {
    console.warn('[NotificationManager] Notification error:', err);
  }
}

export default function NotificationManager({ currentUid }: NotificationManagerProps) {
  const [activeToast, setActiveToast] = useState<InAppToast | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const toastTimeoutRef = useRef<any>(null);

  // Message tracking
  const initialLoadedRef = useRef<boolean>(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  // Check permission on mount and auto-subscribe if granted
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted' && currentUid) {
      void subscribeToWebPush(currentUid);
    }
  }, [currentUid]);

  // Sync Native Android FCM Token to Firestore
  useEffect(() => {
    if (!currentUid || typeof window === 'undefined') return undefined;

    const cap = (window as any).Capacitor;
    if (cap?.Plugins?.ShinziNotification) {
      let isSubscribed = true;

      if (typeof cap.Plugins.ShinziNotification.setCurrentUser === 'function') {
        void cap.Plugins.ShinziNotification.setCurrentUser({
          uid: currentUid,
          name: 'You',
        }).catch(() => {});
      }

      const syncToken = async (token: string) => {
        if (!token || !isSubscribed) return;
        try {
          // 1. Send to backend register-token endpoint (uses Firebase Admin SDK - bypasses Firestore rules)
          const apiBase = typeof window !== 'undefined' && window.location.origin.includes('localhost')
            ? 'https://shinzi.vercel.app'
            : '';
          void fetch(`${apiBase}/api/register-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUid, fcmToken: token }),
          }).catch((err) => console.warn('[FCM] Backend token register error:', err));

          // 2. Client-side Firestore write as secondary fallback
          const { doc, setDoc, arrayUnion } = await import('firebase/firestore');
          await setDoc(
            doc(db, 'users', currentUid),
            { fcmTokens: arrayUnion(token) },
            { merge: true }
          );
          console.log('[FCM] Token synced to Firestore successfully:', token.slice(0, 10) + '...');
        } catch (e) {
          console.warn('[FCM] Client Firestore sync notice:', e);
        }
      };

      const fetchAndSync = () => {
        if (typeof cap?.Plugins?.ShinziNotification?.getFcmToken === 'function') {
          cap.Plugins.ShinziNotification.getFcmToken()
            .then((res: any) => {
              if (res?.token) {
                void syncToken(res.token);
              }
            })
            .catch(() => {});
        }
      };

      // Attempt immediately
      fetchAndSync();

      // Retry after 2s and 5s in case Google Play Services token was resolving on app startup
      const t1 = setTimeout(fetchAndSync, 2000);
      const t2 = setTimeout(fetchAndSync, 5000);

      let tokenListener: any = null;
      if (typeof cap.Plugins.ShinziNotification.addListener === 'function') {
        tokenListener = cap.Plugins.ShinziNotification.addListener(
          'onFcmToken',
          (data: { token: string }) => {
            if (data?.token) void syncToken(data.token);
          }
        );
      }

      return () => {
        isSubscribed = false;
        clearTimeout(t1);
        clearTimeout(t2);
        if (tokenListener && typeof tokenListener.remove === 'function') {
          tokenListener.remove();
        }
      };
    }
    return undefined;
  }, [currentUid]);

  // Listen for direct messages across all user's conversations
  useEffect(() => {
    if (!currentUid) return undefined;

    initialLoadedRef.current = false;
    seenMessageIdsRef.current = new Set();

    const q = query(
      collection(db, 'conversations'),
      where('memberIds', 'array-contains', currentUid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // First snapshot: index all existing message IDs so we never alert old messages
        if (!initialLoadedRef.current) {
          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.lastMessageId) {
              seenMessageIdsRef.current.add(data.lastMessageId);
            }
          });
          initialLoadedRef.current = true;
          return;
        }

        // Subsequent snapshots: process incoming new messages
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            const conv = change.doc.data();
            const convId = change.doc.id;
            const messageId = conv.lastMessageId;

            // Must have a new message ID we haven't processed yet
            if (!messageId || seenMessageIdsRef.current.has(messageId)) {
              return;
            }
            seenMessageIdsRef.current.add(messageId);

            // Direct messages only (ignore servers and group channels)
            if (conv.type === 'group' || conv.type === 'channel' || conv.serverId) {
              return;
            }

            const lastSenderId = conv.lastSenderId;
            // Ignore own sent messages
            if (!lastSenderId || lastSenderId === currentUid) {
              return;
            }

            // Check if user is currently inside this active conversation AND page is visible
            const activeConvId = (window as any).__activeConversationId;
            const isUserInsideThisChat =
              activeConvId === convId &&
              document.visibilityState === 'visible';

            const senderProfile = conv.memberProfiles?.[lastSenderId];
            const senderName =
              conv.lastSenderName ||
              senderProfile?.displayName ||
              senderProfile?.username ||
              'Someone';

            const senderAvatar = senderProfile?.photoURL || '';
            const previewText = conv.lastMessageText || 'Sent a message';

            const cap = (window as any).Capacitor;
            const isNative = !!cap?.Plugins?.ShinziNotification;

            // 1. Show Root-style In-App Floating Toast when user is NOT inside this active chat
            // Enabled for both Web and Native APK so the 5-second toast with tap-to-chat always works inside the app
            if (!isUserInsideThisChat && document.visibilityState === 'visible') {
              playNotificationSound();
              triggerToast({
                id: `${convId}-${messageId}-${Date.now()}`,
                convId,
                senderUid: lastSenderId,
                senderName,
                senderAvatar,
                text: previewText,
                messageId,
                kind: 'dm',
              });
            }

            // 2. Dispatch real OS notification ONLY for web browsers when page is hidden
            if (document.hidden && !isNative) {
              // Web Browser: Standard Web Push / ServiceWorker notification
              void dispatchOSNotification(senderName, {
                body: previewText,
                icon: senderAvatar ? (senderAvatar.startsWith('/') ? `https://shinzi.vercel.app${senderAvatar}` : senderAvatar) : '/icon-192.png',
                tag: `shinzi-${convId}-${messageId}`,
                renotify: true,
                data: {
                  url: `/chat?user=${encodeURIComponent(lastSenderId)}&msg=${encodeURIComponent(messageId)}`,
                },
              });
            }
          }
        });
      },
      (error) => {
        console.warn('[NotificationManager] Conversation listener error:', error);
      }
    );

    // Inline reply listener from Android notification
    const cap = (window as any).Capacitor;
    let replyListenerHandle: any = null;
    if (typeof cap?.Plugins?.ShinziNotification?.addListener === 'function') {
      replyListenerHandle = cap.Plugins.ShinziNotification.addListener(
        'onNotificationReply',
        (data: { convId: string; replyText: string }) => {
          // ReplyReceiver.java already posts the message to Firestore via /api/send-push.
          // We intentionally do not duplicate the write here to prevent vector spamming / doubled messages.
          console.log('[NotificationManager] Notification reply received for conversation:', data?.convId);
        }
      );
    }

    return () => {
      unsubscribe();
      if (replyListenerHandle && typeof replyListenerHandle.remove === 'function') {
        replyListenerHandle.remove();
      }
    };
  }, [currentUid]);

  // Listen for incoming pending friend requests (for both desktop and android)
  const initialFriendReqLoadedRef = useRef<boolean>(false);
  const seenFriendReqIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUid) return undefined;

    initialFriendReqLoadedRef.current = false;
    seenFriendReqIdsRef.current = new Set();

    const q = query(
      collection(db, 'friendRequests'),
      where('toUid', '==', currentUid),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!initialFriendReqLoadedRef.current) {
          snapshot.docs.forEach((docSnap) => {
            seenFriendReqIdsRef.current.add(docSnap.id);
          });
          initialFriendReqLoadedRef.current = true;
          return;
        }

        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const reqId = change.doc.id;
            if (seenFriendReqIdsRef.current.has(reqId)) return;
            seenFriendReqIdsRef.current.add(reqId);

            const reqData = change.doc.data();
            const fromUid = reqData.fromUid;
            if (!fromUid || fromUid === currentUid) return;

            let senderName = reqData.fromName || reqData.fromDisplayName || 'Someone';
            let senderAvatar = reqData.fromAvatar || reqData.fromPhotoURL || '';

            if (!senderAvatar || senderName === 'Someone') {
              try {
                const { getDoc, doc: fDoc } = await import('firebase/firestore');
                const userDoc = await getDoc(fDoc(db, 'users', fromUid));
                if (userDoc.exists()) {
                  const u = userDoc.data();
                  senderName = u.displayName || u.username || senderName;
                  senderAvatar = u.photoURL || senderAvatar;
                }
              } catch {}
            }

            playNotificationSound();

            triggerToast({
              id: `fr-${reqId}-${Date.now()}`,
              senderUid: fromUid,
              senderName,
              senderAvatar,
              text: 'sent you a friend request',
              kind: 'friend_request',
              targetUrl: '/chat?screen=notifications',
            });
          }
        });
      },
      (err) => console.warn('[NotificationManager] Friend request listener notice:', err)
    );

    return () => unsubscribe();
  }, [currentUid]);

  const triggerToast = (toastData: InAppToast) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setIsExiting(false);
    setActiveToast(toastData);

    // 5-second countdown to auto-dismiss
    toastTimeoutRef.current = setTimeout(() => {
      dismissToast();
    }, 5000);
  };

  const dismissToast = () => {
    setIsExiting(true);
    setTimeout(() => {
      setActiveToast(null);
      setIsExiting(false);
    }, 250);
  };

  const handleToastClick = () => {
    if (!activeToast) return;
    const { senderUid, messageId, targetUrl, kind } = activeToast;
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setActiveToast(null);

    if (kind === 'friend_request' || targetUrl) {
      navigateTo(targetUrl || '/chat?screen=notifications');
      return;
    }

    // Navigate to chat and highlight message
    navigateTo(`/chat?user=${encodeURIComponent(senderUid)}&msg=${encodeURIComponent(messageId || '')}`);
  };

  return (
    <>
      {/* ROOT-STYLE IN-APP FLOATING NOTIFICATION TOAST */}
      {activeToast && (
        <div
          style={{
            ...toastStyles.container,
            ...(isExiting ? toastStyles.containerExiting : toastStyles.containerEntering),
          }}
          onClick={handleToastClick}
        >
          <div style={toastStyles.body}>
            {activeToast.senderAvatar ? (
              <img
                src={activeToast.senderAvatar}
                alt={activeToast.senderName}
                style={toastStyles.avatar}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div style={toastStyles.avatarFallback}>
                {activeToast.senderName.charAt(0).toUpperCase()}
              </div>
            )}

            <div style={toastStyles.textCol}>
              <div style={toastStyles.topRow}>
                <span style={toastStyles.name}>{activeToast.senderName}</span>
                <span style={toastStyles.subtitle}>
                  {activeToast.kind === 'friend_request' ? 'Friend Request' : 'Direct Message'}
                </span>
              </div>
              <div style={toastStyles.previewText}>
                {activeToast.text}
              </div>
            </div>

            <button
              type="button"
              style={toastStyles.closeBtn}
              onClick={(e) => {
                e.stopPropagation();
                dismissToast();
              }}
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>

          {/* 5-second Backward Shrinking Progress Bar */}
          <div style={toastStyles.progressTrack}>
            <div
              key={activeToast.id}
              style={toastStyles.progressBar}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes shinziToastSlideDown {
          0% {
            opacity: 0;
            transform: translateY(-24px) scale(0.96);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes shinziToastSlideUp {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-24px) scale(0.96);
          }
        }
        @keyframes shinziProgressShrink {
          0% {
            width: 100%;
          }
          100% {
            width: 0%;
          }
        }
      `}</style>
    </>
  );
}

const toastStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 14,
    left: 14,
    right: 14,
    maxWidth: 440,
    margin: '0 auto',
    zIndex: 1000000,
    backgroundColor: '#1e1f22',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    boxShadow: '0 10px 32px rgba(0, 0, 0, 0.75)',
    overflow: 'hidden',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
  },
  containerEntering: {
    animation: 'shinziToastSlideDown 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  },
  containerExiting: {
    animation: 'shinziToastSlideUp 0.22s ease-in forwards',
  },
  body: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: '#2b2d31',
  },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    backgroundColor: '#5865f2',
    color: '#FFFFFF',
    fontWeight: 700,
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  topRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    minWidth: 0,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    color: '#949ba4',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    flexShrink: 0,
  },
  previewText: {
    color: '#dbdee1',
    fontSize: 13,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#949ba4',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 1,
  },
  progressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    position: 'relative',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#5865f2',
    animation: 'shinziProgressShrink 5s linear forwards',
  },
};
