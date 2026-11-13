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
  convId: string;
  senderUid: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  messageId: string;
}

interface NotificationManagerProps {
  currentUid: string | null;
}

// Rock-solid notification dispatcher for mobile Chrome & desktop
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

  // In-App Notification Permission Prompt state
  const [showPermissionBanner, setShowPermissionBanner] = useState<boolean>(false);
  const [permissionDeniedGuide, setPermissionDeniedGuide] = useState<boolean>(false);

  // Message tracking
  const initialLoadedRef = useRef<boolean>(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  // Check permission on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const checkPermissionState = () => {
      const perm = Notification.permission;
      const dismissedThisSession = sessionStorage.getItem('shinzi_perm_banner_dismissed') === 'true';

      if (perm === 'default' && !dismissedThisSession) {
        setShowPermissionBanner(true);
      } else {
        setShowPermissionBanner(false);
      }
    };

    checkPermissionState();

    if (Notification.permission === 'granted' && currentUid) {
      void subscribeToWebPush(currentUid);
    }
  }, [currentUid]);

  const handleRequestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        setShowPermissionBanner(false);
        if (currentUid) {
          void subscribeToWebPush(currentUid);
        }
        // Send immediate test / confirmation notification to register Android notification channel
        void dispatchOSNotification('Shinzi Notifications', {
          body: 'Notifications enabled! You will now receive alerts for new messages.',
          icon: '/icon-192.png',
          tag: 'shinzi-welcome',
        });
      } else if (result === 'denied') {
        setShowPermissionBanner(false);
        setPermissionDeniedGuide(true);
      }
    } catch (err) {
      console.warn('Error requesting notification permission:', err);
    }
  };

  const handleDismissPermissionBanner = () => {
    setShowPermissionBanner(false);
    sessionStorage.setItem('shinzi_perm_banner_dismissed', 'true');
  };

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

            // 1. Show Root-style In-App Floating Toast (if not looking at this chat)
            if (!isUserInsideThisChat) {
              triggerToast({
                id: `${convId}-${messageId}-${Date.now()}`,
                convId,
                senderUid: lastSenderId,
                senderName,
                senderAvatar,
                text: previewText,
                messageId,
              });
            }

            // 2. ALWAYS dispatch real OS notification if outside this chat OR if app is minimized/hidden
            if (!isUserInsideThisChat || document.hidden) {
              void dispatchOSNotification(senderName, {
                body: previewText,
                icon: senderAvatar || '/icon-192.png',
                tag: `shinzi-${convId}-${messageId}`,
                renotify: true,
                data: {
                  url: `/chat?user=${encodeURIComponent(lastSenderId)}&msg=${encodeURIComponent(messageId)}`,
                },
              });
            }

            // Vibration feedback if supported
            if (navigator.vibrate) {
              try {
                navigator.vibrate(80);
              } catch {}
            }
          }
        });
      },
      (error) => {
        console.warn('[NotificationManager] Conversation listener error:', error);
      }
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
    const { senderUid, messageId } = activeToast;
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setActiveToast(null);

    // Navigate to chat and highlight message
    navigateTo(`/chat?user=${encodeURIComponent(senderUid)}&msg=${encodeURIComponent(messageId || '')}`);
  };

  return (
    <>
      {/* IN-APP NOTIFICATION PERMISSION BANNER */}
      {showPermissionBanner && (
        <div style={permBannerStyles.container}>
          <div style={permBannerStyles.left}>
            <div style={permBannerStyles.bellIcon}>🔔</div>
            <div style={permBannerStyles.textCol}>
              <span style={permBannerStyles.title}>Enable Notifications</span>
              <span style={permBannerStyles.subtitle}>
                Get alerted when friends send you messages
              </span>
            </div>
          </div>
          <div style={permBannerStyles.right}>
            <button
              type="button"
              onClick={handleRequestPermission}
              style={permBannerStyles.enableBtn}
            >
              Allow
            </button>
            <button
              type="button"
              onClick={handleDismissPermissionBanner}
              style={permBannerStyles.dismissBtn}
              aria-label="Dismiss notification prompt"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* PERMISSION DENIED HELP DIALOG */}
      {permissionDeniedGuide && (
        <div style={modalStyles.overlay} onClick={() => setPermissionDeniedGuide(false)}>
          <div style={modalStyles.content} onClick={(e) => e.stopPropagation()}>
            <h3 style={modalStyles.title}>Notifications are Blocked</h3>
            <p style={modalStyles.body}>
              To receive message alerts, please allow notifications for Shinzi in your browser settings:
            </p>
            <ol style={modalStyles.list}>
              <li style={modalStyles.listItem}>
                Tap the <strong>lock icon (🔒) or tune icon (⚙️)</strong> in Chrome's address bar.
              </li>
              <li style={modalStyles.listItem}>
                Tap <strong>Permissions</strong> or <strong>Site settings</strong>.
              </li>
              <li style={modalStyles.listItem}>
                Set <strong>Notifications</strong> to <strong>Allow</strong>.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setPermissionDeniedGuide(false)}
              style={modalStyles.closeBtn}
            >
              Got it
            </button>
          </div>
        </div>
      )}

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
                <span style={toastStyles.subtitle}>Direct Message</span>
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

const permBannerStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'sticky',
    top: 'var(--shinzi-banner-h, 0px)',
    left: 0,
    right: 0,
    zIndex: 99998,
    backgroundColor: '#1e1f22',
    borderBottom: '1px solid rgba(88, 101, 242, 0.4)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    boxSizing: 'border-box',
    gap: 10,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  bellIcon: {
    fontSize: 22,
    lineHeight: 1,
    flexShrink: 0,
  },
  textCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    color: '#b5bac1',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.2,
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  enableBtn: {
    backgroundColor: '#5865f2',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 16,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: '#949ba4',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 1000001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backdropFilter: 'blur(4px)',
  },
  content: {
    backgroundColor: '#1e1f22',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    maxWidth: 380,
    width: '100%',
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 12px 36px rgba(0,0,0,0.8)',
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: 18,
    fontWeight: 700,
  },
  body: {
    margin: '0 0 12px 0',
    fontSize: 13,
    color: '#dbdee1',
    lineHeight: 1.4,
  },
  list: {
    margin: '0 0 18px 0',
    paddingLeft: 20,
    fontSize: 13,
    color: '#b5bac1',
    lineHeight: 1.5,
  },
  listItem: {
    marginBottom: 8,
  },
  closeBtn: {
    width: '100%',
    backgroundColor: '#5865f2',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 20,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

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
