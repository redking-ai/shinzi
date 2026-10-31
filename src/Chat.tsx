import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  Ban,
  BarChart3,
  Bell,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  CornerUpLeft,
  FileText,
  Flag,
  Gamepad2,
  Image as ImageIcon,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Mic,
  MicOff,
  Pencil,
  Phone,
  PhoneOff,
  Plus,
  Reply,
  Search,
  Send,
  Server,
  Smile,
  SmilePlus,
  Sparkles,
  Square,
  Star,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import type { CategoryButtonRenderProps } from 'emoji-picker-react';
import { auth, db } from './firebaseConfig';
import { useDriveStore } from './driveStore';
import { navigateTo as navigateToUrl, setCachedProfile } from './profileCache';
import {
  getRecentEmojis,
  loadEmojiPickerData,
  saveRecentEmoji,
} from './emojiData';
import './Chat.css';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

function EmojiCategoryButton({
  category,
  className,
  onClick,
  style,
  ...buttonProps
}: CategoryButtonRenderProps) {
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    const button = event.currentTarget;
    window.requestAnimationFrame(() => {
      const picker = button.closest<HTMLElement>('[data-epr-part="root"]');
      const scrollBody = picker?.querySelector<HTMLElement>('.epr-body');
      const section = Array.from(
        picker?.querySelectorAll<HTMLElement>('[data-epr-part="category"]') || [],
      ).find((item) => item.dataset.eprCategory === category.id);

      if (!scrollBody || !section) return;

      const top =
        section.getBoundingClientRect().top -
        scrollBody.getBoundingClientRect().top +
        scrollBody.scrollTop;
      scrollBody.scrollTo({ top, behavior: 'smooth' });
    });
  };

  return (
    <button
      {...buttonProps}
      className={`${className || ''} shc-emoji-category-tab`}
      onClick={handleClick}
      style={{
        ...style,
        background: 'transparent',
        border: 0,
        borderRadius: 8,
        outline: 'none',
        boxShadow: 'none',
      }}
    />
  );
}

// ============================================================
// TYPES + CONSTANTS
// ============================================================

type Rec = Record<string, any>;
type Screen =
  | 'main'
  | 'conversation'
  | 'friends'
  | 'friendRequests'
  | 'dmRequests'
  | 'notifications'
  | 'search';
type Panel = 'poll' | 'event' | 'gif' | null;

interface ChatProps {
  onNavigate?: (target: 'ai' | 'servers' | 'profile') => void;
}

const MAX_MESSAGE_LENGTH = 4000;
const MAX_POLL_OPTIONS = 20;
const DIRECT_PREFIX = 'dm_';

// ============================================================
// HELPERS
// ============================================================

const directId = (a: string, b: string) =>
  `${DIRECT_PREFIX}${[a, b].sort().join('_')}`;

const millis = (value: any): number => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
};

const initials = (value?: string) => {
  const s = String(value || '').trim();
  if (!s) return '?';
  const p = s.split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : s.slice(0, 2)).toUpperCase();
};

const formatTime = (value: any) =>
  millis(value)
    ? new Date(millis(value)).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

const dayKey = (value: any) => {
  if (!millis(value)) return '';
  const d = new Date(millis(value));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const dateLabel = (value: any) => {
  if (!millis(value)) return '';
  const d = new Date(millis(value));
  const now = new Date();
  const y = new Date();
  y.setDate(y.getDate() - 1);

  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(y)) return 'Yesterday';

  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};

const formatDiscordTimestamp = (value: any) => {
  if (!millis(value)) return '';
  const d = new Date(millis(value));
  const now = new Date();
  const y = new Date();
  y.setDate(y.getDate() - 1);

  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (dayKey(d) === dayKey(now)) {
    return `Today at ${timeStr}`;
  }
  if (dayKey(d) === dayKey(y)) {
    return `Yesterday at ${timeStr}`;
  }

  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year} ${timeStr}`;
};

const isSingleEmoji = (text?: string): boolean => {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    try {
      const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
      const segments = Array.from(segmenter.segment(trimmed)) as Array<{ segment: string }>;
      if (segments.length === 1) {
        return /^\p{Extended_Pictographic}$/u.test(segments[0].segment);
      }
      return false;
    } catch {}
  }

  const regex = /^(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)$/u;
  return regex.test(trimmed);
};

const renderComposerFormattedText = (text: string) => {
  if (!text) return null;
  const parts = text.split(/((?:^|\s)@[a-zA-Z0-9_]+(?![a-zA-Z0-9_]))/g);
  return parts.map((part, i) => {
    const match = part.match(/^(\s*)(@[a-zA-Z0-9_]+)$/);
    if (match) {
      const [, space, mention] = match;
      return (
        <span key={i}>
          {space}
          <span className="shc-composer-mention-token">{mention}</span>
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

const isMentioned = (text: string, username?: string, displayName?: string) => {
  if (!text) return false;
  const candidates = [username, displayName].filter(Boolean) as string[];
  return candidates.some((candidate) => {
    const clean = candidate.replace(/^@+/, '').trim();
    if (!clean || clean.length < 2) return false;
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, 'i').test(text);
  });
};

const renderFormattedText = (text: string) => {
  if (!text) return null;
  const parts = text.split(/((?:^|\s)@[a-zA-Z0-9_]+(?![a-zA-Z0-9_]))/g);
  return parts.map((part, i) => {
    const match = part.match(/^(\s*)(@[a-zA-Z0-9_]+)$/);
    if (match) {
      const [, space, mention] = match;
      return (
        <span key={i}>
          {space}
          <span className="shc-mention">{mention}</span>
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

const getReplyExcerpt = (msg: Rec | null | undefined): string => {
  if (!msg) return '';
  if (msg.deleted) return 'This message was deleted';
  if (msg.type === 'poll') return `Poll: ${msg.question || ''}`;
  if (msg.type === 'event') return `Event: ${msg.name || ''}`;
  if (msg.type === 'voice') return 'Voice message';
  return String(msg.text || '').slice(0, 100);
};


const pollTotal = (poll: Rec): number =>
  Object.values(poll?.votes || {}).reduce(
    (sum: number, v: any) => sum + (typeof v === 'number' ? v : 0),
    0,
  );

const pollPercent = (poll: Rec, index: number): number => {
  const total = pollTotal(poll);
  return total
    ? Math.round((Number(poll?.votes?.[index] || 0) / total) * 100)
    : 0;
};

const messageOf = (error: unknown, fallback = 'Please try again.') =>
  error instanceof Error && error.message ? error.message : fallback;

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60,
  ).padStart(2, '0')}`;

// ============================================================
// SMALL COMPONENTS
// ============================================================

const avatarMemoryCache = new Map<string, string>();

const testImageLoad = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

function UserAvatar({
  uid: targetUid,
  name,
  photoURL,
  profileAssetId,
  size = 'md',
  group = false,
  small = false,
  className = '',
}: {
  uid?: string | null;
  name?: string;
  photoURL?: string;
  profileAssetId?: string;
  size?: 'xs' | 'sm' | 'md' | 'nav';
  group?: boolean;
  small?: boolean;
  className?: string;
}) {
  const drive = useDriveStore();
  const effectiveSize = small ? 'sm' : size;

  const [imageUri, setImageUri] = useState<string | null>(() => {
    if (photoURL && (photoURL.startsWith('http') || photoURL.startsWith('data:'))) {
      return photoURL;
    }
    if (targetUid && avatarMemoryCache.has(targetUid)) {
      return avatarMemoryCache.get(targetUid)!;
    }
    if (typeof window !== 'undefined') {
      if (targetUid) {
        try {
          const localStored = localStorage.getItem(`shinzi_avatar_${targetUid}`);
          if (localStored) {
            avatarMemoryCache.set(targetUid, localStored);
            return localStored;
          }
        } catch {}
      }
      if (profileAssetId && window.sessionStorage) {
        try {
          const stored = window.sessionStorage.getItem(`shinzi_drive_${profileAssetId}`);
          if (stored) return stored;
        } catch {}
      }
    }
    return null;
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (group) return false;
    if (photoURL && (photoURL.startsWith('http') || photoURL.startsWith('data:'))) return false;
    if (targetUid && avatarMemoryCache.has(targetUid)) return false;
    if (typeof window !== 'undefined' && targetUid) {
      try {
        if (localStorage.getItem(`shinzi_avatar_${targetUid}`)) return false;
      } catch {}
    }
    return Boolean(targetUid || profileAssetId);
  });

  useEffect(() => {
    if (group) {
      setImageUri(null);
      setLoading(false);
      return;
    }

    if (photoURL && (photoURL.startsWith('http') || photoURL.startsWith('data:'))) {
      setImageUri(photoURL);
      if (targetUid) {
        avatarMemoryCache.set(targetUid, photoURL);
        try {
          localStorage.setItem(`shinzi_avatar_${targetUid}`, photoURL);
        } catch {}
      }
      setLoading(false);
      return;
    }

    if (targetUid && avatarMemoryCache.has(targetUid)) {
      setImageUri(avatarMemoryCache.get(targetUid)!);
      setLoading(false);
      return;
    }

    if (typeof window !== 'undefined' && targetUid) {
      try {
        const localStored = localStorage.getItem(`shinzi_avatar_${targetUid}`);
        if (localStored) {
          avatarMemoryCache.set(targetUid, localStored);
          setImageUri(localStored);
          setLoading(false);
          return;
        }
      } catch {}
    }

    // Reset imageUri immediately so previous user's avatar never lingers on search or reuse
    setImageUri(null);
    setLoading(Boolean(targetUid || profileAssetId));

    let cancelled = false;

    const resolveAvatar = async () => {
      try {
        let directUrl = photoURL;
        let assetId = profileAssetId;

        // Always check Firestore user doc if directUrl is not passed
        if (!directUrl && targetUid) {
          try {
            const userSnap = await getDoc(doc(db, 'users', targetUid));
            if (userSnap.exists()) {
              const data = userSnap.data();
              directUrl =
                data?.photoURL ||
                data?.photoUrl ||
                data?.avatarUrl ||
                data?.avatarURL ||
                data?.profileImageUri;
              if (!assetId) {
                assetId = data?.profileAssetId;
              }
            }
          } catch {}
        }

        if (directUrl && (directUrl.startsWith('http') || directUrl.startsWith('data:'))) {
          if (!cancelled) {
            setImageUri(directUrl);
            if (targetUid) {
              avatarMemoryCache.set(targetUid, directUrl);
              try {
                localStorage.setItem(`shinzi_avatar_${targetUid}`, directUrl);
              } catch {}
            }
            setLoading(false);
          }
          return;
        }

        // Try backend /api/avatar endpoint (resolves any user's Drive file via server OAuth + edge CDN)
        if (targetUid) {
          const apiAvatarUrl = `/api/avatar?uid=${encodeURIComponent(targetUid)}`;
          const canLoadFromApi = await testImageLoad(apiAvatarUrl);
          if (canLoadFromApi && !cancelled) {
            setImageUri(apiAvatarUrl);
            avatarMemoryCache.set(targetUid, apiAvatarUrl);
            try {
              localStorage.setItem(`shinzi_avatar_${targetUid}`, apiAvatarUrl);
            } catch {}
            setLoading(false);
            return;
          }
        }

        if (assetId) {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            const stored = window.sessionStorage.getItem(`shinzi_drive_${assetId}`);
            if (stored) {
              if (!cancelled) {
                setImageUri(stored);
                if (targetUid) avatarMemoryCache.set(targetUid, stored);
                setLoading(false);
              }
              return;
            }
          }

          const assetSnap = await getDoc(doc(db, 'assets', assetId));
          if (assetSnap.exists()) {
            const assetData = assetSnap.data();
            const providerFileId = assetData?.providerFileId;
            if (providerFileId) {
              if (typeof window !== 'undefined' && window.sessionStorage) {
                const storedFile = window.sessionStorage.getItem(
                  `shinzi_drive_${providerFileId}`,
                );
                if (storedFile) {
                  if (!cancelled) {
                    setImageUri(storedFile);
                    if (targetUid) avatarMemoryCache.set(targetUid, storedFile);
                    setLoading(false);
                  }
                  return;
                }
              }

              // 1. Try Drive OAuth download if session is active
              if (drive.hasActiveSession) {
                try {
                  const dataUri = await drive.getFileDataUri(providerFileId);
                  if (dataUri && !cancelled) {
                    setImageUri(dataUri);
                    if (targetUid) {
                      avatarMemoryCache.set(targetUid, dataUri);
                      try {
                        localStorage.setItem(`shinzi_avatar_${targetUid}`, dataUri);
                      } catch {}
                      const currentAuthUid = auth.currentUser?.uid;
                      if (currentAuthUid && targetUid === currentAuthUid && dataUri) {
                        updateDoc(doc(db, 'users', currentAuthUid), { photoURL: dataUri }).catch(() => {});
                        void drive.makeFilePublic(providerFileId);
                      }
                    }
                    setLoading(false);
                    return;
                  }
                } catch {
                  // Fall through to public CDN / thumbnails
                }
              }

              // 2. Try Google Drive CDN / Thumbnail endpoints (publicly viewable assets)
              const cdnCandidates = [
                `https://lh3.googleusercontent.com/d/${providerFileId}=s400`,
                `https://drive.google.com/thumbnail?id=${providerFileId}&sz=w400`,
                `https://drive.google.com/uc?export=view&id=${providerFileId}`,
              ];

              for (const candidate of cdnCandidates) {
                if (cancelled) return;
                const canLoad = await testImageLoad(candidate);
                if (canLoad && !cancelled) {
                  setImageUri(candidate);
                  if (targetUid) {
                    avatarMemoryCache.set(targetUid, candidate);
                    try {
                      localStorage.setItem(`shinzi_avatar_${targetUid}`, candidate);
                    } catch {}
                  }
                  setLoading(false);
                  return;
                }
              }
            }
          }
        }

        if (!cancelled) {
          setImageUri(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setImageUri(null);
          setLoading(false);
        }
      }
    };

    void resolveAvatar();

    return () => {
      cancelled = true;
    };
  }, [targetUid, photoURL, profileAssetId, group, drive.hasActiveSession]);

  const sizeClass =
    effectiveSize === 'xs'
      ? 'shc-avatar-xs'
      : effectiveSize === 'sm'
        ? 'shc-avatar-sm'
        : effectiveSize === 'nav'
          ? 'shc-avatar-nav'
          : 'shc-avatar-md';

  return (
    <div className={`shc-avatar ${sizeClass} ${className}`} aria-hidden="true">
      {loading ? (
        <div className="shc-avatar-skeleton" />
      ) : imageUri ? (
        <img
          src={imageUri}
          alt={name || 'Avatar'}
          className="shc-avatar-img"
          onError={() => setImageUri(null)}
        />
      ) : group ? (
        <Users size={effectiveSize === 'sm' || effectiveSize === 'xs' ? 15 : 20} />
      ) : (
        <span>{initials(name || 'User')}</span>
      )}
    </div>
  );
}

const Avatar = UserAvatar;

function Badge({ count }: { count: number }) {
  return <span className="shc-badge">{count > 9 ? '9+' : count}</span>;
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="shc-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  tall = false,
  children,
}: {
  title: string;
  onClose: () => void;
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="shc-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={tall ? 'shc-sheet shc-sheet-tall' : 'shc-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="shc-sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="shc-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// SWIPE-TO-REPLY COMPONENT
// ============================================================

interface SwipeableMessageProps {
  item: Rec;
  own: boolean;
  onReply: (item: Rec) => void;
  onLongPress: (item: Rec) => void;
  children: ReactNode;
}

function SwipeableMessage({
  item,
  own,
  onReply,
  onLongPress,
  children,
}: SwipeableMessageProps) {
  const bubbleWrapRef = useRef<HTMLDivElement | null>(null);
  const rightIndicatorRef = useRef<HTMLDivElement | null>(null);

  const startX = useRef(0);
  const startY = useRef(0);
  const isSwiping = useRef(false);
  const isVertical = useRef(false);
  const currentDrag = useRef(0);
  const longPressTimer = useRef<number | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (item.deleted || e.touches.length !== 1) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isSwiping.current = false;
    isVertical.current = false;
    currentDrag.current = 0;

    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(30);
        }
      } catch {}
      onLongPress(item);
    }, 450);

    if (bubbleWrapRef.current) {
      bubbleWrapRef.current.style.transition = 'none';
    }
    if (rightIndicatorRef.current) {
      rightIndicatorRef.current.style.transition = 'none';
    }
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (item.deleted || isVertical.current || e.touches.length !== 1) return;

    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    const diffX = touchX - startX.current;
    const diffY = touchY - startY.current;

    if (Math.hypot(diffX, diffY) > 8) {
      clearLongPress();
    }

    if (!isSwiping.current && !isVertical.current) {
      if (Math.abs(diffY) > 8 && Math.abs(diffY) > Math.abs(diffX)) {
        isVertical.current = true;
        return;
      }
      if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
        isSwiping.current = true;
      }
    }

    if (!isSwiping.current) return;

    if (e.cancelable) e.preventDefault();

    let moveX = 0;
    const threshold = 36;

    // Discord mobile standard: ALL messages swipe left to reply
    if (diffX < 0) {
      const absDiff = Math.abs(diffX);
      const damped =
        absDiff > threshold
          ? threshold + (absDiff - threshold) * 0.35
          : absDiff;
      moveX = -Math.min(damped, 65);
    }

    currentDrag.current = moveX;

    if (bubbleWrapRef.current) {
      bubbleWrapRef.current.style.transform = `translateX(${moveX}px)`;
    }

    const progress = Math.min(1, Math.abs(moveX) / threshold);

    if (moveX < 0 && rightIndicatorRef.current) {
      rightIndicatorRef.current.style.opacity = `${progress}`;
      rightIndicatorRef.current.style.transform = `translateY(-50%) scale(${
        0.5 + 0.5 * progress
      })`;
    } else if (rightIndicatorRef.current) {
      rightIndicatorRef.current.style.opacity = '0';
    }
  };

  const onTouchEnd = () => {
    clearLongPress();
    if (!isSwiping.current) return;

    const drag = currentDrag.current;
    const threshold = 36;
    const shouldReply = drag <= -threshold;

    if (bubbleWrapRef.current) {
      bubbleWrapRef.current.style.transition =
        'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)';
      bubbleWrapRef.current.style.transform = 'translateX(0px)';
    }

    if (rightIndicatorRef.current) {
      rightIndicatorRef.current.style.transition =
        'opacity 0.2s ease, transform 0.2s ease';
      rightIndicatorRef.current.style.opacity = '0';
      rightIndicatorRef.current.style.transform = 'translateY(-50%) scale(0.5)';
    }

    if (shouldReply && !item.deleted) {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(15);
        }
      } catch {}
      onReply(item);
    }

    setTimeout(() => {
      if (bubbleWrapRef.current) {
        bubbleWrapRef.current.style.transition = '';
        bubbleWrapRef.current.style.transform = '';
      }
      if (rightIndicatorRef.current) {
        rightIndicatorRef.current.style.transition = '';
        rightIndicatorRef.current.style.transform = '';
      }
    }, 250);

    isSwiping.current = false;
    isVertical.current = false;
    currentDrag.current = 0;
  };

  const isCard = item.type === 'event' || item.type === 'poll';

  return (
    <div
      className={`shc-msg-swipe-container ${own ? 'shc-msg-swipe-own' : ''} ${
        isCard ? 'shc-msg-swipe-card' : ''
      }`}
      onContextMenu={(e) => {
        if (!item.deleted) {
          e.preventDefault();
          onLongPress(item);
        }
      }}
    >
      <div
        className="shc-msg-bubble-wrap"
        ref={bubbleWrapRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>

      <div
        className="shc-msg-swipe-indicator shc-msg-swipe-right"
        ref={rightIndicatorRef}
      >
        <Reply size={15} style={{ transform: 'scaleX(-1)' }} />
      </div>
    </div>
  );
}

// ============================================================
// CHAT
// ============================================================

export default function Chat({ onNavigate }: ChatProps) {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [authLoading, setAuthLoading] = useState(() => !auth.currentUser);
  const user = authUser;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setAuthUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const uid = authUser?.uid ?? null;
  const me: string = uid ?? '';

  const [profile, setProfile] = useState<Rec | null>(null);
  const [conversations, setConversations] = useState<Rec[]>([]);
  const [friends, setFriends] = useState<Rec[]>([]);
  const [friendRequests, setFriendRequests] = useState<Rec[]>([]);
  const [dmRequests, setDmRequests] = useState<Rec[]>([]);
  const [sentDMRequests, setSentDMRequests] = useState<Rec[]>([]);
  const [messages, setMessages] = useState<Rec[]>([]);
  const [pendingDmMessages, setPendingDmMessages] = useState<Rec[]>([]);
  const [activity, setActivity] = useState<Record<string, Rec>>({});
  const [now, setNow] = useState(() => Date.now());

  const [screen, setScreen] = useState<Screen>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('screen') === 'search') return 'search';
    }
    return 'main';
  });
  const [selected, setSelected] = useState<Rec | null>(null);
  const [visualHeight, setVisualHeight] = useState<number | null>(null);
  const [visualTop, setVisualTop] = useState<number>(0);

  const [chatFilter ] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [searchResult, setSearchResult] = useState<Rec | null>(null);
  const [searching, setSearching] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState<string | null>(null);
  const [sentRequestUids, setSentRequestUids] = useState<Set<string>>(() => new Set());
  const [optimisticFavorites, setOptimisticFavorites] = useState<Record<string, boolean>>({});

  const [messageText, setMessageText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Rec | null>(null);
  const [editingMessage, setEditingMessage] = useState<Rec | null>(null);
  const [actionMessage, setActionMessage] = useState<Rec | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => getRecentEmojis());
  const [toastMessage, setToastMessage] = useState<string>('');
  const toastMessageTimer = useRef<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingFriends, setLoadingFriends] = useState(true);

  const [showModes, setShowModes] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupSelected, setGroupSelected] = useState<Record<string, boolean>>({});
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollDescription, setPollDescription] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);

  const [eventName, setEventName] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [creatingEvent, setCreatingEvent] = useState(false);

  const [gifMode, setGifMode] = useState<'gif' | 'sticker'>('gif');
  const [gifCategory, setGifCategory] = useState('normal');
  const [gifSearch, setGifSearch] = useState('');

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const [showCall, setShowCall] = useState(false);
  const [callMode, setCallMode] = useState<'voice' | 'video'>('voice');
  const [callMuted, setCallMuted] = useState(false);

  const [toast, setToast] = useState<{ title: string; text: string } | null>(
    null,
  );

  const typingTimer = useRef<number | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoOpenedUserRef = useRef('');

  const syncBackdropScroll = () => {
    if (inputRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = inputRef.current.scrollTop;
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const notify = useCallback((title: string, text = '') => {
    setToast({ title, text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  // ----------------------------------------------------------
  // LISTENERS
  // ----------------------------------------------------------

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      return undefined;
    }

    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setProfile({ id: snap.id, ...data });
          setCachedProfile(uid, data);
        } else {
          setProfile(null);
        }
      },
      (error) => console.error('Profile listener error:', error),
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setConversations([]);
      setLoadingChats(false);
      return undefined;
    }

    setLoadingChats(true);

    const q = query(
      collection(db, 'conversations'),
      where('memberIds', 'array-contains', uid),
    );

    return onSnapshot(
      q,
      (snap) => {
        const rows: Rec[] = snap.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        rows.sort(
          (a, b) =>
            millis(b.updatedAt || b.lastMessageAt) -
            millis(a.updatedAt || a.lastMessageAt),
        );

        setConversations(rows);
        setOptimisticFavorites((prev) => {
          let changed = false;
          const next = { ...prev };
          rows.forEach((r) => {
            if (r.id in next && r.favoriteBy?.[uid] === next[r.id]) {
              delete next[r.id];
              changed = true;
            }
          });
          return changed ? next : prev;
        });
        setLoadingChats(false);
      },
      (error) => {
        console.error('Conversation listener error:', error);
        setLoadingChats(false);
      },
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setFriends([]);
      setLoadingFriends(false);
      return undefined;
    }

    setLoadingFriends(true);

    return onSnapshot(
      collection(db, 'users', uid, 'friends'),
      (snap) => {
        setFriends(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoadingFriends(false);
      },
      (error) => {
        console.error('Friends listener error:', error);
        setLoadingFriends(false);
      },
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setFriendRequests([]);
      return undefined;
    }

    const q = query(
      collection(db, 'friendRequests'),
      where('toUid', '==', uid),
      where('status', '==', 'pending'),
    );

    return onSnapshot(
      q,
      (snap) =>
        setFriendRequests(
          snap.docs.map((item) => ({ id: item.id, ...item.data() })),
        ),
      (error) => console.error('Friend request listener error:', error),
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setSentRequestUids(new Set());
      return undefined;
    }

    const q = query(
      collection(db, 'friendRequests'),
      where('fromUid', '==', uid),
      where('status', '==', 'pending'),
    );

    return onSnapshot(
      q,
      (snap) => {
        setSentRequestUids(new Set(snap.docs.map((docItem) => docItem.data().toUid)));
      },
      (error) => console.error('Outgoing friend request listener error:', error),
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setDmRequests([]);
      return undefined;
    }

    const q = query(
      collection(db, 'dmRequests'),
      where('toUid', '==', uid),
      where('status', '==', 'pending'),
    );

    return onSnapshot(
      q,
      (snap) =>
        setDmRequests(
          snap.docs.map((item) => ({ id: item.id, ...item.data() })),
        ),
      (error) => console.error('DM request listener error:', error),
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setSentDMRequests([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, 'dmRequests'), where('fromUid', '==', uid)),
      (snap) => setSentDMRequests(snap.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => console.error('Outgoing DM request listener error:', error),
    );
  }, [uid]);

  useEffect(() => {
    if (!selected?.id) {
      setMessages([]);
      return undefined;
    }

    let unsubscribeMessages: (() => void) | null = null;
    const unsubscribeConversation = onSnapshot(
      doc(db, 'conversations', selected.id),
      (conversationSnap) => {
        unsubscribeMessages?.();
        unsubscribeMessages = null;
        if (!conversationSnap.exists()) {
          setMessages([]);
          return;
        }

        const messagesQuery = query(
          collection(db, 'conversations', selected.id, 'messages'),
          orderBy('createdAt', 'asc'),
          limitToLast(300),
        );
        unsubscribeMessages = onSnapshot(
          messagesQuery,
          (snap) => setMessages(snap.docs.map((item) => ({ id: item.id, ...item.data() }))),
          (error) => console.error('Messages listener error:', error),
        );
      },
      (error) => console.error('Conversation detail listener error:', error),
    );

    return () => {
      unsubscribeConversation();
      unsubscribeMessages?.();
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.id || !uid) {
      setActivity({});
      return undefined;
    }

    return onSnapshot(
      collection(db, 'conversations', selected.id, 'activity'),
      (snap) => {
        const next: Record<string, Rec> = {};
        snap.docs.forEach((item) => {
          next[item.id] = item.data();
        });
        setActivity(next);
      },
      (error) => console.error('Typing listener error:', error),
    );
  }, [selected?.id, uid]);

  // Re-check typing expiry every couple of seconds.
  useEffect(() => {
    if (screen !== 'conversation') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [screen]);

  // Clear timers on unmount.
  useEffect(() => {
    return () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (recordingTimer.current) window.clearInterval(recordingTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Synchronize mobile keyboard visual viewport immediately
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;

    const onViewportChange = () => {
      setVisualHeight(vv.height);
      setVisualTop(vv.offsetTop);

      if (screen === 'conversation' && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    };

    vv.addEventListener('resize', onViewportChange);
    vv.addEventListener('scroll', onViewportChange);
    window.addEventListener('resize', onViewportChange);

    onViewportChange();

    return () => {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [screen]);

  // ----------------------------------------------------------
  // DERIVED DATA
  // ----------------------------------------------------------

  const selectedConversation: Rec | null = useMemo(
    () => conversations.find((item) => item.id === selected?.id) || selected,
    [conversations, selected],
  );

  const unreadCount = useMemo(() => {
    if (!uid) return 0;

    return conversations.reduce((total, conversation) => {
      const lastRead = millis(conversation?.lastReadAt?.[uid]);
      const lastMessage = millis(conversation?.lastMessageAt);

      if (
        lastMessage &&
        lastMessage > lastRead &&
        conversation?.lastSenderId !== uid
      ) {
        return total + 1;
      }

      return total;
    }, 0);
  }, [conversations, uid]);

  const typingNames = useMemo(
    () =>
      Object.entries(activity)
        .filter(
          ([id, data]) =>
            id !== uid && data.typing === true && millis(data.expiresAt) > now,
        )
        .map(([, data]) => String(data.displayName || data.username || 'Someone')),
    [activity, now, uid],
  );

  const otherMemberId = (conversation: Rec | null | undefined): string =>
    String(
      (conversation?.memberIds || []).find((id: string) => id !== uid) ?? '',
    );

  const getConversationName = (conversation: Rec | null | undefined) => {
    if (!conversation) return 'Conversation';
    if (conversation.type === 'group') return conversation.name || 'Group';

    const member = conversation.memberProfiles?.[otherMemberId(conversation)];
    return member?.displayName || member?.username || 'User';
  };

  const getConversationUsername = (conversation: Rec | null | undefined) => {
    if (!conversation || conversation.type === 'group') return '';
    return (
      conversation.memberProfiles?.[otherMemberId(conversation)]?.username || ''
    );
  };

  const getDirectRequestState = (conversation: Rec | null | undefined) => {
    if (!conversation || conversation.type === 'group') return '';
    // If the conversation already has existing messages or history, it is an active conversation
    if (messages.length > 0 || conversation.lastMessageAt) return 'accepted';
    const targetUid = otherMemberId(conversation);
    const outgoing = sentDMRequests.find((request) => request.toUid === targetUid);
    if (outgoing?.status) return String(outgoing.status);
    if (dmRequests.some((request) => request.fromUid === targetUid)) return 'incoming';
    return String(conversation.requestStatus || '');
  };

  const isKeyboardOpen = Boolean(
    visualHeight &&
      typeof window !== 'undefined' &&
      visualHeight < window.innerHeight - 80,
  );

  const mentionSuggestions = useMemo(() => {
    if (!selectedConversation) return [];
    const list: { id: string; handle: string; name: string; isHere?: boolean }[] = [];

    if (selectedConversation.type === 'group') {
      const ids: string[] = selectedConversation.memberIds || [];
      ids.forEach((memberId) => {
        if (memberId === uid) return;
        const prof = selectedConversation.memberProfiles?.[memberId];
        const handle =
          prof?.username ||
          prof?.displayName?.toLowerCase().replace(/\s+/g, '_') ||
          'user';
        const name = prof?.displayName || prof?.username || 'User';
        list.push({ id: memberId, handle, name });
      });
    } else {
      const otherId = otherMemberId(selectedConversation);
      const otherProf = selectedConversation.memberProfiles?.[otherId];
      const handle =
        otherProf?.username ||
        otherProf?.displayName?.toLowerCase().replace(/\s+/g, '_') ||
        'user';
      const name = otherProf?.displayName || otherProf?.username || 'User';
      list.push({ id: otherId || 'other', handle, name });
    }

    list.push({
      id: 'here',
      handle: 'here',
      name: 'Notify all members in this conversation',
      isHere: true,
    });

    return list;
  }, [selectedConversation, uid]);

  const filteredMentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionSuggestions.filter(
      (s) =>
        s.handle.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q),
    );
  }, [mentionQuery, mentionSuggestions]);

  const activeComposerMentions = useMemo(() => {
    if (!messageText) return [];
    const matches = messageText.match(/(?:^|\s)@[a-zA-Z0-9_]+(?![a-zA-Z0-9_])/g) || [];
    return Array.from(new Set(matches.map((m) => m.trim())));
  }, [messageText]);

  const isFavorite = (conversation: Rec | null | undefined) => {
    if (!conversation?.id || !me) return false;
    if (conversation.id in optimisticFavorites) {
      return optimisticFavorites[conversation.id];
    }
    return Boolean(conversation?.favoriteBy?.[me]);
  };

  const isUrgent = (conversation: Rec | null | undefined) =>
    Boolean(conversation?.urgentFor?.[me]);

  const filteredConversations = useMemo(() => {
    let rows = [...conversations];

    const text = chatFilter.trim().toLowerCase();

    if (text) {
      rows = rows.filter((item) => {
        const name = String(getConversationName(item)).toLowerCase();
        const username = String(getConversationUsername(item)).toLowerCase();
        const preview = String(item.lastMessageText || '').toLowerCase();
        return (
          name.includes(text) || username.includes(text) || preview.includes(text)
        );
      });
    }

    rows.sort((a, b) => {
      // 1. Starred / Favorite at the top
      const favA = isFavorite(a) ? 1 : 0;
      const favB = isFavorite(b) ? 1 : 0;
      if (favA !== favB) return favB - favA;

      // 2. Mentioned / Urgent right below starred
      const urgA = isUrgent(a) ? 1 : 0;
      const urgB = isUrgent(b) ? 1 : 0;
      if (urgA !== urgB) return urgB - urgA;

      // 3. Followed by newest message
      return (
        millis(b.lastMessageAt || b.updatedAt) -
        millis(a.lastMessageAt || a.updatedAt)
      );
    });

    return rows;
  }, [conversations, chatFilter, uid, optimisticFavorites]);

  // ----------------------------------------------------------
  // CONVERSATION ACTIONS
  // ----------------------------------------------------------

  const markRead = async (conversation: Rec | null | undefined) => {
    if (!uid || !conversation?.id) return;

    try {
      await updateDoc(doc(db, 'conversations', conversation.id), {
        [`lastReadAt.${uid}`]: serverTimestamp(),
        [`urgentFor.${uid}`]: false,
      });
    } catch (error) {
      console.error('Unable to mark conversation as read:', error);
    }
  };

  // Keep the chat marked as read while new messages arrive.
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    if (screen !== 'conversation' || !selected?.id || !lastMessage) return;
    if (lastMessage.senderId !== uid) void markRead(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage?.id, screen, selected?.id]);

  // Scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, screen, typingNames.length]);

  // Clear mention suggestions whenever switching conversations, screens, or when text is empty
  useEffect(() => {
    setMentionQuery(null);
    setMentionSelectedIndex(0);
  }, [screen, selected?.id]);

  useEffect(() => {
    if (!messageText) {
      setMentionQuery(null);
      setMentionSelectedIndex(0);
    }
  }, [messageText]);

  const openConversation = async (conversation: Rec) => {
    if (!conversation?.id) return;

    setSelected(conversation);
    setScreen('conversation');
    setPendingDmMessages([]);

    const savedDraft =
      typeof window !== 'undefined'
        ? localStorage.getItem(`shinzi_draft_${conversation.id}`) || ''
        : '';
    setMessageText(savedDraft);
    setReplyTarget(null);
    setMentionQuery(null);
    setMentionSelectedIndex(0);
    await markRead(conversation);

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 140)}px`;
        syncBackdropScroll();
      }
    }, 50);
  };

  const openDirectConversation = async (otherUser: Rec) => {
    if (!uid || !otherUser?.id) return;

    if (otherUser.id === uid) {
      notify('Not available', 'You cannot open a direct chat with yourself.');
      return;
    }

    const id = directId(uid, otherUser.id);
    const conversationRef = doc(db, 'conversations', id);
    const isFriend = friends.some((friend) => friend.id === otherUser.id || friend.uid === otherUser.id);

    try {
      const existing = await getDoc(conversationRef);

      if (!existing.exists()) {
        if (!isFriend) {
          notify('Message request needed', 'Send a message to start a request before a private conversation can open.');
          return;
        }
        await setDoc(conversationRef, {
          type: 'direct',
          memberIds: [uid, otherUser.id],
          memberProfiles: {
            [uid]: {
              displayName:
                profile?.displayName || user?.displayName || 'User',
              username: profile?.username || '',
            },
            [otherUser.id]: {
              displayName:
                otherUser.displayName || otherUser.username || 'User',
              username: otherUser.username || '',
            },
          },
          favoriteBy: { [uid]: false, [otherUser.id]: false },
          urgentFor: { [uid]: false, [otherUser.id]: false },
          lastReadAt: { [uid]: serverTimestamp() },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastMessageAt: null,
          lastMessageText: '',
          lastSenderId: null,
          hasChatIntro: true,
        });
      }

      const snapshot = await getDoc(conversationRef);
      await openConversation({ id, ...snapshot.data() });
    } catch (error) {
      console.error('Unable to open direct conversation:', error);
      notify('Unable to open chat', messageOf(error));
    }
  };

  const openMessageEntry = async (otherUser: Rec) => {
    if (!uid || !otherUser?.id || otherUser.id === uid) return;

    const conversationId = directId(uid, otherUser.id);
    const isFriend = friends.some((friend) => friend.id === otherUser.id || friend.uid === otherUser.id);
    const existingConversation = conversations.find((item) => item.id === conversationId);

    if (isFriend && existingConversation) {
      await openConversation(existingConversation);
      return;
    }
    if (isFriend) {
      await openDirectConversation(otherUser);
      return;
    }

    try {
      const [outgoingSnap, incomingSnap] = await Promise.all([
        getDoc(doc(db, 'dmRequests', `${uid}_${otherUser.id}`)),
        getDoc(doc(db, 'dmRequests', `${otherUser.id}_${uid}`)),
      ]);
      const outgoing = outgoingSnap.exists() ? outgoingSnap.data() : null;
      const incoming = incomingSnap.exists() ? incomingSnap.data() : null;
      const pendingRequest = outgoing?.status === 'pending'
        ? outgoing
        : incoming?.status === 'pending'
          ? incoming
          : null;

      if (existingConversation && !pendingRequest) {
        await openConversation(existingConversation);
        return;
      }

      const requestStatus = outgoing?.status === 'pending'
        ? 'pending'
        : incoming?.status === 'pending'
          ? 'incoming'
          : 'new';
      const queuedRequest = requestStatus === 'pending' ? outgoing : requestStatus === 'incoming' ? incoming : null;
      const queuedMessages = Array.isArray(queuedRequest?.messages)
        ? queuedRequest.messages
        : queuedRequest?.message
          ? [{
              id: `${queuedRequest.fromUid}_${queuedRequest.toUid}_0`,
              type: 'text',
              text: queuedRequest.message,
              senderId: queuedRequest.fromUid,
              senderName: queuedRequest.fromProfile?.displayName || queuedRequest.fromProfile?.username || 'User',
              senderUsername: queuedRequest.fromProfile?.username || '',
              senderPhotoURL: queuedRequest.fromProfile?.photoURL || '',
              senderProfileAssetId: queuedRequest.fromProfile?.profileAssetId || '',
              createdAt: millis(queuedRequest.createdAt) || Date.now(),
              deleted: false,
            }]
          : [];
      setPendingDmMessages(queuedMessages);
      setSelected({
        id: conversationId,
        type: 'direct',
        memberIds: [uid, otherUser.id],
        memberProfiles: {
          [uid]: {
            displayName: profile?.displayName || user?.displayName || 'User',
            username: profile?.username || '',
            photoURL: profile?.photoURL || '',
            profileAssetId: profile?.profileAssetId || '',
          },
          [otherUser.id]: {
            displayName: otherUser.displayName || otherUser.username || 'User',
            username: otherUser.username || '',
            photoURL: otherUser.photoURL || '',
            profileAssetId: otherUser.profileAssetId || '',
          },
        },
        requestStatus,
        requestMessage: pendingRequest?.message || '',
        hasChatIntro: existingConversation?.hasChatIntro ?? true,
      });
      setScreen('conversation');
      setMessageText('');
      setReplyTarget(null);
      setMentionQuery(null);
    } catch (error) {
      console.error('Unable to open message request preview:', error);
      notify('Unable to open chat', messageOf(error));
    }
  };

  useEffect(() => {
    if (!uid || loadingChats || loadingFriends) return;
    const params = new URLSearchParams(window.location.search);
    const targetUid = params.get('user') || '';
    if (!targetUid || targetUid === uid || autoOpenedUserRef.current === targetUid) return;
    autoOpenedUserRef.current = targetUid;

    void (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', targetUid));
        if (!userSnap.exists()) {
          notify('Profile unavailable', 'That user could not be found.');
          return;
        }
        await openMessageEntry({ id: userSnap.id, ...userSnap.data() });
      } finally {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('user');
        window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    })();
  }, [uid, loadingChats, loadingFriends]);

const handleSearchMessage = async (target: Rec) => {
  if (!uid || !target?.id || target.id === uid) return;
  await openMessageEntry(target);
};


  const publishTyping = async (typing: boolean) => {
    if (!uid || !selected?.id) return;
    const activeConversation = selectedConversation || selected;
    if (
      activeConversation?.type !== 'group' &&
      ['new', 'pending', 'incoming'].includes(getDirectRequestState(activeConversation))
    ) return;

    try {
      await setDoc(
        doc(db, 'conversations', selected.id, 'activity', uid),
        {
          uid,
          typing,
          displayName: profile?.displayName || profile?.username || 'Someone',
          username: profile?.username || '',
          updatedAt: serverTimestamp(),
          expiresAt: new Date(Date.now() + (typing ? 6000 : 1000)),
        },
        { merge: true },
      );
    } catch (error) {
      console.error('Typing state error:', error);
    }
  };

  const checkMentionToken = (text: string, textarea?: HTMLTextAreaElement | null) => {
    const el = textarea || inputRef.current;
    const cursor = el ? el.selectionStart : text.length;
    const textBefore = text.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);

    if (match) {
      setMentionQuery(match[1]);
      setMentionSelectedIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (handle: string) => {
    const el = inputRef.current;
    const cursor = el ? el.selectionStart : messageText.length;
    const textBefore = messageText.slice(0, cursor);
    const textAfter = messageText.slice(cursor);

    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }

    const atIndex = match.index! + match[0].lastIndexOf('@');
    const inserted = `@${handle} `;
    const nextText = textBefore.slice(0, atIndex) + inserted + textAfter;
    const newCursor = atIndex + inserted.length;

    setMessageText(nextText);
    setMentionQuery(null);

    if (el) {
      el.value = nextText;
      el.setSelectionRange(newCursor, newCursor);
      el.focus({ preventScroll: true });
    }
  };

  const handleMessageChange = (text: string, el?: HTMLTextAreaElement) => {
    if (text.length > MAX_MESSAGE_LENGTH) {
      notify(
        'Message too long',
        `Messages can contain up to ${MAX_MESSAGE_LENGTH} characters.`,
      );
      return;
    }

    setMessageText(text);
    checkMentionToken(text, el);

    if (selected?.id) {
      try {
        if (text.trim()) {
          localStorage.setItem(`shinzi_draft_${selected.id}`, text);
        } else {
          localStorage.removeItem(`shinzi_draft_${selected.id}`);
        }
      } catch {}
    }

    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }
    syncBackdropScroll();

    if (!selected?.id || !uid) return;

    void publishTyping(Boolean(text.trim()));

    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void publishTyping(false);
    }, 5000);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastMessageTimer.current) window.clearTimeout(toastMessageTimer.current);
    toastMessageTimer.current = window.setTimeout(() => {
      setToastMessage('');
    }, 2500);
  };

  const copyMessageText = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast('Copied text to clipboard');
    } catch {
      showToast('Failed to copy');
    }
  };

  const handleToggleReaction = async (msg: Rec, emoji: string) => {
    if (!uid || !selected?.id || msg.deleted) return;
    try {
      const msgRef = doc(db, 'conversations', selected.id, 'messages', msg.id);
      const current = (msg.reactions || {}) as Record<string, string[]>;
      const list = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
      const idx = list.indexOf(uid);
      if (idx > -1) {
        list.splice(idx, 1);
      } else {
        list.push(uid);
        const updated = saveRecentEmoji(emoji);
        setRecentEmojis(updated);
      }
      const updatedReactions = { ...current };
      if (list.length === 0) {
        delete updatedReactions[emoji];
      } else {
        updatedReactions[emoji] = list;
      }
      await updateDoc(msgRef, {
        reactions: updatedReactions,
      });
    } catch (err) {
      console.error('[REACTIONS] Failed to toggle reaction:', err);
    }
  };

  const startEditing = (msg: Rec) => {
    if (!msg || msg.deleted) return;
    setReplyTarget(null);
    setEditingMessage(msg);
    setMessageText(msg.text || '');
    if (inputRef.current && screen === 'conversation' && selected?.id) {
      inputRef.current.focus({ preventScroll: true });
    }
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setMessageText('');
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!selected?.id) return;
    try {
      await updateDoc(doc(db, 'conversations', selected.id, 'messages', msgId), {
        deleted: true,
        text: '',
        reactions: {},
      });
      showToast('Message deleted');
    } catch (err) {
      console.error('[CHAT] Failed to delete message:', err);
    }
  };

  const startReply = (msg: Rec) => {
    if (!msg || msg.deleted) return;
    setEditingMessage(null);
    setReplyTarget(msg);
    if (inputRef.current && screen === 'conversation' && selected?.id) {
      inputRef.current.focus({ preventScroll: true });
    }
  };

  const scrollToMessage = (targetMessageId?: string) => {
    if (!targetMessageId) {
      notify('Unavailable', 'Original message unavailable.');
      return;
    }
    const el = document.getElementById(`shc-msg-${targetMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('shc-msg-highlight');
      void el.offsetWidth;
      el.classList.add('shc-msg-highlight');
      window.setTimeout(() => {
        el.classList.remove('shc-msg-highlight');
      }, 1500);
    } else {
      notify('Unavailable', 'Original message unavailable.');
    }
  };

  const sendMessage = async () => {
    if (!uid || !selected?.id || sendingRef.current) return;

    if (editingMessage) {
      const msgId = editingMessage.id;
      const newText = messageText.trim();
      if (newText) {
        try {
          await updateDoc(
            doc(db, 'conversations', selected.id, 'messages', msgId),
            {
              text: newText,
              editedAt: serverTimestamp(),
            },
          );
        } catch (e) {
          console.error('[CHAT] Failed to edit message:', e);
        }
      }
      setEditingMessage(null);
      setMessageText('');
      return;
    }

    const text = messageText.trim();
    if (!text) return;

    const activeConv = selectedConversation || selected;
    const directTargetUid = activeConv?.type === 'group' ? '' : otherMemberId(activeConv);
    const hasExistingHistory = messages.length > 0 || Boolean(activeConv?.lastMessageAt);
    if (directTargetUid && !hasExistingHistory) {
      const isFriend = friends.some((friend) => friend.id === directTargetUid || friend.uid === directTargetUid);
      const requestState = getDirectRequestState(activeConv);

      if (!isFriend && requestState === 'pending') {
        const queuedMessage: Rec = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'text',
          text,
          senderId: uid,
          senderName: profile?.displayName || profile?.username || 'User',
          senderUsername: profile?.username || '',
          senderPhotoURL: profile?.photoURL || '',
          senderProfileAssetId: profile?.profileAssetId || '',
          createdAt: Date.now(),
          editedAt: null,
          deleted: false,
        };
        sendingRef.current = true;
        setSending(true);
        try {
          await updateDoc(doc(db, 'dmRequests', `${uid}_${directTargetUid}`), {
            messages: arrayUnion(queuedMessage),
            updatedAt: serverTimestamp(),
          });
          setPendingDmMessages((previous) => [...previous, queuedMessage]);
          setMessageText('');
          setReplyTarget(null);
          setMentionQuery(null);
        } catch (error) {
          console.error('Queue pending DM error:', error);
          notify('Message not saved', messageOf(error, 'Unable to queue this message.'));
        } finally {
          sendingRef.current = false;
          setSending(false);
        }
        return;
      }

      if (!isFriend && requestState === 'incoming') {
        notify(
          'Message request received',
          'Accept their message request from your requests before replying.',
        );
        return;
      }

      if (!isFriend && requestState !== 'accepted') {
        const targetProfile = activeConv?.memberProfiles?.[directTargetUid] || {};
        const queuedMessage: Rec = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'text',
          text,
          senderId: uid,
          senderName: profile?.displayName || profile?.username || 'User',
          senderUsername: profile?.username || '',
          senderPhotoURL: profile?.photoURL || '',
          senderProfileAssetId: profile?.profileAssetId || '',
          createdAt: Date.now(),
          editedAt: null,
          deleted: false,
        };
        sendingRef.current = true;
        setSending(true);
        try {
          const didSendRequest = await sendRequest('dmRequests', {
            id: directTargetUid,
            displayName: targetProfile.displayName || getConversationName(activeConv),
            username: targetProfile.username || getConversationUsername(activeConv),
            photoURL: targetProfile.photoURL || '',
            profileAssetId: targetProfile.profileAssetId || '',
          }, text, queuedMessage);
          if (didSendRequest) {
            setSelected((previous) => previous ? {
              ...previous,
              requestStatus: 'pending',
              requestMessage: text,
            } : previous);
            setPendingDmMessages([queuedMessage]);
            setMessageText('');
            setReplyTarget(null);
            setMentionQuery(null);
          }
        } finally {
          sendingRef.current = false;
          setSending(false);
        }
        return;
      }
    }

    sendingRef.current = true;
    setSending(true);

    try {
      const targetReply =
        replyTarget && messages.some((m) => m.id === replyTarget.id)
          ? replyTarget
          : null;

      const messageData: Rec = {
        type: 'text',
        text,
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        senderPhotoURL: profile?.photoURL || '',
        senderProfileAssetId: profile?.profileAssetId || '',
        createdAt: serverTimestamp(),
        editedAt: null,
        deleted: false,
      };

      if (targetReply) {
        messageData.replyToMessageId = targetReply.id;
        messageData.replyTo = {
          id: targetReply.id,
          senderId: targetReply.senderId || '',
          senderName:
            targetReply.senderName || targetReply.senderUsername || 'User',
          senderUsername: targetReply.senderUsername || '',
          text: getReplyExcerpt(targetReply),
        };
      }

      const messageRef = await addDoc(
        collection(db, 'conversations', selected.id, 'messages'),
        messageData,
      );

      const updates: Rec = {
        lastMessageId: messageRef.id,
        lastMessageText: text,
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        updatedAt: serverTimestamp(),
      };

      // Mark mentioned users (and all participants if @here is present) as urgent; leave everyone else alone.
      const hasHere = /(^|[^a-zA-Z0-9_])@here(?![a-zA-Z0-9_])/i.test(text);

      (activeConv?.memberIds || []).forEach((memberId: string) => {
        if (memberId === uid) return;
        const memberProfile = activeConv?.memberProfiles?.[memberId];
        if (
          hasHere ||
          isMentioned(text, memberProfile?.username, memberProfile?.displayName)
        ) {
          updates[`urgentFor.${memberId}`] = true;
        }
      });

      await updateDoc(doc(db, 'conversations', selected.id), updates);

      if (selected?.id) {
        try {
          localStorage.removeItem(`shinzi_draft_${selected.id}`);
        } catch {}
      }

      setMessageText('');
      setReplyTarget(null);
      setMentionQuery(null);
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        if (screen === 'conversation' && selected?.id) {
          inputRef.current.focus({ preventScroll: true });
        }
      }
      void publishTyping(false);
    } catch (error) {
      console.error('Send message error:', error);
      notify('Message not sent', messageOf(error, 'Unable to send this message.'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex(
          (prev) => (prev + 1) % filteredMentionSuggestions.length,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex(
          (prev) =>
            (prev - 1 + filteredMentionSuggestions.length) %
            filteredMentionSuggestions.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentionSuggestions[mentionSelectedIndex].handle);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    // Enter sends on desktop; on touch screens it adds a new line.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      window.matchMedia('(pointer: fine)').matches
    ) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const toggleFavorite = async (conversation: Rec | null) => {
    if (!uid || !conversation?.id) return;
    const convId = conversation.id;
    const nextVal = !isFavorite(conversation);

    setOptimisticFavorites((prev) => ({ ...prev, [convId]: nextVal }));

    try {
      await updateDoc(doc(db, 'conversations', convId), {
        [`favoriteBy.${uid}`]: nextVal,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setOptimisticFavorites((prev) => {
        const copy = { ...prev };
        delete copy[convId];
        return copy;
      });
      console.error('Favorite update error:', error);
      notify('Unable to update favorite', messageOf(error));
    }
  };

  // ----------------------------------------------------------
  // FRIEND + DM REQUESTS
  // ----------------------------------------------------------

  const sendRequest = async (
    kind: 'friendRequests' | 'dmRequests',
    target: Rec,
    message = '',
    queuedMessage?: Rec,
  ) => {
    if (!uid || !target?.id) return false;

    const label = kind === 'friendRequests' ? 'friend request' : 'DM request';

    if (target.id === uid) {
      notify('Not available', `You cannot send yourself a ${label}.`);
      return false;
    }

    if (kind === 'friendRequests') {
      const isAlreadyFriend = friends.some((friend) => friend.id === target.id || friend.uid === target.id);
      if (isAlreadyFriend) {
        notify('Already friends', `You and @${target.username || 'user'} are already friends.`);
        return false;
      }
    }

    setSendingRequestId(target.id);

    try {
      const requestRef = doc(db, kind, `${uid}_${target.id}`);
      let isAlreadyPending = false;

      try {
        const existing = await getDoc(requestRef);
        if (existing.exists() && existing.data()?.status === 'pending') {
          isAlreadyPending = true;
        }
      } catch {
        // Preflight check error should not prevent write attempt
      }

      if (isAlreadyPending) {
        if (kind === 'friendRequests') notify('Already sent', `A ${label} is already pending.`);
        if (kind === 'friendRequests') {
          setSentRequestUids((prev) => new Set(prev).add(target.id));
        }
          return false;
      }

      await setDoc(requestRef, {
        fromUid: uid,
        toUid: target.id,
        fromProfile: {
          displayName: profile?.displayName || profile?.username || 'User',
          username: profile?.username || '',
          photoURL: profile?.photoURL || '',
          profileAssetId: profile?.profileAssetId || '',
        },
        toProfile: {
          displayName: target.displayName || target.username || 'User',
          username: target.username || '',
          photoURL: target.photoURL || '',
          profileAssetId: target.profileAssetId || '',
        },
        ...(kind === 'dmRequests' && message ? {
          message,
          messages: [queuedMessage || {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'text',
            text: message,
            senderId: uid,
            senderName: profile?.displayName || profile?.username || 'User',
            senderUsername: profile?.username || '',
            senderPhotoURL: profile?.photoURL || '',
            senderProfileAssetId: profile?.profileAssetId || '',
            createdAt: Date.now(),
            deleted: false,
          }],
        } : {}),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (kind === 'friendRequests') {
        setSentRequestUids((prev) => new Set(prev).add(target.id));
      }
      if (kind === 'friendRequests') notify('Request sent', `Your ${label} was sent.`);
      return true;
    } catch (error) {
      console.error('Request error:', error);
      notify('Unable to send request', messageOf(error));
      return false;
    } finally {
      setSendingRequestId(null);
    }
  };

  const setRequestStatus = async (
    kind: 'friendRequests' | 'dmRequests',
    request: Rec,
    status: 'rejected',
  ) => {
    if (!request?.id) return;

    try {
      await updateDoc(doc(db, kind, request.id), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Reject request error:', error);
      notify('Unable to reject', messageOf(error));
    }
  };

  const acceptFriendRequest = async (request: Rec) => {
    if (!uid || !request?.id) return;

    const fromUid: string = request.fromUid;
    if (!fromUid || fromUid === uid) return;

    try {
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, 'friendRequests', request.id);
        const senderFriendRef = doc(db, 'users', fromUid, 'friends', uid);
        const receiverFriendRef = doc(db, 'users', uid, 'friends', fromUid);

        const requestSnap = await transaction.get(requestRef);

        if (!requestSnap.exists()) {
          throw new Error('This friend request no longer exists.');
        }

        const data = requestSnap.data();

        if (data.status && data.status !== 'pending') {
          throw new Error('This friend request has already been handled.');
        }

        transaction.set(
          senderFriendRef,
          {
            uid,
            username: profile?.username || '',
            displayName: profile?.displayName || profile?.username || 'User',
            addedAt: serverTimestamp(),
          },
          { merge: true },
        );

        transaction.set(
          receiverFriendRef,
          {
            uid: fromUid,
            username: data.fromProfile?.username || '',
            displayName:
              data.fromProfile?.displayName ||
              data.fromProfile?.username ||
              'User',
            addedAt: serverTimestamp(),
          },
          { merge: true },
        );

        transaction.update(requestRef, {
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });
      });

      notify('Friend added', 'You are now friends.');
    } catch (error) {
      console.error('Accept friend request error:', error);
      notify('Unable to accept', messageOf(error));
    }
  };

  const acceptDMRequest = async (request: Rec) => {
    if (!uid || !request?.id) return;

    const fromUid: string = request.fromUid;
    if (!fromUid || fromUid === uid) return;

    const conversationId = directId(uid, fromUid);

    try {
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, 'dmRequests', request.id);
        const conversationRef = doc(db, 'conversations', conversationId);

        const requestSnap = await transaction.get(requestRef);

        if (!requestSnap.exists()) {
          throw new Error('This DM request no longer exists.');
        }

        const data = requestSnap.data();

        if (data.status && data.status !== 'pending') {
          throw new Error('This DM request has already been handled.');
        }

        const conversationSnap = await transaction.get(conversationRef);

        const queuedMessages: Rec[] = Array.isArray(data.messages) && data.messages.length
          ? data.messages.filter((item: Rec) => String(item?.text || '').trim())
          : String(data.message || '').trim()
            ? [{ id: `${request.id}_0`, text: String(data.message).trim(), createdAt: data.createdAt }]
            : [];
        const finalQueuedMessage = queuedMessages[queuedMessages.length - 1];
        const conversationData: Rec = {
          type: 'direct',
          memberIds: [uid, fromUid],
          memberProfiles: {
            [uid]: {
              displayName: profile?.displayName || profile?.username || 'User',
              username: profile?.username || '',
              photoURL: profile?.photoURL || '',
              profileAssetId: profile?.profileAssetId || '',
            },
            [fromUid]: {
              displayName: data.fromProfile?.displayName || data.fromProfile?.username || 'User',
              username: data.fromProfile?.username || '',
              photoURL: data.fromProfile?.photoURL || '',
              profileAssetId: data.fromProfile?.profileAssetId || '',
            },
          },
          favoriteBy: { [uid]: Boolean(conversationSnap.data()?.favoriteBy?.[uid]), [fromUid]: Boolean(conversationSnap.data()?.favoriteBy?.[fromUid]) },
          urgentFor: { [uid]: false, [fromUid]: false },
          lastReadAt: { [uid]: serverTimestamp() },
          createdAt: conversationSnap.data()?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
          hasChatIntro: conversationSnap.data()?.hasChatIntro ?? true,
          ...(finalQueuedMessage ? {
            lastMessageId: finalQueuedMessage.id || `${request.id}_${queuedMessages.length - 1}`,
            lastMessageText: String(finalQueuedMessage.text),
            lastMessageAt: serverTimestamp(),
            lastSenderId: fromUid,
          } : {}),
        };
        transaction.set(conversationRef, conversationData, { merge: true });

        queuedMessages.forEach((item: Rec, index: number) => {
          const messageId = String(item.id || `${request.id}_${index}`);
          transaction.set(doc(db, 'conversations', conversationId, 'messages', messageId), {
            type: 'text',
            text: String(item.text).trim(),
            senderId: fromUid,
            dmRequestId: request.id,
            senderName: data.fromProfile?.displayName || data.fromProfile?.username || 'User',
            senderUsername: data.fromProfile?.username || '',
            senderPhotoURL: data.fromProfile?.photoURL || '',
            senderProfileAssetId: data.fromProfile?.profileAssetId || '',
            createdAt: typeof item.createdAt === 'number'
              ? new Date(item.createdAt)
              : item.createdAt || data.createdAt || serverTimestamp(),
            editedAt: null,
            deleted: false,
          });
        });

        transaction.update(requestRef, {
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });
      });

      notify('DM request accepted', 'The conversation is ready.');
    } catch (error) {
      console.error('Accept DM request error:', error);
      notify('Unable to accept DM request', messageOf(error));
    }
  };

  // ----------------------------------------------------------
  // USER SEARCH
  // ----------------------------------------------------------

  const searchUser = async () => {
    const username = userQuery.trim().toLowerCase().replace(/^@/, '');

    if (!username) {
      setSearchResult(null);
      return;
    }

    setSearching(true);

    try {
      const usernameSnap = await getDoc(doc(db, 'usernames', username));

      if (!usernameSnap.exists()) {
        setSearchResult(null);
        notify('Not found', 'No user was found with that username.');
        return;
      }

      const targetUid: string | undefined = usernameSnap.data()?.uid;

      if (!targetUid) {
        setSearchResult(null);
        return;
      }

      if (targetUid === uid) {
        setSearchResult({ ...(profile || {}), id: targetUid });
        return;
      }

      const userSnap = await getDoc(doc(db, 'users', targetUid));

      if (!userSnap.exists()) {
        setSearchResult(null);
        notify('Not found', 'That user profile could not be loaded.');
        return;
      }

      setSearchResult({ id: userSnap.id, ...userSnap.data() });

      if (uid && targetUid) {
        try {
          const reqSnap = await getDoc(doc(db, 'friendRequests', `${uid}_${targetUid}`));
          if (reqSnap.exists() && reqSnap.data()?.status === 'pending') {
            setSentRequestUids((prev) => new Set(prev).add(targetUid));
          } else {
            setSentRequestUids((prev) => {
              const next = new Set(prev);
              next.delete(targetUid);
              return next;
            });
          }
        } catch {}
      }
    } catch (error) {
      console.error('User search error:', error);
      notify('Search failed', messageOf(error, 'Unable to search right now.'));
    } finally {
      setSearching(false);
    }
  };

  // ----------------------------------------------------------
  // GROUPS, POLLS, EVENTS
  // ----------------------------------------------------------

  const createGroup = async () => {
    if (!uid || creatingGroup) return;

    const name = groupName.trim();

    if (!name) {
      notify('Group name required', 'Please enter a group name.');
      return;
    }

    const selectedFriends = friends.filter((friend) => groupSelected[friend.id]);

    if (!selectedFriends.length) {
      notify('Add friends', 'Select at least one friend.');
      return;
    }

    setCreatingGroup(true);

    try {
      const memberIds = [uid, ...selectedFriends.map((friend) => friend.id)];

      const memberProfiles: Rec = {
        [uid]: {
          displayName: profile?.displayName || profile?.username || 'User',
          username: profile?.username || '',
        },
      };

      selectedFriends.forEach((friend) => {
        memberProfiles[friend.id] = {
          displayName: friend.displayName || friend.username || 'User',
          username: friend.username || '',
        };
      });

      const favoriteBy: Rec = {};
      const urgentFor: Rec = {};
      const lastReadAt: Rec = {};

      memberIds.forEach((memberId) => {
        favoriteBy[memberId] = false;
        urgentFor[memberId] = false;
        lastReadAt[memberId] = null;
      });

      lastReadAt[uid] = serverTimestamp();

      const conversationRef = await addDoc(collection(db, 'conversations'), {
        type: 'group',
        name,
        description: groupDescription.trim(),
        memberIds,
        memberProfiles,
        favoriteBy,
        urgentFor,
        lastReadAt,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessageAt: null,
        lastMessageText: '',
        lastSenderId: null,
      });

      const snapshot = await getDoc(conversationRef);

      setShowGroup(false);
      setGroupName('');
      setGroupDescription('');
      setGroupSelected({});

      await openConversation({ id: conversationRef.id, ...snapshot.data() });
    } catch (error) {
      console.error('Create group error:', error);
      notify('Unable to create group', messageOf(error));
    } finally {
      setCreatingGroup(false);
    }
  };

  const addPollOption = () => {
    if (pollOptions.length >= MAX_POLL_OPTIONS) {
      notify('Limit reached', `A poll can have up to ${MAX_POLL_OPTIONS} options.`);
      return;
    }
    setPollOptions((options) => [...options, '']);
  };

  const updatePollOption = (index: number, value: string) =>
    setPollOptions((options) =>
      options.map((option, i) => (i === index ? value : option)),
    );

  const removePollOption = (index: number) => {
    if (pollOptions.length <= 2) {
      notify('Poll needs options', 'A poll needs at least two options.');
      return;
    }
    setPollOptions((options) => options.filter((_, i) => i !== index));
  };

  const createPoll = async () => {
    if (!uid || !selected?.id || creatingPoll) return;

    const question = pollQuestion.trim();
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);

    if (!question) {
      notify('Question required', 'Enter a poll question.');
      return;
    }

    if (options.length < 2) {
      notify('More options required', 'Add at least two poll options.');
      return;
    }

    setCreatingPoll(true);

    try {
      await addDoc(collection(db, 'conversations', selected.id, 'messages'), {
        type: 'poll',
        question,
        description: pollDescription.trim(),
        options,
        votes: Object.fromEntries(options.map((_, index) => [index, 0])),
        voters: {},
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        createdAt: serverTimestamp(),
        deleted: false,
      });

      await updateDoc(doc(db, 'conversations', selected.id), {
        lastMessageText: `Poll: ${question}`,
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        updatedAt: serverTimestamp(),
      });

      setPollQuestion('');
      setPollDescription('');
      setPollOptions(['', '']);
      setPanel(null);
    } catch (error) {
      console.error('Create poll error:', error);
      notify('Unable to create poll', messageOf(error));
    } finally {
      setCreatingPoll(false);
    }
  };

  const votePoll = async (message: Rec, optionIndex: number) => {
    if (!uid || !selected?.id || !message?.id) return;

    try {
      await runTransaction(db, async (transaction) => {
        const messageRef = doc(
          db,
          'conversations',
          selected.id,
          'messages',
          message.id,
        );

        const snap = await transaction.get(messageRef);

        if (!snap.exists()) throw new Error('This poll no longer exists.');

        const data = snap.data();

        if (data.type !== 'poll') throw new Error('This message is not a poll.');

        const voters: Rec = { ...(data.voters || {}) };
        const votes: Rec = { ...(data.votes || {}) };
        const previousVote = voters[uid];

        if (previousVote !== undefined && previousVote !== null) {
          const oldIndex = Number(previousVote);
          votes[oldIndex] = Math.max(0, Number(votes[oldIndex] || 0) - 1);
        }

        if (Number(previousVote) === Number(optionIndex)) {
          delete voters[uid];
        } else {
          voters[uid] = optionIndex;
          votes[optionIndex] = Number(votes[optionIndex] || 0) + 1;
        }

        transaction.update(messageRef, {
          voters,
          votes,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      console.error('Vote poll error:', error);
      notify('Unable to vote', messageOf(error));
    }
  };

  const createEvent = async () => {
    if (!uid || !selected?.id || creatingEvent) return;

    const name = eventName.trim();

    if (!name) {
      notify('Event name required', 'Enter an event name.');
      return;
    }

    setCreatingEvent(true);

    try {
      await addDoc(collection(db, 'conversations', selected.id, 'messages'), {
        type: 'event',
        name,
        description: eventDescription.trim(),
        start: eventStart.trim(),
        end: eventEnd.trim(),
        attendees: {},
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        createdAt: serverTimestamp(),
        deleted: false,
      });

      await updateDoc(doc(db, 'conversations', selected.id), {
        lastMessageText: `Event: ${name}`,
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        updatedAt: serverTimestamp(),
      });

      setEventName('');
      setEventDescription('');
      setEventStart('');
      setEventEnd('');
      setPanel(null);
    } catch (error) {
      console.error('Create event error:', error);
      notify('Unable to create event', messageOf(error));
    } finally {
      setCreatingEvent(false);
    }
  };

  const toggleEventAttendance = async (message: Rec) => {
    if (!uid || !selected?.id || !message?.id) return;

    try {
      await runTransaction(db, async (transaction) => {
        const messageRef = doc(
          db,
          'conversations',
          selected.id,
          'messages',
          message.id,
        );

        const snap = await transaction.get(messageRef);

        if (!snap.exists()) throw new Error('This event no longer exists.');

        const data = snap.data();

        if (data.type !== 'event') throw new Error('This message is not an event.');

        const attendees: Rec = { ...(data.attendees || {}) };

        if (attendees[uid]) {
          delete attendees[uid];
        } else {
          attendees[uid] = { uid, joinedAt: new Date().toISOString() };
        }

        transaction.update(messageRef, {
          attendees,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      console.error('Event attendance error:', error);
      notify('Unable to update attendance', messageOf(error));
    }
  };

  // ----------------------------------------------------------
  // MEDIA / VOICE / CALL (UI ONLY — NOT CONNECTED YET)
  // ----------------------------------------------------------

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    notify(
      'Photo selected',
      'Picking photos works, but Drive upload and sending attachments are not enabled yet.',
    );
  };

  const toggleRecordingUI = () => {
    if (recording) {
      setRecording(false);

      if (recordingTimer.current) {
        window.clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }

      notify(
        'Voice recording',
        'Recording UI stopped. Real audio recording and upload are not built yet.',
      );
      return;
    }

    setRecordSeconds(0);
    setRecording(true);

    recordingTimer.current = window.setInterval(() => {
      setRecordSeconds((seconds) => {
        if (seconds >= 3599) {
          if (recordingTimer.current) window.clearInterval(recordingTimer.current);
          recordingTimer.current = null;
          setRecording(false);
          return seconds;
        }
        return seconds + 1;
      });
    }, 1000);
  };

  const startCallUI = (mode: 'voice' | 'video') => {
    setCallMode(mode);
    setShowCall(true);
  };

  // ----------------------------------------------------------
  // NAVIGATION
  // ----------------------------------------------------------

  const navigateTo = (target: 'ai' | 'servers' | 'profile') => {
    if (onNavigate) {
      onNavigate(target);
    } else if (target === 'profile') {
      navigateToUrl('/profile');
    } else {
      notify(target === 'ai' ? 'AI' : 'Servers', 'This screen is not connected yet.');
    }
  };

  const openUserProfile = (profileUid?: string) => {
    if (!profileUid) return;
    navigateToUrl(
      profileUid === uid
        ? '/profile'
        : `/profile?uid=${encodeURIComponent(profileUid)}`,
    );
  };

  const goBack = () => {
    if (screen === 'conversation') {
      void publishTyping(false);
      setSelected(null);
      setScreen('main');
      setMessageText('');
      setReplyTarget(null);
      setMentionQuery(null);
      setMentionSelectedIndex(0);
      setPanel(null);
      setShowAttach(false);
      return;
    }

    if (screen !== 'main') {
      setScreen('main');
      return;
    }

    navigateTo('profile');
  };

  // ----------------------------------------------------------
  // RENDER HELPERS
  // ----------------------------------------------------------

  const renderBackHeader = (title: string) => (
    <header className="shc-subheader">
      <button
        type="button"
        className="shc-icon-btn"
        onClick={goBack}
        aria-label="Go back"
      >
        <ArrowLeft size={23} />
      </button>
      <h1>{title}</h1>
    </header>
  );

  const renderPoll = (poll: Rec) => (
    <div className="shc-card shc-poll">
      <strong className="shc-card-title">{poll.question}</strong>

      {!!poll.description && <p className="shc-card-text">{poll.description}</p>}

      {(poll.options || []).map((option: string, index: number) => {
        const votes = Number(poll.votes?.[index] || 0);
        const percent = pollPercent(poll, index);
        const chosen = Number(poll.voters?.[me]) === index;

        return (
          <button
            type="button"
            key={`${poll.id}-option-${index}`}
            className={chosen ? 'shc-poll-option shc-poll-chosen' : 'shc-poll-option'}
            onClick={() => void votePoll(poll, index)}
          >
            <span className="shc-poll-top">
              <span>{option}</span>
              <span>{percent}%</span>
            </span>
            <span className="shc-poll-track">
              <span className="shc-poll-fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="shc-poll-votes">
              {votes} {votes === 1 ? 'vote' : 'votes'}
            </span>
          </button>
        );
      })}

      <span className="shc-card-foot">{pollTotal(poll)} total votes</span>
    </div>
  );

  const renderEvent = (event: Rec) => {
    const joined = Boolean(event.attendees?.[me]);
    const count = Object.keys(event.attendees || {}).length;

    return (
      <div className="shc-card shc-event">
        <div className="shc-event-icon">
          <Calendar size={24} />
        </div>

        <div className="shc-event-body">
          <strong className="shc-card-title">{event.name}</strong>
          {!!event.description && <p className="shc-card-text">{event.description}</p>}
          {!!event.start && <span className="shc-card-foot">Start: {event.start}</span>}
          {!!event.end && <span className="shc-card-foot">End: {event.end}</span>}
          <span className="shc-card-foot">
            {count} {count === 1 ? 'person' : 'people'} joined
          </span>

          <button
            type="button"
            className={joined ? 'shc-join shc-join-on' : 'shc-join'}
            onClick={() => void toggleEventAttendance(event)}
          >
            {joined ? 'Joined' : 'Join'}
          </button>
        </div>
      </div>
    );
  };

  const renderReactions = (item: Rec) => {
    const reactions = (item.reactions || {}) as Record<string, string[]>;
    const entries = Object.entries(reactions).filter(
      ([, uids]) => Array.isArray(uids) && uids.length > 0,
    );
    if (entries.length === 0) return null;

    return (
      <div className="shc-dc-reactions">
        {entries.map(([emoji, uids]) => {
          const count = uids.length;
          const hasReacted = Boolean(uid && uids.includes(uid));
          return (
            <button
              key={emoji}
              type="button"
              className={`shc-dc-reaction-pill ${hasReacted ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleToggleReaction(item, emoji);
              }}
              title={`${count} ${count === 1 ? 'person' : 'people'} reacted`}
            >
              <span className="shc-reaction-emoji">{emoji}</span>
              <span className="shc-reaction-count">{count}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="shc-dc-reaction-pill shc-dc-reaction-add"
          onClick={(e) => {
            e.stopPropagation();
            setActionMessage(item);
            setShowEmojiPicker(true);
          }}
          title="Add reaction"
        >
          <SmilePlus size={14} />
        </button>
      </div>
    );
  };

  const renderMessage = (item: Rec, index: number, messageList: Rec[] = messages) => {
    const own = item.senderId === uid;
    const previous = messageList[index - 1];
    const showDay =
      millis(item.createdAt) > 0 &&
      (!previous || dayKey(previous.createdAt) !== dayKey(item.createdAt));

    const replyId = item.replyToMessageId || item.replyTo?.id;
    const original = replyId ? messageList.find((m) => m.id === replyId) : null;

    let quotedSender = 'User';
    let quotedText = 'Original message unavailable';
    let quotedSenderId = '';

    if (replyId) {
      if (original) {
        quotedSenderId = original.senderId || '';
        if (original.deleted) {
          quotedSender =
            original.senderId === uid
              ? 'You'
              : original.senderName ||
                original.senderUsername ||
                'User';
          quotedText = 'Original message was deleted';
        } else {
          quotedSender =
            original.senderId === uid
              ? 'You'
              : original.senderName ||
                original.senderUsername ||
                'User';
          quotedText = getReplyExcerpt(original);
        }
      } else if (item.replyTo) {
        quotedSenderId = item.replyTo.senderId || '';
        quotedSender =
          item.replyTo.senderId === uid
            ? 'You'
            : item.replyTo.senderName ||
              item.replyTo.senderUsername ||
              'User';
        quotedText = item.replyTo.text || 'Original message unavailable';
      }
    }

    const authorName = own
      ? profile?.displayName || profile?.username || 'You'
      : item.senderName || item.senderUsername || 'User';

    const mentionedMe =
      !own &&
      (isMentioned(item.text, profile?.username, profile?.displayName) ||
        Boolean(item.text?.includes('@here')));

    let contentNode: ReactNode;

    if (item.deleted) {
      contentNode = (
        <span className="shc-dc-deleted">This message was deleted.</span>
      );
    } else if (item.type === 'poll') {
      contentNode = renderPoll(item);
    } else if (item.type === 'event') {
      contentNode = renderEvent(item);
    } else if (item.type === 'voice') {
      contentNode = (
        <div className="shc-voice">
          <Mic size={20} />
          <span>Voice message</span>
          <span className="shc-voice-time">{item.duration || '00:00'}</span>
        </div>
      );
    } else {
      const singleEmoji = isSingleEmoji(item.text);
      contentNode = singleEmoji ? (
        <span className="shc-dc-jumbo-emoji">{item.text.trim()}</span>
      ) : (
        <span className="shc-dc-text">{renderFormattedText(item.text)}</span>
      );
    }

    const messageContent = (
      <div
        className={`shc-dc-msg ${mentionedMe ? 'shc-dc-msg-highlight' : ''}`}
        onDoubleClick={() => !item.deleted && startReply(item)}
      >
        {replyId && (
          <div
            role="button"
            tabIndex={0}
            className="shc-dc-reply-spine"
            onClick={(e) => {
              e.stopPropagation();
              scrollToMessage(replyId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                scrollToMessage(replyId);
              }
            }}
            title="Jump to original message"
            aria-label="Jump to original message"
          >
            <div className="shc-dc-reply-line" />
            <UserAvatar uid={quotedSenderId} name={quotedSender} size="xs" />
            <span className="shc-dc-reply-sender">{quotedSender}</span>
            <span className="shc-dc-reply-text">{quotedText}</span>
          </div>
        )}

        <div className="shc-dc-main">
          <button
            type="button"
            className="shc-dc-avatar-col shc-profile-trigger"
            onClick={(event) => {
              event.stopPropagation();
              openUserProfile(item.senderId);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            aria-label={`Open ${authorName}'s profile`}
          >
            <UserAvatar
              uid={item.senderId}
              name={authorName}
              photoURL={item.senderPhotoURL}
              profileAssetId={item.senderProfileAssetId}
              size="md"
            />
          </button>

          <div className="shc-dc-body-col">
            <div className="shc-dc-header">
              <button
                type="button"
                className={`shc-dc-author shc-profile-trigger ${own ? 'shc-dc-author-me' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openUserProfile(item.senderId);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                aria-label={`Open ${authorName}'s profile`}
              >
                {authorName}
              </button>
              <span className="shc-dc-timestamp">
                {formatDiscordTimestamp(item.createdAt)}
              </span>
            </div>

            <div className="shc-dc-content">
              {contentNode}
              {item.editedAt && (
                <span className="shc-dc-edited">(edited)</span>
              )}
            </div>
            {renderReactions(item)}
          </div>

        </div>
      </div>
    );

    return (
      <div key={item.id} id={`shc-msg-${item.id}`}>
        {showDay && <div className="shc-day">{dateLabel(item.createdAt)}</div>}
        <SwipeableMessage
          item={item}
          own={own}
          onReply={startReply}
          onLongPress={(msg) => setActionMessage(msg)}
        >
          {messageContent}
        </SwipeableMessage>
      </div>
    );
  };

  const renderBottomNav = () => (
    <nav className="shc-bottom" aria-label="Main navigation">
      <button
        type="button"
        onClick={() => navigateTo('ai')}
        aria-label="AI"
      >
        <Sparkles size={22} />
      </button>

      <button
        type="button"
        onClick={() => navigateTo('servers')}
        aria-label="Servers"
      >
        <Server size={22} />
      </button>

      <button
        type="button"
        className={screen === 'main' ? 'shc-bottom-active' : ''}
        onClick={() => {
          setSelected(null);
          setScreen('main');
        }}
        aria-label="Chat"
      >
        <MessageCircle size={23} />
        {unreadCount > 0 && <Badge count={unreadCount} />}
      </button>

      <button
        type="button"
        className={screen === 'search' ? 'shc-bottom-active' : ''}
        onClick={() => setScreen('search')}
        aria-label="Search"
      >
        <Search size={22} />
      </button>

      <button
        type="button"
        onClick={() => navigateTo('profile')}
        aria-label="Profile"
        className="shc-bottom-profile-btn"
      >
        <UserAvatar
          uid={uid}
          name={profile?.displayName || profile?.username || 'User'}
          photoURL={profile?.photoURL}
          profileAssetId={profile?.profileAssetId}
          size="nav"
        />
      </button>
    </nav>
  );


  // ----------------------------------------------------------
  // SCREENS
  // ----------------------------------------------------------

  const renderMain = () => (
    <>
      <header className="shc-header">
        <h1>Chats</h1>

        <div className="shc-header-actions">
          <button
            type="button"
            className="shc-icon-btn"
            onClick={() => setScreen('notifications')}
            aria-label="Notifications"
          >
            <Bell size={21} />
            {friendRequests.length + dmRequests.length > 0 && (
              <Badge count={friendRequests.length + dmRequests.length} />
            )}
          </button>

          <button
            type="button"
            className="shc-icon-btn"
            onClick={() => setShowGroup(true)}
            aria-label="Create group"
          >
            <Plus size={22} />
          </button>
        </div>
      </header>

      <div className="shc-list">
        {loadingChats ? (
          <div className="shc-loading">
            <span className="shc-spinner" />
          </div>
        ) : !filteredConversations.length ? (
          <EmptyState
            icon={<MessagesSquare size={44} />}
            title="No chats"
            text="Your conversations will appear here."
          />
        ) : (
          filteredConversations.map((item) => {
            const unread =
              millis(item.lastMessageAt) > millis(item.lastReadAt?.[me]) &&
              item.lastSenderId !== uid;
            const name = getConversationName(item);

            return (
              <button
                type="button"
                key={item.id}
                className="shc-conv"
                onClick={() => void openConversation(item)}
              >
                <UserAvatar
                  uid={item.type === 'group' ? undefined : otherMemberId(item)}
                  name={name}
                  photoURL={
                    item.type === 'group'
                      ? undefined
                      : item.memberProfiles?.[otherMemberId(item)]?.photoURL
                  }
                  profileAssetId={
                    item.type === 'group'
                      ? undefined
                      : item.memberProfiles?.[otherMemberId(item)]?.profileAssetId
                  }
                  group={item.type === 'group'}
                  size="md"
                />

                <span className="shc-conv-body">
                  <span className="shc-conv-top">
                    <span className={unread ? 'shc-conv-name shc-unread' : 'shc-conv-name'}>
                      {name}
                    </span>
                    <span className="shc-conv-time">{formatTime(item.lastMessageAt)}</span>
                  </span>

                  <span className="shc-conv-bottom">
                    <span className={unread ? 'shc-conv-preview shc-unread' : 'shc-conv-preview'}>
                      {item.lastMessageText || 'No messages yet'}
                    </span>

                    <span className="shc-conv-icons">
                      {isFavorite(item) && <Star size={15} className="shc-star" />}
                      {isUrgent(item) && <AlertCircle size={16} className="shc-urgent" />}
                      {unread && <span className="shc-unread-dot" />}
                    </span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      

      
    </>
  );

  const renderPeople = (
    title: string,
    rows: Rec[],
    loading: boolean,
    empty: ReactNode,
    renderRow: (item: Rec) => ReactNode,
  ) => (
    <>
      {renderBackHeader(title)}
      <div className="shc-list shc-padded">
        {loading ? (
          <div className="shc-loading">
            <span className="shc-spinner" />
          </div>
        ) : rows.length === 0 ? (
          empty
        ) : (
          rows.map(renderRow)
        )}
      </div>
    </>
  );

  const renderFriends = () =>
    renderPeople(
      'Friends',
      friends,
      loadingFriends,
      <EmptyState
        icon={<Users size={44} />}
        title="No friends"
        text="Search for users and send friend requests."
      />,
      (item) => (
        <button
          type="button"
          key={item.id}
          className="shc-person"
          onClick={() => void openDirectConversation(item)}
        >
          <UserAvatar
            uid={item.id}
            name={item.displayName || item.username}
            photoURL={item.photoURL}
            profileAssetId={item.profileAssetId}
            size="md"
          />
          <span className="shc-person-info">
            <strong>{item.displayName || item.username || 'User'}</strong>
            <span>@{item.username || 'user'}</span>
          </span>
          <MessageCircle size={21} />
        </button>
      ),
    );

  const renderRequestRow = (
    kind: 'friendRequests' | 'dmRequests',
    accept: (request: Rec) => Promise<void>,
  ) =>
    function Row(item: Rec) {
      return (
        <div key={`${kind}:${item.id}`} className="shc-request">
          <UserAvatar
            uid={item.fromUid || item.fromProfile?.uid}
            name={item.fromProfile?.displayName || item.fromProfile?.username}
            photoURL={item.fromProfile?.photoURL}
            profileAssetId={item.fromProfile?.profileAssetId}
            size="md"
          />

          <span className="shc-person-info">
            <strong>
              {item.fromProfile?.displayName || item.fromProfile?.username || 'User'}
            </strong>
            <span>
              {kind === 'friendRequests' ? 'Friend request' : 'DM request'}
              {' · '}@{item.fromProfile?.username || 'user'}
            </span>
            {kind === 'dmRequests' && item.message && (
              <span className="shc-request-preview">“{item.message}”</span>
            )}
          </span>

          <button
            type="button"
            className="shc-circle shc-accept"
            onClick={() => void accept(item)}
            aria-label="Accept"
          >
            <Check size={19} />
          </button>

          <button
            type="button"
            className="shc-circle shc-reject"
            onClick={() => void setRequestStatus(kind, item, 'rejected')}
            aria-label="Reject"
          >
            <X size={19} />
          </button>
        </div>
      );
    };

  const renderFriendRequests = () =>
    renderPeople(
      'Friend requests',
      friendRequests,
      false,
      <EmptyState
        icon={<UserPlus size={44} />}
        title="No friend requests"
        text="New friend requests will appear here."
      />,
      renderRequestRow('friendRequests', acceptFriendRequest),
    );

  const renderNotifications = () => {
    const requests: Rec[] = [
      ...friendRequests.map((item): Rec => ({ ...item, _requestKind: 'friendRequests' })),
      ...dmRequests.map((item): Rec => ({ ...item, _requestKind: 'dmRequests' })),
    ].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

    return renderPeople(
      'Notifications',
      requests,
      false,
      <EmptyState
        icon={<Bell size={44} />}
        title="No notifications received"
        text="New notifications will appear here."
      />,
      (item) => {
        const kind = item._requestKind as 'friendRequests' | 'dmRequests';
        const accept = kind === 'friendRequests' ? acceptFriendRequest : acceptDMRequest;
        return renderRequestRow(kind, accept)(item);
      },
    );
  };

  const renderSearch = () => (
    <>
      <header className="shc-header">
        <div>
          <h1>Search</h1>
        </div>
      </header>

      <div className="shc-list shc-padded">
        <div className="shc-searchbox shc-searchbox-big">
          {searching ? (
            <span className="shc-spinner shc-spinner-sm" aria-hidden="true" />
          ) : (
            <Search size={20} aria-hidden="true" />
          )}
          <input
            placeholder="Username"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void searchUser();
            }}
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
          />
        </div>

        {searchResult ? (
          <div className="shc-request shc-result">
            <button
              type="button"
              className="shc-search-profile-trigger"
              onClick={() => openUserProfile(searchResult.id)}
              aria-label={`Open ${searchResult.displayName || searchResult.username || 'user'}'s profile`}
            >
              <UserAvatar
                key={searchResult.id}
                uid={searchResult.id}
                name={searchResult.displayName || searchResult.username}
                photoURL={searchResult.photoURL}
                profileAssetId={searchResult.profileAssetId}
                size="md"
              />

              <span className="shc-person-info">
                <strong>{searchResult.displayName || searchResult.username || 'User'}</strong>
                <span>@{searchResult.username || 'user'}</span>
              </span>
            </button>

            {searchResult.id !== uid && (() => {
              const isFriend = friends.some((f) => f.id === searchResult.id || f.uid === searchResult.id);
              const isPending = sentRequestUids.has(searchResult.id);

              return (
                <>
                  {!isFriend && (
                    <button
                      type="button"
                      className="shc-circle"
                      onClick={() => void sendRequest('friendRequests', searchResult)}
                      disabled={sendingRequestId === searchResult.id || isPending}
                      title={isPending ? 'Request sent' : 'Add friend'}
                      aria-label={isPending ? 'Request sent' : 'Add friend'}
                    >
                      {sendingRequestId === searchResult.id ? (
                        <span className="shc-spinner shc-spinner-sm" />
                      ) : isPending ? (
                        <Check size={19} />
                      ) : (
                        <UserPlus size={19} />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    className="shc-circle"
                    onClick={() => {
                      setSelected({
                        id: directId(uid!, searchResult.id),
                        type: 'direct',
                        memberIds: [uid!, searchResult.id],
                        memberProfiles: {
                          [uid!]: {
                            displayName: profile?.displayName || profile?.username || 'User',
                            username: profile?.username || '',
                          },
                          [searchResult.id]: {
                            displayName: searchResult.displayName || searchResult.username || 'User',
                            username: searchResult.username || '',
                          },
                        },
                      });
                      startCallUI('voice');
                    }}
                    aria-label="Call"
                  >
                    <Phone size={19} />
                  </button>

                  <button
                    type="button"
                    className="shc-circle"
                    onClick={() => void handleSearchMessage(searchResult)}
                    aria-label="Message"
                  >
                    <MessageCircle size={19} />
                  </button>
                </>
              );
            })()}
          </div>
        ) : (
          <EmptyState
            icon={<Search size={44} />}
            title="Find someone"
            text="Search using their exact Shinzi username."
          />
        )}
      </div>
    </>
  );

  const renderConversation = () => {
    const name = getConversationName(selectedConversation);
    const username = getConversationUsername(selectedConversation);
    const isGroup = selectedConversation?.type === 'group';
    const fav = isFavorite(selectedConversation);
    const targetUid = isGroup ? undefined : otherMemberId(selectedConversation);
    const targetProfile = targetUid ? selectedConversation?.memberProfiles?.[targetUid] : undefined;
    const dmRequestState = getDirectRequestState(selectedConversation);
    const conversationMessages = (messages && messages.length > 0)
      ? messages
      : (pendingDmMessages && pendingDmMessages.length > 0
          ? pendingDmMessages
          : messages);
    const hasFirstContactIntro = Boolean(
      targetUid && selectedConversation?.hasChatIntro && conversationMessages.length === 0
    );
    const composerPlaceholder = isGroup
      ? `Message #${name}`
      : username
        ? `Message @${username}`
        : `Message @${name}`;

    return (
      <>
        <header className="shc-chat-head">
          <button
            type="button"
            className="shc-icon-btn"
            onClick={goBack}
            aria-label="Go back"
          >
            <ArrowLeft size={23} />
          </button>

          {targetUid ? (
            <button
              type="button"
              className="shc-chat-avatar-trigger"
              onClick={() => openUserProfile(targetUid)}
              aria-label={`Open ${name}'s profile`}
            >
              <UserAvatar
                uid={targetUid}
                name={name}
                photoURL={targetProfile?.photoURL}
                profileAssetId={targetProfile?.profileAssetId}
                size="sm"
              />
            </button>
          ) : (
            <UserAvatar
              uid={undefined}
              name={name}
              group={isGroup}
              size="md"
            />
          )}

          {targetUid ? (
            <button
              type="button"
              className="shc-chat-title shc-chat-title-trigger"
              onClick={() => openUserProfile(targetUid)}
              aria-label={`Open ${name}'s profile`}
            >
              <strong>
                <span className="shc-chat-title-name">{name}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </strong>
            </button>
          ) : (
            <div className="shc-chat-title">
              <strong>{name}</strong>
              <span>{`${selectedConversation?.memberIds?.length || 0} members`}</span>
            </div>
          )}

          <button
            type="button"
            className="shc-icon-btn"
            onClick={() => void toggleFavorite(selectedConversation)}
            aria-label={fav ? 'Remove favorite' : 'Add favorite'}
          >
            <Star size={21} className={fav ? 'shc-star shc-star-on' : ''} />
          </button>

          {!isGroup && (
            <>
              <button
                type="button"
                className="shc-icon-btn"
                onClick={() => startCallUI('voice')}
                aria-label="Voice call"
              >
                <Phone size={21} />
              </button>

              <button
                type="button"
                className="shc-icon-btn"
                onClick={() => startCallUI('video')}
                aria-label="Video call"
              >
                <Video size={21} />
              </button>
            </>
          )}
        </header>

        <div className="shc-messages" ref={scrollRef}>
          {hasFirstContactIntro && targetUid && (
              <div className="shc-dm-intro">
                <UserAvatar
                  uid={targetUid}
                  name={name}
                  photoURL={targetProfile?.photoURL}
                  profileAssetId={targetProfile?.profileAssetId}
                  size="md"
                  className="shc-dm-intro-avatar"
                />
                <h2>{name}</h2>
                <span className="shc-dm-intro-username">@{username || 'user'}</span>
                <p>This is the first time talking to @{username || 'user'}.</p>
                <div className="shc-dm-intro-actions">
                  <button type="button" title="Block is not connected yet">
                    <Ban size={16} aria-hidden="true" /> Block
                  </button>
                  <button type="button" title="Report is not connected yet">
                    <Flag size={16} aria-hidden="true" /> Report
                  </button>
                </div>
              </div>
          )}
          {conversationMessages.length === 0 ? (
            !hasFirstContactIntro && (
              <EmptyState
                icon={<MessageCircle size={44} />}
                title="Start the conversation"
                text="Send a message to begin."
              />
            )
          ) : (
            conversationMessages.map((item, index) => renderMessage(item, index, conversationMessages))
          )}
        </div>

        {typingNames.length > 0 && (
          <div className="shc-typing">
            <span className="shc-typing-dots">
              <i />
              <i />
              <i />
            </span>
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}

        {recording && (
          <div className="shc-recording">
            <span className="shc-rec-dot" />
            <span>Recording {formatDuration(recordSeconds)}</span>
            <button type="button" onClick={toggleRecordingUI}>
              Stop
            </button>
          </div>
        )}

        {replyTarget && (
          <div className="shc-reply-bar">
            <div className="shc-reply-bar-left">
              <Reply size={16} className="shc-reply-bar-icon" />
              <div className="shc-reply-bar-content">
                <span className="shc-reply-bar-sender">
                  Replying to{' '}
                  {replyTarget.senderId === uid
                    ? 'yourself'
                    : replyTarget.senderName ||
                      replyTarget.senderUsername ||
                      'User'}
                </span>
                <span className="shc-reply-bar-text">
                  {getReplyExcerpt(replyTarget)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="shc-reply-bar-close"
              onClick={() => setReplyTarget(null)}
              title="Cancel reply"
              aria-label="Cancel reply"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {editingMessage && (
          <div className="shc-editing-banner">
            <div className="shc-editing-info">
              <Pencil size={15} className="shc-editing-icon" />
              <span>Editing message</span>
            </div>
            <button
              type="button"
              className="shc-editing-cancel"
              onClick={cancelEditing}
              title="Cancel editing"
              aria-label="Cancel editing"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="shc-composer-wrap">
          {mentionQuery !== null && filteredMentionSuggestions.length > 0 && (
            <div
              className="shc-mention-panel"
              role="listbox"
              aria-label="Mention suggestions"
            >
              {filteredMentionSuggestions.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={idx === mentionSelectedIndex}
                  className={`shc-mention-item ${
                    idx === mentionSelectedIndex ? 'shc-mention-item-active' : ''
                  }`}
                  onPointerDown={(e) => {
                    // Prevent blur so mobile keyboard stays open!
                    e.preventDefault();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => insertMention(item.handle)}
                >
                  <span className="shc-mention-item-badge">
                    {item.isHere ? <Megaphone size={14} /> : <AtSign size={14} />}
                  </span>
                  <div className="shc-mention-item-details">
                    <span className="shc-mention-item-handle">@{item.handle}</span>
                    {item.isHere && item.name && (
                      <span className="shc-mention-item-desc">{item.name}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div
            className={
              isKeyboardOpen ? 'shc-composer shc-composer-kb' : 'shc-composer'
            }
          >
            <button
              type="button"
              className="shc-icon-btn shc-accent-btn"
              onClick={() => setShowAttach(true)}
              aria-label="Attach"
            >
              <Plus size={26} />
            </button>

            <div
              className={`shc-composer-input-box ${
                activeComposerMentions.length > 0
                  ? 'shc-composer-has-mentions'
                  : ''
              }`}
            >
              <div
                className="shc-composer-backdrop"
                aria-hidden="true"
                ref={backdropRef}
              >
                {renderComposerFormattedText(messageText)}
              </div>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder={composerPlaceholder}
                value={messageText}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(e) => handleMessageChange(e.target.value, e.target)}
                onKeyDown={onComposerKey}
                onClick={(e) => checkMentionToken(messageText, e.currentTarget)}
                onKeyUp={(e) => checkMentionToken(messageText, e.currentTarget)}
                onScroll={syncBackdropScroll}
                onFocus={() => {
                  window.requestAnimationFrame(() => {
                    if (scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }
                  });
                }}
              />
            </div>

            <button
              type="button"
              className={recording ? 'shc-icon-btn shc-rec-on' : 'shc-icon-btn'}
              onClick={toggleRecordingUI}
              aria-label={recording ? 'Stop recording' : 'Record voice message'}
            >
              {recording ? <Square size={22} /> : <Mic size={23} />}
            </button>

            <button
              type="button"
              className="shc-send"
              disabled={!messageText.trim() || sending || (Boolean(targetUid) && dmRequestState === 'incoming')}
              onPointerDown={(e) => {
                // Crucial for mobile virtual keyboards:
                // Calling preventDefault on pointerdown stops the button tap from blurring the textarea,
                // keeping the mobile keyboard open.
                e.preventDefault();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => void sendMessage()}
              aria-label="Send"
            >
              {sending ? <span className="shc-spinner shc-spinner-sm" /> : <Send size={19} />}
            </button>
          </div>

          {messageText.length > MAX_MESSAGE_LENGTH * 0.85 && (
            <div className="shc-counter">
              {messageText.length}/{MAX_MESSAGE_LENGTH}
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onPickImage}
        />
      </>
    );
  };

  // ----------------------------------------------------------
  // OVERLAYS
  // ----------------------------------------------------------

  const renderOverlays = () => (
    <>
      {showModes && (
        <Sheet title="Modes" onClose={() => setShowModes(false)}>
          <button
            type="button"
            className="shc-mode"
            onClick={() => notify('Social mode', 'Social mode is selected.')}
          >
            <span className="shc-mode-icon">
              <Users size={24} />
            </span>
            <span>
              <strong>Social</strong>
              <small>Chats, friends and social activity</small>
            </span>
          </button>

          <button
            type="button"
            className="shc-mode"
            onClick={() => notify('Games mode', 'Reserved for the future Games system.')}
          >
            <span className="shc-mode-icon">
              <Gamepad2 size={24} />
            </span>
            <span>
              <strong>Games</strong>
              <small>Game-related activity</small>
            </span>
          </button>

          <button
            type="button"
            className="shc-mode"
            onClick={() => {
              setShowModes(false);
              setScreen('search');
            }}
          >
            <span className="shc-mode-icon">
              <Search size={24} />
            </span>
            <span>
              <strong>Search</strong>
              <small>Find users by username</small>
            </span>
          </button>
        </Sheet>
      )}

      {showGroup && (
        <Sheet title="Create group" tall onClose={() => setShowGroup(false)}>
          <input
            className="shc-input"
            placeholder="Group name"
            value={groupName}
            maxLength={60}
            onChange={(e) => setGroupName(e.target.value)}
          />

          <textarea
            className="shc-input shc-input-multi"
            placeholder="Description"
            value={groupDescription}
            maxLength={300}
            onChange={(e) => setGroupDescription(e.target.value)}
          />

          <h3 className="shc-label">Add friends</h3>

          <div className="shc-picker">
            {friends.length === 0 ? (
              <EmptyState
                icon={<Users size={40} />}
                title="No friends yet"
                text="Add friends before creating a group."
              />
            ) : (
              friends.map((friend) => {
                const added = Boolean(groupSelected[friend.id]);

                return (
                  <button
                    type="button"
                    key={friend.id}
                    className="shc-picker-row"
                    onClick={() =>
                      setGroupSelected((current) => ({
                        ...current,
                        [friend.id]: !current[friend.id],
                      }))
                    }
                  >
                    <UserAvatar
                      uid={friend.id}
                      name={friend.displayName || friend.username}
                      photoURL={friend.photoURL}
                      profileAssetId={friend.profileAssetId}
                      size="sm"
                    />
                    <span className="shc-person-info">
                      <strong>{friend.displayName || friend.username || 'User'}</strong>
                      <span>@{friend.username || 'user'}</span>
                    </span>
                    <span className={added ? 'shc-pill shc-pill-on' : 'shc-pill'}>
                      {added ? 'Added' : 'Add'}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <p className="shc-count">
            {Object.values(groupSelected).filter(Boolean).length} added
          </p>

          <button
            type="button"
            className="shc-primary"
            disabled={creatingGroup}
            onClick={() => void createGroup()}
          >
            {creatingGroup ? <span className="shc-spinner shc-spinner-sm" /> : 'Create group'}
          </button>
        </Sheet>
      )}

      {screen === 'conversation' && showAttach && (
        <Sheet title="Attach" onClose={() => setShowAttach(false)}>
          <div className="shc-attach-grid">
            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                fileRef.current?.click();
              }}
            >
              <ImageIcon size={30} />
              Photo
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                setPanel('gif');
              }}
            >
              <Smile size={30} />
              GIF / Sticker
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                setPanel('poll');
              }}
            >
              <BarChart3 size={30} />
              Poll
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                setPanel('event');
              }}
            >
              <Calendar size={30} />
              Event
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                toggleRecordingUI();
              }}
            >
              <Mic size={30} />
              Voice
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                notify('File attachment', 'File upload is not connected yet.');
              }}
            >
              <FileText size={30} />
              File
            </button>
          </div>
        </Sheet>
      )}

      {screen === 'conversation' && panel === 'poll' && (
        <Sheet title="Create poll" tall onClose={() => setPanel(null)}>
          <input
            className="shc-input"
            placeholder="Question"
            value={pollQuestion}
            maxLength={300}
            onChange={(e) => setPollQuestion(e.target.value)}
          />

          <textarea
            className="shc-input shc-input-multi"
            placeholder="Description (optional)"
            value={pollDescription}
            maxLength={500}
            onChange={(e) => setPollDescription(e.target.value)}
          />

          <div className="shc-options">
            {pollOptions.map((option, index) => (
              <div className="shc-option-row" key={`poll-${index}`}>
                <input
                  className="shc-input"
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  maxLength={150}
                  onChange={(e) => updatePollOption(index, e.target.value)}
                />

                <button
                  type="button"
                  className="shc-icon-btn shc-danger"
                  onClick={() => removePollOption(index)}
                  aria-label={`Remove option ${index + 1}`}
                >
                  <XCircle size={22} />
                </button>
              </div>
            ))}

            <button type="button" className="shc-secondary" onClick={addPollOption}>
              <Plus size={18} /> Add option
            </button>
          </div>

          <button
            type="button"
            className="shc-primary"
            disabled={creatingPoll}
            onClick={() => void createPoll()}
          >
            {creatingPoll ? <span className="shc-spinner shc-spinner-sm" /> : 'Create poll'}
          </button>
        </Sheet>
      )}

      {screen === 'conversation' && panel === 'event' && (
        <Sheet title="Create event" tall onClose={() => setPanel(null)}>
          <input
            className="shc-input"
            placeholder="Event name"
            value={eventName}
            maxLength={120}
            onChange={(e) => setEventName(e.target.value)}
          />

          <textarea
            className="shc-input shc-input-multi"
            placeholder="Description"
            value={eventDescription}
            maxLength={500}
            onChange={(e) => setEventDescription(e.target.value)}
          />

          <input
            className="shc-input"
            placeholder="Start date / time"
            value={eventStart}
            maxLength={100}
            onChange={(e) => setEventStart(e.target.value)}
          />

          <input
            className="shc-input"
            placeholder="End date / time"
            value={eventEnd}
            maxLength={100}
            onChange={(e) => setEventEnd(e.target.value)}
          />

          <button
            type="button"
            className="shc-primary"
            disabled={creatingEvent}
            onClick={() => void createEvent()}
          >
            {creatingEvent ? <span className="shc-spinner shc-spinner-sm" /> : 'Create event'}
          </button>
        </Sheet>
      )}

      {screen === 'conversation' && panel === 'gif' && (
        <Sheet title="GIFs & stickers" tall onClose={() => setPanel(null)}>
          <div className="shc-segments">
            {(['gif', 'sticker'] as const).map((type) => (
              <button
                type="button"
                key={type}
                className={gifMode === type ? 'shc-segment shc-segment-on' : 'shc-segment'}
                onClick={() => setGifMode(type)}
              >
                {type === 'gif' ? 'GIF' : 'Sticker'}
              </button>
            ))}
          </div>

          <input
            className="shc-input"
            placeholder={`Search ${gifMode}s`}
            value={gifSearch}
            onChange={(e) => setGifSearch(e.target.value)}
          />

          <div className="shc-chips">
            {['normal', 'trending', 'funny', 'reaction', 'gaming'].map((category) => (
              <button
                type="button"
                key={category}
                className={gifCategory === category ? 'shc-chip shc-chip-on' : 'shc-chip'}
                onClick={() => setGifCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <EmptyState
            icon={gifMode === 'gif' ? <ImageIcon size={44} /> : <Smile size={44} />}
            title={gifSearch.trim() ? 'Search is ready' : 'GIF and sticker browser'}
            text="A GIF provider still needs to be connected, so nothing can be sent from here yet."
          />
        </Sheet>
      )}

      {screen === 'conversation' && showCall && (
        <div className="shc-call" role="dialog" aria-modal="true" aria-label="Call">
          <header className="shc-subheader">
            <button
              type="button"
              className="shc-icon-btn"
              onClick={() => setShowCall(false)}
              aria-label="Close call"
            >
              <X size={24} />
            </button>
            <h1>{callMode === 'video' ? 'Video call' : 'Voice call'}</h1>
          </header>

          <div className="shc-call-center">
            <Avatar name={getConversationName(selectedConversation)} />
            <h2>{getConversationName(selectedConversation)}</h2>
            <p>Calls are not connected yet, so this screen only shows the layout.</p>
          </div>

          <div className="shc-call-controls">
            <button
              type="button"
              className={callMuted ? 'shc-call-btn shc-call-btn-on' : 'shc-call-btn'}
              onClick={() => setCallMuted((value) => !value)}
              aria-label={callMuted ? 'Unmute' : 'Mute'}
            >
              {callMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>

            <button
              type="button"
              className="shc-call-btn shc-call-end"
              onClick={() => setShowCall(false)}
              aria-label="End call"
            >
              <PhoneOff size={25} />
            </button>

            {callMode === 'video' && (
              <button
                type="button"
                className="shc-call-btn"
                onClick={() => notify('Camera', 'Video is not connected yet.')}
                aria-label="Camera"
              >
                <Video size={24} />
              </button>
            )}
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="shc-toast" role="status">
          {toastMessage}
        </div>
      )}

      {actionMessage && !showEmojiPicker && (
        <div
          className="shc-sheet-backdrop"
          onClick={() => setActionMessage(null)}
        >
          <div
            className="shc-action-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shc-sheet-handle" />

            {/* Quick 5 Recent Emojis + SmilePlus */}
            <div className="shc-action-emoji-bar">
              {recentEmojis.slice(0, 5).map((em) => (
                <button
                  key={em}
                  type="button"
                  className="shc-action-emoji-btn"
                  onClick={() => {
                    const target = actionMessage;
                    setActionMessage(null);
                    void handleToggleReaction(target, em);
                  }}
                >
                  {em}
                </button>
              ))}
              <button
                type="button"
                className="shc-action-emoji-btn shc-action-emoji-btn-more"
                onClick={() => setShowEmojiPicker(true)}
                aria-label="More emojis"
              >
                <SmilePlus size={22} />
              </button>
            </div>

            {/* Discord Menu Options */}
            <div className="shc-action-menu">
              <button
                type="button"
                className="shc-action-item"
                onClick={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  startReply(target);
                }}
              >
                <CornerUpLeft size={19} />
                <span>Reply</span>
              </button>

              {actionMessage.senderId === uid &&
                !actionMessage.deleted &&
                !actionMessage.type && (
                  <button
                    type="button"
                    className="shc-action-item"
                    onClick={() => {
                      const target = actionMessage;
                      setActionMessage(null);
                      startEditing(target);
                    }}
                  >
                    <Pencil size={19} />
                    <span>Edit Message</span>
                  </button>
                )}

              {actionMessage.text && !actionMessage.deleted && (
                <button
                  type="button"
                  className="shc-action-item"
                  onClick={() => {
                    const textVal = actionMessage.text;
                    setActionMessage(null);
                    void copyMessageText(textVal);
                  }}
                >
                  <Copy size={19} />
                  <span>Copy Text</span>
                </button>
              )}

              {actionMessage.senderId === uid && !actionMessage.deleted && (
                <button
                  type="button"
                  className="shc-action-item shc-action-item-danger"
                  onClick={() => {
                    const id = actionMessage.id;
                    setActionMessage(null);
                    void handleDeleteMessage(id);
                  }}
                >
                  <Trash2 size={19} />
                  <span>Delete Message</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showEmojiPicker && (
        <div
          className="shc-sheet-backdrop"
          onClick={() => {
            setShowEmojiPicker(false);
            setActionMessage(null);
          }}
        >
          <div
            className="shc-emoji-picker-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shc-sheet-handle" />
            <Suspense
              fallback={
                <div className="shc-emoji-picker-loading" role="status">
                  <span className="shc-spinner shc-spinner-sm" />
                  <span>Loading emojis…</span>
                </div>
              }
            >
              <EmojiPicker
                className="shc-emoji-picker"
                components={{ CategoryButton: EmojiCategoryButton }}
                colorScheme="dark"
                emojiStyle="native"
                width="100%"
                height="100%"
                emojiData={loadEmojiPickerData}
                previewConfig={{ showPreview: false }}
                searchPlaceholder="Search all emojis"
                onEmojiClick={({ emoji }) => {
                  const updated = saveRecentEmoji(emoji);
                  setRecentEmojis(updated);

                  if (actionMessage) {
                    void handleToggleReaction(actionMessage, emoji);
                  } else {
                    setMessageText((previous) => previous + emoji);
                  }

                  setShowEmojiPicker(false);
                  setActionMessage(null);
                }}
              />
            </Suspense>
          </div>
        </div>
      )}
    </>
  );

  // ----------------------------------------------------------
  // PAGE
  // ----------------------------------------------------------

  if (authLoading) {
    return (
      <div className="shc-page shc-page-loading">
        <span className="shc-spinner" />
      </div>
    );
  }

  if (!uid) {
    return (
      <div
        className="shc-page"
        style={{
          ...(visualHeight ? { height: `${visualHeight}px` } : {}),
          ...(visualTop ? { top: `${visualTop}px` } : {}),
        }}
      >
        <EmptyState
          icon={<User size={44} />}
          title="Sign in required"
          text="Please sign in to use Shinzi Chat."
          action={
            <button
              type="button"
              className="shc-btn"
              style={{ marginTop: 16 }}
              onClick={() => {
                navigateToUrl('/');
              }}
            >
              Go to sign in
            </button>
          }
        />
      </div>
    );
  }

return (
  <div
    className="shc-page"
    style={{
      ...(visualHeight ? { height: `${visualHeight}px` } : {}),
      ...(visualTop ? { top: `${visualTop}px` } : {}),
    }}
  >
    <div className="shc-screen-content">
      {screen === 'conversation'
        ? renderConversation()
        : screen === 'friends'
          ? renderFriends()
          : screen === 'friendRequests'
            ? renderFriendRequests()
            : screen === 'notifications' || screen === 'dmRequests'
              ? renderNotifications()
              : screen === 'search'
                ? renderSearch()
                : renderMain()}
    </div>

    {screen !== 'conversation' && renderBottomNav()}

    {renderOverlays()}

    {toast && (
      <div className="shc-toast" role="status">
        <strong>{toast.title}</strong>
        {toast.text && <span>{toast.text}</span>}
      </div>
    )}
  </div>
);
}
