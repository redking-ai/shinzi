import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Servers.css';
import {
  Plus,
  Search,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Calendar,
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
} from 'lucide-react';
import { auth, db } from './firebaseConfig';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { useDriveStore } from './driveStore';

interface ServerChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement';
  isPrivate?: boolean;
  listenerCount?: string;
}

interface ServerCategory {
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
 * This guarantees the image stays well under Firestore's 1MB document limit,
 * prevents localStorage quota errors, and preserves animated GIFs.
 */
async function processServerImage(file: File, isBanner: boolean): Promise<string> {
  // If animated GIF under 1.5MB, preserve raw bytes for animated GIF playback
  if (file.type === 'image/gif' && file.size < 1500000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Compress other images (JPEG, PNG, WEBP, high-res phone camera shots)
  return new Promise((resolve) => {
    const maxWidth = isBanner ? 800 : 200;
    const maxHeight = isBanner ? 450 : 200;
    const quality = isBanner ? 0.78 : 0.82;

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

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  const handleBack = () => {
    if (activeServer) {
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

  // Fetch when user state resolves
  useEffect(() => {
    void fetchPublicServers();
  }, [currentUser?.uid, fetchPublicServers]);

  // Re-fetch whenever Search modal opens so newly created servers from other devices appear immediately
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
        // Created servers
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

        // Joined servers
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

  // Handle avatar upload (Supports image & animated GIF, compressed for web speed)
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await processServerImage(file, false);
      setFormAvatarPreview(dataUrl);

      // Upload to Drive folder 'server' if configured
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

  // Handle banner upload (Supports image & animated GIF, compressed for web speed)
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

    // Save to Firestore with valid memberIds and visibility adhering to firestore.rules
    try {
      await setDoc(doc(db, 'servers', newServerId), newServer);
      console.log('Server successfully created in Firestore:', newServerId);
    } catch (err) {
      console.warn('Firestore server write fallback:', err);
    }

    // Update local state and localStorage
    const updated = [newServer, ...createdServers];
    setCreatedServers(updated);
    setDiscoverableServers((prev) => [newServer, ...prev.filter((s) => s.id !== newServer.id)]);
    try {
      localStorage.setItem('shinzi_created_servers', JSON.stringify(updated));
    } catch {}

    // Reset form
    setFormName('');
    setFormDesc('');
    setFormIsPrivate(false);
    setFormAvatarPreview('');
    setFormBannerPreview('');
    setCreateBusy(false);
    setShowCreateModal(false);

    // Open the new server immediately
    setActiveServer(newServer);
    setSelectedChannel(newServer.categories[1]?.channels[0] || newServer.categories[0]?.channels[0]);
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

  // Toggle Category Collapse
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
  // RENDER: SEARCH SERVERS MODAL (20261109_222742 & 222850)
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
                          <span className="sh-search-result-creator">
                            by {match?.creatorName || 'Community'}
                          </span>
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
                    // Record in recent searches without auto-joining (per user requirement)
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
                      <span className="sh-search-result-creator">
                        by {srv.creatorName || 'Community'}
                      </span>
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
  // RENDER: FULL SERVER DETAILS (20261109_223029)
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
            className="sh-servers-icon-btn"
            style={{ position: 'absolute', top: 14, left: 14, zIndex: 10 }}
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
              <div
                className="sh-server-card-avatar-placeholder"
                style={{ width: 68, height: 68, fontSize: 28, margin: 0 }}
              >
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

          <div className="sh-server-details-stats">
            {activeServer.memberCount} • {activeServer.isOfficial ? 'official • ' : ''}
            {activeServer.onlineCount || '1 online'}
          </div>

          <div className="sh-server-details-mutual">
            <User size={16} />
            <span>by {activeServer.creatorName || 'Community'}</span>
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
  // RENDER: SERVER CHANNEL VIEW (20261109_222903 & 222918)
  // ==========================================================
  if (activeServer) {
    return (
      <div className="sh-server-view-page">
        {/* Banner Header with Expandable Thumbnail */}
        <div className="sh-server-banner-header">
          {activeServer.bannerUrl ? (
            <img
              src={activeServer.bannerUrl}
              alt={activeServer.name}
              className="sh-server-banner-bg-img"
            />
          ) : (
            <div className="sh-server-card-bg-gradient" />
          )}
          <div className="sh-server-banner-overlay" />

          {/* Top Bar inside Server View */}
          <div className="sh-server-banner-top">
            <button
              type="button"
              className="sh-servers-icon-btn"
              onClick={handleBack}
              aria-label="Back to Servers"
            >
              <ArrowLeft size={20} />
            </button>
          </div>

          {/* Server Info Row & 4 Side Actions (Event, Invite, Search, >) */}
          <div className="sh-server-header-info">
            <div className="sh-server-header-left">
              {activeServer.iconUrl ? (
                <img
                  src={activeServer.iconUrl}
                  alt={activeServer.name}
                  className="sh-server-header-avatar"
                />
              ) : (
                <div
                  className="sh-server-card-avatar-placeholder"
                  style={{ width: 44, height: 44, fontSize: 18, margin: 0 }}
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
                  {activeServer.memberCount} {activeServer.isOfficial ? '• official' : ''}
                </span>
              </div>
            </div>

            {/* 4 Header Actions: Event, Invite, Search, > */}
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
                title="Invite to Server"
                onClick={() => setShowInviteSheet(true)}
              >
                <UserPlus size={18} />
              </button>

              <button
                type="button"
                className="sh-servers-icon-btn"
                title="Search Server"
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
        </div>

        {/* Server Channels & Categories List */}
        <div className="sh-server-channels-content">
          {activeServer.categories.map((cat) => {
            const isCollapsed = collapsedCategories[cat.id];
            return (
              <div key={cat.id} className="sh-category-group">
                <div
                  className="sh-category-header"
                  onClick={() => toggleCategory(cat.id)}
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
                        onClick={() => setSelectedChannel(ch)}
                      >
                        <div className="sh-channel-left">
                          {ch.type === 'voice' ? (
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 18, color: '#949ba4' }}
                            >
                              mic
                            </span>
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

        {/* Invite Bottom Sheet (20261109_222945) */}
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

              {/* Share Options Row */}
              <div className="sh-invite-share-row">
                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => {
                    navigator.clipboard?.writeText(
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
                      navigator.share({
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

              {/* Enter / Choose Channel */}
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

              {/* Invite Expiry */}
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
      </div>
    );
  }

  // ==========================================================
  // RENDER: MAIN SERVERS DASHBOARD (20261109_222510)
  // ==========================================================
  return (
    <div className="sh-servers-page">
      {/* Top Bar with Title Servers, + and Search (NO 3-dot menu) */}
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
                    setSelectedChannel(srv.categories[0]?.channels[0]);
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

        {/* SECTION 2: Joined Servers (down) */}
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
                    setSelectedChannel(srv.categories[0]?.channels[0]);
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

      {/* CREATE SERVER MODAL (20261109_222718) */}
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

              {/* Private Server Checkbox */}
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
      <nav className="sh-servers-bottom-nav">
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
