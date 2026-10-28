import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  addDoc,
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
  BarChart3,
  Calendar,
  FileText,
  Gamepad2,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  MessagesSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Plus,
  Reply,
  Search,
  Send,
  Server,
  Smile,
  Sparkles,
  Square,
  Star,
  User,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
  Check,
} from 'lucide-react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { navigateTo as navigateToUrl, setCachedProfile } from './profileCache';
import './Chat.css';

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
  | 'search';
type Panel = 'poll' | 'event' | 'gif' | null;

const TABS = ['All', 'Recent', 'Urgent', 'Favorite', 'Groups'] as const;
type Tab = (typeof TABS)[number];

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

function Avatar({
  name,
  group = false,
  small = false,
}: {
  name?: string;
  group?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={small ? 'shc-avatar shc-avatar-sm' : 'shc-avatar'}
      aria-hidden="true"
    >
      {group ? <Users size={small ? 17 : 23} /> : <span>{initials(name)}</span>}
    </div>
  );
}

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
  const [messages, setMessages] = useState<Rec[]>([]);
  const [activity, setActivity] = useState<Record<string, Rec>>({});
  const [now, setNow] = useState(() => Date.now());

  const [screen, setScreen] = useState<Screen>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('screen') === 'search') return 'search';
    }
    return 'main';
  });
  const [activeTab, setActiveTab] = useState<Tab>('All');
  const [selected, setSelected] = useState<Rec | null>(null);

  const [chatFilter ] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [searchResult, setSearchResult] = useState<Rec | null>(null);
  const [searching, setSearching] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState<string | null>(null);
  const [sentRequestUids, setSentRequestUids] = useState<Set<string>>(() => new Set());
  const [optimisticFavorites, setOptimisticFavorites] = useState<Record<string, boolean>>({});

  const [messageText, setMessageText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Rec | null>(null);
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
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    if (!selected?.id) {
      setMessages([]);
      return undefined;
    }

    const q = query(
      collection(db, 'conversations', selected.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limitToLast(300),
    );

    return onSnapshot(
      q,
      (snap) =>
        setMessages(snap.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => console.error('Messages listener error:', error),
    );
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

    if (activeTab === 'Recent') {
      rows = rows.filter((item) => millis(item.lastMessageAt) > 0);
    }
    if (activeTab === 'Urgent') rows = rows.filter(isUrgent);
    if (activeTab === 'Favorite') rows = rows.filter(isFavorite);
    if (activeTab === 'Groups') rows = rows.filter((i) => i.type === 'group');

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
      if (activeTab !== 'Recent' && activeTab !== 'Favorite') {
        const fav = Number(isFavorite(b)) - Number(isFavorite(a));
        if (fav !== 0) return fav;
      }
      return (
        millis(b.lastMessageAt || b.updatedAt) -
        millis(a.lastMessageAt || a.updatedAt)
      );
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeTab, chatFilter, uid, optimisticFavorites]);

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

  const openConversation = async (conversation: Rec) => {
    if (!conversation?.id) return;

    setSelected(conversation);
    setScreen('conversation');
    setMessageText('');
    setReplyTarget(null);
    await markRead(conversation);
  };

  const openDirectConversation = async (otherUser: Rec) => {
    if (!uid || !otherUser?.id) return;

    if (otherUser.id === uid) {
      notify('Not available', 'You cannot open a direct chat with yourself.');
      return;
    }

    const id = directId(uid, otherUser.id);
    const conversationRef = doc(db, 'conversations', id);

    try {
      const existing = await getDoc(conversationRef);

      if (!existing.exists()) {
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
        });
      }

      const snapshot = await getDoc(conversationRef);
      await openConversation({ id, ...snapshot.data() });
    } catch (error) {
      console.error('Unable to open direct conversation:', error);
      notify('Unable to open chat', messageOf(error));
    }
  };
const handleSearchMessage = async (target: Rec) => {
  if (!uid || !target?.id || target.id === uid) return;

  const existingConversation = conversations.find(
    (conversation) =>
      conversation.type !== 'group' &&
      conversation.memberIds?.includes(uid) &&
      conversation.memberIds?.includes(target.id),
  );

  if (existingConversation) {
    await openConversation(existingConversation);
    return;
  }

  const isFriend = friends.some((friend) => friend.id === target.id);

  if (isFriend) {
    await openDirectConversation(target);
    return;
  }

  await sendRequest('dmRequests', target);
};


  const publishTyping = async (typing: boolean) => {
    if (!uid || !selected?.id) return;

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

  const handleMessageChange = (text: string, el?: HTMLTextAreaElement) => {
    if (text.length > MAX_MESSAGE_LENGTH) {
      notify(
        'Message too long',
        `Messages can contain up to ${MAX_MESSAGE_LENGTH} characters.`,
      );
      return;
    }

    setMessageText(text);

    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }

    if (!selected?.id || !uid) return;

    void publishTyping(Boolean(text.trim()));

    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void publishTyping(false);
    }, 5000);
  };

  const startReply = (msg: Rec) => {
    if (!msg || msg.deleted) return;
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

    const text = messageText.trim();
    if (!text) return;

    sendingRef.current = true;
    setSending(true);

    try {
      const activeConv = selectedConversation || selected;
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

      // Mark only the mentioned people as urgent; leave everyone else alone.
      (activeConv?.memberIds || []).forEach((memberId: string) => {
        const memberProfile = activeConv?.memberProfiles?.[memberId];
        if (
          memberId !== uid &&
          isMentioned(text, memberProfile?.username, memberProfile?.displayName)
        ) {
          updates[`urgentFor.${memberId}`] = true;
        }
      });

      await updateDoc(doc(db, 'conversations', selected.id), updates);

      setMessageText('');
      setReplyTarget(null);
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
  ) => {
    if (!uid || !target?.id) return;

    const label = kind === 'friendRequests' ? 'friend request' : 'DM request';

    if (target.id === uid) {
      notify('Not available', `You cannot send yourself a ${label}.`);
      return;
    }

    if (kind === 'friendRequests') {
      const isAlreadyFriend = friends.some((friend) => friend.id === target.id);
      if (isAlreadyFriend) {
        notify('Already friends', `You and @${target.username || 'user'} are already friends.`);
        return;
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
        notify('Already sent', `A ${label} is already pending.`);
        setSentRequestUids((prev) => new Set(prev).add(target.id));
        return;
      }

      await setDoc(requestRef, {
        fromUid: uid,
        toUid: target.id,
        fromProfile: {
          displayName: profile?.displayName || profile?.username || 'User',
          username: profile?.username || '',
        },
        toProfile: {
          displayName: target.displayName || target.username || 'User',
          username: target.username || '',
        },
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSentRequestUids((prev) => new Set(prev).add(target.id));
      notify('Request sent', `Your ${label} was sent.`);
    } catch (error) {
      console.error('Request error:', error);
      notify('Unable to send request', messageOf(error));
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

        if (!conversationSnap.exists()) {
          transaction.set(conversationRef, {
            type: 'direct',
            memberIds: [uid, fromUid],
            memberProfiles: {
              [uid]: {
                displayName:
                  profile?.displayName || profile?.username || 'User',
                username: profile?.username || '',
              },
              [fromUid]: {
                displayName:
                  data.fromProfile?.displayName ||
                  data.fromProfile?.username ||
                  'User',
                username: data.fromProfile?.username || '',
              },
            },
            favoriteBy: { [uid]: false, [fromUid]: false },
            urgentFor: { [uid]: false, [fromUid]: false },
            lastReadAt: { [uid]: serverTimestamp() },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastMessageAt: null,
            lastMessageText: '',
            lastSenderId: null,
          });
        }

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

  const renderMessage = (item: Rec, index: number) => {
    const own = item.senderId === uid;
    const previous = messages[index - 1];
    const showDay =
      millis(item.createdAt) > 0 &&
      (!previous || dayKey(previous.createdAt) !== dayKey(item.createdAt));

    let body: ReactNode;

    if (item.deleted) {
      body = (
        <div className="shc-bubble shc-bubble-deleted">
          This message was deleted.
        </div>
      );
    } else if (item.type === 'poll') {
      body = renderPoll(item);
    } else if (item.type === 'event') {
      body = renderEvent(item);
    } else if (item.type === 'voice') {
      body = (
        <div className={own ? 'shc-voice shc-voice-own' : 'shc-voice'}>
          <Mic size={20} />
          <span>Voice message</span>
          <span className="shc-voice-time">{item.duration || '00:00'}</span>
        </div>
      );
    } else {
      const replyId = item.replyToMessageId || item.replyTo?.id;
      const original = replyId ? messages.find((m) => m.id === replyId) : null;

      body = (
        <div
          className={own ? 'shc-bubble shc-bubble-own' : 'shc-bubble'}
          onDoubleClick={() => !item.deleted && startReply(item)}
        >
          {!own && selected?.type === 'group' && (
            <span className="shc-sender">
              {item.senderName || item.senderUsername || 'User'}
            </span>
          )}

          {replyId && (() => {
            let quotedSender = 'User';
            let quotedText = 'Original message unavailable';

            if (original) {
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
              quotedSender =
                item.replyTo.senderId === uid
                  ? 'You'
                  : item.replyTo.senderName ||
                    item.replyTo.senderUsername ||
                    'User';
              quotedText = item.replyTo.text || 'Original message unavailable';
            }

            return (
              <div
                role="button"
                tabIndex={0}
                className={own ? 'shc-quote shc-quote-own' : 'shc-quote'}
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
                <div className="shc-quote-bar" />
                <div className="shc-quote-content">
                  <span className="shc-quote-sender">{quotedSender}</span>
                  <span className="shc-quote-text">{quotedText}</span>
                </div>
              </div>
            );
          })()}

          <span className="shc-text">{item.text}</span>

          <span className="shc-meta">
            {formatTime(item.createdAt)}
          </span>
        </div>
      );
    }

    return (
      <div key={item.id} id={`shc-msg-${item.id}`}>
        {showDay && <div className="shc-day">{dateLabel(item.createdAt)}</div>}

        <div className={own ? 'shc-msg-row shc-msg-own' : 'shc-msg-row'}>
          {own && !item.deleted && (
            <button
              type="button"
              className="shc-msg-reply-btn"
              onClick={() => startReply(item)}
              title="Reply"
              aria-label="Reply"
            >
              <Reply size={15} />
            </button>
          )}

          {!own && <Avatar name={item.senderName} small />}
          {body}

          {!own && !item.deleted && (
            <button
              type="button"
              className="shc-msg-reply-btn"
              onClick={() => startReply(item)}
              title="Reply"
              aria-label="Reply"
            >
              <Reply size={15} />
            </button>
          )}
        </div>
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
      >
        <User size={22} />
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
      onClick={() => setScreen('dmRequests')}
      aria-label="DM requests"
    >
      <Mail size={21} />
      {dmRequests.length > 0 && <Badge count={dmRequests.length} />}
    </button>

    <button
      type="button"
      className="shc-icon-btn"
      onClick={() => setScreen('friendRequests')}
      aria-label="Friend requests"
    >
      <UserPlus size={21} />
      {friendRequests.length > 0 && <Badge count={friendRequests.length} />}
    </button>

    <button
      type="button"
      className="shc-icon-btn"
      onClick={() => setShowGroup(true)}
      aria-label="Create group"
    >
      <Users size={21} />
    </button>
  </div>
</header>
      

      <nav className="shc-tabs" aria-label="Chat filters">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            className={activeTab === tab ? 'shc-tab shc-tab-active' : 'shc-tab'}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            {tab === 'Urgent' && conversations.some(isUrgent) && (
              <span className="shc-tab-dot" />
            )}
          </button>
        ))}
      </nav>

      <div className="shc-list">
        {loadingChats ? (
          <div className="shc-loading">
            <span className="shc-spinner" />
          </div>
        ) : !filteredConversations.length ? (
          <EmptyState
            icon={<MessagesSquare size={44} />}
            title="No chats"
            text={
              activeTab === 'All'
                ? 'Your conversations will appear here.'
                : `There are no ${activeTab.toLowerCase()} chats right now.`
            }
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
                <Avatar name={name} group={item.type === 'group'} />

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
          <Avatar name={item.displayName || item.username} />
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
        <div key={item.id} className="shc-request">
          <Avatar name={item.fromProfile?.displayName || item.fromProfile?.username} />

          <span className="shc-person-info">
            <strong>
              {item.fromProfile?.displayName || item.fromProfile?.username || 'User'}
            </strong>
            <span>@{item.fromProfile?.username || 'user'}</span>
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

  const renderDmRequests = () =>
    renderPeople(
      'DM requests',
      dmRequests,
      false,
      <EmptyState
        icon={<Mail size={44} />}
        title="No DM requests"
        text="New direct-message requests will appear here."
      />,
      renderRequestRow('dmRequests', acceptDMRequest),
    );

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
            <Avatar name={searchResult.displayName || searchResult.username} />

            <span className="shc-person-info">
              <strong>{searchResult.displayName || searchResult.username || 'User'}</strong>
              <span>@{searchResult.username || 'user'}</span>
            </span>

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

          <Avatar name={name} group={isGroup} small />

          <div className="shc-chat-title">
            <strong>{name}</strong>
            <span>
              {isGroup
                ? `${selectedConversation?.memberIds?.length || 0} members`
                : username
                  ? `@${username}`
                  : 'Direct message'}
            </span>
          </div>

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
          {messages.length === 0 ? (
            <EmptyState
              icon={<MessageCircle size={44} />}
              title="Start the conversation"
              text="Send a message to begin."
            />
          ) : (
            messages.map(renderMessage)
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

        <div className="shc-composer">
          <button
            type="button"
            className="shc-icon-btn shc-accent-btn"
            onClick={() => setShowAttach(true)}
            aria-label="Attach"
          >
            <Plus size={26} />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Message"
            value={messageText}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(e) => handleMessageChange(e.target.value, e.target)}
            onKeyDown={onComposerKey}
          />

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
            disabled={!messageText.trim() || sending}
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

        <div className="shc-counter">
          {messageText.length}/{MAX_MESSAGE_LENGTH}
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
                    <Avatar name={friend.displayName || friend.username} small />
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
      <div className="shc-page">
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
  <div className="shc-page">
    <div className="shc-screen-content">
      {screen === 'conversation'
        ? renderConversation()
        : screen === 'friends'
          ? renderFriends()
          : screen === 'friendRequests'
            ? renderFriendRequests()
            : screen === 'dmRequests'
              ? renderDmRequests()
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