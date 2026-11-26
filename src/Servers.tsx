import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import './Servers.css';
import './Chat.css';
import type { CategoryButtonRenderProps } from 'emoji-picker-react';
import { loadEmojiPickerData, saveRecentEmoji, isEmojiOnly } from './emojiData';
import { searchKlipy, getCachedKlipy, type KlipyItem } from './klipyService';
import {
  Plus,
  Search,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  UserPlus,
  X,
  Copy,
  Check,
  Share2,
  Lock,
  Volume2,
  Sparkles,
  Server as ServerIcon,
  MessageCircle,
  User,
  Bell,
  Settings,
  LogOut,
  Ban,
  Trash2,
  CheckCircle2,
  Calendar,
  Pencil,
  ArrowUpDown,
  Send,
  Image as ImageIcon,
  Mic,
  FileText,
  Smile,
  Square,
  Camera,
  Eye,
  MoreHorizontal,
  Shield,
  GitCommit,
  Link2,
  Users,
} from 'lucide-react';
import ColorPickerModal from './ColorPickerModal';
import { auth, db } from './firebaseConfig';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  addDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import MediaCropModal from './MediaCropModal';
import { useDriveStore } from './driveStore';
import { getUserEffectiveStatus } from './presenceService';
import {
  applyTextStyles,
  validateTextStyleSyntax,
  renderStyledContent,
  getUsedStylesData,
  importIncomingStyleData,
  cleanRawText,
  renderStyledDisplayName,
} from './textStyleService';
import OtherProfile from './OtherProfile';
import { navigateTo } from './profileCache';

export interface ServerChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'forum';
  description?: string;
  iconUrl?: string;
  isPrivate?: boolean;
  listenerCount?: string;
  allowedTags?: string[];
}

export interface ServerCategory {
  id: string;
  name: string;
  channels: ServerChannel[];
  isPrivate?: boolean;
}

export interface ServerTag {
  id: string;
  name: string;
  color: string;
  createdAt?: number;
}

export interface ServerCommit {
  id: string; // 7-char hash code e.g. "a3b89ef"
  authorUid: string;
  authorName: string;
  authorAvatar?: string;
  createdAt: number;
  changes: string[];
}

export interface ServerInviteItem {
  id: string;
  code: string;
  creatorUid: string;
  creatorName: string;
  creatorAvatar?: string;
  createdAt: number;
  expiresAt?: string;
  uses: number;
}

export interface ServerData {
  id: string;
  name: string;
  creatorName?: string;
  ownerId?: string;
  description?: string;
  iconUrl?: string;
  bannerUrl?: string;
  memberCount: string;
  memberIds?: string[];
  visibility?: 'public' | 'private';
  isOfficial?: boolean;
  isCustomTag?: boolean;
  isCreatedByMe?: boolean;
  isPrivate?: boolean;
  onlineCount?: string;
  categories: ServerCategory[];
  tags?: ServerTag[];
  memberTags?: Record<string, string[]>;
  equippedTags?: Record<string, string>;
  commits?: ServerCommit[];
  invites?: ServerInviteItem[];
  createdAt?: number;
}

export interface ServerChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text?: string;
  imageUrl?: string;
  createdAt?: any;
}

interface ServersProps {
  onBack?: () => void;
  onOpenChat?: () => void;
  onOpenProfile?: () => void;
  onOpenNotifications?: () => void;
}

// Legacy mock server IDs to clean out from localStorage
const FAKE_SERVER_IDS = new Set([
  'shinzi-hub',
  'minecraft',
  'roblox',
  'mcpedl',
  'ishowspeed',
  'steak-kitchen',
]);

const cleanSavedServers = (saved: string | null): ServerData[] => {
  if (!saved) return [];
  try {
    const list: ServerData[] = JSON.parse(saved);
    if (!Array.isArray(list)) return [];
    return list.filter((s) => s && s.id && !FAKE_SERVER_IDS.has(s.id));
  } catch {
    return [];
  }
};

/**
 * Resizes and compresses image files into lightweight web-ready base64 data URLs.
 * Preserves animated GIFs under 1.5MB.
 */
async function processServerImage(file: File, isBanner: boolean | 'chat'): Promise<string> {
  if (file.type === 'image/gif' && file.size < 1500000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve) => {
    const isChat = isBanner === 'chat';
    const maxWidth = isChat ? 720 : isBanner ? 800 : 200;
    const maxHeight = isChat ? 720 : isBanner ? 450 : 200;
    const quality = isChat ? 0.78 : isBanner ? 0.78 : 0.82;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(img.src);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      const fallbackReader = new FileReader();
      fallbackReader.onload = () => resolve(fallbackReader.result as string);
      fallbackReader.readAsDataURL(file);
    };
    reader.readAsDataURL(file);
  });
}

const millis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
};

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

/**
 * Resolves attachment URLs (assetId / providerFileId / imageUrl / mediaUrl)
 * matching Drive image loading logic in Chat.tsx
 */
function resolveChannelAttachmentUrl(
  msg: any,
  assetMap: Record<string, string>
): string {
  const fileId =
    msg.providerFileId ||
    msg.driveFileId ||
    msg.fileId ||
    (msg.assetId ? assetMap[msg.assetId] || msg.assetId : undefined);

  if (fileId) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(`shinzi_drive_${fileId}`);
      if (stored) return stored;
    }
    return `https://lh3.googleusercontent.com/d/${fileId}=s1600`;
  }

  const raw = msg.imageUrl || msg.mediaUrl || '';
  if (raw) {
    const driveMatch = String(raw).match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch && driveMatch[1]) {
      return `https://lh3.googleusercontent.com/d/${driveMatch[1]}=s1600`;
    }
    return raw;
  }
  return '';
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
      }}
    />
  );
}

export default function Servers({
  onBack: _onBack,
  onOpenChat,
  onOpenProfile,
  onOpenNotifications,
}: ServersProps) {
  const drive = useDriveStore();
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(() => auth.currentUser);

  // Keep Firebase user state synchronized
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return unsubscribe;
  }, []);

  // Servers State - strictly real data, no hardcoded mocks
  const [createdServers, setCreatedServers] = useState<ServerData[]>(() => {
    return cleanSavedServers(localStorage.getItem('shinzi_created_servers'));
  });

  const [joinedServers, setJoinedServers] = useState<ServerData[]>(() => {
    return cleanSavedServers(localStorage.getItem('shinzi_joined_servers'));
  });

  // Discoverable public servers loaded from Firestore
  const [discoverableServers, setDiscoverableServers] = useState<ServerData[]>([]);

  // Navigation / Modal States
  const [activeServer, setActiveServer] = useState<ServerData | null>(() => {
    try {
      const saved = sessionStorage.getItem('shinzi_active_server');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [selectedChannel, setSelectedChannel] = useState<ServerChannel | null>(() => {
    try {
      const saved = sessionStorage.getItem('shinzi_selected_channel');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (activeServer) {
      try {
        sessionStorage.setItem('shinzi_active_server', JSON.stringify(activeServer));
      } catch {}
    } else {
      sessionStorage.removeItem('shinzi_active_server');
    }
  }, [activeServer]);

  useEffect(() => {
    if (selectedChannel) {
      try {
        sessionStorage.setItem('shinzi_selected_channel', JSON.stringify(selectedChannel));
      } catch {}
    } else {
      sessionStorage.removeItem('shinzi_selected_channel');
    }
  }, [selectedChannel]);

  const [viewingProfileUid, setViewingProfileUid] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Desktop Responsive State
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 768 : false));
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Server creation crop modal state (Banner and Profile, supports GIF)
  const [cropModalData, setCropModalData] = useState<{
    imageSrc: string;
    originalFile?: File;
    isGif?: boolean;
    type: 'banner' | 'avatar';
  } | null>(null);

  // Invite Screen State (IMG-20261110-WA0009)
  const [inviteModalServer, setInviteModalServer] = useState<ServerData | null>(null);
  const [isJoiningServer, setIsJoiningServer] = useState(false);

  // Channel Info / More modal state (IMG-20261126-WA0011)
  const [activeChannelInfo, setActiveChannelInfo] = useState<ServerChannel | null>(null);
  const [channelInfoTab, setChannelInfoTab] = useState<'members' | 'media' | 'chat'>('members');
  const [channelInfoSearchActive, setChannelInfoSearchActive] = useState(false);
  const [channelInfoSearchQuery, setChannelInfoSearchQuery] = useState('');
  const [selectedMediaPreviewUrl, setSelectedMediaPreviewUrl] = useState<string | null>(null);

  // Server Search modal state (IMG-20261126-WA0012)
  const [showServerSearch, setShowServerSearch] = useState(false);
  const [serverSearchTab, setServerSearchTab] = useState<'members' | 'media' | 'chat'>('members');
  const [serverSearchQuery, setServerSearchQuery] = useState('');

  // Server Settings & Tags Management state (IMG-20261110-WA0021, IMG-20261126-WA0016, IMG-20261126-WA0017)
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [showTagsManagement, setShowTagsManagement] = useState(false);
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#5865F2');
  const [editingTag, setEditingTag] = useState<ServerTag | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('#5865F2');
  const [showTagColorPicker, setShowTagColorPicker] = useState(false);
  const [serverMemberProfiles, setServerMemberProfiles] = useState<
    Record<string, { displayName: string; avatarUrl?: string; isOnline?: boolean }>
  >({});

  // Server Overview States (IMG-20261126-WA0026)
  const [showServerOverview, setShowServerOverview] = useState(false);
  const [overviewName, setOverviewName] = useState('');
  const [overviewDescription, setOverviewDescription] = useState('');
  const [overviewBannerUrl, setOverviewBannerUrl] = useState('');
  const [overviewIconUrl, setOverviewIconUrl] = useState('');
  const overviewBannerFileRef = useRef<HTMLInputElement | null>(null);
  const overviewAvatarFileRef = useRef<HTMLInputElement | null>(null);

  // Commits & Unsaved Changes States (IMG-20261126-WA0026, WA0042, WA0037)
  const [pendingCommitChanges, setPendingCommitChanges] = useState<string[]>([]);
  const [showServerCommits, setShowServerCommits] = useState(false);
  const [selectedCommitDetails, setSelectedCommitDetails] = useState<ServerCommit | null>(null);

  // Server Members & Actions States (IMG-20261126-WA0018, WA0038)
  const [showServerMembers, setShowServerMembers] = useState(false);
  const [serverMembersSearchQuery, setServerMembersSearchQuery] = useState('');
  const [selectedMemberAction, setSelectedMemberAction] = useState<{
    uid: string;
    displayName: string;
    username?: string;
    avatarUrl?: string;
  } | null>(null);

  // Role Members Picker States (IMG-20261126-WA0040, WA0039)
  const [showTagMembersSheet, setShowTagMembersSheet] = useState(false);
  const [showAddMembersToRole, setShowAddMembersToRole] = useState(false);
  const [tagMemberSearchQuery, setTagMemberSearchQuery] = useState('');
  const [selectedUidsForRole, setSelectedUidsForRole] = useState<Set<string>>(new Set());

  // Invites & Invite Friends States (IMG-20261126-WA0041, WA0032)
  const [showServerInvites, setShowServerInvites] = useState(false);
  const [showInviteFriendsModal, setShowInviteFriendsModal] = useState(false);
  const [userFriendsList, setUserFriendsList] = useState<Array<{ uid: string; displayName: string; photoURL?: string; username?: string }>>([]);
  const [selectedFriendUids, setSelectedFriendUids] = useState<Set<string>>(new Set());
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [invitingFriendsBusy, setInvitingFriendsBusy] = useState(false);

  // Chat Tag Autocomplete State (IMG-20261126-WA0028)
  const [showTagAutocomplete, setShowTagAutocomplete] = useState(false);
  const [tagAutocompleteQuery, setTagAutocompleteQuery] = useState('');

  // Real Online Members Count for active server
  const [onlineMembersCount, setOnlineMembersCount] = useState<number>(1);

  // Search Screen State
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('shinzi_recent_searches');
      if (!saved) return [];
      const list = JSON.parse(saved);
      if (!Array.isArray(list)) return [];
      return list.filter(
        (name) =>
          typeof name === 'string' &&
          !['roblox', 'minecraft', 'shinzi hub', 'mcpedl', 'ishowspeed', 'steak kitchen'].includes(
            name.toLowerCase()
          )
      );
    } catch {
      return [];
    }
  });

  // Create Server Form State
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formIsPrivate, setFormIsPrivate] = useState(false);
  const [formAvatarPreview, setFormAvatarPreview] = useState('');
  const [formBannerPreview, setFormBannerPreview] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // Invite Sheet State
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteChannel, setInviteChannel] = useState('# chat');
  const [inviteExpiry, setInviteExpiry] = useState('Never ∞');

  // Collapsible categories
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Channel Chat States
  const [channelMessages, setChannelMessages] = useState<ServerChannelMessage[]>([]);
  const [channelInputText, setChannelInputText] = useState('');
  const [channelSendBusy, setChannelSendBusy] = useState(false);
  const [showChannelAttachMenu, setShowChannelAttachMenu] = useState(false);
  const [senderProfiles, setSenderProfiles] = useState<
    Record<string, { displayName: string; avatarUrl?: string; displayNameStyle?: any }>
  >({});
  const [assetFileMap, setAssetFileMap] = useState<Record<string, string>>({});
  const [showChannelEmojiPicker, setShowChannelEmojiPicker] = useState(false);
  const [showChannelGifSheet, setShowChannelGifSheet] = useState(false);
  const [channelGifMode, setChannelGifMode] = useState<'gif' | 'sticker'>('gif');
  const [channelGifSearch, setChannelGifSearch] = useState('');
  const [channelKlipyItems, setChannelKlipyItems] = useState<KlipyItem[]>([]);
  const [channelKlipyLoading, setChannelKlipyLoading] = useState(false);
  const channelFileInputRef = useRef<HTMLInputElement | null>(null);
  const channelDocInputRef = useRef<HTMLInputElement | null>(null);
  const channelInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [channelRecording, setChannelRecording] = useState(false);
  const [channelRecordSeconds, setChannelRecordSeconds] = useState(0);
  const channelMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const channelAudioChunksRef = useRef<Blob[]>([]);
  const channelRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [localChannelError, setLocalChannelError] = useState<{ id: string; text: string } | null>(null);
  const localChannelErrorTimer = useRef<number | null>(null);

  const showLocalChannelError = (errText: string) => {
    if (localChannelErrorTimer.current) window.clearTimeout(localChannelErrorTimer.current);
    setLocalChannelError({ id: String(Date.now()), text: errText });
    localChannelErrorTimer.current = window.setTimeout(() => {
      setLocalChannelError(null);
    }, 12000);
  };

  // Channel Activity / Typing Indicators (matches Chat.tsx)
  const [channelActivity, setChannelActivity] = useState<Record<string, any>>({});
  const [activityNow, setActivityNow] = useState(Date.now());
  const channelTypingTimer = useRef<number | null>(null);
  const lastChannelTypingPingRef = useRef<number>(0);

  const channelTypingNames = useMemo(
    () =>
      Object.entries(channelActivity)
        .filter(
          ([id, data]) =>
            id !== currentUser?.uid && data.typing === true && millis(data.expiresAt) > activityNow
        )
        .map(([, data]) => String(data.displayName || data.username || 'Someone')),
    [channelActivity, activityNow, currentUser?.uid]
  );

  // Real-time Current User Profile for bottom nav avatar
  const [currentUserProfile, setCurrentUserProfile] = useState<{
    displayName?: string;
    photoURL?: string;
  } | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    return onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const avatarUrl =
          data.photoURL ||
          (data.profileAssetId
            ? `https://lh3.googleusercontent.com/d/${data.profileAssetId}=s400`
            : undefined);
        setCurrentUserProfile({
          displayName: data.displayName,
          photoURL: avatarUrl,
        });
      }
    });
  }, [currentUser?.uid]);

  // Memory Booter: Remember last visited channel per server (IMG-20261111-WA0001)
  const [lastChannelByServer, setLastChannelByServer] = useState<Record<string, string>>(() => {
    const memory: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('shinzi_last_channel_')) {
            const sId = key.replace('shinzi_last_channel_', '');
            const chId = localStorage.getItem(key);
            if (chId) memory[sId] = chId;
          }
        }
      } catch {}
    }
    return memory;
  });

  // Touch Swipe Gestures (VID-20261111-WA0002)
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleChannelChatTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleChannelChatTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartXRef.current;
    const diffY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    // Swipe right (horizontal drag > 60px) -> Close channel chat and go back to server view
    if (diffX > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      setSelectedChannel(null);
    }
  };

  const handleServerViewTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleServerViewTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartXRef.current;
    const diffY = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    // Swipe left (horizontal drag < -60px) -> Open the active/remembered channel
    if (diffX < -60 && Math.abs(diffX) > Math.abs(diffY) * 1.4) {
      if (activeServer) {
        const targetChId =
          lastChannelByServer[activeServer.id] ||
          activeServer.categories[0]?.channels[0]?.id;
        if (targetChId) {
          for (const cat of activeServer.categories) {
            const found = cat.channels.find((c) => c.id === targetChId);
            if (found && found.type === 'text') {
              setSelectedChannel(found);
              break;
            }
          }
        }
      }
    }
  };

  // Long-press Context Sheet States
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextCategory, setContextCategory] = useState<ServerCategory | null>(null);
  const [contextChannel, setContextChannel] = useState<{ catId: string; channel: ServerChannel } | null>(null);

  // Create Channel Modal State (IMG-20261110-WA0017 & 20261110_184235)
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [targetCategoryForNewChannel, setTargetCategoryForNewChannel] = useState<string | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice' | 'forum'>('text');
  const [newChannelIsPrivate, setNewChannelIsPrivate] = useState(false);
  const [newChannelIcon, setNewChannelIcon] = useState<string>('');
  const newChannelIconInputRef = useRef<HTMLInputElement | null>(null);

  // Edit Channel Modal State (20261110_184443)
  const [editingChannel, setEditingChannel] = useState<{ catId: string; channel: ServerChannel } | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelDesc, setEditChannelDesc] = useState('');
  const [editChannelIsPrivate, setEditChannelIsPrivate] = useState(false);
  const [editChannelIcon, setEditChannelIcon] = useState<string>('');
  const editChannelIconInputRef = useRef<HTMLInputElement | null>(null);

  // Edit Category Modal State
  const [editingCategory, setEditingCategory] = useState<ServerCategory | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryIsPrivate, setEditCategoryIsPrivate] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!viewingProfileUid) return;
    const handlePopState = () => {
      setViewingProfileUid(null);
    };
    window.history.pushState({ modal: 'other-profile' }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [viewingProfileUid]);

  const handleCloseProfile = () => {
    if (typeof window !== 'undefined' && window.history.state?.modal === 'other-profile') {
      window.history.back();
    } else {
      setViewingProfileUid(null);
    }
  };

  const handleExitServer = () => {
    setActiveServer(null);
    setSelectedChannel(null);
  };

  // On desktop mode, auto-select first channel when entering a server if none selected
  useEffect(() => {
    if (isDesktop && activeServer && !selectedChannel) {
      for (const cat of activeServer.categories || []) {
        const textCh = cat.channels?.find((ch) => ch.type === 'text');
        if (textCh) {
          setSelectedChannel(textCh);
          break;
        }
      }
    }
  }, [isDesktop, activeServer, selectedChannel]);

  // Clean local server cache on startup: move miscategorized servers from created to joined
  useEffect(() => {
    if (!currentUser?.uid) return;
    try {
      const rawCreated = localStorage.getItem('shinzi_created_servers');
      if (rawCreated) {
        const parsed: ServerData[] = JSON.parse(rawCreated);
        if (Array.isArray(parsed)) {
          const reallyCreated = parsed.filter((s) => !s.ownerId || s.ownerId === currentUser.uid);
          const miscategorized = parsed.filter((s) => s.ownerId && s.ownerId !== currentUser.uid);
          if (miscategorized.length > 0) {
            localStorage.setItem('shinzi_created_servers', JSON.stringify(reallyCreated));
            setCreatedServers(reallyCreated);

            const rawJoined = localStorage.getItem('shinzi_joined_servers');
            const currentJoined: ServerData[] = rawJoined ? JSON.parse(rawJoined) : [];
            const mergedJoined = [...currentJoined];
            miscategorized.forEach((m) => {
              if (!mergedJoined.some((j) => j.id === m.id)) {
                mergedJoined.push({ ...m, isCreatedByMe: false });
              }
            });
            localStorage.setItem('shinzi_joined_servers', JSON.stringify(mergedJoined));
            setJoinedServers(mergedJoined);
          }
        }
      }
    } catch {}
  }, [currentUser?.uid]);

  const addRecentSearch = (term: string) => {
    if (!term.trim()) return;
    setRecentSearches((prev) => {
      const updated = Array.from(new Set([term.trim(), ...prev])).slice(0, 10);
      try {
        localStorage.setItem('shinzi_recent_searches', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // 1. Fetch all public discoverable servers from Firestore
  const fetchPublicServers = useCallback(async () => {
    try {
      const q = query(collection(db, 'servers'), where('visibility', '==', 'public'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const list: ServerData[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setDiscoverableServers(list);
      }
    } catch (err) {
      console.warn('Could not load public servers from Firestore:', err);
    }
  }, []);

  useEffect(() => {
    void fetchPublicServers();
  }, [currentUser?.uid, fetchPublicServers]);

  useEffect(() => {
    if (showSearchModal) {
      void fetchPublicServers();
    }
  }, [showSearchModal, fetchPublicServers]);

  // 2. Fetch current user's created and joined servers from Firestore
  useEffect(() => {
    if (!currentUser?.uid) return;
    const fetchUserServers = async () => {
      try {
        const qMemberServers = query(
          collection(db, 'servers'),
          where('memberIds', 'array-contains', currentUser.uid)
        );
        const snapMember = await getDocs(qMemberServers);
        const allUserServers: ServerData[] = snapMember.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));

        // Also attempt query by ownerId in case server has ownerId but memberIds missed
        try {
          const qCreated = query(collection(db, 'servers'), where('ownerId', '==', currentUser.uid));
          const snapCreated = await getDocs(qCreated);
          snapCreated.docs.forEach((docSnap) => {
            if (!allUserServers.some((s) => s.id === docSnap.id)) {
              allUserServers.push({
                id: docSnap.id,
                ...(docSnap.data() as any),
              });
            }
          });
        } catch {}

        const createdList = allUserServers
          .filter((s) => Boolean(s.ownerId && s.ownerId === currentUser.uid))
          .map((s) => ({ ...s, isCreatedByMe: true }));

        const joinedList = allUserServers
          .filter((s) => !s.ownerId || s.ownerId !== currentUser.uid)
          .map((s) => ({ ...s, isCreatedByMe: false }));

        setCreatedServers(createdList);
        try {
          localStorage.setItem('shinzi_created_servers', JSON.stringify(createdList));
        } catch {}

        setJoinedServers(joinedList);
        try {
          localStorage.setItem('shinzi_joined_servers', JSON.stringify(joinedList));
        } catch {}
      } catch (err) {
        console.warn('Could not load user servers from Firestore:', err);
      }
    };
    void fetchUserServers();
  }, [currentUser?.uid]);

  // Real-time calculation of online members for activeServer
  useEffect(() => {
    if (!activeServer || !activeServer.memberIds || activeServer.memberIds.length === 0) {
      setOnlineMembersCount(1);
      return;
    }

    const memberIds = activeServer.memberIds;
    const unsubs: (() => void)[] = [];
    const presenceMap: Record<string, any> = {};

    memberIds.forEach((uid) => {
      try {
        const u = onSnapshot(doc(db, 'users', uid, 'friends', 'presence'), (snap) => {
          if (snap.exists()) {
            presenceMap[uid] = snap.data();
          } else {
            presenceMap[uid] = null;
          }

          let count = 0;
          memberIds.forEach((mId) => {
            const p = presenceMap[mId];
            const status = getUserEffectiveStatus(p, p);
            if (status === 'online') {
              count++;
            }
          });

          // Ensure current user is counted if online
          if (currentUser?.uid && memberIds.includes(currentUser.uid) && count === 0) {
            const userMode = localStorage.getItem('shinzi_status_mode');
            if (userMode !== 'ghost') {
              count = 1;
            }
          }
          setOnlineMembersCount(Math.max(count, 1));
        });
        unsubs.push(u);
      } catch {
        // Fallback
      }
    });

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [activeServer?.id, activeServer?.memberIds, currentUser?.uid]);

  // Real-time channel messages listener with persistent localStorage cache
  useEffect(() => {
    if (!activeServer?.id || !selectedChannel?.id || selectedChannel.type !== 'text') {
      setChannelMessages([]);
      return;
    }

    const storageKey = `shinzi_channel_msgs_${activeServer.id}_${selectedChannel.id}`;

    // 1. Immediately load cached messages from localStorage
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChannelMessages(parsed);
        }
      }
    } catch {}

    // 2. Real-time Firestore sync
    try {
      const messagesRef = collection(
        db,
        'servers',
        activeServer.id,
        'channels',
        selectedChannel.id,
        'messages'
      );
      // Query collection and sort in memory to prevent missing index errors and dropped pending writes
      const q = query(messagesRef);
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (!snap.empty) {
            const msgs: ServerChannelMessage[] = snap.docs.map((docSnap) => ({
              id: docSnap.id,
              ...(docSnap.data() as any),
            }));

            // Auto-cache any custom text styles and fonts attached to channel messages
            msgs.forEach((m) => {
              if ((m as any).styleData) {
                importIncomingStyleData((m as any).styleData);
              }
            });

            // Sort ascending by creation time
            msgs.sort((a, b) => {
              const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
              const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
              return timeA - timeB;
            });

            setChannelMessages((prev) => {
              const map = new Map<string, ServerChannelMessage>();
              // Keep prior local messages so old chats never vanish
              prev.forEach((m) => {
                if (m.id) map.set(m.id, m);
              });
              // Firestore messages override or add to map
              msgs.forEach((m) => {
                if (m.id) map.set(m.id, m);
              });
              const merged = Array.from(map.values());
              merged.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
                return timeA - timeB;
              });
              try {
                localStorage.setItem(storageKey, JSON.stringify(merged));
              } catch {}
              return merged;
            });
          }
        },
        (err) => {
          console.warn('Channel messages listener fallback:', err);
        }
      );
      return unsub;
    } catch (err) {
      console.warn('Could not subscribe to channel messages:', err);
    }
  }, [activeServer?.id, selectedChannel?.id, selectedChannel?.type, currentUser?.uid]);

  // Real-time typing activity listener for active channel (matches Chat.tsx)
  useEffect(() => {
    if (!activeServer?.id || !selectedChannel?.id || !currentUser?.uid) {
      setChannelActivity({});
      return undefined;
    }

    try {
      const activityRef = collection(
        db,
        'servers',
        activeServer.id,
        'channels',
        selectedChannel.id,
        'activity'
      );
      return onSnapshot(
        activityRef,
        (snap) => {
          const next: Record<string, any> = {};
          snap.docs.forEach((item) => {
            next[item.id] = item.data();
          });
          setChannelActivity(next);
        },
        (error) => {
          console.warn('Channel typing listener warning:', error);
        }
      );
    } catch (err) {
      console.warn('Channel activity setup error:', err);
      return undefined;
    }
  }, [activeServer?.id, selectedChannel?.id, currentUser?.uid]);

  // Periodic ticker to purge expired typing indicators every 2s
  useEffect(() => {
    if (!selectedChannel) return undefined;
    const timer = window.setInterval(() => setActivityNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [selectedChannel]);

  // Cleanup typing timers on unmount
  useEffect(() => {
    return () => {
      if (channelTypingTimer.current) window.clearTimeout(channelTypingTimer.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages]);

  // Fetch sender user profiles for channel messages to display real displayName & avatar (Item 5)
  useEffect(() => {
    if (!channelMessages.length) return;
    const unknownSenderIds = Array.from(
      new Set(
        channelMessages
          .map((m) => m.senderId)
          .filter((uid) => uid && uid !== 'anon' && !senderProfiles[uid])
      )
    );

    if (unknownSenderIds.length === 0) return;

    let isMounted = true;
    Promise.all(
      unknownSenderIds.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const data = snap.data();
            const avatarUrl =
              data.photoURL ||
              (data.profileAssetId
                ? `https://lh3.googleusercontent.com/d/${data.profileAssetId}=s400`
                : undefined);
            return {
              uid,
              displayName: data.displayName || data.username || 'User',
              displayNameStyle: data.displayNameStyle,
              avatarUrl,
            };
          }
        } catch (err) {
          console.warn('Error fetching user profile for server chat:', err);
        }
        return null;
      })
    ).then((results) => {
      if (!isMounted) return;
      setSenderProfiles((prev) => {
        const next = { ...prev };
        results.forEach((res) => {
          if (res) {
            next[res.uid] = {
              displayName: res.displayName,
              displayNameStyle: res.displayNameStyle,
              avatarUrl: res.avatarUrl,
            };
          }
        });
        return next;
      });
    });

    return () => {
      isMounted = false;
    };
  }, [channelMessages, senderProfiles]);

  // Resolve assetId to providerFileId from Firestore /assets/ (Item 5 / Drive attachments)
  useEffect(() => {
    if (!channelMessages.length) return;
    const missingAssetIds = channelMessages
      .map((m: any) => m.assetId)
      .filter((id) => id && !assetFileMap[id]);

    if (!missingAssetIds.length) return;

    let cancelled = false;
    Promise.all(
      missingAssetIds.map(async (assetId) => {
        try {
          const snap = await getDoc(doc(db, 'assets', assetId));
          if (snap.exists()) {
            const providerFileId = snap.data()?.providerFileId;
            if (providerFileId) return { assetId, providerFileId };
          }
        } catch (e) {
          console.warn('Failed resolving asset doc:', e);
        }
        return null;
      })
    ).then((res) => {
      if (cancelled) return;
      setAssetFileMap((prev) => {
        const next = { ...prev };
        res.forEach((r) => {
          if (r) next[r.assetId] = r.providerFileId;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [channelMessages, assetFileMap]);

  // Klipy GIF & Sticker search effect (Item 6 - No window.prompt)
  useEffect(() => {
    if (!showChannelGifSheet) return;
    let active = true;
    const cached = getCachedKlipy(channelGifMode, channelGifSearch);
    if (cached) {
      setChannelKlipyItems(cached);
      setChannelKlipyLoading(false);
      return;
    }
    setChannelKlipyLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const items = await searchKlipy(channelGifMode, channelGifSearch, 24, controller.signal);
        if (active) {
          setChannelKlipyItems(items);
          setChannelKlipyLoading(false);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (active) {
          setChannelKlipyItems([]);
          setChannelKlipyLoading(false);
        }
      }
    }, channelGifSearch ? 180 : 0);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [showChannelGifSheet, channelGifMode, channelGifSearch]);

  // Publish typing status to Firestore channel activity subcollection
  const publishChannelTyping = async (typing: boolean) => {
    if (!currentUser?.uid || !activeServer?.id || !selectedChannel?.id) return;
    try {
      const userUid = currentUser.uid;
      const profile = senderProfiles[userUid];
      const displayName =
        profile?.displayName ||
        currentUser.displayName ||
        (currentUser as any).username ||
        'Someone';

      await setDoc(
        doc(
          db,
          'servers',
          activeServer.id,
          'channels',
          selectedChannel.id,
          'activity',
          userUid
        ),
        {
          uid: userUid,
          typing,
          displayName,
          username: (currentUser as any).username || '',
          updatedAt: serverTimestamp(),
          expiresAt: new Date(Date.now() + (typing ? 6000 : 1000)),
        },
        { merge: true }
      );
    } catch (error) {
      console.warn('Channel typing state error:', error);
    }
  };

  // Debounced & throttled typing input handler
  const handleChannelInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setChannelInputText(text);

    if (channelInputRef.current) {
      channelInputRef.current.style.height = 'auto';
      channelInputRef.current.style.height = `${Math.min(channelInputRef.current.scrollHeight, 140)}px`;
    }

    // Check for @ mention trigger
    const lastAt = text.lastIndexOf('@');
    if (lastAt !== -1 && lastAt >= text.length - 20) {
      const q = text.slice(lastAt + 1);
      if (!q.includes(' ')) {
        setShowTagAutocomplete(true);
        setTagAutocompleteQuery(q);
      } else {
        setShowTagAutocomplete(false);
      }
    } else {
      setShowTagAutocomplete(false);
    }

    if (!text.trim()) {
      if (channelTypingTimer.current) window.clearTimeout(channelTypingTimer.current);
      lastChannelTypingPingRef.current = 0;
      void publishChannelTyping(false);
      return;
    }

    const nowMs = Date.now();
    if (nowMs - lastChannelTypingPingRef.current > 3500) {
      lastChannelTypingPingRef.current = nowMs;
      void publishChannelTyping(true);
    }

    if (channelTypingTimer.current) window.clearTimeout(channelTypingTimer.current);
    channelTypingTimer.current = window.setTimeout(() => {
      void publishChannelTyping(false);
      lastChannelTypingPingRef.current = 0;
    }, 3500);
  };

  // Send channel message with instant optimistic save & Firestore persistence
  const handleSendChannelMessage = async (
    imageUrl?: string,
    extra?: Record<string, any>
  ) => {
    if (!activeServer || !selectedChannel) return;
    const textToSend = channelInputText.trim();
    if (!textToSend && !imageUrl && !extra?.audioUrl && !extra?.text && !extra?.fileName) return;

    // Check syntax for (ts ...) and {ts ...} tags
    const syntaxValidation = validateTextStyleSyntax(textToSend);
    if (!syntaxValidation.isValid) {
      showLocalChannelError(syntaxValidation.error || 'Unsupported syntax. Please enter a space, e.g. (ts ashetic)');
      return;
    }

    // Immediately stop typing indicator upon sending
    void publishChannelTyping(false);
    if (channelTypingTimer.current) window.clearTimeout(channelTypingTimer.current);
    lastChannelTypingPingRef.current = 0;

    setChannelSendBusy(true);
    const userUid = currentUser?.uid || auth.currentUser?.uid || 'anon';
    const profile = senderProfiles[userUid];
    const userName = profile?.displayName || currentUser?.displayName || 'User';
    const userAvatar = profile?.avatarUrl || currentUser?.photoURL || '';

    const processedText = extra?.text !== undefined ? extra.text : applyTextStyles(textToSend);
    const usedStyles = getUsedStylesData(textToSend);

    const newMsg: Record<string, any> = {
      senderId: userUid,
      senderName: userName,
      senderAvatar: userAvatar,
      text: processedText,
      ...(imageUrl ? { imageUrl } : {}),
      ...(usedStyles ? { styleData: usedStyles } : {}),
      ...(extra || {}),
      createdAt: serverTimestamp(),
    };

    // Sanitize undefined fields so Firestore never rejects
    const cleanMsg: Record<string, any> = {};
    Object.entries(newMsg).forEach(([k, v]) => {
      if (v !== undefined) cleanMsg[k] = v;
    });

    // 1. Optimistic message with local timestamp for instant display and localStorage saving
    const storageKey = `shinzi_channel_msgs_${activeServer.id}_${selectedChannel.id}`;
    const optimisticMsg: ServerChannelMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: userUid,
      senderName: userName,
      senderAvatar: userAvatar,
      text: processedText,
      imageUrl,
      ...(extra || {}),
      createdAt: Date.now(),
    };

    setChannelMessages((prev) => {
      const updated = [...prev, optimisticMsg];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setChannelInputText('');
    if (channelInputRef.current) {
      channelInputRef.current.style.height = 'auto';
      channelInputRef.current.focus({ preventScroll: true });
    }
    window.requestAnimationFrame(() => {
      channelInputRef.current?.focus({ preventScroll: true });
    });

    // 2. Persist to Firestore subcollection
    try {
      await addDoc(
        collection(db, 'servers', activeServer.id, 'channels', selectedChannel.id, 'messages'),
        cleanMsg
      );
    } catch (err) {
      console.warn('Send channel message to Firestore failed, preserved in local storage:', err);
    } finally {
      setChannelSendBusy(false);
    }
  };

  // Real voice recording for server channel (matches Chat.tsx)
  const startChannelVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      channelMediaRecorderRef.current = mr;
      channelAudioChunksRef.current = [];
      setChannelRecordSeconds(0);
      setChannelRecording(true);

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) channelAudioChunksRef.current.push(e.data);
      };

      mr.start(100);
      channelRecordTimerRef.current = setInterval(() => {
        setChannelRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone permission or recording error:', err);
      alert('Could not access microphone.');
    }
  };

  const stopAndSendChannelVoice = async () => {
    if (channelRecordTimerRef.current) clearInterval(channelRecordTimerRef.current);
    const mr = channelMediaRecorderRef.current;
    if (!mr) return;

    mr.onstop = async () => {
      const audioBlob = new Blob(channelAudioChunksRef.current, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUri = reader.result as string;
        await handleSendChannelMessage(undefined, {
          audioUrl: dataUri,
          type: 'voice',
          duration: channelRecordSeconds,
        });
      };
      reader.readAsDataURL(audioBlob);
      setChannelRecording(false);
      setChannelRecordSeconds(0);
      mr.stream.getTracks().forEach((t) => t.stop());
    };
    mr.stop();
  };

  const toggleChannelRecording = () => {
    if (channelRecording) {
      void stopAndSendChannelVoice();
    } else {
      void startChannelVoiceRecording();
    }
  };

  const handleChannelImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await processServerImage(file, 'chat');
      await handleSendChannelMessage(dataUrl);
    } catch (err) {
      console.warn('Channel image upload failed:', err);
    } finally {
      if (channelFileInputRef.current) channelFileInputRef.current.value = '';
    }
  };

  // Helper to persist server changes to local state & Firestore
  const updateServerInStateAndStorage = async (updatedServer: ServerData) => {
    setActiveServer(updatedServer);

    setCreatedServers((prev) => {
      const exists = prev.some((s) => s.id === updatedServer.id);
      const next = exists ? prev.map((s) => (s.id === updatedServer.id ? updatedServer : s)) : prev;
      try {
        localStorage.setItem('shinzi_created_servers', JSON.stringify(next));
      } catch {}
      return next;
    });

    setJoinedServers((prev) => {
      const exists = prev.some((s) => s.id === updatedServer.id);
      const next = exists ? prev.map((s) => (s.id === updatedServer.id ? updatedServer : s)) : prev;
      try {
        localStorage.setItem('shinzi_joined_servers', JSON.stringify(next));
      } catch {}
      return next;
    });

    setDiscoverableServers((prev) =>
      prev.map((s) => (s.id === updatedServer.id ? updatedServer : s))
    );

    try {
      await updateDoc(doc(db, 'servers', updatedServer.id), {
        categories: updatedServer.categories,
      });
    } catch (err) {
      console.warn('Could not update server in Firestore:', err);
    }
  };

  // Fetch real user profiles for all members in active server
  useEffect(() => {
    if (!activeServer?.id) return;
    const uids = Array.from(
      new Set([
        ...(activeServer.memberIds || []),
        activeServer.ownerId || '',
        currentUser?.uid || '',
      ])
    ).filter(Boolean);

    uids.forEach(async (uid) => {
      if (serverMemberProfiles[uid]) return;
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          const d = snap.data();
          setServerMemberProfiles((prev) => ({
            ...prev,
            [uid]: {
              displayName: d.displayName || d.username || 'User',
              avatarUrl: d.photoURL || '',
              isOnline: d.isOnline || false,
            },
          }));
        }
      } catch {}
    });
  }, [activeServer?.id, activeServer?.memberIds, activeServer?.ownerId, currentUser?.uid]);

  const handleCreateTag = async () => {
    if (!activeServer || !newTagName.trim()) return;
    const newTag: ServerTag = {
      id: 'tag_' + Date.now(),
      name: newTagName.trim(),
      color: newTagColor || '#5865F2',
      createdAt: Date.now(),
    };
    const updatedTags = [...(activeServer.tags || []), newTag];
    const updatedServer = { ...activeServer, tags: updatedTags };
    setActiveServer(updatedServer);
    setShowCreateTag(false);
    setNewTagName('');
    setNewTagColor('#5865F2');

    try {
      await updateDoc(doc(db, 'servers', activeServer.id), { tags: updatedTags });
    } catch (err) {
      console.warn('Failed to save tag to Firestore:', err);
    }
  };

  const handleSaveTag = async () => {
    if (!activeServer || !editingTag || !editingTagName.trim()) return;
    const updatedTags = (activeServer.tags || []).map((t) =>
      t.id === editingTag.id ? { ...t, name: editingTagName.trim(), color: editingTagColor } : t
    );
    const updatedServer = { ...activeServer, tags: updatedTags };
    setActiveServer(updatedServer);
    setEditingTag(null);

    try {
      await updateDoc(doc(db, 'servers', activeServer.id), { tags: updatedTags });
    } catch (err) {
      console.warn('Failed to update tag in Firestore:', err);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!activeServer) return;
    const updatedTags = (activeServer.tags || []).filter((t) => t.id !== tagId);
    const updatedServer = { ...activeServer, tags: updatedTags };
    setActiveServer(updatedServer);
    setEditingTag(null);

    try {
      await updateDoc(doc(db, 'servers', activeServer.id), { tags: updatedTags });
    } catch (err) {
      console.warn('Failed to delete tag in Firestore:', err);
    }
  };

  // Sync overview state when active server changes
  useEffect(() => {
    if (activeServer) {
      setOverviewName(activeServer.name || '');
      setOverviewDescription(activeServer.description || '');
      setOverviewBannerUrl(activeServer.bannerUrl || '');
      setOverviewIconUrl(activeServer.iconUrl || '');
      setPendingCommitChanges([]);
    }
  }, [activeServer?.id]);

  const hasUnsavedCommits = useMemo(() => {
    if (!activeServer) return false;
    if (pendingCommitChanges.length > 0) return true;
    if (overviewName !== activeServer.name) return true;
    if (overviewDescription !== (activeServer.description || '')) return true;
    if (overviewBannerUrl !== (activeServer.bannerUrl || '')) return true;
    if (overviewIconUrl !== (activeServer.iconUrl || '')) return true;
    return false;
  }, [activeServer, pendingCommitChanges, overviewName, overviewDescription, overviewBannerUrl, overviewIconUrl]);

  const handleCommitChanges = async () => {
    if (!activeServer || !currentUser) return;
    const changes: string[] = [...pendingCommitChanges];
    if (overviewName !== activeServer.name) {
      changes.push(`Updated server name to "${overviewName}"`);
    }
    if (overviewDescription !== (activeServer.description || '')) {
      changes.push('Updated server description');
    }
    if (overviewBannerUrl !== (activeServer.bannerUrl || '')) {
      changes.push('Updated server banner');
    }
    if (overviewIconUrl !== (activeServer.iconUrl || '')) {
      changes.push('Updated server profile icon');
    }
    if (changes.length === 0) return;

    const commitCode = Math.random().toString(36).substring(2, 9);
    const newCommit: ServerCommit = {
      id: commitCode,
      authorUid: currentUser.uid,
      authorName: currentUserProfile?.displayName || currentUser.displayName || 'Owner',
      authorAvatar: currentUserProfile?.photoURL || currentUser.photoURL || '',
      createdAt: Date.now(),
      changes,
    };

    const updatedCommits = [newCommit, ...(activeServer.commits || [])];
    const updatedServer: ServerData = {
      ...activeServer,
      name: overviewName,
      description: overviewDescription,
      bannerUrl: overviewBannerUrl,
      iconUrl: overviewIconUrl,
      commits: updatedCommits,
    };

    setActiveServer(updatedServer);
    setCreatedServers((prev) => prev.map((s) => (s.id === updatedServer.id ? updatedServer : s)));
    setDiscoverableServers((prev) => prev.map((s) => (s.id === updatedServer.id ? updatedServer : s)));
    setPendingCommitChanges([]);

    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        name: overviewName,
        description: overviewDescription,
        bannerUrl: overviewBannerUrl,
        iconUrl: overviewIconUrl,
        commits: updatedCommits,
      });
    } catch (err) {
      console.warn('Failed to commit server changes to Firestore:', err);
    }
  };

  const handleDiscardCommits = () => {
    if (!activeServer) return;
    setOverviewName(activeServer.name || '');
    setOverviewDescription(activeServer.description || '');
    setOverviewBannerUrl(activeServer.bannerUrl || '');
    setOverviewIconUrl(activeServer.iconUrl || '');
    setPendingCommitChanges([]);
  };

  const handleOverviewBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
    const previewUrl = URL.createObjectURL(file);
    setCropModalData({
      imageSrc: previewUrl,
      originalFile: file,
      isGif,
      type: 'banner',
    });
  };

  const handleOverviewAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
    const previewUrl = URL.createObjectURL(file);
    setCropModalData({
      imageSrc: previewUrl,
      originalFile: file,
      isGif,
      type: 'avatar',
    });
  };

  const handleEquipTag = async (tagId: string) => {
    if (!activeServer || !currentUser) return;
    const updatedEquipped = { ...(activeServer.equippedTags || {}), [currentUser.uid]: tagId };
    const updatedServer = { ...activeServer, equippedTags: updatedEquipped };
    setActiveServer(updatedServer);
    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        [`equippedTags.${currentUser.uid}`]: tagId,
      });
    } catch (err) {
      console.warn('Failed to equip tag:', err);
    }
  };

  const handleAddMembersToRole = async () => {
    if (!activeServer || !editingTag || selectedUidsForRole.size === 0) return;
    const updatedMemberTags = { ...(activeServer.memberTags || {}) };
    const updatedEquipped = { ...(activeServer.equippedTags || {}) };

    selectedUidsForRole.forEach((uid) => {
      const currentTags = updatedMemberTags[uid] || [];
      if (!currentTags.includes(editingTag.id)) {
        updatedMemberTags[uid] = [...currentTags, editingTag.id];
      }
      // Auto-equip role tag
      updatedEquipped[uid] = editingTag.id;
    });

    const updatedServer: ServerData = {
      ...activeServer,
      memberTags: updatedMemberTags,
      equippedTags: updatedEquipped,
    };

    setActiveServer(updatedServer);
    setPendingCommitChanges((prev) => [
      ...prev,
      `Added ${selectedUidsForRole.size} member(s) to the ${editingTag.name} role`,
    ]);
    setShowAddMembersToRole(false);
    setSelectedUidsForRole(new Set());

    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        memberTags: updatedMemberTags,
        equippedTags: updatedEquipped,
      });
    } catch (err) {
      console.warn('Failed to update role members in Firestore:', err);
    }
  };

  const handleRemoveMemberFromRole = async (uid: string, tagId: string) => {
    if (!activeServer) return;
    const currentTags = activeServer.memberTags?.[uid] || [];
    const updated = currentTags.filter((id) => id !== tagId);
    const updatedMemberTags = { ...(activeServer.memberTags || {}), [uid]: updated };
    const updatedEquipped = { ...(activeServer.equippedTags || {}) };
    if (updatedEquipped[uid] === tagId) {
      delete updatedEquipped[uid];
    }
    const updatedServer = { ...activeServer, memberTags: updatedMemberTags, equippedTags: updatedEquipped };
    setActiveServer(updatedServer);
    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        memberTags: updatedMemberTags,
        equippedTags: updatedEquipped,
      });
    } catch (err) {}
  };

  const handleKickMember = async (memberUid: string, memberName: string) => {
    if (!activeServer || !confirm(`Are you sure you want to kick ${memberName}?`)) return;
    const updatedMembers = (activeServer.memberIds || []).filter((id) => id !== memberUid);
    const updatedServer = { ...activeServer, memberIds: updatedMembers };
    setActiveServer(updatedServer);
    setSelectedMemberAction(null);
    setPendingCommitChanges((prev) => [...prev, `Kicked member ${memberName}`]);
    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        memberIds: updatedMembers,
      });
    } catch (err) {}
  };

  const handleBanMember = async (memberUid: string, memberName: string) => {
    if (!activeServer || !confirm(`Are you sure you want to ban ${memberName}?`)) return;
    const updatedMembers = (activeServer.memberIds || []).filter((id) => id !== memberUid);
    const updatedServer = { ...activeServer, memberIds: updatedMembers };
    setActiveServer(updatedServer);
    setSelectedMemberAction(null);
    setPendingCommitChanges((prev) => [...prev, `Banned member ${memberName}`]);
    try {
      await updateDoc(doc(db, 'servers', activeServer.id), {
        memberIds: updatedMembers,
      });
    } catch (err) {}
  };

  const openInviteFriendsModal = async () => {
    setShowInviteSheet(false);
    setShowInviteFriendsModal(true);
    if (!currentUser) return;
    try {
      const snap = await getDocs(collection(db, 'users', currentUser.uid, 'friends'));
      const friends: Array<{ uid: string; displayName: string; photoURL?: string; username?: string }> = [];
      for (const fDoc of snap.docs) {
        const fData = fDoc.data();
        friends.push({
          uid: fDoc.id,
          displayName: fData.displayName || fData.username || 'Friend',
          photoURL: fData.photoURL || '',
          username: fData.username,
        });
      }
      setUserFriendsList(friends);
    } catch (err) {
      console.warn('Failed to load friends:', err);
    }
  };

  const handleSendFriendInvites = async () => {
    if (!activeServer || selectedFriendUids.size === 0 || !currentUser) return;
    setInvitingFriendsBusy(true);
    const inviteUrl = `${window.location.origin}/servers?invite=${activeServer.id}`;
    const inviteMessage = `Join my server **${activeServer.name}** on Shinzi!\n${inviteUrl}`;

    try {
      for (const friendUid of Array.from(selectedFriendUids)) {
        const convId = [currentUser.uid, friendUid].sort().join('_');
        const convRef = doc(db, 'conversations', convId);
        await setDoc(
          convRef,
          {
            memberIds: [currentUser.uid, friendUid],
            lastMessageText: inviteMessage,
            lastMessageAt: serverTimestamp(),
            lastSenderId: currentUser.uid,
            lastSenderName: currentUserProfile?.displayName || currentUser.displayName || 'Friend',
            type: 'dm',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await addDoc(collection(db, 'conversations', convId, 'messages'), {
          senderId: currentUser.uid,
          senderName: currentUserProfile?.displayName || currentUser.displayName || 'Friend',
          senderAvatar: currentUserProfile?.photoURL || currentUser.photoURL || '',
          text: inviteMessage,
          createdAt: serverTimestamp(),
        });
      }
      alert(`Invited ${selectedFriendUids.size} friend(s) successfully!`);
      setSelectedFriendUids(new Set());
      setShowInviteFriendsModal(false);
    } catch (err) {
      console.warn('Error sending friend invites:', err);
    } finally {
      setInvitingFriendsBusy(false);
    }
  };

  // Helper to render message text with styled colored role mentions (@Role)
  const renderServerMessageText = (rawText: string, tags?: ServerTag[]) => {
    if (!tags || tags.length === 0) return renderStyledContent(rawText);
    const tagNames = tags.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (tagNames.length === 0) return renderStyledContent(rawText);
    const regex = new RegExp(`(@(?:${tagNames.join('|')}))`, 'gi');
    const parts = rawText.split(regex);
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith('@')) {
            const matchedTag = tags.find((t) => t.name.toLowerCase() === part.slice(1).toLowerCase());
            if (matchedTag) {
              return (
                <span
                  key={i}
                  className="sh-tag-mention"
                  style={{
                    color: matchedTag.color,
                    backgroundColor: `${matchedTag.color}26`,
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontWeight: 600,
                    display: 'inline-block',
                    margin: '0 2px',
                  }}
                >
                  {part}
                </span>
              );
            }
          }
          return <React.Fragment key={i}>{renderStyledContent(part)}</React.Fragment>;
        })}
      </>
    );
  };

  // Long press timer helpers
  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startCategoryLongPress = (cat: ServerCategory) => {
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      setContextCategory(cat);
    }, 450);
  };

  const startChannelLongPress = (catId: string, channel: ServerChannel) => {
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      setContextChannel({ catId, channel });
    }, 450);
  };

  // Handle avatar upload with cropping modal
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
    const previewUrl = URL.createObjectURL(file);

    setCropModalData({
      imageSrc: previewUrl,
      originalFile: file,
      isGif,
      type: 'avatar',
    });
  };

  // Handle banner upload with cropping modal
  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
    const previewUrl = URL.createObjectURL(file);

    setCropModalData({
      imageSrc: previewUrl,
      originalFile: file,
      isGif,
      type: 'banner',
    });
  };

  const handleCropConfirm = async (result: { file: File; dataUri: string }) => {
    if (!cropModalData) return;
    const { type, isGif } = cropModalData;
    const file = result.file;
    const dataUrl = result.dataUri;
    setCropModalData(null);

    if (showServerOverview) {
      if (type === 'banner') {
        setOverviewBannerUrl(dataUrl);
      } else {
        setOverviewIconUrl(dataUrl);
      }
    } else {
      if (type === 'banner') {
        setFormBannerPreview(dataUrl);
      } else {
        setFormAvatarPreview(dataUrl);
      }
    }

    try {
      if (drive.hasActiveSession && drive.uploadFile) {
        const prefix = type === 'banner' ? 'server_banner' : 'server_avatar';
        const res = await drive.uploadFile({
          file,
          fileName: `${prefix}_${Date.now()}_${file.name}`,
          mimeType: file.type || (isGif ? 'image/gif' : 'image/jpeg'),
          folderType: 'server',
        });
        if (res?.fileId) {
          await drive.makeFilePublic(res.fileId);
          const cdnUrl = `https://lh3.googleusercontent.com/d/${res.fileId}=s1600`;
          if (showServerOverview) {
            if (type === 'banner') {
              setOverviewBannerUrl(cdnUrl);
            } else {
              setOverviewIconUrl(cdnUrl);
            }
          } else {
            if (type === 'banner') {
              setFormBannerPreview(cdnUrl);
            } else {
              setFormAvatarPreview(cdnUrl);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`${type} upload note:`, err);
    }
  };

  // Create Server Action
  const handleCreateServer = async () => {
    if (!formName.trim() || createBusy) return;
    setCreateBusy(true);

    const userUid = currentUser?.uid || auth.currentUser?.uid || `user-${Date.now()}`;
    const authorName = currentUser?.displayName || 'Community Member';
    const newServerId = `server-${Date.now()}`;

    const newServer: ServerData = {
      id: newServerId,
      name: formName.trim(),
      creatorName: authorName,
      ownerId: userUid,
      description: formDesc.trim() || 'A community server on Shinzi.',
      iconUrl: formAvatarPreview || '',
      bannerUrl: formBannerPreview || '',
      memberCount: '1 member',
      memberIds: [userUid],
      visibility: formIsPrivate ? 'private' : 'public',
      isOfficial: false,
      isCreatedByMe: true,
      isPrivate: formIsPrivate,
      createdAt: Date.now(),
      categories: [
        {
          id: `cat-welcome-${Date.now()}`,
          name: 'Welcome',
          channels: [
            { id: `ch-wel-${Date.now()}`, name: 'welcome', type: 'text' },
            { id: `ch-ann-${Date.now()}`, name: 'announcements', type: 'announcement' },
          ],
        },
        {
          id: `cat-lobby-${Date.now()}`,
          name: 'Lobby',
          channels: [
            { id: `ch-chat-${Date.now()}`, name: 'chat', type: 'text' },
            { id: `ch-chill-${Date.now()}`, name: 'chill-chat', type: 'text' },
            { id: `ch-photo-${Date.now()}`, name: 'photo-chat', type: 'text' },
          ],
        },
        {
          id: `cat-sugg-${Date.now()}`,
          name: 'Suggestions',
          channels: [{ id: `ch-sugg-${Date.now()}`, name: 'suggestions', type: 'text' }],
        },
        {
          id: `cat-voice-${Date.now()}`,
          name: 'Voice Rooms',
          channels: [
            {
              id: `ch-v1-${Date.now()}`,
              name: 'Voice Room 1',
              type: 'voice',
              listenerCount: '0 People in',
            },
          ],
        },
        {
          id: `cat-logs-${Date.now()}`,
          name: 'Logs',
          channels: [{ id: `ch-logs-${Date.now()}`, name: 'logs', type: 'text', isPrivate: true }],
        },
      ],
    };

    const docToWrite = { ...newServer };
    delete (docToWrite as any).isCreatedByMe;

    try {
      await setDoc(doc(db, 'servers', newServerId), docToWrite);
      console.log('Server successfully created in Firestore:', newServerId);
    } catch (err) {
      console.warn('Firestore server write fallback:', err);
    }

    const updated = [newServer, ...createdServers];
    setCreatedServers(updated);
    setDiscoverableServers((prev) => [newServer, ...prev.filter((s) => s.id !== newServer.id)]);
    try {
      localStorage.setItem('shinzi_created_servers', JSON.stringify(updated));
    } catch {}

    setFormName('');
    setFormDesc('');
    setFormIsPrivate(false);
    setFormAvatarPreview('');
    setFormBannerPreview('');
    setCreateBusy(false);
    setShowCreateModal(false);

    setActiveServer(newServer);
    setSelectedChannel(null);
  };

  // Create Channel Action
  const handleCreateChannel = async () => {
    if (!activeServer || !targetCategoryForNewChannel || !newChannelName.trim()) return;

    const newChan: ServerChannel = {
      id: `ch-${Date.now()}`,
      name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
      type: newChannelType,
      description: newChannelDesc.trim(),
      isPrivate: newChannelIsPrivate,
      ...(newChannelIcon ? { iconUrl: newChannelIcon } : {}),
      ...(newChannelType === 'voice' ? { listenerCount: '0 People in' } : {}),
    };

    const updatedCategories = activeServer.categories.map((cat) => {
      if (cat.id === targetCategoryForNewChannel) {
        return {
          ...cat,
          channels: [...cat.channels, newChan],
        };
      }
      return cat;
    });

    const updatedServer: ServerData = {
      ...activeServer,
      categories: updatedCategories,
    };

    await updateServerInStateAndStorage(updatedServer);
    setShowCreateChannelModal(false);
  };

  // Save Edited Channel Action
  const handleSaveEditedChannel = async () => {
    if (!activeServer || !editingChannel || !editChannelName.trim()) return;

    const updatedCategories = activeServer.categories.map((cat) => {
      if (cat.id === editingChannel.catId) {
        return {
          ...cat,
          channels: cat.channels.map((ch) => {
            if (ch.id === editingChannel.channel.id) {
              return {
                ...ch,
                name: editChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
                description: editChannelDesc.trim(),
                isPrivate: editChannelIsPrivate,
                iconUrl: editChannelIcon || undefined,
              };
            }
            return ch;
          }),
        };
      }
      return cat;
    });

    const updatedServer: ServerData = {
      ...activeServer,
      categories: updatedCategories,
    };

    await updateServerInStateAndStorage(updatedServer);
    setEditingChannel(null);
  };

  // Save Edited Category Action
  const handleSaveEditedCategory = async () => {
    if (!activeServer || !editingCategory || !editCategoryName.trim()) return;
    const isNowPrivate = editCategoryIsPrivate;

    const updatedCategories = activeServer.categories.map((cat) => {
      if (cat.id === editingCategory.id) {
        // If category is private, all channels inside it become auto private
        const updatedChannels = isNowPrivate
          ? cat.channels.map((ch) => ({ ...ch, isPrivate: true }))
          : cat.channels;
        return {
          ...cat,
          name: editCategoryName.trim(),
          isPrivate: isNowPrivate,
          channels: updatedChannels,
        };
      }
      return cat;
    });

    const updatedServer: ServerData = {
      ...activeServer,
      categories: updatedCategories,
    };

    await updateServerInStateAndStorage(updatedServer);
    setEditingCategory(null);
  };

  // Delete Category Action
  const handleDeleteCategory = async (catId: string) => {
    if (!activeServer) return;
    const cat = activeServer.categories.find((c) => c.id === catId);
    if (!cat) return;
    if (!confirm(`Are you sure you want to delete category "${cat.name}" and all its channels?`)) {
      return;
    }
    const updatedCategories = activeServer.categories.filter((c) => c.id !== catId);
    await updateServerInStateAndStorage({
      ...activeServer,
      categories: updatedCategories,
    });
    setContextCategory(null);
  };

  // Delete Channel Action
  const handleDeleteChannel = async (catId: string, channelId: string) => {
    if (!activeServer) return;
    let chName = 'this channel';
    const updatedCategories = activeServer.categories.map((cat) => {
      if (cat.id === catId) {
        const target = cat.channels.find((c) => c.id === channelId);
        if (target) chName = target.name;
        return {
          ...cat,
          channels: cat.channels.filter((c) => c.id !== channelId),
        };
      }
      return cat;
    });

    if (!confirm(`Are you sure you want to delete #${chName}?`)) {
      return;
    }

    if (selectedChannel?.id === channelId) {
      setSelectedChannel(null);
    }

    await updateServerInStateAndStorage({
      ...activeServer,
      categories: updatedCategories,
    });
    setContextChannel(null);
  };

  // Delete Server Action (Owner only)
  const handleDeleteServer = async (srv: ServerData) => {
    if (!confirm(`Are you sure you want to delete "${srv.name}" permanently?`)) return;

    try {
      await deleteDoc(doc(db, 'servers', srv.id));
    } catch (err) {
      console.warn('Firestore delete error:', err);
    }

    setCreatedServers((prev) => {
      const updated = prev.filter((s) => s.id !== srv.id);
      try {
        localStorage.setItem('shinzi_created_servers', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setDiscoverableServers((prev) => prev.filter((s) => s.id !== srv.id));
    setShowDetailsModal(false);
    setActiveServer(null);
  };

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  // Deduplicate and combine all real servers for search and discovery
  const allServersMap = new Map<string, ServerData>();
  discoverableServers.forEach((s) => allServersMap.set(s.id, s));
  joinedServers.forEach((s) => allServersMap.set(s.id, s));
  createdServers.forEach((s) => allServersMap.set(s.id, s));
  const allServers = Array.from(allServersMap.values());

  const searchResults = searchQuery.trim()
    ? allServers.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
          s.creatorName?.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase().trim())
      )
    : [];

  // Check URL parameters for server invite (?invite=<serverId>)
  useEffect(() => {
    const checkUrlInvite = async () => {
      try {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const inviteId = params.get('invite');
        if (!inviteId) return;

        const found = allServers.find((s) => s.id === inviteId);
        if (found) {
          setInviteModalServer(found);
          return;
        }

        const docSnap = await getDoc(doc(db, 'servers', inviteId));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const srv: ServerData = {
            id: docSnap.id,
            name: data.name || 'Community Server',
            description: data.description || '',
            bannerUrl: data.bannerUrl || '',
            iconUrl: data.iconUrl || '',
            memberCount: `${data.memberCount || data.memberIds?.length || 1} Members`,
            onlineCount: `${data.onlineCount || 1} Online`,
            memberIds: data.memberIds || [],
            categories: data.categories || [],
            ownerId: data.ownerId || '',
            createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
          };
          setInviteModalServer(srv);
        }
      } catch (e) {
        console.warn('Invite URL check note:', e);
      }
    };
    void checkUrlInvite();
  }, [allServers]);

  const handleAcceptInvite = async (srv: ServerData) => {
    if (!currentUser) {
      alert('Please sign in to join this server.');
      return;
    }
    setIsJoiningServer(true);
    try {
      const srvRef = doc(db, 'servers', srv.id);
      await updateDoc(srvRef, {
        memberIds: arrayUnion(currentUser.uid),
      });

      const joinedServerData: ServerData = {
        ...srv,
        isCreatedByMe: false,
        memberIds: Array.from(new Set([...(srv.memberIds || []), currentUser.uid])),
      };

      setJoinedServers((prev) => {
        const filtered = prev.filter((s) => s.id !== srv.id);
        const updated = [...filtered, joinedServerData];
        try {
          localStorage.setItem('shinzi_joined_servers', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      setCreatedServers((prev) => {
        const updated = prev.filter((s) => s.id !== srv.id);
        try {
          localStorage.setItem('shinzi_created_servers', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      if (window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      setInviteModalServer(null);
      setActiveServer(joinedServerData);
      setSelectedChannel(null);
    } catch (err) {
      console.error('Accept invite error:', err);
    } finally {
      setIsJoiningServer(false);
    }
  };

  const handleDeclineInvite = () => {
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setInviteModalServer(null);
  };

  const renderInviteModal = () => {
    if (!inviteModalServer) return null;
    const memberNum = parseInt(inviteModalServer.memberCount || '') || inviteModalServer.memberIds?.length || 1;
    const onlineNum = parseInt(inviteModalServer.onlineCount || '') || 1;

    return (
      <div className="sh-invite-screen-overlay" onClick={handleDeclineInvite}>
        {inviteModalServer.bannerUrl && (
          <div
            className="sh-invite-screen-backdrop"
            style={{ backgroundImage: `url(${inviteModalServer.bannerUrl})` }}
          />
        )}
        <div className="sh-invite-screen-card" onClick={(e) => e.stopPropagation()}>
          {inviteModalServer.iconUrl ? (
            <img
              src={inviteModalServer.iconUrl}
              alt={inviteModalServer.name}
              className="sh-invite-screen-avatar"
            />
          ) : (
            <div className="sh-invite-screen-avatar-placeholder">
              {inviteModalServer.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="sh-invite-screen-subtitle">You are invited to the server</div>
          <div className="sh-invite-screen-name">{inviteModalServer.name}</div>

          <div className="sh-invite-screen-counts">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="sh-dot-members" /> {memberNum} {memberNum === 1 ? 'member' : 'members'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="sh-dot-online" /> {onlineNum} online
            </span>
          </div>

          <button
            type="button"
            className="sh-invite-screen-accept-btn"
            disabled={isJoiningServer}
            onClick={() => handleAcceptInvite(inviteModalServer)}
          >
            {isJoiningServer ? 'Joining...' : 'Accept'}
          </button>

          <button
            type="button"
            className="sh-invite-screen-decline-btn"
            disabled={isJoiningServer}
            onClick={handleDeclineInvite}
          >
            Decline
          </button>
        </div>
      </div>
    );
  };

  const renderCropModal = () => {
    if (!cropModalData) return null;
    return (
      <MediaCropModal
        imageSrc={cropModalData.imageSrc}
        originalFile={cropModalData.originalFile}
        isGif={cropModalData.isGif}
        aspect={cropModalData.type === 'banner' ? 16 / 9 : 1}
        cropShape={cropModalData.type === 'banner' ? 'rect' : 'round'}
        title={cropModalData.type === 'banner' ? 'Crop Banner' : 'Crop Server Profile'}
        onCancel={() => setCropModalData(null)}
        onConfirm={handleCropConfirm}
      />
    );
  };

  // ==========================================================
  // RENDER: SEARCH SERVERS MODAL
  // ==========================================================
  if (showSearchModal) {
    return (
      <div className="sh-search-page">
        <div className="sh-search-topbar">
          <button
            type="button"
            className="sh-servers-icon-btn"
            onClick={() => setShowSearchModal(false)}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="sh-search-input-wrap">
            <input
              type="text"
              className="sh-search-input"
              placeholder="Search server by name, code"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="sh-search-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="sh-search-content">
          {!searchQuery.trim() ? (
            <div>
              <div className="sh-servers-section-title">Recents</div>
              {recentSearches.length > 0 ? (
                recentSearches.map((rec) => {
                  const match = allServers.find((s) => s.name.toLowerCase() === rec.toLowerCase());
                  if (match) {
                    const isJoined =
                      joinedServers.some((s) => s.id === match.id) ||
                      createdServers.some((s) => s.id === match.id) ||
                      match.memberIds?.includes(currentUser?.uid || '') ||
                      match.ownerId === currentUser?.uid;

                    return (
                      <div
                        key={match.id}
                        className="sh-search-discovery-card"
                        onClick={() => addRecentSearch(match.name)}
                      >
                        <div className="sh-search-discovery-banner-wrap">
                          <div className="sh-search-discovery-banner">
                            {match.bannerUrl ? (
                              <img
                                src={match.bannerUrl}
                                alt={match.name}
                                className="sh-search-discovery-banner-img"
                              />
                            ) : (
                              <div className="sh-server-card-bg-gradient" />
                            )}
                          </div>
                          <div className="sh-search-discovery-avatar-anchor">
                            {match.iconUrl ? (
                              <img
                                src={match.iconUrl}
                                alt={match.name}
                                className="sh-search-discovery-avatar"
                              />
                            ) : (
                              <div
                                className="sh-server-card-avatar-placeholder"
                                style={{ width: 48, height: 48, fontSize: 18, margin: 0, borderRadius: 14, border: '3px solid #111214' }}
                              >
                                {match.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="sh-search-discovery-body">
                          <div className="sh-search-discovery-title-box">
                            <span className="sh-search-discovery-name">{match.name}</span>
                            {match.isOfficial && <span className="sh-server-badge-official">✓</span>}
                          </div>

                          <div className="sh-search-discovery-counts">
                            <span className="sh-search-count-item">
                              <span className="sh-search-dot-grey" />
                              {match.memberCount || '1 Members'}
                            </span>
                            <span className="sh-search-count-item">
                              <span className="sh-search-dot-green" />
                              {match.onlineCount || '1 Online'}
                            </span>
                          </div>

                          <div className="sh-search-discovery-desc">
                            {match.description || 'Welcome to our community server.'}
                          </div>

                          <div className="sh-search-discovery-btn-row">
                            {isJoined ? (
                              <button
                                type="button"
                                className="sh-search-btn-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addRecentSearch(match.name);
                                  setShowSearchModal(false);
                                  setActiveServer(match);
                                  setSelectedChannel(null);
                                }}
                              >
                                Go to Server
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="sh-search-btn-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addRecentSearch(match.name);
                                  setShowSearchModal(false);
                                  setInviteModalServer(match);
                                }}
                              >
                                Join
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={rec}
                      className="sh-search-result-simple"
                      onClick={() => setSearchQuery(rec)}
                    >
                      <Search size={16} color="#636b75" />
                      <span>{rec}</span>
                    </div>
                  );
                })
              ) : (
                <div className="sh-servers-empty">
                  <div className="sh-servers-empty-title">No recent server searched</div>
                </div>
              )}
            </div>
          ) : searchResults.length > 0 ? (
            <div>
              <div className="sh-servers-section-title">
                [{searchResults.length}] {searchResults.length === 1 ? 'Result' : 'Results'}
              </div>
              {searchResults.map((srv) => {
                const isJoined =
                  joinedServers.some((s) => s.id === srv.id) ||
                  createdServers.some((s) => s.id === srv.id) ||
                  srv.memberIds?.includes(currentUser?.uid || '') ||
                  srv.ownerId === currentUser?.uid;

                return (
                  <div
                    key={srv.id}
                    className="sh-search-discovery-card"
                    onClick={() => {
                      addRecentSearch(srv.name);
                    }}
                  >
                    <div className="sh-search-discovery-banner-wrap">
                      <div className="sh-search-discovery-banner">
                        {srv.bannerUrl ? (
                          <img
                            src={srv.bannerUrl}
                            alt={srv.name}
                            className="sh-search-discovery-banner-img"
                          />
                        ) : (
                          <div className="sh-server-card-bg-gradient" />
                        )}
                      </div>
                      <div className="sh-search-discovery-avatar-anchor">
                        {srv.iconUrl ? (
                          <img
                            src={srv.iconUrl}
                            alt={srv.name}
                            className="sh-search-discovery-avatar"
                          />
                        ) : (
                          <div
                            className="sh-server-card-avatar-placeholder"
                            style={{ width: 48, height: 48, fontSize: 18, margin: 0, borderRadius: 14, border: '3px solid #111214' }}
                          >
                            {srv.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="sh-search-discovery-body">
                      <div className="sh-search-discovery-title-box">
                        <span className="sh-search-discovery-name">{srv.name}</span>
                        {srv.isOfficial && <span className="sh-server-badge-official">✓</span>}
                      </div>

                      <div className="sh-search-discovery-counts">
                        <span className="sh-search-count-item">
                          <span className="sh-search-dot-grey" />
                          {srv.memberCount || '1 Members'}
                        </span>
                        <span className="sh-search-count-item">
                          <span className="sh-search-dot-green" />
                          {srv.onlineCount || '1 Online'}
                        </span>
                      </div>

                      <div className="sh-search-discovery-desc">
                        {srv.description || 'Welcome to our community server.'}
                      </div>

                      <div className="sh-search-discovery-btn-row">
                        {isJoined ? (
                          <button
                            type="button"
                            className="sh-search-btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              addRecentSearch(srv.name);
                              setShowSearchModal(false);
                              setActiveServer(srv);
                              setSelectedChannel(null);
                            }}
                          >
                            Go to Server
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sh-search-btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              addRecentSearch(srv.name);
                              setShowSearchModal(false);
                              setInviteModalServer(srv);
                            }}
                          >
                            Join
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sh-servers-empty">
              <Search size={32} color="#636b75" />
              <div className="sh-servers-empty-title">No Results</div>
              <div className="sh-servers-empty-desc">
                We couldn't find any server matching "{searchQuery}".
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================
  // RENDER: FULL SERVER DETAILS (IMG-20261110-WA0018)
  // ==========================================================
  if (showDetailsModal && activeServer) {
    const isOwner =
      activeServer.ownerId === currentUser?.uid || activeServer.isCreatedByMe;

    return (
      <div className="sh-server-details-page">
        <div className="sh-server-details-banner">
          {activeServer.bannerUrl ? (
            <img
              src={activeServer.bannerUrl}
              alt={activeServer.name}
              className="sh-server-banner-bg-img"
            />
          ) : (
            <div className="sh-server-card-bg-gradient" />
          )}
          <button
            type="button"
            className="sh-server-details-back-btn"
            onClick={() => setShowDetailsModal(false)}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
        </div>

        <div className="sh-server-details-body">
          <div className="sh-server-details-avatar-wrap">
            {activeServer.iconUrl ? (
              <img
                src={activeServer.iconUrl}
                alt={activeServer.name}
                className="sh-server-details-avatar"
              />
            ) : (
              <div className="sh-server-details-avatar-placeholder">
                {activeServer.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="sh-server-details-title-row">
            <h1 className="sh-server-details-title">{activeServer.name}</h1>
            {activeServer.isOfficial && <CheckCircle2 size={20} color="#5865F2" fill="#5865F2" />}
          </div>

          <p className="sh-server-details-desc">
            {activeServer.description || 'Welcome to our community server.'}
          </p>

          {/* Real Online & Member counts matching IMG-20261110-WA0018 */}
          <div className="sh-server-details-status-row">
            <div className="sh-server-status-pill">
              <span className="sh-status-dot-green"></span>
              <span>{onlineMembersCount} Online</span>
            </div>
            <div className="sh-server-status-pill">
              <span className="sh-status-dot-gray"></span>
              <span>{activeServer.memberIds?.length || 1} Members</span>
            </div>
          </div>

          {/* 3 Quick Action Cards */}
          <div className="sh-server-action-cards">
            <button
              type="button"
              className="sh-server-action-card"
              onClick={() => {
                setShowDetailsModal(false);
                setShowInviteSheet(true);
              }}
            >
              <UserPlus size={20} />
              <span className="sh-server-action-card-label">Invite</span>
            </button>

            <button
              type="button"
              className="sh-server-action-card"
              onClick={() => alert('Notifications enabled')}
            >
              <Bell size={20} />
              <span className="sh-server-action-card-label">Notification</span>
            </button>

            <button
              type="button"
              className="sh-server-action-card"
              onClick={() => {
                setShowDetailsModal(false);
                setShowServerSettings(true);
              }}
            >
              <Settings size={20} />
              <span className="sh-server-action-card-label">Settings</span>
            </button>
          </div>

          {/* Menu Options List */}
          <div className="sh-server-menu-list">
            <button
              type="button"
              className="sh-server-menu-item"
              onClick={() => alert('All channels marked as read')}
            >
              <span>Mark all channels as Read</span>
              <ChevronRight size={18} color="#636b75" />
            </button>

            <button
              type="button"
              className="sh-server-menu-item"
              onClick={() => alert('Channels, Category and Tags')}
            >
              <span>Channels, Category and Tags</span>
              <ChevronRight size={18} color="#636b75" />
            </button>

            {isOwner ? (
              <button
                type="button"
                className="sh-server-menu-item sh-server-menu-danger"
                onClick={() => handleDeleteServer(activeServer)}
              >
                <span>Delete server</span>
                <Trash2 size={18} color="#ff4b4b" />
              </button>
            ) : (
              <button
                type="button"
                className="sh-server-menu-item sh-server-menu-danger"
                onClick={() => {
                  if (confirm(`Leave ${activeServer.name}?`)) {
                    setJoinedServers((prev) => {
                      const updated = prev.filter((s) => s.id !== activeServer.id);
                      try {
                        localStorage.setItem('shinzi_joined_servers', JSON.stringify(updated));
                      } catch {}
                      return updated;
                    });
                    setShowDetailsModal(false);
                    setActiveServer(null);
                  }
                }}
              >
                <span>Leave server</span>
                <LogOut size={18} color="#ff4b4b" />
              </button>
            )}

            <button
              type="button"
              className="sh-server-menu-item sh-server-menu-danger"
              onClick={() => {
                if (confirm(`Block ${activeServer.name}?`)) {
                  setShowDetailsModal(false);
                  setActiveServer(null);
                }
              }}
            >
              <span>Block server</span>
              <Ban size={18} color="#ff4b4b" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================
  // RENDER: CHANNEL CHAT VIEW (IMG-20261110-WA0014)
  // ==========================================================
  const renderChannelChat = (inDesktopSplit = false) => {
    if (!activeServer || !selectedChannel || selectedChannel.type !== 'text') return null;

    return (
      <div
        className={`sh-channel-chat-page ${inDesktopSplit ? 'sh-channel-chat-desktop' : ''}`}
        onTouchStart={handleChannelChatTouchStart}
        onTouchEnd={handleChannelChatTouchEnd}
      >
        {/* Header matching IMG-20261110-WA0014 */}
        <div className="sh-channel-chat-header">
          {!inDesktopSplit && (
            <button
              type="button"
              className="sh-channel-chat-back-btn"
              onClick={() => setSelectedChannel(null)}
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          <div
            className="sh-channel-chat-title-group"
            onClick={() => {
              setActiveChannelInfo(selectedChannel);
            }}
          >
            {selectedChannel.iconUrl ? (
              <img
                src={selectedChannel.iconUrl}
                alt={selectedChannel.name}
                className="sh-channel-header-icon"
              />
            ) : (
              <span className="sh-channel-chat-hash">#</span>
            )}
            <span className="sh-channel-chat-title">{selectedChannel.name}</span>
            <ChevronRight size={18} color="#949ba4" />
          </div>

          <div style={{ width: 40 }} />
        </div>

        {/* Messages List */}
        <div className="sh-channel-chat-messages">
          {channelMessages.length === 0 ? (
            <div className="sh-channel-chat-welcome">
              {selectedChannel.iconUrl && (
                <img
                  src={selectedChannel.iconUrl}
                  alt={selectedChannel.name}
                  className="sh-channel-welcome-icon"
                />
              )}
              <h3>Welcome to {selectedChannel.iconUrl ? '' : '#'}{selectedChannel.name}!</h3>
              <p>This is the start of the #{selectedChannel.name} channel.</p>
            </div>
          ) : (
            channelMessages.map((msg: any, index: number) => {
              const profile = senderProfiles[msg.senderId];
              const authorName = profile?.displayName || msg.senderName || 'User';
              const avatar = profile?.avatarUrl || msg.senderAvatar;
              const resolvedImgUrl = resolveChannelAttachmentUrl(msg, assetFileMap);

              const previous = channelMessages[index - 1];
              const showDay =
                millis(msg.createdAt) > 0 &&
                (!previous || dayKey(previous.createdAt) !== dayKey(msg.createdAt));

              const timeGap =
                previous && msg.createdAt && previous.createdAt
                  ? Math.abs(millis(msg.createdAt) - millis(previous.createdAt)) > 5 * 60 * 1000
                  : true;

              const isFirstInGroup =
                !previous ||
                showDay ||
                previous.senderId !== msg.senderId ||
                timeGap ||
                Boolean(msg.type === 'voice' || msg.type === 'file' || resolvedImgUrl);

              return (
                <React.Fragment key={msg.id || index}>
                  {showDay && (
                    <div className="sh-channel-date-divider">
                      <span>{dateLabel(msg.createdAt)}</span>
                    </div>
                  )}
                  <div
                    className={`sh-channel-msg-row ${
                      !isFirstInGroup ? 'sh-channel-msg-row-compact' : ''
                    }`}
                  >
                    {isFirstInGroup ? (
                      <div
                        className="sh-channel-msg-avatar shc-avatar-fallback"
                        onClick={() => {
                          if (msg.senderId) {
                            setViewingProfileUid(msg.senderId);
                          } else if (onOpenProfile) {
                            onOpenProfile();
                          }
                        }}
                      >
                        {avatar ? (
                          <img src={avatar} alt={authorName} />
                        ) : (
                          authorName.charAt(0).toUpperCase()
                        )}
                      </div>
                    ) : (
                      <div className="sh-channel-msg-gutter" aria-hidden="true" />
                    )}
                    <div className="sh-channel-msg-content">
                      {isFirstInGroup && (
                        <div className="sh-channel-msg-header">
                          {(() => {
                            const equippedTagId = activeServer?.equippedTags?.[msg.senderId];
                            const equippedTag = activeServer?.tags?.find((t) => t.id === equippedTagId);
                            const nameColor = equippedTag?.color;
                            return (
                              <span
                                className="sh-channel-msg-author"
                                style={nameColor ? { color: nameColor } : undefined}
                                onClick={() => {
                                  if (msg.senderId) {
                                    setViewingProfileUid(msg.senderId);
                                  } else if (onOpenProfile) {
                                    onOpenProfile();
                                  }
                                }}
                              >
                                {renderStyledDisplayName(cleanRawText(authorName), profile?.displayNameStyle)}
                              </span>
                            );
                          })()}
                          <span className="sh-channel-msg-time">
                            {formatDiscordTimestamp(msg.createdAt)}
                          </span>
                        </div>
                      )}
                      {msg.text && (
                        <div
                          className="sh-channel-msg-text"
                          style={(msg as any).isError ? { color: '#ff4b4b', fontWeight: 600 } : undefined}
                        >
                          {isEmojiOnly(msg.text) ? (
                            <span className="shc-dc-jumbo-emoji">{msg.text.trim()}</span>
                          ) : (
                            renderServerMessageText(msg.text, activeServer?.tags)
                          )}
                        </div>
                      )}
                      {resolvedImgUrl && (
                        <img
                          src={resolvedImgUrl}
                          alt="attachment"
                          className="sh-channel-msg-img"
                          onClick={() => window.open(resolvedImgUrl, '_blank')}
                        />
                      )}
                      {msg.type === 'voice' && msg.audioUrl && (
                        <div
                          style={{
                            marginTop: 6,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: '#1e1f22',
                            padding: '8px 12px',
                            borderRadius: 12,
                            maxWidth: 320,
                          }}
                        >
                          <audio controls src={msg.audioUrl} style={{ height: 32, maxWidth: 260 }} />
                        </div>
                      )}
                      {msg.type === 'file' && (
                        <a
                          href={msg.fileUrl || '#'}
                          download={msg.fileName || 'file'}
                          className="shc-file-msg"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 14px',
                            background: '#1e1f22',
                            borderRadius: 10,
                            marginTop: 6,
                            textDecoration: 'none',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <FileText size={20} color="#5865F2" />
                          <span style={{ fontSize: 13, color: '#00a8fc', fontWeight: 600 }}>{msg.fileName || 'Attachment'}</span>
                        </a>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Hidden inputs for composer attachments */}
        <input
          type="file"
          ref={channelFileInputRef}
          accept="image/*,.gif"
          style={{ display: 'none' }}
          onChange={handleChannelImageSelect}
        />
        <input
          type="file"
          ref={channelDocInputRef}
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUri = reader.result as string;
              await handleSendChannelMessage(undefined, {
                type: 'file',
                fileName: file.name,
                fileSize: file.size,
                fileUrl: dataUri,
              });
            };
            reader.readAsDataURL(file);
            if (channelDocInputRef.current) channelDocInputRef.current.value = '';
          }}
        />

        {/* Real-time typing indicator (matches Chat.tsx) */}
        {channelTypingNames.length > 0 && (
          <div className="shc-typing">
            <span className="shc-typing-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="sh-channel-typing-text">
              {channelTypingNames.length === 1 && (
                <><strong>{channelTypingNames[0]}</strong> is typing...</>
              )}
              {channelTypingNames.length === 2 && (
                <><strong>{channelTypingNames[0]}</strong> and <strong>{channelTypingNames[1]}</strong> are typing...</>
              )}
              {channelTypingNames.length > 2 && (
                <>Tons of people are typing...</>
              )}
            </span>
          </div>
        )}

        {localChannelError && (
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
            <span>{localChannelError.text}</span>
            <button
              type="button"
              onClick={() => setLocalChannelError(null)}
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

        {/* Full Working Chat Composer Bar (Item 6) */}
        <div className="shc-composer-wrap" style={{ position: 'relative' }}>
          {showTagAutocomplete && activeServer && (
            <div className="sh-tag-autocomplete-popover">
              {(activeServer.tags || [])
                .filter((t) => !tagAutocompleteQuery || t.name.toLowerCase().includes(tagAutocompleteQuery.toLowerCase()))
                .map((tag) => {
                  const count = Object.values(activeServer.memberTags || {}).filter((tags) => tags.includes(tag.id)).length;
                  return (
                    <div
                      key={tag.id}
                      className="sh-tag-autocomplete-item"
                      onClick={() => {
                        const lastAt = channelInputText.lastIndexOf('@');
                        const newText = lastAt !== -1 ? channelInputText.slice(0, lastAt) + `@${tag.name} ` : `@${tag.name} `;
                        setChannelInputText(newText);
                        setShowTagAutocomplete(false);
                        setTagAutocompleteQuery('');
                        channelInputRef.current?.focus();
                      }}
                    >
                      <div className="sh-tag-autocomplete-left">
                        <span
                          style={{
                            color: tag.color,
                            fontWeight: 700,
                            fontSize: 14,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: tag.color }} />
                          @{tag.name}
                        </span>
                      </div>
                      <span className="sh-tag-autocomplete-desc">
                        Notify users with this role in this channel {count > 0 ? `(${count})` : ''}
                      </span>
                    </div>
                  );
                })}

              {Array.from(new Set([...(activeServer.memberIds || []), activeServer.ownerId || '']))
                .filter(Boolean)
                .map((uid) => {
                  const p = serverMemberProfiles[uid] || senderProfiles[uid];
                  const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
                  if (tagAutocompleteQuery && !name.toLowerCase().includes(tagAutocompleteQuery.toLowerCase())) return null;
                  return (
                    <div
                      key={uid}
                      className="sh-tag-autocomplete-item"
                      onClick={() => {
                        const lastAt = channelInputText.lastIndexOf('@');
                        const newText = lastAt !== -1 ? channelInputText.slice(0, lastAt) + `@${name} ` : `@${name} `;
                        setChannelInputText(newText);
                        setShowTagAutocomplete(false);
                        setTagAutocompleteQuery('');
                        channelInputRef.current?.focus();
                      }}
                    >
                      <div className="sh-tag-autocomplete-left">
                        <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 14 }}>
                          @{name}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="shc-composer">
            <div className="shc-composer-input-box">
              <button
                type="button"
                className="shc-composer-icon-btn shc-composer-attach-btn"
                onClick={() => setShowChannelAttachMenu(true)}
                aria-label="Attach"
                title="More"
              >
                <Plus size={22} />
              </button>

              <div className="shc-composer-text-wrap">
                {channelRecording ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: '#f23f43', fontWeight: 700, fontSize: 13 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f23f43' }} />
                    Recording voice message... {channelRecordSeconds}s
                  </div>
                ) : (
                  <textarea
                    ref={channelInputRef}
                    className="shc-composer-textarea"
                    placeholder={`Message #${selectedChannel.name}`}
                    value={channelInputText}
                    onChange={handleChannelInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendChannelMessage();
                      }
                    }}
                    rows={1}
                  />
                )}
              </div>

              <button
                type="button"
                className="shc-composer-icon-btn shc-composer-emoji-btn"
                onClick={() => {
                  setShowChannelAttachMenu(false);
                  setShowChannelGifSheet(false);
                  setShowChannelEmojiPicker((prev) => !prev);
                }}
                aria-label="Toggle emoji picker"
              >
                <Smile size={21} />
              </button>

              {!channelInputText.trim() && (
                <button
                  type="button"
                  className={`shc-composer-icon-btn shc-composer-voice-btn ${channelRecording ? 'shc-rec-on' : ''}`}
                  onClick={toggleChannelRecording}
                  aria-label={channelRecording ? 'Stop recording' : 'Record voice message'}
                >
                  {channelRecording ? <Square size={20} color="#f23f43" /> : <Mic size={21} />}
                </button>
              )}

              <button
                type="button"
                className={`shc-composer-icon-btn shc-composer-send-btn ${(channelInputText.trim() || channelRecording || channelSendBusy) ? 'shc-send-active' : ''}`}
                onPointerDown={(e) => {
                  // Crucial for mobile virtual keyboards:
                  // Calling preventDefault on pointerdown stops the button tap from blurring the textarea,
                  // keeping the mobile keyboard open.
                  e.preventDefault();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => {
                  if (channelSendBusy) return;
                  if (channelRecording) {
                    void stopAndSendChannelVoice();
                  } else if (channelInputText.trim()) {
                    void handleSendChannelMessage();
                  }
                }}
                aria-label="Send message"
              >
                {channelSendBusy ? (
                  <span className="shc-spinner shc-spinner-sm" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Server + More Attachment Sheet (Item 6 - Excludes Poll & Event via isServerChannel) */}
        {showChannelAttachMenu && (() => {
          const isServerChannel = true;
          return (
            <div
              className="sh-attach-backdrop"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowChannelAttachMenu(false);
              }}
            >
              <div className="sh-attach-sheet" role="dialog" aria-modal="true" aria-label="More">
                <div className="sh-attach-sheet-header">
                  <h3 className="sh-attach-sheet-title">More</h3>
                  <button
                    type="button"
                    className="sh-servers-icon-btn"
                    onClick={() => setShowChannelAttachMenu(false)}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="shc-attach-grid">
                  <button
                    type="button"
                    onClick={() => {
                      setShowChannelAttachMenu(false);
                      channelFileInputRef.current?.click();
                    }}
                  >
                    <ImageIcon size={28} />
                    Gallery
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowChannelAttachMenu(false);
                      setShowChannelGifSheet(true);
                    }}
                  >
                    <Sparkles size={28} />
                    GIF / Sticker
                  </button>

                  {!isServerChannel && (
                    <>
                      <button type="button">Poll</button>
                      <button type="button">Event</button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowChannelAttachMenu(false);
                      toggleChannelRecording();
                    }}
                  >
                    <Mic size={28} />
                    Voice
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowChannelAttachMenu(false);
                      channelDocInputRef.current?.click();
                    }}
                  >
                    <FileText size={28} />
                    File
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Klipy GIF & Sticker Sheet (Item 6 - No window.prompt!) */}
        {showChannelGifSheet && (
          <div
            className="sh-attach-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowChannelGifSheet(false);
            }}
          >
            <div
              className="sh-attach-sheet"
              style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
              role="dialog"
              aria-modal="true"
              aria-label="GIFs & stickers"
            >
              <div className="sh-attach-sheet-header">
                <h3 className="sh-attach-sheet-title">GIFs & stickers</h3>
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => setShowChannelGifSheet(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="shc-segments" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['gif', 'sticker'] as const).map((type) => (
                  <button
                    type="button"
                    key={type}
                    className={channelGifMode === type ? 'shc-segment shc-segment-on' : 'shc-segment'}
                    onClick={() => {
                      if (channelGifMode !== type) {
                        setChannelGifMode(type);
                        setChannelGifSearch('');
                      }
                    }}
                    style={
                      channelGifMode === type
                        ? { flex: 1, padding: '8px 12px', borderRadius: 8, backgroundColor: '#ffffff', color: '#000000', border: 'none', fontWeight: 800, cursor: 'pointer' }
                        : { flex: 1, padding: '8px 12px', borderRadius: 8, backgroundColor: '#1e1f22', color: '#949ba4', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }
                    }
                  >
                    {type === 'gif' ? 'GIF' : 'Sticker'}
                  </button>
                ))}
              </div>

              <input
                className="shc-gif-search"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginBottom: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#1e1f22',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  outline: 'none',
                }}
                placeholder={channelGifMode === 'gif' ? 'Search gifs' : 'Search stickers'}
                value={channelGifSearch}
                onChange={(e) => setChannelGifSearch(e.target.value)}
              />

              <div style={{ flex: 1, overflowY: 'auto', minHeight: 200, maxHeight: 380 }}>
                {channelKlipyLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: '#949ba4' }}>
                    Loading...
                  </div>
                ) : channelKlipyItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#949ba4' }}>
                    {channelGifSearch.trim()
                      ? `No result for "${channelGifSearch.trim()}"`
                      : `No ${channelGifMode}s found`}
                  </div>
                ) : (
                  <div className="shc-klipy-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {channelKlipyItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        style={{ border: 'none', background: 'transparent', padding: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', aspectRatio: '1/1' }}
                        onClick={() => {
                          setShowChannelGifSheet(false);
                          void handleSendChannelMessage(item.originalUrl || item.previewUrl);
                        }}
                        title={item.title}
                      >
                        <img
                          src={item.previewUrl || item.originalUrl}
                          alt={item.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Full Unicode Emoji Picker Sheet */}
        {showChannelEmojiPicker && (
          <div
            className="shc-sheet-backdrop"
            onClick={() => setShowChannelEmojiPicker(false)}
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
                    saveRecentEmoji(emoji);
                    setChannelInputText((previous) => previous + emoji);
                    setShowChannelEmojiPicker(false);
                  }}
                />
              </Suspense>
            </div>
          </div>
        )}

        {viewingProfileUid && (
          <OtherProfile
            targetUid={viewingProfileUid}
            onClose={handleCloseProfile}
            onOpenChat={(targetUid) => {
              handleCloseProfile();
              if (onOpenChat) onOpenChat();
              else navigateTo(`/chat?user=${encodeURIComponent(targetUid)}`);
            }}
            serverContext={activeServer ? {
              server: activeServer,
              onEquipTag: (tagId: string) => {
                void handleEquipTag(tagId);
              },
            } : undefined}
          />
        )}
      </div>
    );
  };

  // ==========================================================
  // RENDER: SERVER VIEW (IMG-20261109-WA0007, IMG-20261110-WA0022, VID-20261110-WA0023)
  // ==========================================================
  if (activeServer) {
    const serverBannerAndHeader = (
      <>
        {/* Banner at top if server has a banner; matches video_1.mp4 */}
        {activeServer.bannerUrl && (
          <div className="sh-server-banner">
            <img
              src={activeServer.bannerUrl}
              alt={activeServer.name}
              className="sh-server-banner-img"
            />
            <button
              type="button"
              className="sh-server-banner-back-btn"
              onClick={handleExitServer}
              aria-label="Back to Servers"
            >
              <ArrowLeft size={20} />
            </button>
          </div>
        )}

        {/* Server Sticky Header Bar directly below banner */}
        <div className="sh-server-sticky-header">
          <div
            className="sh-server-header-left"
            onClick={() => setShowDetailsModal(true)}
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
          >
            {!activeServer.bannerUrl && (
              <button
                type="button"
                className="sh-server-banner-back-btn"
                style={{ position: 'static', marginRight: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleExitServer();
                }}
                aria-label="Back to Servers"
              >
                <ArrowLeft size={18} />
              </button>
            )}

            {activeServer.iconUrl ? (
              <img
                src={activeServer.iconUrl}
                alt={activeServer.name}
                className="sh-server-header-avatar"
              />
            ) : (
              <div
                className="sh-server-header-avatar-placeholder"
                style={{ width: 40, height: 40, fontSize: 16, margin: 0, borderRadius: 12 }}
              >
                {activeServer.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="sh-server-header-details">
              <h1 className="sh-server-header-name">
                {activeServer.name}
                {activeServer.isOfficial && <CheckCircle2 size={16} color="#5865F2" fill="#5865F2" />}
              </h1>
            </div>
          </div>

          <div className="sh-server-header-actions">
            <button
              type="button"
              className="sh-servers-icon-btn"
              title="Events"
              onClick={() => alert('No active server events currently.')}
            >
              <Calendar size={18} />
            </button>
            <button
              type="button"
              className="sh-servers-icon-btn"
              title="Invite"
              onClick={() => setShowInviteSheet(true)}
            >
              <UserPlus size={18} />
            </button>
            <button
              type="button"
              className="sh-servers-icon-btn"
              title="Search in Server"
              onClick={() => setShowServerSearch(true)}
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              className="sh-servers-icon-btn"
              title="Server Details"
              onClick={() => setShowDetailsModal(true)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </>
    );

    const channelsContentOnly = (
      <div className="sh-server-channels-content">
          {activeServer.categories.map((cat) => {
            const isCollapsed = collapsedCategories[cat.id];
            return (
              <div key={cat.id} className="sh-category-group">
                <div
                  className="sh-category-header"
                  onClick={() => toggleCategory(cat.id)}
                  onTouchStart={() => startCategoryLongPress(cat)}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                  onMouseDown={() => startCategoryLongPress(cat)}
                  onMouseUp={clearLongPress}
                  onMouseLeave={clearLongPress}
                >
                  <span className="sh-category-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {cat.name}
                    {cat.isPrivate && <Lock size={12} color="#949ba4" />}
                  </span>
                  <ChevronDown
                    size={15}
                    className={`sh-category-chevron ${isCollapsed ? 'sh-category-chevron-collapsed' : ''}`}
                  />
                </div>

                {!isCollapsed &&
                  cat.channels.map((ch) => {
                    const activeChannelId =
                      selectedChannel?.id ||
                      (activeServer ? lastChannelByServer[activeServer.id] : null) ||
                      (activeServer?.categories[0]?.channels[0]?.id || null);
                    const isActive = activeChannelId === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className={`sh-channel-item ${isActive ? 'sh-channel-item-active' : ''}`}
                        onClick={() => {
                          if (ch.type === 'text') {
                            setSelectedChannel(ch);
                            if (activeServer) {
                              try {
                                localStorage.setItem(`shinzi_last_channel_${activeServer.id}`, ch.id);
                              } catch {}
                              setLastChannelByServer((prev) => ({ ...prev, [activeServer.id]: ch.id }));
                            }
                          } else if (ch.type === 'voice') {
                            alert(`Voice Room: ${ch.name} (${ch.listenerCount || '0 People in'})`);
                          } else {
                            setSelectedChannel(ch);
                            if (activeServer) {
                              try {
                                localStorage.setItem(`shinzi_last_channel_${activeServer.id}`, ch.id);
                              } catch {}
                              setLastChannelByServer((prev) => ({ ...prev, [activeServer.id]: ch.id }));
                            }
                          }
                        }}
                        onTouchStart={() => startChannelLongPress(cat.id, ch)}
                        onTouchEnd={clearLongPress}
                        onTouchMove={clearLongPress}
                        onMouseDown={() => startChannelLongPress(cat.id, ch)}
                        onMouseUp={clearLongPress}
                        onMouseLeave={clearLongPress}
                      >
                        <div className="sh-channel-left">
                          {ch.iconUrl ? (
                            <img src={ch.iconUrl} alt="" className="sh-channel-icon-mini-thumb" />
                          ) : ch.type === 'voice' ? (
                            <Volume2 size={16} color="#949ba4" />
                          ) : ch.type === 'forum' ? (
                            <MessageCircle size={16} color="#949ba4" />
                          ) : ch.isPrivate ? (
                            <Lock size={16} color="#636b75" />
                          ) : (
                            <span className="sh-channel-icon-hash">#</span>
                          )}
                          <span>{ch.name}</span>
                        </div>

                        {ch.listenerCount && (
                          <div className="sh-channel-right">
                            <Volume2 size={13} />
                            <span>{ch.listenerCount}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      );

      const renderMemberRow = (
        m: { uid: string; name: string; avatar: string; isOnline: boolean; tag?: ServerTag },
        color?: string
      ) => (
        <div
          key={m.uid}
          className="sh-member-item"
          onClick={() => setViewingProfileUid(m.uid)}
        >
          <div className="sh-member-avatar-wrap">
            {m.avatar ? (
              <img src={m.avatar} alt={m.name} className="sh-member-avatar" />
            ) : (
              <div className="sh-member-avatar-placeholder">
                {m.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span
              className="sh-member-status-dot"
              style={{ background: m.isOnline ? '#23a55a' : '#80848e' }}
            />
          </div>
          <div className="sh-member-info">
            <span
              className="sh-member-name"
              style={(() => {
                const eqTagId = activeServer?.equippedTags?.[m.uid];
                const eqTag = activeServer?.tags?.find((t) => t.id === eqTagId);
                const finalColor = color || eqTag?.color || m.tag?.color;
                return finalColor ? { color: finalColor } : undefined;
              })()}
            >
              {m.name}
            </span>
            {m.tag && (
              <span
                className="sh-member-tag-badge"
                style={{
                  color: m.tag.color,
                  borderColor: m.tag.color,
                  background: m.tag.color + '22',
                }}
              >
                {m.tag.name}
              </span>
            )}
          </div>
        </div>
      );

      const renderGroupedMembers = (searchFilter: string) => {
        if (!activeServer) return null;
        const allTags = activeServer.tags || [];
        const memberUids = Array.from(
          new Set([
            ...(activeServer.memberIds || []),
            activeServer.ownerId || '',
            currentUser?.uid || '',
          ])
        ).filter(Boolean);

        const filterQuery = searchFilter.trim().toLowerCase();

        const membersWithData = memberUids.map((uid) => {
          const p = serverMemberProfiles[uid] || senderProfiles[uid];
          const name =
            p?.displayName ||
            (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
          const avatar = p?.avatarUrl || '';
          const isOnline = p?.isOnline || uid === currentUser?.uid;
          const userTagIds = activeServer.memberTags?.[uid] || [];
          const primaryTag = allTags.find((t) => userTagIds.includes(t.id));
          return { uid, name, avatar, isOnline, tag: primaryTag };
        });

        const filtered = filterQuery
          ? membersWithData.filter((m) => m.name.toLowerCase().includes(filterQuery))
          : membersWithData;

        if (allTags.length === 0) {
          return (
            <div className="sh-member-group">
              <div className="sh-member-group-header">
                <span>MEMBERS — {filtered.length}</span>
              </div>
              {filtered.map((m) => renderMemberRow(m))}
            </div>
          );
        }

        return (
          <div className="sh-member-groups-list">
            {allTags.map((tag) => {
              const inTag = filtered.filter((m) => m.tag?.id === tag.id);
              if (inTag.length === 0) return null;
              return (
                <div key={tag.id} className="sh-member-group">
                  <div className="sh-member-group-header" style={{ color: tag.color }}>
                    <span>{tag.name.toUpperCase()} — {inTag.length}</span>
                  </div>
                  {inTag.map((m) => renderMemberRow(m, tag.color))}
                </div>
              );
            })}

            {(() => {
              const untagged = filtered.filter((m) => !m.tag);
              if (untagged.length === 0) return null;
              return (
                <div className="sh-member-group">
                  <div className="sh-member-group-header">
                    <span>MEMBERS — {untagged.length}</span>
                  </div>
                  {untagged.map((m) => renderMemberRow(m))}
                </div>
              );
            })()}
          </div>
        );
      };

      const renderServerMembersList = () => {
        if (!activeServer) return null;
        const allTags = activeServer.tags || [];
        const memberUids = Array.from(
          new Set([
            ...(activeServer.memberIds || []),
            activeServer.ownerId || '',
            currentUser?.uid || '',
          ])
        ).filter(Boolean);

        const q = serverMembersSearchQuery.trim().toLowerCase();

        const filteredUids = memberUids.filter((uid) => {
          const p = serverMemberProfiles[uid] || senderProfiles[uid];
          const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
          return !q || name.toLowerCase().includes(q);
        });

        if (filteredUids.length === 0) {
          return (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: '#949ba4' }}>
              No members found matching &quot;{serverMembersSearchQuery}&quot;
            </div>
          );
        }

        return filteredUids.map((uid) => {
          const p = serverMemberProfiles[uid] || senderProfiles[uid];
          const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
          const avatar = p?.avatarUrl || '';
          const isOnline = p?.isOnline || uid === currentUser?.uid;
          const userTagIds = activeServer.memberTags?.[uid] || [];
          const userTags = allTags.filter((t) => userTagIds.includes(t.id));
          const equippedTagId = activeServer.equippedTags?.[uid] || userTags[userTags.length - 1]?.id;
          const equippedTag = allTags.find((t) => t.id === equippedTagId);

          return (
            <div
              key={uid}
              className="sh-server-member-row"
              onClick={() => {
                setSelectedMemberAction({
                  uid,
                  displayName: name,
                  username: (p as any)?.username,
                  avatarUrl: avatar,
                });
              }}
            >
              <div className="sh-server-member-left">
                <div className="sh-server-member-avatar-wrap">
                  {avatar ? (
                    <img src={avatar} alt="" className="sh-server-member-avatar" />
                  ) : (
                    <div
                      className="sh-server-member-avatar"
                      style={{
                        background: '#5865F2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {isOnline && <div className="sh-server-member-online-dot" />}
                </div>

                <div className="sh-server-member-info">
                  <span
                    className="sh-server-member-name"
                    style={{ color: equippedTag?.color || '#ffffff' }}
                  >
                    {name}
                  </span>
                  {(p as any)?.username && (
                    <span className="sh-server-member-username">@{(p as any).username}</span>
                  )}

                  {userTags.length > 0 && (
                    <div className="sh-server-member-tags-row">
                      {userTags.map((tag) => (
                        <span key={tag.id} className="sh-server-member-tag-pill">
                          <span
                            className="sh-server-member-tag-dot"
                            style={{ background: tag.color }}
                          />
                          <span>{tag.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <ChevronRight size={18} color="#949ba4" />
            </div>
          );
        });
      };

      const renderMediaGrid = (messages: ServerChannelMessage[]) => {
        const mediaItems: Array<{ url: string; senderName: string; senderAvatar?: string }> = [];
        messages.forEach((m) => {
          const url = resolveChannelAttachmentUrl(m, assetFileMap) || m.imageUrl || (m as any).fileUrl;
          const isImg =
            m.imageUrl ||
            ((m as any).fileType && (m as any).fileType.startsWith('image')) ||
            (url && typeof url === 'string' && url.match(/\.(jpeg|jpg|gif|png|webp)/i));
          if (url && isImg) {
            mediaItems.push({
              url,
              senderName: m.senderName || 'User',
              senderAvatar: m.senderAvatar,
            });
          }
        });

        if (mediaItems.length === 0) {
          return (
            <div className="sh-media-empty">
              <ImageIcon size={40} color="#636b75" />
              <p>No media shared yet</p>
            </div>
          );
        }

        return (
          <div className="sh-media-grid">
            {mediaItems.map((item, idx) => (
              <div
                key={idx}
                className="sh-media-item"
                onClick={() => setSelectedMediaPreviewUrl(item.url)}
              >
                <img src={item.url} alt="media" className="sh-media-thumb" loading="lazy" />
                {item.senderAvatar && (
                  <img
                    src={item.senderAvatar}
                    alt={item.senderName}
                    className="sh-media-author-avatar"
                    title={`Sent by ${item.senderName}`}
                  />
                )}
              </div>
            ))}
          </div>
        );
      };

      const renderChatSearchTab = (messages: ServerChannelMessage[], query: string) => {
        const q = query.trim().toLowerCase();
        const filtered = q
          ? messages.filter((m) => m.text && m.text.toLowerCase().includes(q))
          : messages.filter((m) => m.text && m.text.includes('@'));

        if (filtered.length === 0) {
          return (
            <div className="sh-chat-search-empty">
              <MessageCircle size={40} color="#636b75" />
              <p>{q ? `No messages found matching "${q}"` : 'No mentioned messages yet'}</p>
            </div>
          );
        }

        return (
          <div className="sh-chat-search-list">
            {filtered.map((m) => (
              <div key={m.id} className="sh-chat-search-card">
                <div className="sh-chat-search-meta">
                  {m.senderAvatar ? (
                    <img src={m.senderAvatar} alt="" className="sh-chat-search-avatar" />
                  ) : (
                    <div className="sh-chat-search-avatar-placeholder">
                      {(m.senderName || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="sh-chat-search-author">{m.senderName || 'User'}</span>
                  <span className="sh-chat-search-time">
                    {m.createdAt ? new Date(millis(m.createdAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <div className="sh-chat-search-text">
                  {renderStyledContent(m.text || '')}
                </div>
              </div>
            ))}
          </div>
        );
      };

      const modalsAndSheets = (
        <>
          {/* Invite Bottom Sheet */}
        {showInviteSheet && (
          <div
            className="sh-invite-sheet-overlay"
            onClick={() => setShowInviteSheet(false)}
          >
            <div
              className="sh-invite-sheet"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="sh-invite-sheet-title">Invite to {activeServer.name}</h3>

              <div className="sh-invite-share-row">
                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      window.location.origin + `/servers?invite=${activeServer.id}`
                    );
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 2000);
                  }}
                >
                  <div className="sh-invite-share-icon">
                    {inviteCopied ? <Check size={22} color="#5865F2" /> : <Copy size={22} />}
                  </div>
                  <span className="sh-invite-share-label">
                    {inviteCopied ? 'Copied!' : 'Copy Link'}
                  </span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={openInviteFriendsModal}
                >
                  <div className="sh-invite-share-icon">
                    <Users size={22} />
                  </div>
                  <span className="sh-invite-share-label">To friends</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => {
                    const text = encodeURIComponent(
                      `Join my server ${activeServer.name} on Shinzi: ${window.location.origin}/servers?invite=${activeServer.id}`
                    );
                    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
                  }}
                >
                  <div className="sh-invite-share-icon">
                    <MessageCircle size={24} color="#ffffff" />
                  </div>
                  <span className="sh-invite-share-label">WhatsApp</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => alert('Instagram Direct share')}
                >
                  <div className="sh-invite-share-icon">
                    <Camera size={24} color="#ffffff" />
                  </div>
                  <span className="sh-invite-share-label">Instagram</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: `Join ${activeServer.name}`,
                        url: `${window.location.origin}/servers?invite=${activeServer.id}`,
                      }).catch((e) => console.log('Share canceled/failed:', e));
                    } else {
                      void navigator.clipboard?.writeText(
                        `${window.location.origin}/servers?invite=${activeServer.id}`
                      );
                      alert('Server invite link copied to clipboard!');
                    }
                  }}
                >
                  <div className="sh-invite-share-icon">
                    <Share2 size={22} />
                  </div>
                  <span className="sh-invite-share-label">Others</span>
                </button>
              </div>

              <div className="sh-invite-field">
                <label>Enter Channel</label>
                <select
                  className="sh-invite-select"
                  value={inviteChannel}
                  onChange={(e) => setInviteChannel(e.target.value)}
                >
                  {activeServer.categories.flatMap((cat) =>
                    cat.channels.map((ch) => (
                      <option key={ch.id} value={ch.name}>
                        {ch.type === 'voice' ? '🔊 ' : '# '}
                        {ch.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="sh-invite-field">
                <label>Invite Link Expires In</label>
                <select
                  className="sh-invite-select"
                  value={inviteExpiry}
                  onChange={(e) => setInviteExpiry(e.target.value)}
                >
                  <option value="Never ∞">Never ∞</option>
                  <option value="24 Hours">24 Hours</option>
                  <option value="7 Days">7 Days</option>
                  <option value="30 Days">30 Days</option>
                </select>
              </div>

              <button
                type="button"
                className="sh-invite-done-btn"
                onClick={() => setShowInviteSheet(false)}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Category Context Sheet */}
        {contextCategory && (
          <div className="sh-context-sheet-overlay" onClick={() => setContextCategory(null)}>
            <div className="sh-context-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sh-context-sheet-header">
                <span className="sh-context-sheet-title">{contextCategory.name}</span>
                <button
                  type="button"
                  className="sh-context-sheet-close-btn"
                  onClick={() => setContextCategory(null)}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Both Owner and Member see Mark as read and More (IMG-20261110-WA0016) */}
              <button
                type="button"
                className="sh-context-sheet-item"
                onClick={() => {
                  setContextCategory(null);
                  alert(`Category "${contextCategory.name}" marked as read.`);
                }}
              >
                <Eye size={18} />
                <span>Mark as read</span>
              </button>

              <button
                type="button"
                className="sh-context-sheet-item"
                onClick={() => {
                  const firstCh = contextCategory.channels[0];
                  setContextCategory(null);
                  if (firstCh) {
                    setActiveChannelInfo(firstCh);
                  } else {
                    setShowServerSearch(true);
                  }
                }}
              >
                <MoreHorizontal size={18} />
                <span>More</span>
              </button>

              {/* Owner only options */}
              {(activeServer?.ownerId === currentUser?.uid || activeServer?.isCreatedByMe) && (
                <>
                  <button
                    type="button"
                    className="sh-context-sheet-item"
                    onClick={() => {
                      setTargetCategoryForNewChannel(contextCategory.id);
                      setContextCategory(null);
                      setNewChannelName('');
                      setNewChannelDesc('');
                      setNewChannelType('text');
                      setNewChannelIsPrivate(false);
                      setNewChannelIcon('');
                      setShowCreateChannelModal(true);
                    }}
                  >
                    <Plus size={18} />
                    <span>Create Channel</span>
                  </button>
                  <button
                    type="button"
                    className="sh-context-sheet-item"
                    onClick={() => {
                      setEditingCategory(contextCategory);
                      setEditCategoryName(contextCategory.name);
                      setEditCategoryIsPrivate(!!contextCategory.isPrivate);
                      setContextCategory(null);
                    }}
                  >
                    <Pencil size={18} />
                    <span>Edit Category</span>
                  </button>
                  <button
                    type="button"
                    className="sh-context-sheet-item"
                    onClick={() => {
                      alert('Drag and drop to reorder categories coming soon.');
                      setContextCategory(null);
                    }}
                  >
                    <ArrowUpDown size={18} />
                    <span>Move Category</span>
                  </button>
                  <button
                    type="button"
                    className="sh-context-sheet-item sh-context-sheet-item-danger"
                    onClick={() => void handleDeleteCategory(contextCategory.id)}
                  >
                    <Trash2 size={18} color="#ff4b4b" />
                    <span>Delete Category</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Channel Context Sheet */}
        {contextChannel && (
          <div className="sh-context-sheet-overlay" onClick={() => setContextChannel(null)}>
            <div className="sh-context-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sh-context-sheet-header">
                <span className="sh-context-sheet-title">#{contextChannel.channel.name}</span>
                <button
                  type="button"
                  className="sh-context-sheet-close-btn"
                  onClick={() => setContextChannel(null)}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Both Owner and Member see Mark as read and More (IMG-20261110-WA0016) */}
              <button
                type="button"
                className="sh-context-sheet-item"
                onClick={() => {
                  setContextChannel(null);
                  alert(`#${contextChannel.channel.name} marked as read.`);
                }}
              >
                <Eye size={18} />
                <span>Mark as read</span>
              </button>

              <button
                type="button"
                className="sh-context-sheet-item"
                onClick={() => {
                  const ch = contextChannel.channel;
                  setContextChannel(null);
                  setActiveChannelInfo(ch);
                }}
              >
                <MoreHorizontal size={18} />
                <span>More</span>
              </button>

              {/* Owner only options */}
              {(activeServer?.ownerId === currentUser?.uid || activeServer?.isCreatedByMe) && (
                <>
                  <button
                    type="button"
                    className="sh-context-sheet-item"
                    onClick={() => {
                      const ch = contextChannel.channel;
                      setEditingChannel(contextChannel);
                      setContextChannel(null);
                      setEditChannelName(ch.name);
                      setEditChannelDesc(ch.description || '');
                      setEditChannelIsPrivate(!!ch.isPrivate);
                      setEditChannelIcon(ch.iconUrl || '');
                    }}
                  >
                    <Pencil size={18} />
                    <span>Edit Channel</span>
                  </button>
                  <button
                    type="button"
                    className="sh-context-sheet-item"
                    onClick={() => {
                      alert('Drag and drop to reorder channels coming soon.');
                      setContextChannel(null);
                    }}
                  >
                    <ArrowUpDown size={18} />
                    <span>Move Channel</span>
                  </button>
                  <button
                    type="button"
                    className="sh-context-sheet-item sh-context-sheet-item-danger"
                    onClick={() => void handleDeleteChannel(contextChannel.catId, contextChannel.channel.id)}
                  >
                    <Trash2 size={18} color="#ff4b4b" />
                    <span>Delete Channel</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Create Channel Modal (IMG-20261110-WA0017 & 20261110_184235) */}
        {showCreateChannelModal && (
          <div className="sh-fullscreen-modal">
            <div className="sh-fullscreen-modal-header">
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setShowCreateChannelModal(false)}
              >
                <X size={20} />
              </button>
              <h2>Create Channel</h2>
              <div style={{ width: 40 }} />
            </div>

            <div className="sh-fullscreen-modal-body">
              {/* Channel Name with inside Image Icon */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Name</label>
                <div className="sh-channel-name-input-wrap">
                  <input
                    type="file"
                    ref={newChannelIconInputRef}
                    accept="image/*,.gif"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await processServerImage(file, false);
                      setNewChannelIcon(dataUrl);
                    }}
                  />
                  <div className="sh-channel-icon-wrap">
                    <button
                      type="button"
                      className="sh-channel-icon-trigger"
                      title="Channel Icon / GIF"
                      onClick={() => newChannelIconInputRef.current?.click()}
                    >
                      {newChannelIcon ? (
                        <img src={newChannelIcon} alt="Channel Icon" className="sh-channel-icon-thumb" />
                      ) : (
                        <ImageIcon size={18} />
                      )}
                    </button>
                    {newChannelIcon && (
                      <button
                        type="button"
                        className="sh-channel-icon-remove-badge"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewChannelIcon('');
                        }}
                        title="Remove Icon"
                        aria-label="Remove Icon"
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="new-channel"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                  />
                </div>
              </div>

              {/* Channel Description */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Topic / Description</label>
                <textarea
                  className="sh-create-textarea"
                  placeholder="What is this channel about?"
                  rows={2}
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                />
              </div>

              {/* Channel Type Selector (Item 4 - IMG-20261110-WA0017) */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Type</label>

                {/* Option 1: Text */}
                <div
                  className={`sh-channel-type-card ${newChannelType === 'text' ? 'sh-channel-type-card-active' : ''}`}
                  onClick={() => setNewChannelType('text')}
                >
                  <div className="sh-channel-type-icon">
                    <span style={{ fontSize: 20, fontWeight: 700 }}>#</span>
                  </div>
                  <div className="sh-channel-type-copy">
                    <div className="sh-channel-type-title">Text</div>
                    <div className="sh-channel-type-desc">Post images, stickers, opinions, and puns</div>
                  </div>
                  <div className="sh-channel-type-radio">
                    {newChannelType === 'text' && <div className="sh-channel-type-radio-dot" />}
                  </div>
                </div>

                {/* Option 2: Voice */}
                <div
                  className={`sh-channel-type-card ${newChannelType === 'voice' ? 'sh-channel-type-card-active' : ''}`}
                  onClick={() => setNewChannelType('voice')}
                >
                  <div className="sh-channel-type-icon">
                    <Volume2 size={20} />
                  </div>
                  <div className="sh-channel-type-copy">
                    <div className="sh-channel-type-title">Voice</div>
                    <div className="sh-channel-type-desc">Talk with users or stream there</div>
                  </div>
                  <div className="sh-channel-type-radio">
                    {newChannelType === 'voice' && <div className="sh-channel-type-radio-dot" />}
                  </div>
                </div>

                {/* Option 3: Forum */}
                <div
                  className={`sh-channel-type-card ${newChannelType === 'forum' ? 'sh-channel-type-card-active' : ''}`}
                  onClick={() => setNewChannelType('forum')}
                >
                  <div className="sh-channel-type-icon">
                    <MessageCircle size={20} />
                  </div>
                  <div className="sh-channel-type-copy">
                    <div className="sh-channel-type-title">Forum</div>
                    <div className="sh-channel-type-desc">Take suggestions and post suggestions or more</div>
                  </div>
                  <div className="sh-channel-type-radio">
                    {newChannelType === 'forum' && <div className="sh-channel-type-radio-dot" />}
                  </div>
                </div>
              </div>

              {/* Private Channel Toggle (No Grid Box) */}
              <div
                className="sh-channel-private-row"
                onClick={() => setNewChannelIsPrivate(!newChannelIsPrivate)}
              >
                <div>
                  <div className="sh-create-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Lock size={16} /> Private Channel
                  </div>
                  <div style={{ fontSize: 13, color: '#949ba4', marginTop: 3 }}>
                    Only selected members and roles will be able to view this channel.
                  </div>
                </div>
                <button
                  type="button"
                  className={`sh-settings-toggle ${newChannelIsPrivate ? 'sh-settings-toggle-on' : ''}`}
                  style={{
                    background: newChannelIsPrivate ? '#ffffff' : '#23252b',
                    borderColor: newChannelIsPrivate ? '#ffffff' : 'rgba(255, 255, 255, 0.15)',
                    flexShrink: 0,
                    marginLeft: 12,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewChannelIsPrivate(!newChannelIsPrivate);
                  }}
                >
                  <div
                    className="sh-settings-toggle-knob"
                    style={{
                      background: newChannelIsPrivate ? '#000000' : '#ffffff',
                      transform: newChannelIsPrivate ? 'translateX(20px)' : 'translateX(0)',
                    }}
                  />
                </button>
              </div>

              {/* Create Channel Button in Bottom Bar */}
              <button
                type="button"
                className="sh-create-submit-btn"
                style={{ marginTop: 20 }}
                disabled={!newChannelName.trim()}
                onClick={handleCreateChannel}
              >
                Create Channel
              </button>
            </div>
          </div>
        )}

        {/* Edit Channel Modal (20261110_184443) */}
        {editingChannel && (
          <div className="sh-fullscreen-modal">
            <div className="sh-fullscreen-modal-header">
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setEditingChannel(null)}
              >
                <ArrowLeft size={20} />
              </button>
              <h2>Edit Channel</h2>
              <div style={{ width: 40 }} />
            </div>

            <div className="sh-fullscreen-modal-body">
              {/* Channel Name with inside Image Icon (Item 3) */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Name</label>
                <div className="sh-channel-name-input-wrap">
                  <input
                    type="file"
                    ref={editChannelIconInputRef}
                    accept="image/*,.gif"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await processServerImage(file, false);
                      setEditChannelIcon(dataUrl);
                    }}
                  />
                  <div className="sh-channel-icon-wrap">
                    <button
                      type="button"
                      className="sh-channel-icon-trigger"
                      title="Channel Icon / GIF"
                      onClick={() => editChannelIconInputRef.current?.click()}
                    >
                      {editChannelIcon ? (
                        <img src={editChannelIcon} alt="Channel Icon" className="sh-channel-icon-thumb" />
                      ) : (
                        <ImageIcon size={18} />
                      )}
                    </button>
                    {editChannelIcon && (
                      <button
                        type="button"
                        className="sh-channel-icon-remove-badge"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditChannelIcon('');
                        }}
                        title="Remove Icon"
                        aria-label="Remove Icon"
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="suggestions"
                    value={editChannelName}
                    onChange={(e) => setEditChannelName(e.target.value)}
                  />
                </div>
              </div>

              {/* Channel Description */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Topic / Description</label>
                <textarea
                  className="sh-create-textarea"
                  placeholder="Channel topic or description"
                  rows={3}
                  value={editChannelDesc}
                  onChange={(e) => setEditChannelDesc(e.target.value)}
                />
              </div>

              {/* Channel Type Segmented Toggle: [ Public | Private ] */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Channel Type</label>
                <div className="sh-segmented-toggle">
                  <button
                    type="button"
                    className={`sh-segmented-btn ${!editChannelIsPrivate ? 'sh-segmented-btn-active' : ''}`}
                    onClick={() => setEditChannelIsPrivate(false)}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    className={`sh-segmented-btn ${editChannelIsPrivate ? 'sh-segmented-btn-active' : ''}`}
                    onClick={() => setEditChannelIsPrivate(true)}
                  >
                    Private
                  </button>
                </div>
              </div>

              {/* Allowed Tags Section: ONLY shown when Private is active! */}
              {editChannelIsPrivate && (
                <div className="sh-create-input-group">
                  <label className="sh-create-label">Allowed Tags</label>
                  <div className="sh-allowed-tags-box">
                    <span>No tags available for now</span>
                  </div>
                </div>
              )}

              {/* Done Button at bottom */}
              <button
                type="button"
                className="sh-create-submit-btn"
                style={{ marginTop: 24 }}
                disabled={!editChannelName.trim()}
                onClick={handleSaveEditedChannel}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Edit Category Modal */}
        {editingCategory && (
          <div className="sh-fullscreen-modal">
            <div className="sh-fullscreen-modal-header">
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setEditingCategory(null)}
              >
                <ArrowLeft size={20} />
              </button>
              <h2>Edit Category</h2>
              <div style={{ width: 40 }} />
            </div>

            <div className="sh-fullscreen-modal-body">
              {/* Category Name */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Category Name</label>
                <div className="sh-category-name-input-wrap">
                  <input
                    type="text"
                    placeholder="Category Name"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                  />
                </div>
              </div>

              {/* Category Type Segmented Toggle: [ Public | Private ] */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Category Type</label>
                <div className="sh-segmented-toggle">
                  <button
                    type="button"
                    className={`sh-segmented-btn ${!editCategoryIsPrivate ? 'sh-segmented-btn-active' : ''}`}
                    onClick={() => setEditCategoryIsPrivate(false)}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    className={`sh-segmented-btn ${editCategoryIsPrivate ? 'sh-segmented-btn-active' : ''}`}
                    onClick={() => setEditCategoryIsPrivate(true)}
                  >
                    Private
                  </button>
                </div>
              </div>

              {/* Done Button at bottom */}
              <button
                type="button"
                className="sh-create-submit-btn"
                style={{ marginTop: 24 }}
                disabled={!editCategoryName.trim()}
                onClick={handleSaveEditedCategory}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {viewingProfileUid && (
          <OtherProfile
            targetUid={viewingProfileUid}
            onClose={handleCloseProfile}
            onOpenChat={(targetUid) => {
              handleCloseProfile();
              if (onOpenChat) onOpenChat();
              else navigateTo(`/chat?user=${encodeURIComponent(targetUid)}`);
            }}
            serverContext={activeServer ? {
              server: activeServer,
              onEquipTag: (tagId: string) => {
                void handleEquipTag(tagId);
              },
            } : undefined}
          />
        )}

        {/* Channel Info / More Screen (IMG-20261126-WA0011, IMG-20261126-WA0012, IMG-20261126-WA0014) */}
        {activeChannelInfo && (
          <div className="sh-channel-info-overlay" onClick={() => setActiveChannelInfo(null)}>
            <div className="sh-channel-info-modal" onClick={(e) => e.stopPropagation()}>
              {/* Top bar */}
              <div className="sh-channel-info-topbar">
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => {
                    setActiveChannelInfo(null);
                    setChannelInfoSearchActive(false);
                    setChannelInfoSearchQuery('');
                  }}
                  aria-label="Back"
                >
                  <ArrowLeft size={20} />
                </button>

                {channelInfoSearchActive ? (
                  <div className="sh-channel-info-search-input-wrap">
                    <Search size={16} color="#949ba4" />
                    <input
                      type="text"
                      autoFocus
                      className="sh-channel-info-search-input"
                      placeholder={`Search in #${activeChannelInfo.name}...`}
                      value={channelInfoSearchQuery}
                      onChange={(e) => setChannelInfoSearchQuery(e.target.value)}
                    />
                    {channelInfoSearchQuery && (
                      <button
                        type="button"
                        className="sh-channel-info-search-clear"
                        onClick={() => setChannelInfoSearchQuery('')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="sh-channel-info-top-title">
                    <span>#{activeChannelInfo.name}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => {
                    setChannelInfoSearchActive((prev) => !prev);
                    if (channelInfoSearchActive) setChannelInfoSearchQuery('');
                  }}
                  title={channelInfoSearchActive ? 'Close search' : 'Search'}
                >
                  {channelInfoSearchActive ? <X size={20} /> : <Search size={20} />}
                </button>
              </div>

              {/* Hero matching IMG-20261126-WA0011 */}
              {!channelInfoSearchActive && (
                <div className="sh-channel-info-hero">
                  <div className="sh-channel-info-hero-header">
                    {activeChannelInfo.iconUrl ? (
                      <img
                        src={activeChannelInfo.iconUrl}
                        alt={activeChannelInfo.name}
                        className="sh-channel-info-hero-img"
                      />
                    ) : (
                      <div className="sh-channel-info-hero-hash-box">
                        <span className="sh-channel-info-hero-hash">#</span>
                      </div>
                    )}
                    <div className="sh-channel-info-hero-text">
                      <h2 className="sh-channel-info-hero-name">#{activeChannelInfo.name}</h2>
                      <p className="sh-channel-info-hero-desc">
                        {activeChannelInfo.description || `Text Channel in ${activeServer.name}`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 3 Tabs Bar: Members, Media, Chat */}
              <div className="sh-channel-info-tabs">
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${channelInfoTab === 'members' ? 'active' : ''}`}
                  onClick={() => setChannelInfoTab('members')}
                >
                  Members
                </button>
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${channelInfoTab === 'media' ? 'active' : ''}`}
                  onClick={() => setChannelInfoTab('media')}
                >
                  Media
                </button>
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${channelInfoTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setChannelInfoTab('chat')}
                >
                  Chat
                </button>
              </div>

              {/* Tab Content */}
              <div className="sh-channel-info-content">
                {channelInfoTab === 'members' && renderGroupedMembers(channelInfoSearchQuery)}
                {channelInfoTab === 'media' && renderMediaGrid(channelMessages)}
                {channelInfoTab === 'chat' && renderChatSearchTab(channelMessages, channelInfoSearchQuery)}
              </div>
            </div>
          </div>
        )}

        {/* Server Search Modal (IMG-20261126-WA0012) */}
        {showServerSearch && (
          <div className="sh-channel-info-overlay" onClick={() => setShowServerSearch(false)}>
            <div className="sh-channel-info-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sh-channel-info-topbar">
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => {
                    setShowServerSearch(false);
                    setServerSearchQuery('');
                  }}
                  aria-label="Back"
                >
                  <ArrowLeft size={20} />
                </button>

                <div className="sh-channel-info-search-input-wrap">
                  <Search size={16} color="#949ba4" />
                  <input
                    type="text"
                    autoFocus
                    className="sh-channel-info-search-input"
                    placeholder={`Search in ${activeServer.name}...`}
                    value={serverSearchQuery}
                    onChange={(e) => setServerSearchQuery(e.target.value)}
                  />
                  {serverSearchQuery && (
                    <button
                      type="button"
                      className="sh-channel-info-search-clear"
                      onClick={() => setServerSearchQuery('')}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* 3 Tabs Bar: Members, Media, Chat */}
              <div className="sh-channel-info-tabs">
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${serverSearchTab === 'members' ? 'active' : ''}`}
                  onClick={() => setServerSearchTab('members')}
                >
                  Members
                </button>
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${serverSearchTab === 'media' ? 'active' : ''}`}
                  onClick={() => setServerSearchTab('media')}
                >
                  Media
                </button>
                <button
                  type="button"
                  className={`sh-channel-info-tab-btn ${serverSearchTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setServerSearchTab('chat')}
                >
                  Chat
                </button>
              </div>

              {/* Tab Content */}
              <div className="sh-channel-info-content">
                {serverSearchTab === 'members' && renderGroupedMembers(serverSearchQuery)}
                {serverSearchTab === 'media' && renderMediaGrid(channelMessages)}
                {serverSearchTab === 'chat' && renderChatSearchTab(channelMessages, serverSearchQuery)}
              </div>
            </div>
          </div>
        )}

        {/* Server Settings Page (IMG-20261110-WA0021) */}
        {showServerSettings && (
          <div className="sh-channel-info-overlay" onClick={() => setShowServerSettings(false)}>
            <div className="sh-channel-info-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sh-channel-info-topbar">
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => setShowServerSettings(false)}
                  aria-label="Back"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="sh-channel-info-top-title">
                  <span>Server Settings</span>
                </div>
                <div style={{ width: 40 }} />
              </div>

              <div className="sh-server-settings-body">
                <div className="sh-server-settings-section-title">PEOPLE</div>
                <button
                  type="button"
                  className="sh-server-settings-item"
                  onClick={() => {
                    setShowServerSettings(false);
                    setShowTagsManagement(true);
                  }}
                >
                  <div className="sh-server-settings-item-left">
                    <Shield size={20} color="#949ba4" />
                    <span>Tags</span>
                  </div>
                  <ChevronRight size={18} color="#949ba4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tags Management Page (IMG-20261126-WA0016, IMG-20261126-WA0017) */}
        {showTagsManagement && (
          <div className="sh-channel-info-overlay" onClick={() => setShowTagsManagement(false)}>
            <div className="sh-channel-info-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sh-channel-info-topbar">
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => {
                    setShowTagsManagement(false);
                    setShowServerSettings(true);
                  }}
                  aria-label="Back"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="sh-channel-info-top-title">
                  <span>Tags</span>
                </div>
                <button
                  type="button"
                  className="sh-servers-icon-btn"
                  onClick={() => {
                    setNewTagName('');
                    setNewTagColor('#5865F2');
                    setShowCreateTag(true);
                  }}
                  title="Create Tag"
                >
                  <Plus size={22} />
                </button>
              </div>

              <div className="sh-channel-info-content">
                {(activeServer.tags || []).length === 0 ? (
                  <div className="sh-servers-empty" style={{ padding: '40px 20px' }}>
                    <Shield size={44} color="#5865F2" />
                    <div className="sh-servers-empty-title" style={{ marginTop: 12 }}>No Tags Created Yet</div>
                    <div className="sh-servers-empty-desc">
                      Create tags with custom colors for your members to stand out in chat!
                    </div>
                    <button
                      type="button"
                      className="sh-search-btn-primary"
                      style={{ marginTop: 16, maxWidth: 200 }}
                      onClick={() => {
                        setNewTagName('');
                        setNewTagColor('#5865F2');
                        setShowCreateTag(true);
                      }}
                    >
                      + Create Tag
                    </button>
                  </div>
                ) : (
                  <div className="sh-tags-list">
                    {(activeServer.tags || []).map((t) => (
                      <div
                        key={t.id}
                        className="sh-tags-list-item"
                        onClick={() => {
                          setEditingTag(t);
                          setEditingTagName(t.name);
                          setEditingTagColor(t.color);
                        }}
                      >
                        <div className="sh-tags-list-item-left">
                          <span
                            className="sh-tag-color-circle"
                            style={{ background: t.color }}
                          />
                          <span
                            className="sh-tag-list-name"
                            style={{ color: t.color }}
                          >
                            {t.name}
                          </span>
                        </div>
                        <ChevronRight size={18} color="#949ba4" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Tag Modal (IMG-20261126-WA0016) */}
        {showCreateTag && (
          <div className="sh-fullscreen-modal" style={{ zIndex: 1400 }}>
            <div className="sh-fullscreen-modal-header">
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setShowCreateTag(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
              <div style={{ width: 40 }} />
            </div>

            <div className="sh-tag-create-body">
              <h2 className="sh-tag-create-title">Create a new tag</h2>
              <p className="sh-tag-create-subtitle">
                Create a tag you like for your server with color.
              </p>

              <div className="sh-tag-form-group">
                <label className="sh-tag-form-label">Tag name *</label>
                <input
                  type="text"
                  className="sh-tag-form-input"
                  placeholder="e.g. coach, moderator, subscriber, pet club"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="sh-tag-form-group">
                <div
                  className="sh-tag-color-selector"
                  onClick={() => setShowTagColorPicker(true)}
                >
                  <span className="sh-tag-color-selector-label">Tag Color</span>
                  <div className="sh-tag-color-selector-right">
                    <span
                      className="sh-tag-color-box"
                      style={{ background: newTagColor }}
                    />
                    <code className="sh-tag-hex-code">{newTagColor}</code>
                    <ChevronRight size={18} color="#949ba4" />
                  </div>
                </div>
                <p className="sh-tag-color-hint">
                  Members use the color of the highest tag they have in the tags list.
                </p>
              </div>

              <div style={{ flex: 1 }} />

              <button
                type="button"
                className="sh-tag-create-submit-btn"
                disabled={!newTagName.trim()}
                onClick={handleCreateTag}
              >
                Create
              </button>
            </div>
          </div>
        )}

        {/* Edit Tag Modal (IMG-20261126-WA0017) */}
        {editingTag && (
          <div className="sh-fullscreen-modal" style={{ zIndex: 1400 }}>
            <div className="sh-fullscreen-modal-header">
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setEditingTag(null)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: 18, margin: 0, color: editingTagColor }}>{editingTag.name}</h2>
              <div style={{ width: 40 }} />
            </div>

            <div className="sh-tag-create-body">
              <div className="sh-tag-form-group">
                <label className="sh-tag-form-label">Tag name</label>
                <input
                  type="text"
                  className="sh-tag-form-input"
                  value={editingTagName}
                  onChange={(e) => setEditingTagName(e.target.value)}
                />
              </div>

              <div className="sh-tag-form-group">
                <div
                  className="sh-tag-color-selector"
                  onClick={() => setShowTagColorPicker(true)}
                >
                  <span className="sh-tag-color-selector-label">Tag Color</span>
                  <div className="sh-tag-color-selector-right">
                    <span
                      className="sh-tag-color-box"
                      style={{ background: editingTagColor }}
                    />
                    <code className="sh-tag-hex-code">{editingTagColor}</code>
                    <ChevronRight size={18} color="#949ba4" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="sh-tag-delete-btn"
                onClick={() => handleDeleteTag(editingTag.id)}
              >
                Delete Tag
              </button>

              <div style={{ flex: 1 }} />

              <button
                type="button"
                className="sh-tag-create-submit-btn"
                disabled={!editingTagName.trim()}
                onClick={handleSaveTag}
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* Color Picker Wheel for Tags */}
        <ColorPickerModal
          isOpen={showTagColorPicker}
          title="Pick Tag Color"
          initialColor={editingTag ? editingTagColor : newTagColor}
          onSelect={(color) => {
            if (editingTag) setEditingTagColor(color);
            else setNewTagColor(color);
            setShowTagColorPicker(false);
          }}
          onClose={() => setShowTagColorPicker(false)}
        />

        {/* Server Overview Modal (IMG-20261126-WA0026, WA0004) */}
        {showServerOverview && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowServerOverview(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Overview</h2>
              <div style={{ width: 36 }} />
            </div>

            <div className="sh-tags-page-content" style={{ padding: '16px' }}>
              {/* Server Banner & Profile Preview with Pencils */}
              <div className="sh-overview-header-preview">
                <div className="sh-overview-banner-wrap">
                  {overviewBannerUrl ? (
                    <img src={overviewBannerUrl} alt="Server Banner" className="sh-overview-banner-img" />
                  ) : (
                    <div className="sh-overview-banner-img" style={{ background: '#5865F2' }} />
                  )}
                  <button
                    type="button"
                    className="sh-overview-banner-pencil"
                    onClick={() => overviewBannerFileRef.current?.click()}
                    aria-label="Edit Server Banner"
                  >
                    <Pencil size={16} />
                  </button>
                  <input
                    ref={overviewBannerFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleOverviewBannerChange}
                  />
                </div>

                <div className="sh-overview-avatar-wrap">
                  {overviewIconUrl ? (
                    <img src={overviewIconUrl} alt="Server Avatar" className="sh-overview-avatar-img" />
                  ) : (
                    <div
                      className="sh-overview-avatar-img"
                      style={{
                        background: '#2b2d31',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: 24,
                      }}
                    >
                      {activeServer.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <button
                    type="button"
                    className="sh-overview-avatar-pencil"
                    onClick={() => overviewAvatarFileRef.current?.click()}
                    aria-label="Edit Server Avatar"
                  >
                    <Pencil size={14} />
                  </button>
                  <input
                    ref={overviewAvatarFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleOverviewAvatarChange}
                  />
                </div>
              </div>

              {/* Server Name Input */}
              <div className="sh-overview-form-group">
                <label className="sh-overview-label">Server Name</label>
                <input
                  type="text"
                  className="sh-overview-input"
                  placeholder="Enter server name"
                  value={overviewName}
                  onChange={(e) => setOverviewName(e.target.value)}
                />
              </div>

              {/* Server Description Textarea */}
              <div className="sh-overview-form-group">
                <label className="sh-overview-label">Server Description</label>
                <textarea
                  className="sh-overview-textarea"
                  placeholder="Tell people what your server is about..."
                  rows={4}
                  value={overviewDescription}
                  onChange={(e) => setOverviewDescription(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Unsaved Commits Sticky Bar (IMG-20261126-WA0026) */}
        {hasUnsavedCommits && (
          <div className="sh-unsaved-commits-bar">
            <span className="sh-unsaved-commits-text">You have some unsaved commits</span>
            <div className="sh-unsaved-commits-actions">
              <button
                type="button"
                className="sh-unsaved-discard-btn"
                onClick={handleDiscardCommits}
              >
                Discard
              </button>
              <button
                type="button"
                className="sh-unsaved-commit-btn"
                onClick={handleCommitChanges}
              >
                Commit
              </button>
            </div>
          </div>
        )}

        {/* Server Members Modal (IMG-20261126-WA0018) */}
        {showServerMembers && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowServerMembers(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Members</h2>
              <div style={{ width: 36 }} />
            </div>

            <div className="sh-tag-search-box-wrap" style={{ padding: '12px 16px' }}>
              <Search size={16} color="#949ba4" />
              <input
                type="text"
                className="sh-tag-search-input"
                placeholder="Search members"
                value={serverMembersSearchQuery}
                onChange={(e) => setServerMembersSearchQuery(e.target.value)}
              />
              {serverMembersSearchQuery && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#949ba4', cursor: 'pointer' }}
                  onClick={() => setServerMembersSearchQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="sh-tags-page-content" style={{ padding: '8px 16px' }}>
              <div className="sh-server-members-list">
                {renderServerMembersList()}
              </div>
            </div>
          </div>
        )}

        {/* Member Action Sheet (IMG-20261126-WA0038) */}
        {selectedMemberAction && (
          <div
            className="sh-tag-menu-overlay"
            onClick={() => setSelectedMemberAction(null)}
          >
            <div
              className="sh-tag-menu-sheet"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sh-tag-menu-handle" />
              <div className="sh-member-action-header">
                {selectedMemberAction.avatarUrl ? (
                  <img
                    src={selectedMemberAction.avatarUrl}
                    alt=""
                    style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: '#5865F2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      fontWeight: 700,
                    }}
                  >
                    {selectedMemberAction.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                    {selectedMemberAction.displayName}
                  </div>
                  {selectedMemberAction.username && (
                    <div style={{ fontSize: 13, color: '#949ba4' }}>
                      @{selectedMemberAction.username}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="sh-member-action-item"
                onClick={() => {
                  alert(`Timed out ${selectedMemberAction.displayName} for 60 seconds.`);
                  setSelectedMemberAction(null);
                }}
              >
                Timeout
              </button>

              <button
                type="button"
                className="sh-member-action-item sh-member-action-danger"
                onClick={() => handleKickMember(selectedMemberAction.uid, selectedMemberAction.displayName)}
              >
                Kick {selectedMemberAction.displayName}
              </button>

              <button
                type="button"
                className="sh-member-action-item sh-member-action-danger"
                onClick={() => handleBanMember(selectedMemberAction.uid, selectedMemberAction.displayName)}
              >
                Ban {selectedMemberAction.displayName}
              </button>
            </div>
          </div>
        )}

        {/* Role Members Sheet (IMG-20261126-WA0040) */}
        {showTagMembersSheet && editingTag && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowTagMembersSheet(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">{editingTag.name} - Members</h2>
              <button
                type="button"
                className="sh-tag-create-btn"
                onClick={() => {
                  setSelectedUidsForRole(new Set());
                  setShowAddMembersToRole(true);
                }}
              >
                Add
              </button>
            </div>

            <div className="sh-tags-page-content" style={{ padding: '16px' }}>
              {(() => {
                const membersWithTag = Object.entries(activeServer.memberTags || {})
                  .filter(([_, tags]) => tags.includes(editingTag.id))
                  .map(([uid]) => uid);

                if (membersWithTag.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#949ba4' }}>
                      No members have been assigned this tag yet.
                    </div>
                  );
                }

                return membersWithTag.map((uid) => {
                  const p = serverMemberProfiles[uid] || senderProfiles[uid];
                  const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
                  const avatar = p?.avatarUrl || '';
                  return (
                    <div key={uid} className="sh-role-member-item">
                      <div className="sh-server-member-left">
                        <div className="sh-server-member-avatar-wrap">
                          {avatar ? (
                            <img src={avatar} alt="" className="sh-server-member-avatar" />
                          ) : (
                            <div
                              className="sh-server-member-avatar"
                              style={{
                                background: '#5865F2',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              {name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="sh-server-member-info">
                          <span className="sh-server-member-name">{name}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#f23f43', cursor: 'pointer', padding: 6 }}
                        onClick={() => handleRemoveMemberFromRole(uid, editingTag.id)}
                        aria-label="Remove role from member"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Add Members to Role Modal (IMG-20261126-WA0039) */}
        {showAddMembersToRole && editingTag && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowAddMembersToRole(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Add members to this role</h2>
              <button
                type="button"
                className="sh-tag-create-btn"
                disabled={selectedUidsForRole.size === 0}
                onClick={handleAddMembersToRole}
              >
                Add
              </button>
            </div>

            {/* Selected chips row */}
            {selectedUidsForRole.size > 0 && (
              <div className="sh-selected-chips-scroll" style={{ padding: '8px 16px' }}>
                {Array.from(selectedUidsForRole).map((uid) => {
                  const p = serverMemberProfiles[uid] || senderProfiles[uid];
                  const name = p?.displayName || 'Member';
                  return (
                    <div key={uid} className="sh-selected-chip">
                      <span>{name}</span>
                      <X
                        size={14}
                        className="sh-selected-chip-remove"
                        onClick={() => {
                          setSelectedUidsForRole((prev) => {
                            const next = new Set(prev);
                            next.delete(uid);
                            return next;
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search Input */}
            <div className="sh-tag-search-box-wrap" style={{ padding: '8px 16px' }}>
              <Search size={16} color="#949ba4" />
              <input
                type="text"
                className="sh-tag-search-input"
                placeholder="Search members"
                value={tagMemberSearchQuery}
                onChange={(e) => setTagMemberSearchQuery(e.target.value)}
              />
              {tagMemberSearchQuery && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#949ba4', cursor: 'pointer' }}
                  onClick={() => setTagMemberSearchQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Members Picker List */}
            <div className="sh-tags-page-content" style={{ padding: '8px 16px' }}>
              {(() => {
                const memberUids = Array.from(
                  new Set([
                    ...(activeServer.memberIds || []),
                    activeServer.ownerId || '',
                    currentUser?.uid || '',
                  ])
                ).filter(Boolean);

                const q = tagMemberSearchQuery.trim().toLowerCase();
                const filtered = memberUids.filter((uid) => {
                  const p = serverMemberProfiles[uid] || senderProfiles[uid];
                  const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
                  return !q || name.toLowerCase().includes(q);
                });

                return filtered.map((uid) => {
                  const p = serverMemberProfiles[uid] || senderProfiles[uid];
                  const name = p?.displayName || (uid === activeServer.ownerId ? activeServer.creatorName || 'Owner' : 'Member');
                  const avatar = p?.avatarUrl || '';
                  const isChecked = selectedUidsForRole.has(uid);

                  return (
                    <div
                      key={uid}
                      className="sh-role-member-item"
                      onClick={() => {
                        setSelectedUidsForRole((prev) => {
                          const next = new Set(prev);
                          if (next.has(uid)) next.delete(uid);
                          else next.add(uid);
                          return next;
                        });
                      }}
                    >
                      <div className="sh-server-member-left">
                        <div className="sh-server-member-avatar-wrap">
                          {avatar ? (
                            <img src={avatar} alt="" className="sh-server-member-avatar" />
                          ) : (
                            <div
                              className="sh-server-member-avatar"
                              style={{
                                background: '#5865F2',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              {name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="sh-server-member-info">
                          <span className="sh-server-member-name">{name}</span>
                          {p && (p as any).username && (
                            <span className="sh-server-member-username">@{(p as any).username}</span>
                          )}
                        </div>
                      </div>
                      <div className={`sh-role-checkbox ${isChecked ? 'checked' : ''}`}>
                        {isChecked && <Check size={14} color="#ffffff" strokeWidth={3} />}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Server Invites Modal (IMG-20261126-WA0041) */}
        {showServerInvites && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowServerInvites(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Invites</h2>
              <div style={{ width: 36 }} />
            </div>

            <div className="sh-tags-page-content" style={{ padding: '16px' }}>
              {/* Primary / Default Invite Link Card */}
              <div className="sh-invite-link-card">
                <div className="sh-invite-link-top">
                  <div className="sh-invite-creator-row">
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: '#5865F2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {activeServer.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>Server Primary Link</span>
                  </div>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#dbdee1', cursor: 'pointer', padding: 4 }}
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/servers?invite=${activeServer.id}`);
                      alert('Server invite link copied to clipboard!');
                    }}
                    title="Copy Link"
                  >
                    <Copy size={18} />
                  </button>
                </div>
                <div className="sh-invite-code-row">
                  <Link2 size={16} color="#5865F2" />
                  <span>{activeServer.id}</span>
                </div>
                <div className="sh-invite-meta-row">
                  <span>Uses: {activeServer.memberIds?.length || 1}</span>
                  <span>Expires: Never</span>
                </div>
              </div>

              {/* Any additional custom invites */}
              {(activeServer.invites || []).map((inv) => (
                <div key={inv.code} className="sh-invite-link-card">
                  <div className="sh-invite-link-top">
                    <div className="sh-invite-creator-row">
                      {inv.creatorAvatar ? (
                        <img src={inv.creatorAvatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: '#5865F2',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {inv.creatorName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>{inv.creatorName}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#dbdee1', cursor: 'pointer', padding: 4 }}
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/servers?invite=${inv.code}`);
                          alert('Invite link copied!');
                        }}
                      >
                        <Copy size={18} />
                      </button>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: '#f23f43', cursor: 'pointer', padding: 4 }}
                        onClick={async () => {
                          const updatedInvites = (activeServer.invites || []).filter((i) => i.code !== inv.code);
                          const updatedServer = { ...activeServer, invites: updatedInvites };
                          setActiveServer(updatedServer);
                          try {
                            await updateDoc(doc(db, 'servers', activeServer.id), { invites: updatedInvites });
                          } catch {}
                        }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="sh-invite-code-row">
                    <Link2 size={16} color="#5865F2" />
                    <span>{inv.code}</span>
                  </div>
                  <div className="sh-invite-meta-row">
                    <span>Uses: {inv.uses}</span>
                    <span>Expires: Never</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invite Friends Modal (IMG-20261126-WA0032) */}
        {showInviteFriendsModal && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowInviteFriendsModal(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Invite Friends</h2>
              <button
                type="button"
                className="sh-tag-create-btn"
                disabled={selectedFriendUids.size === 0 || invitingFriendsBusy}
                onClick={handleSendFriendInvites}
              >
                {invitingFriendsBusy ? 'Sending...' : 'Invite'}
              </button>
            </div>

            <div className="sh-tag-search-box-wrap" style={{ padding: '8px 16px' }}>
              <Search size={16} color="#949ba4" />
              <input
                type="text"
                className="sh-tag-search-input"
                placeholder="Search friends"
                value={friendSearchQuery}
                onChange={(e) => setFriendSearchQuery(e.target.value)}
              />
              {friendSearchQuery && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#949ba4', cursor: 'pointer' }}
                  onClick={() => setFriendSearchQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="sh-tags-page-content" style={{ padding: '8px 16px' }}>
              {(() => {
                const q = friendSearchQuery.trim().toLowerCase();
                const filteredFriends = userFriendsList.filter(
                  (f) => !q || f.displayName.toLowerCase().includes(q) || (f.username && f.username.toLowerCase().includes(q))
                );

                if (filteredFriends.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#949ba4' }}>
                      {userFriendsList.length === 0 ? 'No friends found on your Shinzi list.' : 'No friends match your search.'}
                    </div>
                  );
                }

                return filteredFriends.map((friend) => {
                  const isChecked = selectedFriendUids.has(friend.uid);
                  return (
                    <div
                      key={friend.uid}
                      className="sh-role-member-item"
                      onClick={() => {
                        setSelectedFriendUids((prev) => {
                          const next = new Set(prev);
                          if (next.has(friend.uid)) next.delete(friend.uid);
                          else next.add(friend.uid);
                          return next;
                        });
                      }}
                    >
                      <div className="sh-server-member-left">
                        <div className="sh-server-member-avatar-wrap">
                          {friend.photoURL ? (
                            <img src={friend.photoURL} alt="" className="sh-server-member-avatar" />
                          ) : (
                            <div
                              className="sh-server-member-avatar"
                              style={{
                                background: '#5865F2',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              {friend.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="sh-server-member-info">
                          <span className="sh-server-member-name">{friend.displayName}</span>
                          {friend.username && <span className="sh-server-member-username">@{friend.username}</span>}
                        </div>
                      </div>
                      <div className={`sh-role-checkbox ${isChecked ? 'checked' : ''}`}>
                        {isChecked && <Check size={14} color="#ffffff" strokeWidth={3} />}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Server Commits List Modal (IMG-20261126-WA0042) */}
        {showServerCommits && activeServer && (
          <div className="sh-tags-page-container">
            <div className="sh-tags-page-header">
              <button
                type="button"
                className="sh-tags-back-btn"
                onClick={() => setShowServerCommits(false)}
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="sh-tags-page-title">Commits</h2>
              <div style={{ width: 36 }} />
            </div>

            <div className="sh-tags-page-content" style={{ padding: '16px' }}>
              {(!activeServer.commits || activeServer.commits.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '40px 16px', color: '#949ba4' }}>
                  No commits logged yet for this server.
                </div>
              ) : (
                <div className="sh-commits-list">
                  {activeServer.commits.map((commit) => (
                    <div
                      key={commit.id}
                      className="sh-commit-card"
                      onClick={() => setSelectedCommitDetails(commit)}
                    >
                      <div className="sh-commit-left">
                        <div className="sh-commit-icon-badge">
                          <GitCommit size={18} color="#5865F2" />
                        </div>
                        <div>
                          <div className="sh-commit-title">
                            @{commit.authorName} has made commit ({commit.id})
                          </div>
                          <div className="sh-commit-time">
                            {new Date(commit.createdAt).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                      <span className="sh-commit-code-pill">{commit.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Commit Details Sheet (IMG-20261126-WA0037) */}
        {selectedCommitDetails && (
          <div
            className="sh-tag-menu-overlay"
            onClick={() => setSelectedCommitDetails(null)}
          >
            <div
              className="sh-tag-menu-sheet"
              style={{ maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sh-tag-menu-handle" />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {selectedCommitDetails.authorAvatar ? (
                    <img
                      src={selectedCommitDetails.authorAvatar}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: '#5865F2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      {selectedCommitDetails.authorName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                      @{selectedCommitDetails.authorName}
                    </div>
                    <div style={{ fontSize: 12, color: '#949ba4' }}>
                      {new Date(selectedCommitDetails.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <span className="sh-commit-code-pill">{selectedCommitDetails.id}</span>
              </div>

              <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
                {selectedCommitDetails.changes.map((change, idx) => (
                  <div key={idx} className="sh-commit-detail-change-item">
                    <span className="sh-commit-change-num">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="sh-commit-change-text">{change}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Full Image Preview Overlay */}
        {selectedMediaPreviewUrl && (
          <div
            className="sh-media-preview-overlay"
            onClick={() => setSelectedMediaPreviewUrl(null)}
          >
            <button
              type="button"
              className="sh-media-preview-close"
              onClick={() => setSelectedMediaPreviewUrl(null)}
              aria-label="Close"
            >
              <X size={24} />
            </button>
            <img
              src={selectedMediaPreviewUrl}
              alt="Media Preview"
              className="sh-media-preview-img"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </>
    );

    if (isDesktop) {
      return (
        <div className="sh-server-desktop-container">
          {serverBannerAndHeader}
          <div className="sh-server-desktop-body">
            <div className="sh-server-desktop-channels-col">
              {channelsContentOnly}
            </div>
            <div className="sh-server-desktop-chat-col">
              {selectedChannel && selectedChannel.type === 'text' ? (
                renderChannelChat(true)
              ) : (
                <div className="sh-desktop-chat-empty">
                  <div className="sh-desktop-chat-empty-content">
                    <ServerIcon size={48} color="#5865f2" />
                    <h3>Welcome to {activeServer.name}!</h3>
                    <p>Select a channel from the left sidebar to start chatting.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {modalsAndSheets}
          {renderInviteModal()}
          {renderCropModal()}
        </div>
      );
    }

    if (!isDesktop && selectedChannel && selectedChannel.type === 'text') {
      return (
        <>
          {renderChannelChat(false)}
          {modalsAndSheets}
          {renderInviteModal()}
          {renderCropModal()}
        </>
      );
    }

    return (
      <div
        className="sh-server-scroll-container"
        onTouchStart={handleServerViewTouchStart}
        onTouchEnd={handleServerViewTouchEnd}
      >
        {serverBannerAndHeader}
        {channelsContentOnly}
        {modalsAndSheets}
        {renderInviteModal()}
        {renderCropModal()}
      </div>
    );
  }

  // ==========================================================
  // RENDER: MAIN SERVERS DASHBOARD (20261109_222510)
  // ==========================================================
  return (
    <div className="sh-servers-page">
      {/* Top Bar with Title Servers, + and Search */}
      <header className="sh-servers-topbar">
        <h1 className="sh-servers-topbar-title">Servers</h1>
        <div className="sh-servers-topbar-actions">
          <button
            type="button"
            className="sh-servers-icon-btn"
            title="Create Server"
            onClick={() => setShowCreateModal(true)}
            aria-label="Create Server"
          >
            <Plus size={22} />
          </button>

          <button
            type="button"
            className="sh-servers-icon-btn"
            title="Search Servers"
            onClick={() => setShowSearchModal(true)}
            aria-label="Search Servers"
          >
            <Search size={20} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="sh-servers-content">
        {/* SECTION 1: Your Created Servers (first) */}
        <section>
          <div className="sh-servers-section-title">Your Created Servers</div>
          {createdServers.length > 0 ? (
            <div className="sh-servers-grid">
              {createdServers.map((srv) => (
                <div
                  key={srv.id}
                  className="sh-server-card"
                  onClick={() => {
                    setActiveServer(srv);
                    setSelectedChannel(null);
                  }}
                >
                  {srv.bannerUrl ? (
                    <img
                      src={srv.bannerUrl}
                      alt={srv.name}
                      className="sh-server-card-bg-img"
                    />
                  ) : (
                    <div className="sh-server-card-bg-gradient" />
                  )}
                  <div className="sh-server-card-overlay" />
                  <div className="sh-server-card-body">
                    {srv.iconUrl ? (
                      <img src={srv.iconUrl} alt={srv.name} className="sh-server-card-avatar" />
                    ) : (
                      <div className="sh-server-card-avatar-placeholder">
                        {srv.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="sh-server-card-name-row">
                      <span className="sh-server-card-name">{srv.name}</span>
                      {srv.isOfficial && <span className="sh-server-badge-official">✓</span>}
                    </div>
                    <span className="sh-server-card-members">{srv.memberCount}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sh-servers-empty">
              <ServerIcon size={32} color="#636b75" />
              <div className="sh-servers-empty-title">No servers created yet</div>
            </div>
          )}
        </section>

        {/* SECTION 2: Joined Servers - clean unboxed empty state */}
        <section>
          <div className="sh-servers-section-title">Joined Servers</div>
          {joinedServers.length > 0 ? (
            <div className="sh-servers-grid">
              {joinedServers.map((srv) => (
                <div
                  key={srv.id}
                  className="sh-server-card"
                  onClick={() => {
                    setActiveServer(srv);
                    setSelectedChannel(null);
                  }}
                >
                  {srv.bannerUrl ? (
                    <img
                      src={srv.bannerUrl}
                      alt={srv.name}
                      className="sh-server-card-bg-img"
                    />
                  ) : (
                    <div className="sh-server-card-bg-gradient" />
                  )}
                  <div className="sh-server-card-overlay" />
                  <div className="sh-server-card-body">
                    {srv.iconUrl ? (
                      <img src={srv.iconUrl} alt={srv.name} className="sh-server-card-avatar" />
                    ) : (
                      <div className="sh-server-card-avatar-placeholder">
                        {srv.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="sh-server-card-name-row">
                      <span className="sh-server-card-name">{srv.name}</span>
                      {srv.isOfficial && <span className="sh-server-badge-official">✓</span>}
                    </div>
                    <span className="sh-server-card-members">{srv.memberCount}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sh-servers-empty">
              <ServerIcon size={32} color="#636b75" />
              <div className="sh-servers-empty-title">No servers joined yet</div>
            </div>
          )}
        </section>
      </main>

      {/* CREATE SERVER MODAL (IMG-20261110-WA0010) */}
      {showCreateModal && (
        <div
          className="sh-create-server-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="sh-create-server-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sh-create-server-header">
              <h2>Create Server</h2>
              <button
                type="button"
                className="sh-servers-icon-btn"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="sh-create-server-body">
              {/* Thumbnail / Banner Upload Box */}
              <input
                type="file"
                ref={bannerInputRef}
                accept="image/*,.gif"
                style={{ display: 'none' }}
                onChange={handleBannerChange}
              />
              <div
                className="sh-create-thumbnail-box"
                onClick={() => bannerInputRef.current?.click()}
              >
                {formBannerPreview ? (
                  <>
                    <img
                      src={formBannerPreview}
                      alt="Banner Preview"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: 12,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        background: 'rgba(0,0,0,0.65)',
                        padding: '4px 10px',
                        borderRadius: 6,
                        color: '#fff',
                        fontSize: 12,
                        zIndex: 2,
                      }}
                    >
                      Change Thumbnail / Banner
                    </div>
                  </>
                ) : (
                  <>
                    <ImageIcon size={26} color="#ffffff" />
                    <span className="sh-create-thumbnail-label">
                      Server Thumbnail / Banner (Supports GIF)
                    </span>
                  </>
                )}
              </div>

              {/* Avatar Upload Circle & Server Name */}
              <div className="sh-create-avatar-row">
                <input
                  type="file"
                  ref={avatarInputRef}
                  accept="image/*,.gif"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
                <div
                  className="sh-create-avatar-circle"
                  onClick={() => avatarInputRef.current?.click()}
                  title="Upload Server Profile (Image / GIF)"
                >
                  {formAvatarPreview ? (
                    <img
                      src={formAvatarPreview}
                      alt="Avatar Preview"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: '50%',
                      }}
                    />
                  ) : (
                    <User size={22} color="#ffffff" />
                  )}
                </div>

                <div className="sh-create-input-group" style={{ flex: 1 }}>
                  <label className="sh-create-label">Server Name</label>
                  <input
                    type="text"
                    className="sh-create-input"
                    placeholder="Enter server name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
              </div>

              {/* Server Description */}
              <div className="sh-create-input-group">
                <label className="sh-create-label">Description</label>
                <textarea
                  className="sh-create-textarea"
                  placeholder="What is your server about?"
                  rows={3}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>

              {/* Private Server Checkbox: Clean label "Private Server" & white tick */}
              <div
                className="sh-create-toggle-row"
                onClick={() => setFormIsPrivate(!formIsPrivate)}
              >
                <span className="sh-create-toggle-title">Private Server</span>
                <div
                  className={`sh-create-checkbox ${formIsPrivate ? 'sh-create-checkbox-checked' : ''}`}
                >
                  {formIsPrivate && <Check size={16} color="#ffffff" strokeWidth={3} />}
                </div>
              </div>

              <div className="sh-create-note">• you can change settings any Time</div>

              {/* Submit Button */}
              <button
                type="button"
                className="sh-create-submit-btn"
                disabled={!formName.trim() || createBusy}
                onClick={handleCreateServer}
              >
                {createBusy ? 'Creating Server…' : 'Create Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <nav className="shc-bottom">
        <button
          type="button"
          onClick={() => {
            alert('AI Assistant is active in chats.');
          }}
          aria-label="AI"
        >
          <Sparkles size={22} />
        </button>

        <button
          type="button"
          className="shc-bottom-active"
          onClick={() => {
            setActiveServer(null);
            setShowSearchModal(false);
          }}
          aria-label="Servers"
        >
          <ServerIcon size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenChat) onOpenChat();
            else window.location.href = '/chat';
          }}
          aria-label="Chat"
        >
          <MessageCircle size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenNotifications) onOpenNotifications();
            else navigateTo('/chat?screen=notifications');
          }}
          aria-label="Notifications"
        >
          <Bell size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenProfile) onOpenProfile();
            else window.location.href = '/profile';
          }}
          aria-label="Profile"
          className="shc-bottom-profile-btn"
        >
          {currentUserProfile?.photoURL || currentUser?.photoURL ? (
            <img
              src={currentUserProfile?.photoURL || currentUser?.photoURL || ''}
              alt=""
              className="shc-avatar-img shc-avatar-nav"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = 'none';
              }}
            />
          ) : null}
          <div
            className="shc-avatar-nav shc-avatar-nav-fallback"
            style={{
              backgroundColor: '#5865f2',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              display: (currentUserProfile?.photoURL || currentUser?.photoURL) ? 'none' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {(currentUserProfile?.displayName || currentUser?.displayName || 'U').charAt(0).toUpperCase()}
          </div>
        </button>
      </nav>

      {viewingProfileUid && (
        <OtherProfile
          targetUid={viewingProfileUid}
          onClose={handleCloseProfile}
          onOpenChat={(targetUid) => {
            handleCloseProfile();
            if (onOpenChat) onOpenChat();
            else navigateTo(`/chat?user=${encodeURIComponent(targetUid)}`);
          }}
          serverContext={activeServer ? {
            server: activeServer,
            onEquipTag: (tagId: string) => {
              void handleEquipTag(tagId);
            },
          } : undefined}
        />
      )}

      {renderInviteModal()}
      {renderCropModal()}
    </div>
  );
}
