import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  AtSign,
  Ban,
  BarChart3,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  CornerUpLeft,
  ExternalLink,
  Flag,
  Gamepad2,
  Image as ImageIcon,
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
import OtherProfile from './OtherProfile';
import VoicePlayer from './VoicePlayer';
import {
  GoogleStickerIcon,
  GoogleFileIcon,
  GoogleGifIcon,
  GoogleImageIcon,
  GooglePlayIcon,
} from './GoogleIcons';
import { MediaGrid, type MediaItem } from './MediaGrid';
import { FileMessage } from './FileMessage';
import { compressImageToWebP } from './imageCompressor';
import { DateTimePickerModal } from './DateTimePickerModal';
import { searchKlipy, getCachedKlipy, type KlipyItem } from './klipyService';
import { cacheAudioBlob } from './voiceCache';
import { getUserEffectiveStatus, type EffectiveStatus } from './presenceService';
import MuiAvatar from '@mui/material/Avatar';
import {
  applyTextStyles,
  validateTextStyleSyntax,
  renderStyledContent,
  getUsedStylesData,
  importIncomingStyleData,
} from './textStyleService';
import './Chat.css';

interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
}

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
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (typeof value._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return parsed;
  }
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
  const ms = millis(value);
  const d = ms > 0 ? new Date(ms) : new Date();
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

const EMOJI_ONLY_REGEX = /^(?:\s*(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)\s*)+$/u;

const isEmojiOnly = (text?: string): boolean => {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return EMOJI_ONLY_REGEX.test(trimmed);
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

const renderFormattedText = (
  text: string,
  onMentionClick?: (mention: string) => void,
) => {
  if (!text) return null;
  const parts = text.split(/((?:^|[^\w@#])[@#][a-zA-Z0-9_-]+(?![a-zA-Z0-9_-]))/g);
  return parts.map((part, i) => {
    const match = part.match(/^([^\w@#]*)([@#][a-zA-Z0-9_-]+)$/);
    if (match) {
      const [, space, mention] = match;
      const isChannel = mention.startsWith('#');
      const isClickable = !isChannel && Boolean(onMentionClick);
      return (
        <span key={i}>
          {space}
          <span
            className={
              isChannel
                ? 'shc-channel-mention'
                : `shc-mention ${isClickable ? 'shc-mention-clickable' : ''}`
            }
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={
              isClickable
                ? (e) => {
                    e.stopPropagation();
                    onMentionClick?.(mention);
                  }
                : undefined
            }
            onKeyDown={
              isClickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onMentionClick?.(mention);
                    }
                  }
                : undefined
            }
            title={isClickable ? `View profile of ${mention}` : undefined}
          >
            {mention}
          </span>
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

const renderMentionColoredText = (text: string) => {
  if (!text) return null;
  const displayText = text.endsWith('\n') ? text + ' ' : text;
  const parts = displayText.split(/((?:^|\s)[@#][a-zA-Z0-9_-]*(?![a-zA-Z0-9_-]))/g);
  return parts.map((part, i) => {
    const match = part.match(/^(\s*)([@#][a-zA-Z0-9_-]*)$/);
    if (match) {
      const [, space, mention] = match;
      return (
        <span key={i}>
          {space}
          <span className="shc-composer-mention-text">{mention}</span>
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

const blobToDataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to convert blob to data URI.'));
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed.'));
    reader.readAsDataURL(blob);
  });

const isStandaloneImageUrl = (text?: string): string | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (/^https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i.test(trimmed)) {
    return trimmed;
  }
  const driveMatch = trimmed.match(/^https?:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|lh3\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]+)/i);
  if (driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}=s1600`;
  }
  return null;
};

const isPlainObject = (val: any): boolean => {
  if (!val || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
};

const sanitizeForFirestore = <T,>(obj: T): T => {
  if (obj === undefined) return null as any;
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore) as any;
  }
  if (!isPlainObject(obj)) {
    return obj;
  }
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      clean[key] = sanitizeForFirestore(val);
    }
  }
  return clean as any;
};

const isGifMessage = (msg: Rec | null | undefined): boolean => {
  if (!msg) return false;
  if (msg.type === 'gif') return true;
  const first = msg.mediaItems?.[0];
  if (first?.fileName?.toLowerCase().endsWith('.gif') || first?.mediaUrl?.includes('klipy')) return true;
  if (msg.fileName?.toLowerCase().endsWith('.gif') || msg.mediaUrl?.includes('klipy')) return true;
  return false;
};

const isStickerMessage = (msg: Rec | null | undefined): boolean => {
  if (!msg) return false;
  if (msg.type === 'sticker') return true;
  const first = msg.mediaItems?.[0];
  if (first?.fileName?.toLowerCase().endsWith('.sticker') || first?.type === 'sticker') return true;
  if (msg.fileName?.toLowerCase().endsWith('.sticker')) return true;
  return false;
};

const getReplyExcerpt = (msg: Rec | null | undefined): string => {
  if (!msg) return '';
  if (msg.deleted) return 'This message was deleted';
  if (msg.type === 'poll') return `Poll: ${msg.question || ''}`;
  if (msg.type === 'event') return `Event: ${msg.name || ''}`;
  if (msg.type === 'voice') return 'Voice message';
  if (msg.type === 'file') return msg.fileName || 'File';
  if (isStickerMessage(msg)) return msg.text || 'Sticker';
  if (isGifMessage(msg)) return msg.text || 'GIF';
  if (msg.type === 'video' || msg.mediaItems?.[0]?.type === 'video') return msg.text || 'Video';
  if (msg.type === 'image' || msg.type === 'media' || msg.driveFileId || msg.mediaUrl) return msg.text || 'Photo';
  const raw = String(msg.text || '').slice(0, 100);
  return raw.replace(/[({]ts\s+[a-zA-Z0-9_\s-]+?[)}]\s?/gi, '');
};

const renderReplyContent = (msg: Rec | null | undefined, textFallback?: string) => {
  if (!msg) return textFallback || '';
  if (msg.deleted) return 'This message was deleted';
  if (isGifMessage(msg)) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleGifIcon size={15} />
        {msg.text || 'GIF'}
      </span>
    );
  }
  if (isStickerMessage(msg)) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleStickerIcon size={14} />
        {msg.text || 'Sticker'}
      </span>
    );
  }
  const isVideo = msg.type === 'video' || msg.mediaItems?.[0]?.type === 'video';
  if (isVideo) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GooglePlayIcon size={14} />
        {msg.text || 'Video'}
      </span>
    );
  }
  const isPhoto = msg.type === 'image' || msg.type === 'media' || Boolean(msg.driveFileId) || Boolean(msg.mediaUrl);
  if (isPhoto) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleImageIcon size={14} />
        {msg.text || 'Photo'}
      </span>
    );
  }
  if (msg.type === 'file') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleFileIcon size={14} />
        {msg.fileName || 'File'}
      </span>
    );
  }
  if (msg.type === 'voice') return '🎤 Voice message';
  if (msg.type === 'poll') return `Poll: ${msg.question || ''}`;
  if (msg.type === 'event') return `Event: ${msg.name || ''}`;
  return renderStyledContent(textFallback || String(msg.text || '').slice(0, 100));
};

const renderReplyFromReplyTo = (replyTo: any, fallbackText: string) => {
  if (!replyTo) return fallbackText;
  if (replyTo.isGif || replyTo.mediaType === 'gif') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleGifIcon size={15} />
        {replyTo.text || 'GIF'}
      </span>
    );
  }
  if (replyTo.isSticker || replyTo.mediaType === 'sticker') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleStickerIcon size={14} />
        {replyTo.text || 'Sticker'}
      </span>
    );
  }
  if (replyTo.mediaType === 'video') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GooglePlayIcon size={14} />
        {replyTo.text || 'Video'}
      </span>
    );
  }
  if (replyTo.mediaType === 'photo' || replyTo.text === 'Photo' || replyTo.text?.includes('📷')) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleImageIcon size={14} />
        {replyTo.text ? replyTo.text.replace('📷 ', '') : 'Photo'}
      </span>
    );
  }
  if (replyTo.mediaType === 'file') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <GoogleFileIcon size={14} />
        {replyTo.text || 'File'}
      </span>
    );
  }
  return renderStyledContent(fallbackText);
};

const buildReplyToPayload = (targetReply: Rec): Rec => {
  const targetIsGif = isGifMessage(targetReply);
  const targetIsSticker = isStickerMessage(targetReply);
  const targetIsVideo = targetReply.type === 'video' || targetReply.mediaItems?.[0]?.type === 'video';
  const targetIsPhoto = targetReply.type === 'image' || targetReply.type === 'media' || Boolean(targetReply.driveFileId) || Boolean(targetReply.mediaUrl);
  const targetIsFile = targetReply.type === 'file';

  const mediaType = targetIsGif ? 'gif' : (targetIsSticker ? 'sticker' : (targetIsVideo ? 'video' : (targetIsPhoto ? 'photo' : (targetIsFile ? 'file' : 'text'))));

  return {
    id: targetReply.id,
    senderId: targetReply.senderId || '',
    senderName: targetReply.senderName || targetReply.senderUsername || 'User',
    senderUsername: targetReply.senderUsername || '',
    text: getReplyExcerpt(targetReply),
    mediaType,
    isGif: targetIsGif,
  };
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

function isValidMediaUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (
    lower.includes('video/') ||
    lower.includes('.mp4') ||
    lower.includes('.webm') ||
    lower.includes('ext=mp4') ||
    lower.includes('ext=webm') ||
    lower.includes('mime=video')
  ) {
    return false;
  }
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:') ||
    url.startsWith('/api/') ||
    url.startsWith('/')
  );
}

function useResolvedAvatarUri(
  targetUid?: string | null,
  photoURL?: string,
  profileAssetId?: string,
  group = false,
) {
  const drive = useDriveStore();

  const [imageUri, setImageUri] = useState<string | null>(() => {
    if (isValidMediaUrl(photoURL)) {
      return photoURL!;
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
    if (isValidMediaUrl(photoURL)) return false;
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

    if (photoURL === null && !profileAssetId) {
      if (targetUid) {
        avatarMemoryCache.delete(targetUid);
        try {
          localStorage.removeItem(`shinzi_avatar_${targetUid}`);
        } catch {}
      }
      setImageUri(null);
      setLoading(false);
      return;
    }

    if (isValidMediaUrl(photoURL)) {
      setImageUri(photoURL!);
      if (targetUid) {
        avatarMemoryCache.set(targetUid, photoURL!);
        try {
          localStorage.setItem(`shinzi_avatar_${targetUid}`, photoURL!);
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

        // If the user has neither a photo URL nor a profile asset ID, they have no avatar
        if (!directUrl && !assetId) {
          if (targetUid) {
            avatarMemoryCache.delete(targetUid);
            try {
              localStorage.removeItem(`shinzi_avatar_${targetUid}`);
            } catch {}
          }
          if (!cancelled) {
            setImageUri(null);
            setLoading(false);
          }
          return;
        }

        if (isValidMediaUrl(directUrl)) {
          if (!cancelled) {
            setImageUri(directUrl!);
            if (targetUid) {
              avatarMemoryCache.set(targetUid, directUrl!);
              try {
                localStorage.setItem(`shinzi_avatar_${targetUid}`, directUrl!);
              } catch {}
            }
            setLoading(false);
          }
          return;
        }

        // Try backend /api/avatar endpoint only if user has an assetId or avatar attached
        if (targetUid && assetId) {
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

  return { imageUri, loading, setImageUri };
}

function UserAvatar({
  uid: targetUid,
  name,
  photoURL,
  profileAssetId,
  size = 'md',
  group = false,
  small = false,
  className = '',
  status,
}: {
  uid?: string | null;
  name?: string;
  photoURL?: string;
  profileAssetId?: string;
  size?: 'xs' | 'sm' | 'md' | 'nav';
  group?: boolean;
  small?: boolean;
  className?: string;
  status?: EffectiveStatus;
}) {
  const effectiveSize = small ? 'sm' : size;
  const { imageUri, loading, setImageUri } = useResolvedAvatarUri(
    targetUid,
    photoURL,
    profileAssetId,
    group,
  );

  const sizeClass =
    effectiveSize === 'xs'
      ? 'shc-avatar-xs'
      : effectiveSize === 'sm'
        ? 'shc-avatar-sm'
        : effectiveSize === 'nav'
          ? 'shc-avatar-nav'
          : 'shc-avatar-md';

  const avatarNode = (
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

  if (status && !group) {
    return (
      <div className={`shc-avatar-wrapper shc-avatar-wrapper-${effectiveSize}`}>
        {avatarNode}
        <div className={`shc-status-badge shc-status-${effectiveSize} sh-status-${status}`}>
          {status === 'dnd' && <div className="shc-status-dnd-bar" />}
        </div>
      </div>
    );
  }

  return avatarNode;
}

// FIX 3: MUI Avatar strictly for chat messages
function ChatMessageAvatar({
  uid: targetUid,
  name,
  photoURL,
  profileAssetId,
  size = 36,
}: {
  uid?: string | null;
  name?: string;
  photoURL?: string;
  profileAssetId?: string;
  size?: number;
}) {
  const { imageUri } = useResolvedAvatarUri(
    targetUid,
    photoURL,
    profileAssetId,
    false,
  );
  const fallbackLetter = initials(name || 'User');

  return (
    <MuiAvatar
      src={imageUri || undefined}
      alt={name || 'Avatar'}
      slotProps={{
        img: {
          loading: 'lazy',
          style: { objectFit: 'cover' },
        },
      }}
      sx={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: '#222428',
        color: '#5865F2',
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        border: '1px solid #303238',
      }}
    >
      {fallbackLetter}
    </MuiAvatar>
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
  const drive = useDriveStore();
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

  const [messageText, setMessageText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Rec | null>(null);
  const [editingMessage, setEditingMessage] = useState<Rec | null>(null);
  const [actionMessage, setActionMessage] = useState<Rec | null>(null);
  const [activeImageViewer, setActiveImageViewer] = useState<{
    previewUrl: string;
    originalUrl: string;
    fileName?: string;
  } | null>(null);
  const [activeVideoViewer, setActiveVideoViewer] = useState<{
    url: string;
    fileName?: string;
  } | null>(null);
  const [viewingProfileUid, setViewingProfileUid] = useState<string | null>(null);
  const [stagedMedia, setStagedMedia] = useState<StagedAttachment[]>([]);
  const [localChatError, setLocalChatError] = useState<{ id: string; text: string } | null>(null);
  const localChatErrorTimer = useRef<number | null>(null);

  const showLocalChatError = (errText: string) => {
    if (localChatErrorTimer.current) window.clearTimeout(localChatErrorTimer.current);
    setLocalChatError({ id: String(Date.now()), text: errText });
    localChatErrorTimer.current = window.setTimeout(() => {
      setLocalChatError(null);
    }, 12000);
  };

  const pendingCaretRef = useRef<number | null>(null);

  const removeStagedMedia = (id: string) => {
    setStagedMedia((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {}
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  // Caret restoration layoutEffect: sets selection synchronously after React commits the messageText update
  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null && inputRef.current) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      inputRef.current.focus({ preventScroll: true });
      inputRef.current.setSelectionRange(pos, pos);
    }
  }, [messageText]);

  // Sync popstate for profile overlay so browser/Android back button closes overlay seamlessly
  useEffect(() => {
    const handlePop = () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const targetUid = params.get('uid');
      if (window.location.pathname.toLowerCase() === '/profile' && targetUid) {
        setViewingProfileUid(targetUid);
      } else {
        setViewingProfileUid(null);
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [uid]);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => getRecentEmojis());
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);
  const isNearBottomRef = useRef<boolean>(true);
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
  const [openDatePicker, setOpenDatePicker] = useState<'start' | 'end' | null>(null);

  const [gifMode, setGifMode] = useState<'gif' | 'sticker'>('gif');
  const [gifSearch, setGifSearch] = useState('');
  const [klipyItems, setKlipyItems] = useState<KlipyItem[]>([]);
  const [klipyLoading, setKlipyLoading] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const [showCall, setShowCall] = useState(false);
  const [callMode, setCallMode] = useState<'voice' | 'video'>('voice');
  const [callMuted, setCallMuted] = useState(false);

  const [toast, setToast] = useState<{ title: string; text: string } | null>(
    null,
  );

  const typingTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const lastTypingPingRef = useRef<number>(0);
  const recordingTimer = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const toastTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);
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
          if (data?.photoURL && isValidMediaUrl(data.photoURL)) {
            avatarMemoryCache.set(uid, data.photoURL);
            try {
              localStorage.setItem(`shinzi_avatar_${uid}`, data.photoURL);
            } catch {}
          }
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
          (snap) => {
            const rawDocs: Rec[] = snap.docs.map((item) => ({ id: item.id, ...item.data() }));

            // Auto-cache any custom text styles and fonts attached to messages
            rawDocs.forEach((docItem) => {
              if ((docItem as any).styleData) {
                importIncomingStyleData((docItem as any).styleData);
              }
            });

            // Auto-heal any messages with corrupted or map-based createdAt in Firestore
            rawDocs.forEach((docItem) => {
              if (!selected?.id || !docItem.id) return;
              const rawCreatedAt = (docItem as any).createdAt;
              const isCorrupted =
                rawCreatedAt &&
                typeof rawCreatedAt === 'object' &&
                typeof rawCreatedAt.toMillis !== 'function';

              if (isCorrupted) {
                const parsedMs = millis(rawCreatedAt);
                const realTs = parsedMs > 0 ? Timestamp.fromMillis(parsedMs) : Timestamp.now();
                updateDoc(doc(db, 'conversations', selected.id, 'messages', docItem.id), {
                  createdAt: realTs,
                }).catch((err) => console.warn('Could not auto-heal message createdAt:', err));
              }
            });

            // Ensure messages are strictly sorted chronologically
            rawDocs.sort((a, b) => {
              const aTime = millis(a.createdAt) || Date.now();
              const bTime = millis(b.createdAt) || Date.now();
              return aTime - bTime;
            });

            setMessages(rawDocs);
          },
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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach((track) => track.stop());
        } catch {}
      }
    };
  }, []);

  // Synchronize mobile keyboard visual viewport immediately
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;

    const onViewportChange = () => {
      setVisualHeight(vv.height);
      setVisualTop(vv.offsetTop);

      // Force lock: only auto-scroll on keyboard/viewport resize if user is already at the bottom
      if (screen === 'conversation' && scrollRef.current && isNearBottomRef.current) {
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
  // DERIVED DATA & HELPERS
  // ----------------------------------------------------------

  const otherMemberId = useCallback(
    (conversation: Rec | null | undefined): string =>
      String(
        (conversation?.memberIds || []).find((id: string) => id !== uid) ?? '',
      ),
    [uid],
  );

  const selectedConversation: Rec | null = useMemo(
    () => conversations.find((item) => item.id === selected?.id) || selected,
    [conversations, selected],
  );

  const activeDmTargetUid = useMemo(() => {
    if (!selectedConversation || selectedConversation.type === 'group') return null;
    return otherMemberId(selectedConversation);
  }, [selectedConversation, otherMemberId]);

  const [liveTargetProfile, setLiveTargetProfile] = useState<Rec | null>(null);
  const [userLiveAvatars, setUserLiveAvatars] = useState<Record<string, string>>({});
  const [userLiveProfiles, setUserLiveProfiles] = useState<Record<string, Rec>>(() => {
    const initial: Record<string, Rec> = {};
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('shinzi_profile_')) {
            const targetUid = key.replace('shinzi_profile_', '');
            const val = localStorage.getItem(key);
            if (val) {
              initial[targetUid] = JSON.parse(val);
            }
          }
        }
      }
    } catch {}
    return initial;
  });
  const [userLivePresence, setUserLivePresence] = useState<Record<string, Rec>>({});
  const presenceUnsubsRef = useRef<Map<string, () => void>>(new Map());

  // Presence ticker to refresh status badges when lastSeen expires (> 60s)
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setPresenceTick((t) => t + 1);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      presenceUnsubsRef.current.forEach((unsub) => unsub());
      presenceUnsubsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setToast(null);
  }, [screen]);

  useEffect(() => {
    if (!activeDmTargetUid) {
      setLiveTargetProfile(null);
      return;
    }

    const unsubUser = onSnapshot(
      doc(db, 'users', activeDmTargetUid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Rec;
          setLiveTargetProfile(data);
          setUserLiveProfiles((prev) => ({ ...prev, [activeDmTargetUid]: data }));
          if (data?.onlineStatusMode || data?.lastSeen) {
            setUserLivePresence((prev) => ({ ...prev, [activeDmTargetUid]: { ...prev[activeDmTargetUid], ...data } }));
          }
          try {
            localStorage.setItem(`shinzi_profile_${activeDmTargetUid}`, JSON.stringify(data));
          } catch {}
          if (data?.photoURL) {
            setUserLiveAvatars((prev) => ({ ...prev, [activeDmTargetUid]: data.photoURL }));
            avatarMemoryCache.set(activeDmTargetUid, data.photoURL);
            try {
              localStorage.setItem(`shinzi_avatar_${activeDmTargetUid}`, data.photoURL);
            } catch {}
          }
        }
      },
      (err) => {
        console.warn('Error listening to target user profile:', err);
      }
    );

    const unsubPresence = onSnapshot(
      doc(db, 'users', activeDmTargetUid, 'friends', 'presence'),
      (snap) => {
        if (snap.exists()) {
          const pdata = snap.data() as Rec;
          setUserLivePresence((prev) => ({ ...prev, [activeDmTargetUid]: pdata }));
        }
      },
      () => {}
    );

    return () => {
      unsubUser();
      unsubPresence();
    };
  }, [activeDmTargetUid]);

  useEffect(() => {
    if (!conversations || conversations.length === 0 || !uid) return;

    const directOtherUids = conversations
      .filter((c) => c.type !== 'group')
      .map((c) => otherMemberId(c))
      .filter((id) => Boolean(id) && !presenceUnsubsRef.current.has(id));

    if (directOtherUids.length === 0) return;

    directOtherUids.forEach((targetId) => {
      try {
        const unsubPresence = onSnapshot(
          doc(db, 'users', targetId, 'friends', 'presence'),
          (snap) => {
            if (snap.exists()) {
              const pdata = snap.data() as Rec;
              setUserLivePresence((prev) => ({ ...prev, [targetId]: pdata }));
            }
          },
          () => {}
        );
        presenceUnsubsRef.current.set(`${targetId}_presence`, unsubPresence);

        const unsub = onSnapshot(
          doc(db, 'users', targetId),
          (snap) => {
            if (snap.exists()) {
              const udata = snap.data() as Rec;
              setUserLiveProfiles((prev) => ({ ...prev, [targetId]: udata }));
              if (udata?.onlineStatusMode || udata?.lastSeen) {
                setUserLivePresence((prev) => ({ ...prev, [targetId]: { ...prev[targetId], ...udata } }));
              }
              try {
                localStorage.setItem(`shinzi_profile_${targetId}`, JSON.stringify(udata));
              } catch {}
              if (udata?.photoURL) {
                setUserLiveAvatars((prev) => ({
                  ...prev,
                  [targetId]: udata.photoURL,
                }));
                avatarMemoryCache.set(targetId, udata.photoURL);
                try {
                  localStorage.setItem(`shinzi_avatar_${targetId}`, udata.photoURL);
                } catch {}
              }
              const liveName = udata.displayName || udata.username;
              if (liveName) {
                conversations.forEach((conv) => {
                  if (
                    conv.memberProfiles?.[targetId]?.displayName &&
                    conv.memberProfiles[targetId].displayName !== liveName
                  ) {
                    updateDoc(doc(db, 'conversations', conv.id), {
                      [`memberProfiles.${targetId}.displayName`]: liveName,
                    }).catch(() => {});
                  }
                });
              }
            }
          },
          (err) => {
            console.warn('Presence sub error for', targetId, err);
          }
        );
        presenceUnsubsRef.current.set(targetId, unsub);
      } catch (err) {
        console.warn('Error setting onSnapshot for user:', err);
      }
    });
  }, [conversations, uid, otherMemberId]);

  useEffect(() => {
    const fromMessages = (messages || []).map((m) => m.senderId);
    const fromFriendReqs = (friendRequests || []).map((r) => r.fromUid || r.fromProfile?.uid);
    const fromDmReqs = (dmRequests || []).map((r) => r.fromUid || r.fromProfile?.uid);

    const missingUids = Array.from(
      new Set(
        [...fromMessages, ...fromFriendReqs, ...fromDmReqs]
          .filter((id) => Boolean(id) && id !== uid && !userLiveProfiles[id])
      )
    );
    if (missingUids.length === 0) return;

    let cancelled = false;
    missingUids.forEach(async (senderId) => {
      try {
        const snap = await getDoc(doc(db, 'users', senderId));
        if (snap.exists() && !cancelled) {
          const udata = snap.data() as Rec;
          setUserLiveProfiles((prev) => ({ ...prev, [senderId]: udata }));
          if (udata?.photoURL) {
            setUserLiveAvatars((prev) => ({ ...prev, [senderId]: udata.photoURL }));
          }
        }
      } catch {}
    });

    return () => {
      cancelled = true;
    };
  }, [messages, friendRequests, dmRequests, uid, userLiveProfiles]);

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

  const getConversationName = (conversation: Rec | null | undefined) => {
    if (!conversation) return 'Conversation';
    if (conversation.type === 'group') return conversation.name || 'Group';

    const otherId = otherMemberId(conversation);
    const live = (activeDmTargetUid === otherId ? liveTargetProfile : null) || userLiveProfiles[otherId];
    if (live?.displayName) return live.displayName;
    if (live?.username) return live.username;

    const member = conversation.memberProfiles?.[otherId];
    return member?.displayName || member?.username || 'User';
  };

  const getConversationUsername = (conversation: Rec | null | undefined) => {
    if (!conversation || conversation.type === 'group') return '';
    const otherId = otherMemberId(conversation);
    const live = (activeDmTargetUid === otherId ? liveTargetProfile : null) || userLiveProfiles[otherId];
    if (live?.username) return live.username;
    return (
      conversation.memberProfiles?.[otherId]?.username || ''
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
    const list: {
      id: string;
      handle: string;
      name: string;
      isHere?: boolean;
      photoURL?: string;
      profileAssetId?: string;
      uid?: string;
    }[] = [];

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
        list.push({
          id: memberId,
          handle,
          name,
          photoURL: prof?.photoURL,
          profileAssetId: prof?.profileAssetId,
          uid: memberId,
        });
      });
    } else {
      const otherId = otherMemberId(selectedConversation);
      const otherProf = selectedConversation.memberProfiles?.[otherId];
      const handle =
        otherProf?.username ||
        otherProf?.displayName?.toLowerCase().replace(/\s+/g, '_') ||
        'user';
      const name = otherProf?.displayName || otherProf?.username || 'User';
      list.push({
        id: otherId || 'other',
        handle,
        name,
        photoURL: otherProf?.photoURL,
        profileAssetId: otherProf?.profileAssetId,
        uid: otherId,
      });
    }

    // In down: @here (no description needed per user request)
    list.push({
      id: 'here',
      handle: 'here',
      name: '',
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
        (s.name && s.name.toLowerCase().includes(q)),
    );
  }, [mentionQuery, mentionSuggestions]);

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
      // 1. Mentioned / Urgent at top
      const urgA = isUrgent(a) ? 1 : 0;
      const urgB = isUrgent(b) ? 1 : 0;
      if (urgA !== urgB) return urgB - urgA;

      // 2. Followed by newest message
      return (
        millis(b.lastMessageAt || b.updatedAt) -
        millis(a.lastMessageAt || a.updatedAt)
      );
    });

    return rows;
  }, [conversations, chatFilter, uid]);

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

  // Scroll to the newest message only if near bottom or when screen first opens
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, screen, typingNames.length]);

  const handleMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    isNearBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isNearBottomRef.current = true;
      setShowScrollBottom(false);
    }
  };

  useEffect(() => {
    if (!activeImageViewer && !activeVideoViewer) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveImageViewer(null);
        setActiveVideoViewer(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImageViewer, activeVideoViewer]);

  useEffect(() => {
    if (panel !== 'gif') return;
    let active = true;

    // Check instant in-memory cache first (0ms load)
    const cached = getCachedKlipy(gifMode, gifSearch);
    if (cached) {
      setKlipyItems(cached);
      setKlipyLoading(false);
      return;
    }

    setKlipyLoading(true);
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const items = await searchKlipy(gifMode, gifSearch, 24, controller.signal);
        if (active) {
          setKlipyItems(items);
          setKlipyLoading(false);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (active) {
          console.error('Klipy fetch error:', err);
          setKlipyItems([]);
          setKlipyLoading(false);
        }
      }
    }, gifSearch ? 180 : 0);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [panel, gifMode, gifSearch]);

  // Clear mention suggestions whenever switching conversations, screens, or when text is empty
  const openConversation = async (conversation: Rec) => {
    if (!conversation?.id) return;

    setStagedMedia((prev) => {
      prev.forEach((item) => {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch {}
      });
      return [];
    });

    setSelected(conversation);
    setScreen('conversation');
    setPendingDmMessages([]);
    isNearBottomRef.current = true;
    setShowScrollBottom(false);

    const savedDraft =
      typeof window !== 'undefined'
        ? localStorage.getItem(`shinzi_draft_${conversation.id}`) || ''
        : '';
    setMessageText(savedDraft);
    setReplyTarget(null);
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

    let targetUser = otherUser;
    if (!targetUser.displayName && !targetUser.username) {
      try {
        const uSnap = await getDoc(doc(db, 'users', otherUser.id));
        if (uSnap.exists()) {
          targetUser = { id: otherUser.id, ...uSnap.data() };
        }
      } catch (e) {
        console.warn('Could not fetch target user profile', e);
      }
    }

    const conversationId = directId(uid, targetUser.id);
    const isFriend = friends.some((friend) => friend.id === targetUser.id || friend.uid === targetUser.id);
    const existingConversation = conversations.find((item) => item.id === conversationId);

    if (isFriend && existingConversation) {
      await openConversation(existingConversation);
      return;
    }
    if (isFriend) {
      await openDirectConversation(targetUser);
      return;
    }

    try {
      const [outgoingSnap, incomingSnap] = await Promise.all([
        getDoc(doc(db, 'dmRequests', `${uid}_${targetUser.id}`)),
        getDoc(doc(db, 'dmRequests', `${targetUser.id}_${uid}`)),
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
        memberIds: [uid, targetUser.id],
        memberProfiles: {
          [uid]: {
            displayName: profile?.displayName || user?.displayName || 'User',
            username: profile?.username || '',
            photoURL: profile?.photoURL || '',
            profileAssetId: profile?.profileAssetId || '',
          },
          [targetUser.id]: {
            displayName: targetUser.displayName || targetUser.username || 'User',
            username: targetUser.username || '',
            photoURL: targetUser.photoURL || '',
            profileAssetId: targetUser.profileAssetId || '',
          },
        },
        requestStatus,
        requestMessage: pendingRequest?.message || '',
        hasChatIntro: existingConversation?.hasChatIntro ?? true,
      });
      setScreen('conversation');
      setMessageText('');
      setReplyTarget(null);
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

  const getMentionContext = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (match) {
      const atOffset = match[0].startsWith(' ') ? 1 : 0;
      return {
        query: match[1],
        startIndex: match.index! + atOffset,
        endIndex: cursor,
      };
    }
    return null;
  };

  const insertMention = (handle: string) => {
    const input = inputRef.current;
    const cursor = input ? (input.selectionStart ?? messageText.length) : messageText.length;
    const ctx = getMentionContext(messageText, cursor);

    let newText: string;
    let newCursor: number;
    if (ctx) {
      const before = messageText.slice(0, ctx.startIndex);
      const after = messageText.slice(ctx.endIndex);
      const mentionStr = `@${handle} `;
      newText = before + mentionStr + after;
      newCursor = before.length + mentionStr.length;
    } else {
      newText = messageText + `@${handle} `;
      newCursor = newText.length;
    }

    pendingCaretRef.current = newCursor;
    setMessageText(newText);
    setMentionQuery(null);

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 10);
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

    // Debounce localStorage writes so typing never stutters or drops frames
    if (selected?.id) {
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      const selId = selected.id;
      draftTimer.current = window.setTimeout(() => {
        try {
          if (text.trim()) {
            localStorage.setItem(`shinzi_draft_${selId}`, text);
          } else {
            localStorage.removeItem(`shinzi_draft_${selId}`);
          }
        } catch {}
      }, 400);
    }

    const cursor = el ? (el.selectionStart ?? text.length) : text.length;
    const ctx = getMentionContext(text, cursor);
    if (ctx) {
      setMentionQuery(ctx.query);
      setMentionSelectedIndex(0);
    } else if (mentionQuery !== null) {
      setMentionQuery(null);
    }

    if (el) {
      const targetHeight = Math.min(el.scrollHeight, 120);
      if (Math.abs(el.clientHeight - targetHeight) > 4) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
      }
    }

    if (!selected?.id || !uid) return;

    // Throttle typing activity network calls to at most once every 3.5s
    const now = Date.now();
    if (now - lastTypingPingRef.current > 3500) {
      lastTypingPingRef.current = now;
      void publishTyping(Boolean(text.trim()));
    }

    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void publishTyping(false);
      lastTypingPingRef.current = 0;
    }, 4500);
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
      const rawEdit = messageText.trim();
      if (rawEdit) {
        const syntaxValidation = validateTextStyleSyntax(rawEdit);
        if (!syntaxValidation.isValid) {
          showLocalChatError(syntaxValidation.error || 'Unsupported syntax.');
          return;
        }
        const newText = applyTextStyles(rawEdit);
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

    const rawText = messageText.trim();
    if (!rawText && stagedMedia.length === 0) return;

    if (rawText) {
      const syntaxValidation = validateTextStyleSyntax(rawText);
      if (!syntaxValidation.isValid) {
        showLocalChatError(syntaxValidation.error || 'Unsupported syntax.');
        return;
      }
    }

    const text = applyTextStyles(rawText);
    if (!text && stagedMedia.length === 0) return;

    if (stagedMedia.length > 0) {
      const itemsToUpload = [...stagedMedia];
      const caption = text;
      setStagedMedia([]);
      setMessageText('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      if (selected?.id) {
        try {
          localStorage.removeItem(`shinzi_draft_${selected.id}`);
        } catch {}
      }
      void uploadAndSendStagedMedia(itemsToUpload, caption);
      return;
    }

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

      const usedStyles = getUsedStylesData(rawText);

      const messageData: Rec = {
        type: 'text',
        text,
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        senderPhotoURL: profile?.photoURL || '',
        senderProfileAssetId: profile?.profileAssetId || '',
        ...(usedStyles ? { styleData: usedStyles } : {}),
        createdAt: serverTimestamp(),
        editedAt: null,
        deleted: false,
      };

      if (targetReply) {
        messageData.replyToMessageId = targetReply.id;
        messageData.replyTo = buildReplyToPayload(targetReply);
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
        lastSenderName: profile?.displayName || profile?.username || 'You',
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

      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      if (selected?.id) {
        try {
          localStorage.removeItem(`shinzi_draft_${selected.id}`);
        } catch {}
      }

      setMessageText('');
      setReplyTarget(null);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        isNearBottomRef.current = true;
        setShowScrollBottom(false);
      }
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
        setMentionSelectedIndex((prev) => (prev + 1) % filteredMentionSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex(
          (prev) => (prev - 1 + filteredMentionSuggestions.length) % filteredMentionSuggestions.length,
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

  const searchUser = async (explicitQuery?: string, isManual = false) => {
    const raw = typeof explicitQuery === 'string' ? explicitQuery : userQuery;
    const username = raw.trim().toLowerCase().replace(/^@/, '');

    if (!username) {
      setSearchResult(null);
      setSearching(false);
      return;
    }

    setSearching(true);

    try {
      const usernameSnap = await getDoc(doc(db, 'usernames', username));

      if (!usernameSnap.exists()) {
        setSearchResult(null);
        if (isManual) {
          notify('Not found', 'No user was found with that username.');
        }
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
        if (isManual) {
          notify('Not found', 'That user profile could not be loaded.');
        }
        return;
      }

      const data = userSnap.data() || {};
      const finalPhotoURL = data.photoURL || data.photoUrl || data.avatarUrl || null;
      const finalProfileAssetId = data.profileAssetId || null;

      if (!finalPhotoURL && !finalProfileAssetId) {
        avatarMemoryCache.delete(userSnap.id);
        try {
          localStorage.removeItem(`shinzi_avatar_${userSnap.id}`);
        } catch {}
      }

      setSearchResult({
        id: userSnap.id,
        ...data,
        photoURL: finalPhotoURL,
        profileAssetId: finalProfileAssetId,
      });

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
      if (isManual) {
        notify('Search failed', messageOf(error, 'Unable to search right now.'));
      }
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const trimmed = userQuery.trim().toLowerCase().replace(/^@/, '');
    if (!trimmed) {
      setSearchResult(null);
      setSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      void searchUser(trimmed, false);
    }, 450);

    return () => clearTimeout(timer);
  }, [userQuery]);

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
        lastSenderName: profile?.displayName || profile?.username || 'You',
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
        lastSenderName: profile?.displayName || profile?.username || 'You',
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

  const getMediaDimensions = async (file: File): Promise<{ width?: number; height?: number; duration?: number }> => {
    if (file.type.startsWith('image/')) {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        await new Promise((r) => { img.onload = r; img.onerror = r; });
        const dims = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
        URL.revokeObjectURL(url);
        return dims;
      } catch {
        return {};
      }
    }
    if (file.type.startsWith('video/')) {
      try {
        const url = URL.createObjectURL(file);
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.src = url;
        await new Promise((r) => { vid.onloadedmetadata = r; vid.onerror = r; });
        const dims = { width: vid.videoWidth || 0, height: vid.videoHeight || 0, duration: Math.round(vid.duration || 0) };
        URL.revokeObjectURL(url);
        return dims;
      } catch {
        return {};
      }
    }
    return {};
  };

  const sendMediaMessage = async (params: {
    mediaItems: MediaItem[];
    text?: string;
    isGif?: boolean;
    isSticker?: boolean;
    initiatedAt?: any;
  }) => {
    if (!uid || !selected?.id) return;
    const activeConv = selectedConversation || selected;
    if (!activeConv) return;

    sendingRef.current = true;
    setSending(true);

    try {
      const targetReply =
        replyTarget && messages.some((m) => m.id === replyTarget.id)
          ? replyTarget
          : null;

      const firstItem = params.mediaItems[0];
      const isGif = Boolean(
        params.isGif ||
        firstItem?.fileName?.toLowerCase().endsWith('.gif') ||
        firstItem?.mediaUrl?.includes('klipy')
      );
      const isSticker = Boolean(
        params.isSticker ||
        firstItem?.fileName?.toLowerCase().endsWith('.sticker')
      );

      const messageType = isSticker ? 'sticker' : (isGif ? 'gif' : 'media');

      const rawMessageData: Rec = {
        type: messageType,
        mediaItems: params.mediaItems.map((it) => ({
          ...it,
          width: it.width ?? null,
          height: it.height ?? null,
          duration: it.duration ?? null,
          sizeBytes: it.sizeBytes ?? null,
        })),
        text: params.text || '',
        mediaUrl: firstItem?.mediaUrl || '',
        originalUrl: firstItem?.originalUrl || firstItem?.mediaUrl || '',
        driveFileId: firstItem?.driveFileId || null,
        fileName: firstItem?.fileName || 'media',
        sizeBytes: firstItem?.sizeBytes || null,
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        senderPhotoURL: profile?.photoURL || '',
        senderProfileAssetId: profile?.profileAssetId || '',
        createdAt: params.initiatedAt || Timestamp.now(),
        editedAt: null,
        deleted: false,
      };

      if (targetReply) {
        rawMessageData.replyToMessageId = targetReply.id;
        rawMessageData.replyTo = buildReplyToPayload(targetReply);
      }

      const messageData = sanitizeForFirestore(rawMessageData);

      const messageRef = await addDoc(
        collection(db, 'conversations', selected.id, 'messages'),
        messageData,
      );

      const count = params.mediaItems.length;
      let summaryText = '📷 Photo';
      if (params.text) {
        summaryText = params.text;
      } else if (isSticker) {
        summaryText = 'Sticker';
      } else if (isGif) {
        summaryText = 'GIF';
      } else if (count > 1) {
        summaryText = `📷 ${count} media items`;
      } else if (firstItem?.type === 'video') {
        summaryText = '🎥 Video';
      }

      const updates: Rec = sanitizeForFirestore({
        lastMessageId: messageRef.id,
        lastMessageText: summaryText,
        lastMessageAt: params.initiatedAt || Timestamp.now(),
        lastSenderId: uid,
        lastSenderName: profile?.displayName || profile?.username || 'You',
        updatedAt: Timestamp.now(),
      });

      await updateDoc(doc(db, 'conversations', selected.id), updates);
      setReplyTarget(null);
    } catch (error) {
      console.error('Send media error:', error);
      notify('Unable to send media', messageOf(error));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const onPickGallery = (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (!fileList.length) return;

    if (!selected?.id) {
      notify('No chat open', 'Please open a conversation to attach media.');
      return;
    }

    const availableSlots = Math.max(0, 10 - stagedMedia.length);
    if (availableSlots <= 0) {
      notify('Limit reached', 'Maximum 10 attachments allowed at a time.');
      return;
    }

    if (fileList.length > availableSlots) {
      notify('Limit: 10 items', `Maximum 10 attachments allowed. Adding first ${availableSlots}.`);
    }

    const validFiles = fileList.filter((f) => {
      const isHeic = f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif') || f.type.includes('heic') || f.type.includes('heif');
      return f.type.startsWith('image/') || f.type.startsWith('video/') || isHeic;
    }).slice(0, availableSlots);

    if (!validFiles.length) {
      notify('Invalid file', 'Please select valid image or video files.');
      return;
    }

    const newStaged: StagedAttachment[] = validFiles.map((file, idx) => ({
      id: `${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
    }));

    setStagedMedia((prev) => [...prev, ...newStaged]);
  };

  async function uploadAndSendStagedMedia(items: StagedAttachment[], caption: string) {
    if (!selected?.id || sendingRef.current) return;
    const initiatedAt = Timestamp.now();
    sendingRef.current = true;
    setSending(true);

    // 1. Optimize images (compress to fast WebP in parallel, in milliseconds)
    const processedItems: Array<{
      file: File;
      type: 'image' | 'video';
      previewUrl: string;
      width?: number;
      height?: number;
    }> = await Promise.all(
      items.map(async (item) => {
        if (item.type === 'image') {
          try {
            const comp = await compressImageToWebP(item.file);
            return {
              file: comp.file,
              type: 'image' as const,
              previewUrl: item.previewUrl,
              width: comp.width || undefined,
              height: comp.height || undefined,
            };
          } catch {
            return {
              file: item.file,
              type: 'image' as const,
              previewUrl: item.previewUrl,
            };
          }
        }
        return {
          file: item.file,
          type: 'video' as const,
          previewUrl: item.previewUrl,
        };
      })
    );

    if (!drive.hasActiveSession) {
      // Offline fallback: small images only
      const smallImages = processedItems.filter((it) => it.file.type.startsWith('image/') && it.file.size <= 850 * 1024);
      if (smallImages.length === processedItems.length) {
        try {
          const mediaItems: MediaItem[] = [];
          for (let i = 0; i < smallImages.length; i++) {
            const f = smallImages[i].file;
            const dataUri = await blobToDataUri(f);
            const dims = (smallImages[i].width && smallImages[i].height)
              ? { width: smallImages[i].width, height: smallImages[i].height }
              : await getMediaDimensions(f);
            mediaItems.push({
              id: `local_${Date.now()}_${i}`,
              type: 'image',
              mediaUrl: dataUri,
              originalUrl: dataUri,
              fileName: f.name,
              sizeBytes: f.size,
              width: dims.width,
              height: dims.height,
            });
          }
          await sendMediaMessage({ mediaItems, text: caption, initiatedAt });
        } catch (err) {
          notify('Upload failed', messageOf(err));
          sendingRef.current = false;
          setSending(false);
        } finally {
          items.forEach((it) => {
            try {
              URL.revokeObjectURL(it.previewUrl);
            } catch {}
          });
        }
        return;
      }
      notify(
        'Google Drive Required',
        'Connect Google Drive in settings to send high-res photos and videos.',
      );
      sendingRef.current = false;
      setSending(false);
      return;
    }

    notify('Uploading media…', `Uploading ${processedItems.length} item(s) to Google Drive.`);

    try {
      const mediaItems: MediaItem[] = [];

      for (let i = 0; i < processedItems.length; i++) {
        const item = processedItems[i];
        const file = item.file;
        const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif') || file.type.includes('heic') || file.type.includes('heif');
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/') || isHeic;
        if (!isVideo && !isImage) continue;

        const folderType = isVideo ? 'videos' : 'photos';
        const mimeType = file.type || (isHeic ? 'image/heic' : (isVideo ? 'video/mp4' : 'image/jpeg'));
        const uploaded = await drive.uploadFile({
          file,
          fileName: file.name,
          mimeType,
          folderType,
        });

        await drive.makeFilePublic(uploaded.fileId);

        const dims = (item.width && item.height)
          ? { width: item.width, height: item.height, duration: undefined }
          : await getMediaDimensions(file);

        const previewUrl = isImage
          ? `https://lh3.googleusercontent.com/d/${uploaded.fileId}=s1600`
          : `/api/media?fileId=${uploaded.fileId}`;
        const originalUrl = isImage
          ? `https://lh3.googleusercontent.com/d/${uploaded.fileId}=s0`
          : `/api/media?fileId=${uploaded.fileId}&download=true&name=${encodeURIComponent(file.name)}`;

        mediaItems.push({
          id: `${uploaded.fileId}_${Date.now()}_${i}`,
          type: isVideo ? 'video' : 'image',
          mediaUrl: previewUrl,
          originalUrl,
          driveFileId: uploaded.fileId,
          fileName: file.name,
          sizeBytes: file.size,
          width: dims.width ?? null,
          height: dims.height ?? null,
          duration: dims.duration ?? null,
        });
      }

      if (!mediaItems.length) {
        notify('Upload failed', 'No valid image or video files selected.');
        sendingRef.current = false;
        setSending(false);
        return;
      }

      await sendMediaMessage({
        mediaItems,
        text: caption,
        initiatedAt,
      });
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        isNearBottomRef.current = true;
        setShowScrollBottom(false);
      }
    } catch (err) {
      console.error('Drive gallery upload error:', err);
      notify('Upload failed', messageOf(err));
      sendingRef.current = false;
      setSending(false);
    } finally {
      items.forEach((it) => {
        try {
          URL.revokeObjectURL(it.previewUrl);
        } catch {}
      });
    }
  }

  const onPickDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!selected?.id) {
      notify('No chat open', 'Please open a conversation to send a file.');
      return;
    }

    if (!drive.hasActiveSession) {
      notify('Google Drive Required', 'Connect Google Drive in settings to upload files.');
      return;
    }

    setSending(true);
    notify('Uploading file…', `Uploading ${file.name} to Google Drive.`);

    try {
      const uploaded = await drive.uploadFile({
        file,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        folderType: 'files',
      });

      await drive.makeFilePublic(uploaded.fileId);

      const downloadUrl = `/api/media?fileId=${uploaded.fileId}&download=true&name=${encodeURIComponent(file.name)}`;

      await sendFileMessage({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        driveFileId: uploaded.fileId,
        fileUrl: downloadUrl,
      });
    } catch (err) {
      console.error('Drive document upload error:', err);
      notify('Upload failed', messageOf(err));
    } finally {
      setSending(false);
    }
  };

  const sendFileMessage = async (params: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    driveFileId?: string;
    fileUrl: string;
  }) => {
    if (!uid || !selected?.id) return;
    const activeConv = selectedConversation || selected;
    if (!activeConv) return;

    sendingRef.current = true;
    setSending(true);

    try {
      const targetReply =
        replyTarget && messages.some((m) => m.id === replyTarget.id)
          ? replyTarget
          : null;

      const messageData: Rec = {
        type: 'file',
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        driveFileId: params.driveFileId || null,
        fileUrl: params.fileUrl,
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
        messageData.replyTo = buildReplyToPayload(targetReply);
      }

      const messageRef = await addDoc(
        collection(db, 'conversations', selected.id, 'messages'),
        messageData,
      );

      const updates: Rec = {
        lastMessageId: messageRef.id,
        lastMessageText: `📄 ${params.fileName}`,
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        lastSenderName: profile?.displayName || profile?.username || 'You',
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'conversations', selected.id), updates);
      setReplyTarget(null);
    } catch (error) {
      console.error('Send file error:', error);
      notify('Unable to send file', messageOf(error));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const onSelectKlipyItem = async (item: KlipyItem) => {
    if (!uid || !selected?.id) return;
    setPanel(null);

    await sendMediaMessage({
      mediaItems: [
        {
          id: `klipy_${item.id}_${Date.now()}`,
          type: 'image',
          mediaUrl: item.originalUrl || item.previewUrl,
          originalUrl: item.originalUrl || item.previewUrl,
          fileName: `${item.title || item.type}.${item.type === 'sticker' ? 'sticker' : 'gif'}`,
          width: item.width ?? null,
          height: item.height ?? null,
        },
      ],
      isGif: item.type === 'gif',
      isSticker: item.type === 'sticker',
    });
  };

  const startRecording = async () => {
    if (!selected?.id) {
      notify('No conversation open', 'Please select a conversation to record a voice note.');
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notify('Not supported', 'Your browser does not support audio recording.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      audioStreamRef.current = stream;

      let mimeType = 'audio/webm;codecs=opus';
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
          } else {
            mimeType = '';
          }
        }
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(250);
      setRecordSeconds(0);
      setRecording(true);

      if (recordingTimer.current) window.clearInterval(recordingTimer.current);
      recordingTimer.current = window.setInterval(() => {
        setRecordSeconds((sec) => {
          if (sec >= 300) {
            // Cap recording at 5 minutes
            void finishAndSendRecording();
            return sec;
          }
          return sec + 1;
        });
      }, 1000);
    } catch (err: unknown) {
      console.error('Microphone error:', err);
      const isNotAllowed = (err as any)?.name === 'NotAllowedError' || (err as any)?.name === 'PermissionDeniedError';
      if (isNotAllowed) {
        notify('Microphone blocked', 'Microphone access is blocked in your browser. Tap the tune/lock icon in your address bar to allow microphone.');
      } else {
        notify('Microphone permission needed', 'Please allow microphone access to record voice notes.');
      }
    }
  };

  const cancelRecording = () => {
    if (recordingTimer.current) {
      window.clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    setRecording(false);
    setRecordSeconds(0);

    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (audioStreamRef.current) {
      try {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      audioStreamRef.current = null;
    }
    audioChunksRef.current = [];
  };

  const finishAndSendRecording = async () => {
    if (recordingTimer.current) {
      window.clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }

    const duration = recordSeconds;
    setRecording(false);
    setRecordSeconds(0);

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mime });
        resolve(blob);
      };
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          const mime = recorder.mimeType || 'audio/webm';
          resolve(new Blob(audioChunksRef.current, { type: mime }));
        }
      } catch {
        resolve(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
      }
    });

    if (audioStreamRef.current) {
      try {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      audioStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    if (duration < 1 && audioBlob.size < 1000) {
      notify('Voice note too short', 'Recording was too short to send.');
      return;
    }

    if (!uid || !selected?.id) return;
    const activeConv = selectedConversation || selected;
    if (!activeConv) return;

    try {
      const targetReply =
        replyTarget && messages.some((m) => m.id === replyTarget.id)
          ? replyTarget
          : null;

      const messageData: Rec = {
        type: 'voice',
        text: '',
        durationSeconds: duration,
        duration: formatDuration(duration),
        senderId: uid,
        senderName: profile?.displayName || profile?.username || 'User',
        senderUsername: profile?.username || '',
        senderPhotoURL: profile?.photoURL || '',
        senderProfileAssetId: profile?.profileAssetId || '',
        createdAt: serverTimestamp(),
        status: drive.hasActiveSession ? 'uploading' : 'ready',
        audioUrl: '',
        driveFileId: null,
        driveOwnerUid: uid,
        listenedBy: [],
        listenedAt: null,
        deletedFromDrive: false,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        editedAt: null,
        deleted: false,
      };

      if (targetReply) {
        messageData.replyToMessageId = targetReply.id;
        messageData.replyTo = buildReplyToPayload(targetReply);
      }

      const messageRef = await addDoc(
        collection(db, 'conversations', selected.id, 'messages'),
        messageData,
      );

      // Cache audio locally on user device immediately for instant zero-wait playback
      await cacheAudioBlob(messageRef.id, audioBlob);

      const updates: Rec = {
        lastMessageId: messageRef.id,
        lastMessageText: '🎤 Voice message',
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        lastSenderName: profile?.displayName || profile?.username || 'You',
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'conversations', selected.id), updates);
      setReplyTarget(null);

      // Upload to Google Drive folder 'Shinzi' -> 'Voice' in the background
      if (drive.hasActiveSession) {
        void (async () => {
          try {
            const ext = audioBlob.type.includes('mp4')
              ? 'mp4'
              : audioBlob.type.includes('ogg')
              ? 'ogg'
              : 'webm';
            const fileName = `voice_${Date.now()}.${ext}`;
            const file = new File([audioBlob], fileName, {
              type: audioBlob.type || 'audio/webm',
            });
            const uploaded = await drive.uploadFile({
              file,
              fileName,
              mimeType: audioBlob.type || 'audio/webm',
              folderType: 'voice',
            });
            await drive.makeFilePublic(uploaded.fileId);
            const voiceUrl = `/api/voice?fileId=${encodeURIComponent(
              uploaded.fileId,
            )}&ownerUid=${encodeURIComponent(uid)}`;
            await updateDoc(
              doc(db, 'conversations', selected.id, 'messages', messageRef.id),
              {
                driveFileId: uploaded.fileId,
                audioUrl: voiceUrl,
                status: 'ready',
              },
            );
          } catch (driveErr) {
            console.warn('Voice upload to Drive failed, storing inline:', driveErr);
            const dataUri = await blobToDataUri(audioBlob);
            await updateDoc(
              doc(db, 'conversations', selected.id, 'messages', messageRef.id),
              {
                audioUrl: dataUri,
                status: 'ready',
              },
            );
          }
        })();
      } else {
        const dataUri = await blobToDataUri(audioBlob);
        await updateDoc(
          doc(db, 'conversations', selected.id, 'messages', messageRef.id),
          {
            audioUrl: dataUri,
            status: 'ready',
          },
        );
      }
    } catch (err: unknown) {
      console.error('Error sending voice message:', err);
      notify('Failed to send voice message', messageOf(err));
    }
  };

  const toggleRecordingUI = () => {
    if (recording) {
      void finishAndSendRecording();
    } else {
      void startRecording();
    }
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
    } else if (target === 'servers') {
      navigateToUrl('/servers');
    } else {
      notify(target === 'ai' ? 'AI' : 'Servers', 'This screen is not connected yet.');
    }
  };

  const openUserProfile = (profileUid?: string) => {
    if (!profileUid) return;
    setViewingProfileUid(profileUid);
    window.history.pushState(
      { profileUid },
      '',
      `/profile?uid=${encodeURIComponent(profileUid)}`,
    );
  };

  const handleMentionClick = async (rawMention: string) => {
    if (!rawMention) return;
    const clean = rawMention.replace(/^[@#]+/, '').trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (lower === 'here' || lower === 'everyone') return;

    // 1. Current user (including self-mention e.g. @shinzi)
    const myUsername = (profile?.username || '').trim().toLowerCase();
    const myDisplayNameHandle = (profile?.displayName || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const myDisplayName = (profile?.displayName || '').trim().toLowerCase();
    if (uid && (lower === myUsername || lower === myDisplayNameHandle || lower === myDisplayName)) {
      openUserProfile(uid);
      return;
    }

    // 2. Members of the active conversation
    const activeConv = selectedConversation || selected;
    if (activeConv?.memberProfiles) {
      for (const [memberId, prof] of Object.entries(activeConv.memberProfiles)) {
        const p = prof as Rec | undefined;
        const u = (p?.username || '').trim().toLowerCase();
        const d = (p?.displayName || '').trim().toLowerCase().replace(/\s+/g, '_');
        const dRaw = (p?.displayName || '').trim().toLowerCase();
        if (u === lower || d === lower || dRaw === lower) {
          openUserProfile(memberId);
          return;
        }
      }
    }

    // 3. User live profiles cache
    for (const [mid, liveProf] of Object.entries(userLiveProfiles)) {
      const u = (liveProf?.username || '').trim().toLowerCase();
      const d = (liveProf?.displayName || '').trim().toLowerCase().replace(/\s+/g, '_');
      const dRaw = (liveProf?.displayName || '').trim().toLowerCase();
      if (u === lower || d === lower || dRaw === lower) {
        openUserProfile(mid);
        return;
      }
    }

    // 4. Friends list
    for (const f of friends) {
      const u = String(f?.username || '').trim().toLowerCase();
      const d = String(f?.displayName || '').trim().toLowerCase().replace(/\s+/g, '_');
      const dRaw = String(f?.displayName || '').trim().toLowerCase();
      if (u === lower || d === lower || dRaw === lower) {
        openUserProfile(f.id);
        return;
      }
    }

    // 5. Query Firestore usernames collection
    try {
      const snap = await getDoc(doc(db, 'usernames', lower));
      if (snap.exists()) {
        const targetUid = snap.data()?.uid;
        if (targetUid) {
          openUserProfile(targetUid);
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to resolve mention via usernames doc:', err);
    }

    // 6. Query Firestore users collection as fallback
    try {
      const q = query(collection(db, 'users'), where('username', '==', lower), limit(1));
      const userSnap = await getDocs(q);
      if (!userSnap.empty) {
        openUserProfile(userSnap.docs[0].id);
        return;
      }
    } catch (err) {
      console.warn('Failed to resolve mention via users query:', err);
    }

    notify('Profile not found', `Could not find a user with @${clean}`);
  };

  const goBack = () => {
    if (screen === 'conversation') {
      void publishTyping(false);
      setSelected(null);
      setScreen('main');
      setMessageText('');
      setReplyTarget(null);
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

    const isSpecial =
      Boolean(item.deleted) ||
      item.type === 'poll' ||
      item.type === 'event' ||
      item.type === 'voice' ||
      Boolean(item.isCallRecord) ||
      Boolean(item.isSystem);

    const prevSpecial =
      Boolean(previous) &&
      (Boolean(previous.deleted) ||
        previous.type === 'poll' ||
        previous.type === 'event' ||
        previous.type === 'voice' ||
        Boolean(previous.isCallRecord) ||
        Boolean(previous.isSystem));

    const timeGap =
      previous && item.createdAt && previous.createdAt
        ? Math.abs(millis(item.createdAt) - millis(previous.createdAt)) > 5 * 60 * 1000
        : true;

    const isFirstInGroup =
      !previous ||
      showDay ||
      previous.senderId !== item.senderId ||
      timeGap ||
      Boolean(replyId) ||
      isSpecial ||
      Boolean(prevSpecial);

    let quotedSender = 'User';
    let quotedText = 'Original message unavailable';
    let quotedSenderId = '';

    if (replyId) {
      if (original) {
        quotedSenderId = original.senderId || '';
        if (original.deleted) {
          quotedSender =
            original.senderName ||
            original.senderUsername ||
            (original.senderId === uid
              ? profile?.displayName || profile?.username || 'You'
              : 'User');
          quotedText = 'Original message was deleted';
        } else {
          quotedSender =
            original.senderName ||
            original.senderUsername ||
            (original.senderId === uid
              ? profile?.displayName || profile?.username || 'You'
              : 'User');
          quotedText = getReplyExcerpt(original);
        }
      } else if (item.replyTo) {
        quotedSenderId = item.replyTo.senderId || '';
        const replyProfile = quotedSenderId
          ? (quotedSenderId === uid
              ? profile
              : (quotedSenderId === activeDmTargetUid ? liveTargetProfile : null) || userLiveProfiles[quotedSenderId])
          : null;
        quotedSender =
          (quotedSenderId === uid ? 'You' : replyProfile?.displayName || replyProfile?.username) ||
          item.replyTo.senderName ||
          item.replyTo.senderUsername ||
          'User';
        quotedText = item.replyTo.text || 'Original message unavailable';
      }
    }

    const authorProfile = item.senderId
      ? (item.senderId === uid
          ? profile
          : (item.senderId === activeDmTargetUid ? liveTargetProfile : null) || userLiveProfiles[item.senderId])
      : null;

    const authorName = own
      ? profile?.displayName || profile?.username || 'You'
      : authorProfile?.displayName || authorProfile?.username || item.senderName || item.senderUsername || 'User';

    const mentionedMe =
      !own &&
      (isMentioned(item.text, profile?.username, profile?.displayName) ||
        Boolean(item.text?.includes('@here')));

    let contentNode: ReactNode;

    const resolveImageUrls = (msg: Rec) => {
      let preview = '';
      let original = '';
      const fileId = msg.driveFileId || msg.fileId;
      if (fileId) {
        preview = `https://lh3.googleusercontent.com/d/${fileId}=s1600`;
        original = `https://lh3.googleusercontent.com/d/${fileId}=s0`;
      } else if (msg.mediaUrl || msg.imageUrl) {
        const raw = String(msg.mediaUrl || msg.imageUrl);
        const driveMatch = raw.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          preview = `https://lh3.googleusercontent.com/d/${driveMatch[1]}=s1600`;
          original = `https://lh3.googleusercontent.com/d/${driveMatch[1]}=s0`;
        } else {
          preview = raw;
          original = msg.originalUrl || raw;
        }
      } else if (msg.text) {
        const standalone = isStandaloneImageUrl(msg.text);
        if (standalone) {
          preview = standalone;
          original = standalone;
        }
      }
      return { preview, original };
    };

    const { preview: imgPreview, original: imgOriginal } = resolveImageUrls(item);
    const hasImageMessage = Boolean(
      imgPreview &&
        (item.type === 'image' ||
          item.driveFileId ||
          item.mediaUrl ||
          item.imageUrl ||
          isStandaloneImageUrl(item.text)),
    );

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
        <VoicePlayer
          message={item}
          currentUid={uid}
          conversationId={selected?.id || ''}
          own={item.senderId === uid}
          onNotify={notify}
        />
      );
    } else if (item.type === 'file') {
      contentNode = (
        <FileMessage
          message={item}
          own={item.senderId === uid}
          onNotify={notify}
        />
      );
    } else if (item.type === 'media' || (Array.isArray(item.mediaItems) && item.mediaItems.length > 0)) {
      contentNode = (
        <MediaGrid
          items={item.mediaItems || []}
          caption={item.text ? renderStyledContent(item.text, handleMentionClick, renderFormattedText) : undefined}
          own={item.senderId === uid}
          messageId={item.id}
          createdAt={item.createdAt}
          deletedFromDrive={item.deletedFromDrive}
          onOpenImage={(mediaItem) => {
            setActiveImageViewer({
              previewUrl: mediaItem.originalUrl || mediaItem.mediaUrl,
              originalUrl: mediaItem.originalUrl || mediaItem.mediaUrl,
              fileName: mediaItem.fileName || 'Image',
            });
          }}
          onOpenVideo={(mediaItem) => {
            setActiveVideoViewer({
              url: mediaItem.originalUrl || mediaItem.mediaUrl,
              fileName: mediaItem.fileName || 'Video',
            });
          }}
          onOpenGallery={(galleryItems, startIndex) => {
            const target = galleryItems[startIndex] || galleryItems[0];
            if (target?.type === 'video') {
              setActiveVideoViewer({
                url: target.originalUrl || target.mediaUrl,
                fileName: target.fileName || 'Video',
              });
            } else if (target) {
              setActiveImageViewer({
                previewUrl: target.originalUrl || target.mediaUrl,
                originalUrl: target.originalUrl || target.mediaUrl,
                fileName: target.fileName || 'Image',
              });
            }
          }}
          onNotify={notify}
        />
      );
    } else if (hasImageMessage) {
      const isStandaloneUrl = isStandaloneImageUrl(item.text);
      const singleItem: MediaItem = {
        type: 'image',
        mediaUrl: imgPreview,
        originalUrl: imgOriginal,
        driveFileId: item.driveFileId || null,
        fileName: item.fileName || 'photo.jpg',
        sizeBytes: item.sizeBytes || undefined,
        width: item.width || undefined,
        height: item.height || undefined,
      };
      contentNode = (
        <MediaGrid
          items={[singleItem]}
          caption={item.text && !isStandaloneUrl ? renderStyledContent(item.text, handleMentionClick, renderFormattedText) : undefined}
          own={item.senderId === uid}
          messageId={item.id}
          createdAt={item.createdAt}
          deletedFromDrive={item.deletedFromDrive}
          onOpenImage={(mi) => {
            setActiveImageViewer({
              previewUrl: mi.originalUrl || mi.mediaUrl,
              originalUrl: mi.originalUrl || mi.mediaUrl,
              fileName: mi.fileName || 'Image',
            });
          }}
          onOpenVideo={(mi) => {
            setActiveVideoViewer({
              url: mi.originalUrl || mi.mediaUrl,
              fileName: mi.fileName || 'Video',
            });
          }}
          onOpenGallery={(items, idx) => {
            const mi = items[idx] || items[0];
            if (mi?.type === 'video') {
              setActiveVideoViewer({
                url: mi.originalUrl || mi.mediaUrl,
                fileName: mi.fileName || 'Video',
              });
            } else if (mi) {
              setActiveImageViewer({
                previewUrl: mi.originalUrl || mi.mediaUrl,
                originalUrl: mi.originalUrl || mi.mediaUrl,
                fileName: mi.fileName || 'Image',
              });
            }
          }}
          onNotify={notify}
        />
      );
    } else {
      if (item.isError) {
        contentNode = (
          <span className="shc-dc-text" style={{ color: '#ff4b4b', fontWeight: 600 }}>
            {item.text}
          </span>
        );
      } else {
        const styledText = applyTextStyles(item.text);
        const emojiOnly = isEmojiOnly(styledText);
        contentNode = emojiOnly ? (
          <span className="shc-dc-jumbo-emoji">{styledText.trim()}</span>
        ) : (
          <span className="shc-dc-text">{renderStyledContent(item.text, handleMentionClick, renderFormattedText)}</span>
        );
      }
    }

    const messageContent = (
      <div
        className={`shc-dc-msg ${
          isFirstInGroup ? 'shc-dc-group-start' : 'shc-dc-group-consecutive'
        } ${mentionedMe ? 'shc-dc-msg-highlight' : ''}`}
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
            <UserAvatar
              uid={quotedSenderId}
              name={quotedSender}
              photoURL={
                quotedSenderId === uid
                  ? (profile?.photoURL || undefined)
                  : (quotedSenderId === activeDmTargetUid
                      ? (liveTargetProfile?.photoURL || undefined)
                      : (selectedConversation?.memberProfiles?.[quotedSenderId]?.photoURL || undefined))
              }
              profileAssetId={
                quotedSenderId === uid
                  ? (profile?.profileAssetId || undefined)
                  : (quotedSenderId === activeDmTargetUid
                      ? (liveTargetProfile?.profileAssetId || undefined)
                      : (selectedConversation?.memberProfiles?.[quotedSenderId]?.profileAssetId || undefined))
              }
              size="xs"
            />
            <span className="shc-dc-reply-sender">{quotedSender}:</span>
            <span className="shc-dc-reply-text">
              {original ? renderReplyContent(original, quotedText) : renderReplyFromReplyTo(item.replyTo, quotedText)}
            </span>
          </div>
        )}

        <div className="shc-dc-main">
          {isFirstInGroup ? (
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
              <ChatMessageAvatar
                uid={item.senderId}
                name={authorName}
                photoURL={
                  item.senderId === uid
                    ? (profile?.photoURL || item.senderPhotoURL)
                    : (authorProfile?.photoURL ||
                        userLiveAvatars[item.senderId] ||
                        (item.senderId === activeDmTargetUid
                          ? (liveTargetProfile?.photoURL || item.senderPhotoURL)
                          : (selectedConversation?.memberProfiles?.[item.senderId]?.photoURL || item.senderPhotoURL)))
                }
                profileAssetId={
                  item.senderId === uid
                    ? (profile?.profileAssetId || item.senderProfileAssetId)
                    : (authorProfile?.profileAssetId ||
                        (item.senderId === activeDmTargetUid
                          ? (liveTargetProfile?.profileAssetId || item.senderProfileAssetId)
                          : (selectedConversation?.memberProfiles?.[item.senderId]?.profileAssetId || item.senderProfileAssetId)))
                }
                size={36}
              />
            </button>
          ) : (
            <div className="shc-dc-gutter-col" aria-hidden="true">
              <span className="shc-dc-gutter-time">{formatTime(item.createdAt)}</span>
            </div>
          )}

          <div className="shc-dc-body-col">
            {isFirstInGroup && (
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
                  {renderStyledContent(authorName)}
                </button>
                <span className="shc-dc-timestamp">
                  {formatDiscordTimestamp(item.createdAt)}
                </span>
              </div>
            )}

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
        {showDay && (
          <div className="shc-day">
            <span>{dateLabel(item.createdAt)}</span>
          </div>
        )}
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
            const lastSenderName =
              item.lastSenderId === uid
                ? profile?.displayName || profile?.username || 'You'
                : userLiveProfiles[item.lastSenderId]?.displayName ||
                  userLiveProfiles[item.lastSenderId]?.username ||
                  item.lastSenderName ||
                  (item.lastSenderId
                    ? item.memberProfiles?.[item.lastSenderId]?.displayName ||
                      item.memberProfiles?.[item.lastSenderId]?.username
                    : '') ||
                  (item.type === 'group' ? '' : name);

            const isLastMsgGif = item.lastMessageText === 'GIF' || item.lastMessageText === 'gif';
            const isLastMsgSticker = item.lastMessageText === 'Sticker' || item.lastMessageText === 'sticker';

            const previewNode = item.lastMessageText ? (
              isLastMsgGif ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {lastSenderName ? `${lastSenderName}: ` : ''}
                  <GoogleGifIcon size={16} /> GIF
                </span>
              ) : isLastMsgSticker ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {lastSenderName ? `${lastSenderName}: ` : ''}
                  <GoogleStickerIcon size={14} /> Sticker
                </span>
              ) : (
                lastSenderName
                  ? `${lastSenderName}: ${item.lastMessageText}`
                  : item.lastMessageText
              )
            ) : (
              'No messages yet'
            );

            const otherId = otherMemberId(item);
            const otherProfile = userLiveProfiles[otherId] || (item.memberProfiles?.[otherId]);
            const otherStatus = item.type === 'group' ? undefined : getUserEffectiveStatus(otherProfile, userLivePresence[otherId]);

            return (
              <button
                type="button"
                key={item.id}
                className="shc-conv"
                onClick={() => void openConversation(item)}
              >
                <UserAvatar
                  uid={item.type === 'group' ? undefined : otherId}
                  name={name}
                  photoURL={
                    item.type === 'group'
                      ? undefined
                      : (userLiveAvatars[otherId] || otherProfile?.photoURL)
                  }
                  profileAssetId={
                    item.type === 'group'
                      ? undefined
                      : otherProfile?.profileAssetId
                  }
                  group={item.type === 'group'}
                  size="md"
                  status={otherStatus}
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
                      {previewNode}
                    </span>

                    <span className="shc-conv-icons">
                      {isUrgent(item) && <AtSign size={15} className="shc-mention-badge" />}
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
            photoURL={userLiveAvatars[item.id] || item.photoURL}
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
      const fromUid = item.fromUid || item.fromProfile?.uid;
      const live = fromUid ? userLiveProfiles[fromUid] : null;
      const displayName =
        live?.displayName ||
        item.fromProfile?.displayName ||
        item.fromProfile?.username ||
        'User';
      const username = live?.username || item.fromProfile?.username || 'user';
      const photoURL = live?.photoURL || item.fromProfile?.photoURL;
      const profileAssetId =
        live?.profileAssetId || item.fromProfile?.profileAssetId;

      return (
        <div key={`${kind}:${item.id}`} className="shc-request">
          <UserAvatar
            uid={fromUid}
            name={displayName}
            photoURL={photoURL}
            profileAssetId={profileAssetId}
            size="md"
          />

          <span className="shc-person-info">
            <strong>{displayName}</strong>
            <span>
              {kind === 'friendRequests' ? 'Friend request' : 'DM request'}
              {' · '}@{username}
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
            onChange={(e) => {
              const val = e.target.value;
              setUserQuery(val);
              if (!val.trim()) {
                setSearchResult(null);
                setSearching(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void searchUser(undefined, true);
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
    const isGroup = selectedConversation?.type === 'group';
    const targetUid = isGroup ? undefined : otherMemberId(selectedConversation);
    const targetProfile =
      liveTargetProfile ||
      (targetUid
        ? userLiveProfiles[targetUid] || selectedConversation?.memberProfiles?.[targetUid]
        : undefined);
    const name = getConversationName(selectedConversation);
    const username = getConversationUsername(selectedConversation);
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
    const hasMentions = Boolean(messageText && /[@#]/.test(messageText));

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
                status={isGroup ? undefined : getUserEffectiveStatus(liveTargetProfile || targetProfile || userLiveProfiles[targetUid], userLivePresence[targetUid])}
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

        <div className="shc-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
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
            <button
              type="button"
              className="shc-rec-cancel-btn"
              onClick={cancelRecording}
              aria-label="Cancel recording"
              title="Cancel recording"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {replyTarget && (
          <div className="shc-reply-bar">
            <div className="shc-reply-bar-left">
              <Reply size={16} className="shc-reply-bar-icon" />
              <UserAvatar
                uid={replyTarget.senderId}
                name={replyTarget.senderName || replyTarget.senderUsername || 'User'}
                photoURL={replyTarget.senderPhotoURL}
                profileAssetId={replyTarget.senderProfileAssetId}
                size="xs"
              />
              <div className="shc-reply-bar-content">
                <span className="shc-reply-bar-sender">
                  Replying to{' '}
                  <span className="shc-reply-bar-target-name">
                    {(replyTarget.senderName ||
                      replyTarget.senderUsername ||
                      (replyTarget.senderId === uid
                        ? profile?.displayName || profile?.username || 'You'
                        : 'User'))}:
                  </span>
                </span>
                <span className="shc-reply-bar-text">
                  {renderReplyContent(replyTarget)}
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

        {/* Discord-style scroll-to-bottom floating button */}
        {showScrollBottom && (
          <button
            type="button"
            className="shc-scroll-bottom-btn"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}

        {localChatError && (
          <div
            role="alert"
            style={{
              margin: '0 12px 8px',
              padding: '8px 14px',
              borderRadius: 8,
              background: 'rgba(255, 75, 75, 0.14)',
              border: '1px solid rgba(255, 75, 75, 0.35)',
              color: '#ff4b4b',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <span>{localChatError.text}</span>
            <button
              type="button"
              onClick={() => setLocalChatError(null)}
              style={{
                background: 'transparent',
                border: 0,
                color: '#ff4b4b',
                fontSize: 18,
                cursor: 'pointer',
                lineHeight: 1,
                padding: '0 4px',
              }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <div className="shc-composer-wrap">
          {mentionQuery !== null && filteredMentionSuggestions.length > 0 && (
            <div className="shc-mention-panel" role="listbox" aria-label="Mention suggestions">
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
                    e.preventDefault();
                    insertMention(item.handle);
                  }}
                >
                  <div className="shc-mention-item-inner">
                    {item.isHere ? (
                      <span className="shc-mention-item-badge">@</span>
                    ) : (
                      <UserAvatar
                        uid={item.uid}
                        name={item.name}
                        photoURL={item.photoURL}
                        profileAssetId={item.profileAssetId}
                        size="xs"
                      />
                    )}
                    <span className="shc-mention-item-handle">
                      {item.isHere ? '@here' : `@${item.handle}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {stagedMedia.length > 0 && (
            <div className="shc-composer-staged-tray">
              {stagedMedia.map((item) => (
                <div key={item.id} className="shc-composer-staged-item">
                  {item.type === 'video' ? (
                    <video
                      src={item.previewUrl}
                      className="shc-composer-staged-thumb"
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={item.previewUrl}
                      alt="Staged attachment"
                      className="shc-composer-staged-thumb"
                    />
                  )}
                  <button
                    type="button"
                    className="shc-composer-staged-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeStagedMedia(item.id);
                    }}
                    aria-label="Remove attachment"
                  >
                    <X size={13} strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className={
              isKeyboardOpen ? 'shc-composer shc-composer-kb' : 'shc-composer'
            }
          >
            <div className="shc-composer-input-box">
              <button
                type="button"
                className="shc-composer-icon-btn shc-composer-attach-btn"
                onClick={() => setShowAttach(true)}
                aria-label="Attach"
              >
                <Plus size={22} />
              </button>

              <div className={`shc-composer-text-wrap ${hasMentions ? 'shc-composer-has-mentions' : ''}`}>
                {hasMentions && (
                  <div ref={backdropRef} className="shc-composer-backdrop" aria-hidden="true">
                    {renderMentionColoredText(messageText)}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  value={messageText}
                  onChange={(e) => {
                    handleMessageChange(e.target.value, e.target);
                    syncBackdropScroll();
                  }}
                  onScroll={syncBackdropScroll}
                  onSelect={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    const ctx = getMentionContext(target.value, target.selectionStart ?? target.value.length);
                    if (ctx) {
                      setMentionQuery(ctx.query);
                      setMentionSelectedIndex(0);
                    } else {
                      setMentionQuery(null);
                    }
                  }}
                  placeholder={composerPlaceholder}
                  maxLength={MAX_MESSAGE_LENGTH}
                  onKeyDown={onComposerKey}
                  rows={1}
                  className="shc-composer-textarea"
                  onFocus={() => {
                    // Force lock: only auto-scroll on focus if user is already near bottom
                    if (isNearBottomRef.current) {
                      window.requestAnimationFrame(() => {
                        if (scrollRef.current) {
                          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }
                      });
                    }
                  }}
                />
              </div>

              <button
                type="button"
                className="shc-composer-icon-btn shc-composer-emoji-btn"
                onClick={() => {
                  setActionMessage(null);
                  setShowEmojiPicker((p) => !p);
                }}
                aria-label="Toggle emoji picker"
              >
                <Smile size={21} />
              </button>

              {!messageText.trim() && stagedMedia.length === 0 && (
                <button
                  type="button"
                  className={`shc-composer-icon-btn shc-composer-voice-btn ${recording ? 'shc-rec-on' : ''}`}
                  onClick={toggleRecordingUI}
                  aria-label={recording ? 'Stop recording' : 'Record voice message'}
                >
                  {recording ? <Square size={20} /> : <Mic size={21} />}
                </button>
              )}

              <button
                type="button"
                className={`shc-composer-icon-btn shc-composer-send-btn ${(messageText.trim() || stagedMedia.length > 0) ? 'shc-send-active' : ''}`}
                disabled={(!messageText.trim() && stagedMedia.length === 0) || sending || (Boolean(targetUid) && dmRequestState === 'incoming')}
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
                {sending ? <span className="shc-spinner shc-spinner-sm" /> : <Send size={20} />}
              </button>
            </div>
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
          accept="image/*,video/*"
          multiple
          hidden
          onChange={onPickGallery}
        />
        <input
          ref={docRef}
          type="file"
          accept="*/*"
          hidden
          onChange={onPickDocument}
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
        <Sheet title="More" onClose={() => setShowAttach(false)}>
          <div className="shc-attach-grid">
            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                fileRef.current?.click();
              }}
            >
              <ImageIcon size={30} />
              Gallery
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAttach(false);
                setGifSearch('');
                setPanel('gif');
              }}
            >
              <GoogleStickerIcon size={30} />
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
                docRef.current?.click();
              }}
            >
              <GoogleFileIcon size={30} />
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

          <button
            type="button"
            className="shc-input shc-datetime-field"
            onClick={() => setOpenDatePicker('start')}
          >
            <div className="shc-datetime-field-content">
              <span className="shc-datetime-label">Start:</span>
              <span className={eventStart ? 'shc-datetime-value' : 'shc-datetime-placeholder'}>
                {eventStart || 'Pick start date & time'}
              </span>
            </div>
            <div className="shc-datetime-icons">
              <Calendar size={17} />
              <Clock size={16} />
            </div>
          </button>

          <button
            type="button"
            className="shc-input shc-datetime-field"
            onClick={() => setOpenDatePicker('end')}
          >
            <div className="shc-datetime-field-content">
              <span className="shc-datetime-label">End:</span>
              <span className={eventEnd ? 'shc-datetime-value' : 'shc-datetime-placeholder'}>
                {eventEnd || 'Pick end date & time'}
              </span>
            </div>
            <div className="shc-datetime-icons">
              <Calendar size={17} />
              <Clock size={16} />
            </div>
          </button>

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
                onClick={() => {
                  if (gifMode !== type) {
                    setGifMode(type);
                    setGifSearch('');
                  }
                }}
                style={
                  gifMode === type
                    ? { backgroundColor: '#ffffff', color: '#000000', borderColor: '#ffffff', fontWeight: 800 }
                    : { backgroundColor: '#1e1f22', color: '#949ba4', borderColor: 'rgba(255,255,255,0.08)' }
                }
              >
                {type === 'gif' ? 'GIF' : 'Sticker'}
              </button>
            ))}
          </div>

          <input
            className="shc-gif-search"
            placeholder={gifMode === 'gif' ? 'Search gifs' : 'Search stickers'}
            value={gifSearch}
            onChange={(e) => setGifSearch(e.target.value)}
          />

          {klipyLoading ? (
            <div className="shc-klipy-loading">
              <span className="shc-spinner" />
            </div>
          ) : klipyItems.length === 0 ? (
            <div className="shc-klipy-empty">
              {gifSearch.trim()
                ? `no result for "${gifSearch.trim()}" ${gifMode}`
                : `No ${gifMode}s found`}
            </div>
          ) : (
            <div className="shc-klipy-grid">
              {klipyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`shc-klipy-item ${item.type === 'sticker' ? 'shc-klipy-item-sticker' : ''}`}
                  onClick={() => void onSelectKlipyItem(item)}
                  title={item.title}
                >
                  <img
                    src={item.previewUrl || item.originalUrl}
                    alt={item.title}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
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

      {activeImageViewer && (
        <div
          className="shc-lightbox-backdrop"
          onClick={() => setActiveImageViewer(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div className="shc-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span className="shc-lightbox-title">
              {activeImageViewer.fileName || 'Image'}
            </span>
            <div className="shc-lightbox-actions">
              <a
                href={activeImageViewer.originalUrl || activeImageViewer.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shc-lightbox-btn"
                title="Open original image in new tab"
                aria-label="Open original image in new tab"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
                <span>Open original</span>
              </a>
              <button
                type="button"
                className="shc-lightbox-btn shc-lightbox-close"
                onClick={() => setActiveImageViewer(null)}
                title="Close preview"
                aria-label="Close image preview"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          <div className="shc-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={activeImageViewer.originalUrl || activeImageViewer.previewUrl}
              alt={activeImageViewer.fileName || 'Full image preview'}
              className="shc-lightbox-img"
            />
          </div>
        </div>
      )}

      {activeVideoViewer && (
        <div
          className="shc-lightbox-backdrop"
          onClick={() => setActiveVideoViewer(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Video player"
        >
          <div className="shc-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span className="shc-lightbox-title">
              {activeVideoViewer.fileName || 'Video'}
            </span>
            <div className="shc-lightbox-actions">
              <a
                href={activeVideoViewer.url}
                target="_blank"
                rel="noopener noreferrer"
                download={activeVideoViewer.fileName || 'video.mp4'}
                className="shc-lightbox-btn"
                title="Download video"
                aria-label="Download video"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
                <span>Download</span>
              </a>
              <button
                type="button"
                className="shc-lightbox-btn shc-lightbox-close"
                onClick={() => setActiveVideoViewer(null)}
                title="Close video"
                aria-label="Close video player"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          <div className="shc-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <video
              src={activeVideoViewer.url}
              controls
              autoPlay
              playsInline
              style={{ maxWidth: '92vw', maxHeight: '82vh', borderRadius: 8, outline: 'none' }}
            />
          </div>
        </div>
      )}

      {viewingProfileUid && (
        <OtherProfile
          targetUid={viewingProfileUid}
          onClose={() => {
            setViewingProfileUid(null);
            if (window.location.pathname.toLowerCase() === '/profile') {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateToUrl('/chat');
              }
            }
          }}
          onOpenChat={async (targetUid) => {
            setViewingProfileUid(null);
            await handleSearchMessage({ id: targetUid });
          }}
        />
      )}

      {openDatePicker && (
        <DateTimePickerModal
          title={openDatePicker === 'start' ? 'Select Start Date & Time' : 'Select End Date & Time'}
          initialValue={openDatePicker === 'start' ? eventStart : eventEnd}
          onConfirm={(val) => {
            if (openDatePicker === 'start') {
              setEventStart(val);
            } else {
              setEventEnd(val);
            }
            setOpenDatePicker(null);
          }}
          onClose={() => setOpenDatePicker(null)}
        />
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
