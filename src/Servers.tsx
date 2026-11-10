import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Servers.css';
import './Chat.css';
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
  Sliders,
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
} from 'lucide-react';
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
  orderBy,
} from 'firebase/firestore';
import { useDriveStore } from './driveStore';
import { getUserEffectiveStatus } from './presenceService';

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

function formatMessageTime(createdAt: any): string {
  if (!createdAt) return '';
  try {
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

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

export default function Servers({ onBack, onOpenChat, onOpenProfile }: ServersProps) {
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
  const [activeServer, setActiveServer] = useState<ServerData | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ServerChannel | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

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
    Record<string, { displayName: string; avatarUrl?: string }>
  >({});
  const [assetFileMap, setAssetFileMap] = useState<Record<string, string>>({});
  const channelFileInputRef = useRef<HTMLInputElement | null>(null);
  const channelDocInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  const handleBack = () => {
    if (selectedChannel) {
      setSelectedChannel(null);
    } else if (activeServer) {
      setActiveServer(null);
    } else if (onBack) {
      onBack();
    }
  };

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
        const qCreated = query(collection(db, 'servers'), where('ownerId', '==', currentUser.uid));
        const snapCreated = await getDocs(qCreated);
        if (!snapCreated.empty) {
          const list: ServerData[] = snapCreated.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
            isCreatedByMe: true,
          }));
          setCreatedServers(list);
          localStorage.setItem('shinzi_created_servers', JSON.stringify(list));
        }

        const qJoined = query(
          collection(db, 'servers'),
          where('memberIds', 'array-contains', currentUser.uid)
        );
        const snapJoined = await getDocs(qJoined);
        if (!snapJoined.empty) {
          const list: ServerData[] = snapJoined.docs
            .map((docSnap) => ({
              id: docSnap.id,
              ...(docSnap.data() as any),
            }))
            .filter((s) => s.ownerId !== currentUser.uid);
          setJoinedServers(list);
          localStorage.setItem('shinzi_joined_servers', JSON.stringify(list));
        }
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

  // Real-time channel messages listener
  useEffect(() => {
    if (!activeServer?.id || !selectedChannel?.id || selectedChannel.type !== 'text') {
      setChannelMessages([]);
      return;
    }

    try {
      const messagesRef = collection(
        db,
        'servers',
        activeServer.id,
        'channels',
        selectedChannel.id,
        'messages'
      );
      const q = query(messagesRef, orderBy('createdAt', 'asc'));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const msgs: ServerChannelMessage[] = snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }));
          setChannelMessages(msgs);
        },
        (err) => {
          console.warn('Channel messages listener fallback:', err);
        }
      );
      return unsub;
    } catch (err) {
      console.warn('Could not subscribe to channel messages:', err);
    }
  }, [activeServer?.id, selectedChannel?.id, selectedChannel?.type]);

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
            next[res.uid] = { displayName: res.displayName, avatarUrl: res.avatarUrl };
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

  // Send channel message
  const handleSendChannelMessage = async (imageUrl?: string) => {
    if (!activeServer || !selectedChannel) return;
    const textToSend = channelInputText.trim();
    if (!textToSend && !imageUrl) return;

    setChannelSendBusy(true);
    const userUid = currentUser?.uid || auth.currentUser?.uid || 'anon';
    const profile = senderProfiles[userUid];
    const userName = profile?.displayName || currentUser?.displayName || 'User';
    const userAvatar = profile?.avatarUrl || currentUser?.photoURL || '';

    const newMsg: Partial<ServerChannelMessage> = {
      senderId: userUid,
      senderName: userName,
      senderAvatar: userAvatar,
      text: textToSend,
      ...(imageUrl ? { imageUrl } : {}),
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(
        collection(db, 'servers', activeServer.id, 'channels', selectedChannel.id, 'messages'),
        newMsg
      );
      setChannelInputText('');
    } catch (err) {
      console.warn('Send channel message failed, fallback local:', err);
      setChannelMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          senderId: userUid,
          senderName: userName,
          senderAvatar: userAvatar,
          text: textToSend,
          imageUrl,
          createdAt: { toDate: () => new Date() },
        },
      ]);
      setChannelInputText('');
    } finally {
      setChannelSendBusy(false);
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

  // Handle avatar upload
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await processServerImage(file, false);
      setFormAvatarPreview(dataUrl);

      if (drive.hasActiveSession && drive.uploadFile) {
        const res = await drive.uploadFile({
          file,
          fileName: `server_avatar_${Date.now()}_${file.name}`,
          mimeType: file.type || 'image/png',
          folderType: 'server',
        });
        if (res?.fileId) {
          await drive.makeFilePublic(res.fileId);
          setFormAvatarPreview(`https://lh3.googleusercontent.com/d/${res.fileId}=s1600`);
        }
      }
    } catch (err) {
      console.warn('Avatar processing note:', err);
    }
  };

  // Handle banner upload
  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await processServerImage(file, true);
      setFormBannerPreview(dataUrl);

      if (drive.hasActiveSession && drive.uploadFile) {
        const res = await drive.uploadFile({
          file,
          fileName: `server_banner_${Date.now()}_${file.name}`,
          mimeType: file.type || 'image/png',
          folderType: 'server',
        });
        if (res?.fileId) {
          await drive.makeFilePublic(res.fileId);
          setFormBannerPreview(`https://lh3.googleusercontent.com/d/${res.fileId}=s1600`);
        }
      }
    } catch (err) {
      console.warn('Banner processing note:', err);
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

    try {
      await setDoc(doc(db, 'servers', newServerId), newServer);
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
                  return (
                    <div
                      key={rec}
                      className="sh-search-result-card"
                      onClick={() => {
                        if (!match) {
                          setSearchQuery(rec);
                        }
                      }}
                    >
                      {match?.bannerUrl ? (
                        <img
                          src={match.bannerUrl}
                          alt={match.name}
                          className="sh-search-card-bg-img"
                        />
                      ) : (
                        <div className="sh-server-card-bg-gradient" />
                      )}
                      <div className="sh-search-result-overlay" />
                      <div className="sh-search-result-body">
                        {match?.iconUrl ? (
                          <img
                            src={match.iconUrl}
                            alt={match.name}
                            className="sh-search-result-avatar"
                          />
                        ) : (
                          <div
                            className="sh-server-card-avatar-placeholder"
                            style={{ width: 40, height: 40, fontSize: 16, margin: 0 }}
                          >
                            {(match?.name || rec).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="sh-search-result-info">
                          <span className="sh-search-result-name">{match?.name || rec}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="sh-servers-empty">
                  <div className="sh-servers-empty-title">No Recent</div>
                  <div className="sh-servers-empty-desc">Try searching!</div>
                </div>
              )}
            </div>
          ) : searchResults.length > 0 ? (
            <div>
              <div className="sh-servers-section-title">
                [{searchResults.length}] {searchResults.length === 1 ? 'Result' : 'Results'}
              </div>
              {searchResults.map((srv) => (
                <div
                  key={srv.id}
                  className="sh-search-result-card"
                  onClick={() => {
                    addRecentSearch(srv.name);
                  }}
                >
                  {srv.bannerUrl ? (
                    <img
                      src={srv.bannerUrl}
                      alt={srv.name}
                      className="sh-search-card-bg-img"
                    />
                  ) : (
                    <div className="sh-server-card-bg-gradient" />
                  )}
                  <div className="sh-search-result-overlay" />
                  <div className="sh-search-result-body">
                    {srv.iconUrl ? (
                      <img
                        src={srv.iconUrl}
                        alt={srv.name}
                        className="sh-search-result-avatar"
                      />
                    ) : (
                      <div
                        className="sh-server-card-avatar-placeholder"
                        style={{ width: 40, height: 40, fontSize: 16, margin: 0 }}
                      >
                        {srv.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="sh-search-result-info">
                      <span className="sh-search-result-name">{srv.name}</span>
                    </div>
                  </div>
                </div>
              ))}
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
              onClick={() => alert('Server settings')}
            >
              <Sliders size={20} />
              <span className="sh-server-action-card-label">Custom</span>
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
  if (activeServer && selectedChannel && selectedChannel.type === 'text') {
    return (
      <div className="sh-channel-chat-page">
        {/* Header matching IMG-20261110-WA0014 */}
        <div className="sh-channel-chat-header">
          <button
            type="button"
            className="sh-channel-chat-back-btn"
            onClick={() => setSelectedChannel(null)}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>

          <div
            className="sh-channel-chat-title-group"
            onClick={() => {
              setEditingChannel({ catId: activeServer.categories[0]?.id || '', channel: selectedChannel });
            }}
          >
            <span className="sh-channel-chat-title">#{selectedChannel.name}</span>
            <ChevronRight size={18} color="#949ba4" />
          </div>

          <div className="sh-channel-chat-header-actions">
            <div className="sh-channel-chat-online-badge">
              <span className="sh-status-dot-green"></span>
              <span>{onlineMembersCount}</span>
            </div>
            <button
              type="button"
              className="sh-servers-icon-btn"
              onClick={() => setShowSearchModal(true)}
              aria-label="Search"
            >
              <Search size={18} />
            </button>
          </div>
        </div>

        {/* Messages List */}
        <div className="sh-channel-chat-messages">
          {channelMessages.length === 0 ? (
            <div className="sh-channel-chat-welcome">
              <div className="sh-channel-chat-welcome-hash">#</div>
              <h3>Welcome to #{selectedChannel.name}!</h3>
              <p>{selectedChannel.description || `This is the start of the #${selectedChannel.name} channel.`}</p>
            </div>
          ) : (
            channelMessages.map((msg: any) => {
              const profile = senderProfiles[msg.senderId];
              const authorName = profile?.displayName || msg.senderName || 'User';
              const avatar = profile?.avatarUrl || msg.senderAvatar;
              const resolvedImgUrl = resolveChannelAttachmentUrl(msg, assetFileMap);

              return (
                <div key={msg.id} className="sh-channel-msg-row">
                  <div className="sh-channel-msg-avatar shc-avatar-fallback">
                    {avatar ? (
                      <img src={avatar} alt={authorName} />
                    ) : (
                      authorName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="sh-channel-msg-content">
                    <div className="sh-channel-msg-header">
                      <span className="sh-channel-msg-author">{authorName}</span>
                      <span className="sh-channel-msg-time">{formatMessageTime(msg.createdAt)}</span>
                    </div>
                    {msg.text && <div className="sh-channel-msg-text">{msg.text}</div>}
                    {resolvedImgUrl && (
                      <img
                        src={resolvedImgUrl}
                        alt="attachment"
                        className="sh-channel-msg-img"
                        onClick={() => window.open(resolvedImgUrl, '_blank')}
                      />
                    )}
                    {msg.type === 'file' && (
                      <div
                        className="shc-file-msg"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          background: '#1e1f22',
                          borderRadius: 8,
                          marginTop: 4,
                        }}
                      >
                        <FileText size={20} color="#b5bac1" />
                        <span style={{ fontSize: 13, color: '#00a8fc' }}>{msg.fileName || 'Attachment'}</span>
                      </div>
                    )}
                  </div>
                </div>
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
            const textNotice = `[Shared file: ${file.name}]`;
            setChannelInputText(textNotice);
            if (channelDocInputRef.current) channelDocInputRef.current.value = '';
          }}
        />

        {/* Full Working Chat Composer Bar (Item 6) */}
        <div className="shc-composer-wrap">
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
                <textarea
                  className="shc-composer-textarea"
                  placeholder={`Message #${selectedChannel.name}`}
                  value={channelInputText}
                  onChange={(e) => setChannelInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendChannelMessage();
                    }
                  }}
                  rows={1}
                />
              </div>

              <button
                type="button"
                className="shc-composer-icon-btn shc-composer-emoji-btn"
                onClick={() => {
                  const emoji = prompt('Type or paste emoji:');
                  if (emoji) setChannelInputText((prev) => prev + emoji);
                }}
                aria-label="Toggle emoji picker"
              >
                <Smile size={21} />
              </button>

              {!channelInputText.trim() && (
                <button
                  type="button"
                  className="shc-composer-icon-btn shc-composer-voice-btn"
                  onClick={() => {
                    alert('Hold to record voice message in this channel.');
                  }}
                  aria-label="Record voice message"
                >
                  <Mic size={21} />
                </button>
              )}

              <button
                type="button"
                className={`shc-composer-icon-btn shc-composer-send-btn ${channelInputText.trim() ? 'shc-send-active' : ''}`}
                disabled={!channelInputText.trim() && !channelSendBusy}
                onClick={() => void handleSendChannelMessage()}
                aria-label="Send message"
              >
                <Send size={18} />
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
                      const gifUrl = window.prompt('Paste GIF or Sticker URL:');
                      if (gifUrl && gifUrl.trim()) {
                        void handleSendChannelMessage(gifUrl.trim());
                      }
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
                      alert('Voice note recording started (tap to finish).');
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
      </div>
    );
  }

  // ==========================================================
  // RENDER: SERVER VIEW (IMG-20261109-WA0007, IMG-20261110-WA0022, VID-20261110-WA0023)
  // ==========================================================
  if (activeServer) {
    return (
      <div className="sh-server-scroll-container">
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
              onClick={handleBack}
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
                  handleBack();
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
                className="sh-server-card-avatar-placeholder"
                style={{ width: 40, height: 40, fontSize: 16, margin: 0 }}
              >
                {activeServer.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="sh-server-header-details">
              <h1 className="sh-server-header-name">
                {activeServer.name}
                {activeServer.isOfficial && <CheckCircle2 size={16} color="#5865F2" fill="#5865F2" />}
              </h1>
              <span className="sh-server-header-sub">
                {onlineMembersCount} Online • {activeServer.memberIds?.length || 1} Members &gt;
              </span>
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
              title="Search"
              onClick={() => setShowSearchModal(true)}
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

        {/* Channels & Categories List with Long-press support */}
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
                  <span className="sh-category-name">{cat.name}</span>
                  <ChevronDown
                    size={15}
                    className={`sh-category-chevron ${isCollapsed ? 'sh-category-chevron-collapsed' : ''}`}
                  />
                </div>

                {!isCollapsed &&
                  cat.channels.map((ch) => {
                    const isActive = selectedChannel?.id === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className={`sh-channel-item ${isActive ? 'sh-channel-item-active' : ''}`}
                        onClick={() => {
                          if (ch.type === 'text') {
                            setSelectedChannel(ch);
                          } else if (ch.type === 'voice') {
                            alert(`Voice Room: ${ch.name} (${ch.listenerCount || '0 People in'})`);
                          } else {
                            setSelectedChannel(ch);
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
                  onClick={() => alert('Select friends from chat to invite')}
                >
                  <div className="sh-invite-share-icon">
                    <User size={22} />
                  </div>
                  <span className="sh-invite-share-label">To user</span>
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
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                      chat
                    </span>
                  </div>
                  <span className="sh-invite-share-label">WhatsApp</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => alert('Instagram Direct share')}
                >
                  <div className="sh-invite-share-icon">
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                      photo_camera
                    </span>
                  </div>
                  <span className="sh-invite-share-label">Instagram</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => {
                    if (navigator.share) {
                      void navigator.share({
                        title: `Join ${activeServer.name}`,
                        url: `${window.location.origin}/servers?invite=${activeServer.id}`,
                      });
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
                  const newName = prompt('Edit Category Name:', contextCategory.name);
                  if (newName && newName.trim() && activeServer) {
                    const updatedCategories = activeServer.categories.map((c) =>
                      c.id === contextCategory.id ? { ...c, name: newName.trim() } : c
                    );
                    void updateServerInStateAndStorage({
                      ...activeServer,
                      categories: updatedCategories,
                    });
                  }
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
              <button
                type="button"
                className="sh-fullscreen-modal-save-btn"
                disabled={!newChannelName.trim()}
                onClick={handleCreateChannel}
              >
                Create
              </button>
            </div>

            <div className="sh-fullscreen-modal-body">
              {/* Channel Name with inside Image Icon (Item 4) */}
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
                  <button
                    type="button"
                    className="sh-channel-icon-trigger"
                    title="Channel Icon / GIF"
                    onClick={() => newChannelIconInputRef.current?.click()}
                  >
                    {newChannelIcon ? (
                      <img src={newChannelIcon} alt="Icon" />
                    ) : (
                      <ImageIcon size={18} />
                    )}
                  </button>
                  <input
                    type="text"
                    placeholder="new-channel"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                  />
                  {newChannelIcon && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center' }}
                      onClick={() => setNewChannelIcon('')}
                      title="Remove Icon"
                    >
                      <X size={16} />
                    </button>
                  )}
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

              {/* Private Channel Toggle */}
              <div
                className="sh-create-toggle-row"
                style={{ marginTop: 14 }}
                onClick={() => setNewChannelIsPrivate(!newChannelIsPrivate)}
              >
                <div>
                  <div className="sh-create-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={16} /> Private Channel
                  </div>
                  <div style={{ fontSize: 12, color: '#949ba4', marginTop: 2 }}>
                    Only selected members and roles will be able to view this channel.
                  </div>
                </div>
                <div className={`sh-create-checkbox ${newChannelIsPrivate ? 'sh-create-checkbox-checked' : ''}`}>
                  {newChannelIsPrivate && <Check size={16} color="#ffffff" strokeWidth={3} />}
                </div>
              </div>
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
                  <button
                    type="button"
                    className="sh-channel-icon-trigger"
                    title="Channel Icon / GIF"
                    onClick={() => editChannelIconInputRef.current?.click()}
                  >
                    {editChannelIcon ? (
                      <img src={editChannelIcon} alt="Icon" />
                    ) : (
                      <ImageIcon size={18} />
                    )}
                  </button>
                  <input
                    type="text"
                    placeholder="suggestions"
                    value={editChannelName}
                    onChange={(e) => setEditChannelName(e.target.value)}
                  />
                  {editChannelIcon && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#8e9297', cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center' }}
                      onClick={() => setEditChannelIcon('')}
                      title="Remove Icon"
                    >
                      <X size={16} />
                    </button>
                  )}
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
              <div className="sh-servers-empty-desc">
                Tap the + button to create your own community server!
              </div>
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
              <div className="sh-servers-empty-desc">
                Search and discover exciting community servers to join!
              </div>
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
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 26, color: '#ffffff' }}
                    >
                      image
                    </span>
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
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 22, color: '#ffffff' }}
                    >
                      account_circle
                    </span>
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
          className="sh-nav-active"
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
          onClick={() => setShowSearchModal(true)}
          aria-label="Search"
        >
          <Search size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenProfile) onOpenProfile();
            else window.location.href = '/profile';
          }}
          aria-label="Profile"
        >
          <User size={22} />
        </button>
      </nav>
    </div>
  );
}
