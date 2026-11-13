import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { navigateTo } from './profileCache';

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

function parseMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1000000);
  if (typeof ts === 'string') {
    const d = Date.parse(ts);
    return isNaN(d) ? 0 : d;
  }
  return 0;
}

export default function NotificationManager({ currentUid }: NotificationManagerProps) {
  const [activeToast, setActiveToast] = useState<InAppToast | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const toastTimeoutRef = useRef<any>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Request Notification permission quietly if supported
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const handleUserGesture = () => {
          Notification.requestPermission().catch(() => {});
          window.removeEventListener('click', handleUserGesture);
        };
        window.addEventListener('click', handleUserGesture, { once: true });
      }
    }
  }, []);

  // Listen for direct messages across all user's conversations
  useEffect(() => {
    if (!currentUid) return undefined;

    startTimeRef.current = Date.now();

    const q = query(
      collection(db, 'conversations'),
      where('memberIds', 'array-contains', currentUid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added' || change.type === 'modified') {
            const conv = change.doc.data();
            const convId = change.doc.id;

            // Direct messages only (ignore servers and group chats)
            if (conv.type === 'group' || conv.type === 'channel' || conv.serverId) {
              return;
            }

            const lastMsgAt = parseMillis(conv.lastMessageAt);
            // Ignore historical messages from before the page was loaded
            if (!lastMsgAt || lastMsgAt < startTimeRef.current - 4000) {
              return;
            }

            const lastSenderId = conv.lastSenderId;
            // Ignore own sent messages
            if (!lastSenderId || lastSenderId === currentUid) {
              return;
            }

            // Check if user is currently inside this active conversation and document is visible
            const activeConvId = (window as any).__activeConversationId;
            const isUserInsideThisChat =
              activeConvId === convId &&
              document.visibilityState === 'visible';

            if (isUserInsideThisChat) {
              // Actively looking at this chat; no toast needed
              return;
            }

            const senderProfile = conv.memberProfiles?.[lastSenderId];
            const senderName =
              conv.lastSenderName ||
              senderProfile?.displayName ||
              senderProfile?.username ||
              'Someone';

            const senderAvatar = senderProfile?.photoURL || '';
            const previewText = conv.lastMessageText || 'Sent a message';
            const messageId = conv.lastMessageId || '';

            // 1. Show In-App Floating Toast
            triggerToast({
              id: `${convId}-${lastMsgAt}-${Math.random()}`,
              convId,
              senderUid: lastSenderId,
              senderName,
              senderAvatar,
              text: previewText,
              messageId,
            });

            // 2. Trigger Real OS Push Notification when tab is hidden or backgrounded
            if (
              'Notification' in window &&
              Notification.permission === 'granted' &&
              document.hidden
            ) {
              try {
                if (navigator.serviceWorker?.controller) {
                  navigator.serviceWorker.ready.then((reg) => {
                    reg.showNotification(senderName, {
                      body: previewText,
                      icon: senderAvatar || '/icon-192.png',
                      badge: '/favicon.png',
                      tag: `shinzi-msg-${convId}-${messageId || Date.now()}`,
                      renotify: true,
                      data: {
                        url: `/chat?user=${encodeURIComponent(lastSenderId)}&msg=${encodeURIComponent(messageId)}`,
                      },
                    } as any);
                  }).catch(() => {
                    new Notification(senderName, {
                      body: previewText,
                      icon: senderAvatar || '/icon-192.png',
                      tag: `shinzi-msg-${convId}-${messageId || Date.now()}`,
                    });
                  });
                } else {
                  new Notification(senderName, {
                    body: previewText,
                    icon: senderAvatar || '/icon-192.png',
                    tag: `shinzi-msg-${convId}-${messageId || Date.now()}`,
                  });
                }
              } catch (err) {
                console.warn('Could not display system notification:', err);
              }
            }

            // Vibration feedback if supported
            if (navigator.vibrate) {
              try {
                navigator.vibrate(60);
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

    // Navigate to chat and pass message ID to highlight/glow
    navigateTo(`/chat?user=${encodeURIComponent(senderUid)}&msg=${encodeURIComponent(messageId || '')}`);
  };

  if (!activeToast) return null;

  return (
    <>
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
                // Fallback to placeholder if avatar fails to load
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
