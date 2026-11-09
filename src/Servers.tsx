import React, { useState, useEffect, useRef } from 'react';
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
  CheckCircle2,
} from 'lucide-react';
import { auth, db } from './firebaseConfig';
import { collection, doc, getDocs, setDoc, query, where } from 'firebase/firestore';
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
  description?: string;
  iconUrl?: string;
  bannerUrl?: string;
  memberCount: string;
  isOfficial?: boolean;
  isCustomTag?: boolean;
  isCreatedByMe?: boolean;
  isPrivate?: boolean;
  onlineCount?: string;
  categories: ServerCategory[];
}

interface ServersProps {
  onBack?: () => void;
  onOpenChat?: () => void;
  onOpenProfile?: () => void;
}

// Initial curated servers from sketches
const DEFAULT_JOINED_SERVERS: ServerData[] = [
  {
    id: 'shinzi-hub',
    name: 'Shinzi Hub',
    creatorName: 'Shinzi Official',
    description: 'This is the 1st server of the Shinzi hub by the way.',
    memberCount: '101.4M members',
    onlineCount: '42,910 online',
    isOfficial: true,
    isCustomTag: true,
    iconUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'cat-welcome',
        name: 'Welcome',
        channels: [
          { id: 'ch-welcome', name: 'welcome', type: 'text' },
          { id: 'ch-announcements', name: 'announcements', type: 'announcement' },
        ],
      },
      {
        id: 'cat-events',
        name: 'Events',
        channels: [
          { id: 'ch-events', name: 'Events', type: 'text' },
          { id: 'ch-special-events', name: 'Special Events', type: 'text' },
        ],
      },
      {
        id: 'cat-community',
        name: 'Community',
        channels: [
          { id: 'ch-chats', name: 'Chats', type: 'text' },
          { id: 'ch-chill-chat', name: 'Chill Chat', type: 'text' },
          { id: 'ch-reel-chat', name: 'Reel Chat', type: 'text' },
          { id: 'ch-photo-chat', name: 'Photo Chat', type: 'text' },
          { id: 'ch-about-me', name: 'chat about me', type: 'text' },
          { id: 'ch-suggests', name: 'suggests', type: 'text' },
          { id: 'ch-creations', name: 'Creations', type: 'text' },
        ],
      },
      {
        id: 'cat-voice',
        name: 'Voice Rooms',
        channels: [
          { id: 'ch-voice-1', name: 'Voice Room 1', type: 'voice', listenerCount: '19K People in' },
          { id: 'ch-voice-2', name: 'Voice Room 2', type: 'voice', listenerCount: '5K People in' },
        ],
      },
    ],
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    creatorName: 'Mojang',
    description: 'Official Minecraft community for builders and adventurers.',
    memberCount: '500K members',
    isOfficial: true,
    iconUrl: 'https://images.unsplash.com/photo-1627856013091-fed6e4e30025?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'mc-general',
        name: 'General',
        channels: [
          { id: 'mc-rules', name: 'rules', type: 'text' },
          { id: 'mc-chat', name: 'general-chat', type: 'text' },
          { id: 'mc-builds', name: 'showcase-builds', type: 'text' },
        ],
      },
      {
        id: 'mc-voice',
        name: 'Voice',
        channels: [
          { id: 'mc-v1', name: 'Survival Lobby', type: 'voice', listenerCount: '1.2K People in' },
        ],
      },
    ],
  },
  {
    id: 'roblox',
    name: 'Roblox',
    creatorName: 'Roblox',
    description: 'Official Roblox creators and developers hangout.',
    memberCount: '11.2M members',
    isOfficial: true,
    iconUrl: 'https://images.unsplash.com/photo-1579373903781-fd5c0c30c4cd?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'rb-main',
        name: 'Main',
        channels: [
          { id: 'rb-chat', name: 'general', type: 'text' },
          { id: 'rb-games', name: 'game-recommendations', type: 'text' },
        ],
      },
    ],
  },
  {
    id: 'mcpedl',
    name: 'MCPedl',
    creatorName: 'MCPedl Team',
    description: 'Minecraft Bedrock mods, textures and addon hub.',
    memberCount: '89.3K members',
    isOfficial: true,
    iconUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'mcp-main',
        name: 'Addons',
        channels: [
          { id: 'mcp-chat', name: 'addons-chat', type: 'text' },
          { id: 'mcp-releases', name: 'new-releases', type: 'text' },
        ],
      },
    ],
  },
  {
    id: 'ishowspeed',
    name: 'IShowSpeed Hub',
    creatorName: 'Speed',
    description: 'Live streams, reactions and hype community!',
    memberCount: '24.9M members',
    isOfficial: true,
    iconUrl: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'spd-main',
        name: 'Lobby',
        channels: [
          { id: 'spd-chat', name: 'hype-chat', type: 'text' },
        ],
      },
    ],
  },
  {
    id: 'steak-kitchen',
    name: 'Steak Kitchen',
    creatorName: 'Steak & Co',
    description: 'Gaming clips, highlights and community cooking.',
    memberCount: '100.7M members',
    iconUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=150&auto=format&fit=crop&q=80',
    bannerUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format&fit=crop&q=80',
    categories: [
      {
        id: 'stk-main',
        name: 'Community',
        channels: [
          { id: 'stk-chat', name: 'kitchen-chat', type: 'text' },
        ],
      },
    ],
  },
];

export default function Servers({ onBack, onOpenChat, onOpenProfile }: ServersProps) {
  const drive = useDriveStore();
  const uid = auth.currentUser?.uid;

  // Servers State
  const [createdServers, setCreatedServers] = useState<ServerData[]>(() => {
    try {
      const saved = localStorage.getItem('shinzi_created_servers');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [joinedServers, setJoinedServers] = useState<ServerData[]>(() => {
    try {
      const saved = localStorage.getItem('shinzi_joined_servers');
      return saved ? JSON.parse(saved) : DEFAULT_JOINED_SERVERS;
    } catch {
      return DEFAULT_JOINED_SERVERS;
    }
  });

  // Navigation / Modal States
  const [activeServer, setActiveServer] = useState<ServerData | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ServerChannel | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Search Screen State
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(['Roblox', 'Minecraft', 'Shinzi Hub']);

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

  const handleJoinServer = (srv: ServerData) => {
    setJoinedServers((prev) => {
      if (prev.some((s) => s.id === srv.id)) return prev;
      const updated = [srv, ...prev];
      try {
        localStorage.setItem('shinzi_joined_servers', JSON.stringify(updated));
      } catch {
        // ignore storage errors
      }
      return updated;
    });
  };

  // Load created servers from Firestore
  useEffect(() => {
    if (!uid) return;
    const fetchServers = async () => {
      try {
        const q = query(collection(db, 'servers'), where('ownerId', '==', uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const list: ServerData[] = snap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }));
          setCreatedServers(list);
          localStorage.setItem('shinzi_created_servers', JSON.stringify(list));
        }
      } catch (err) {
        console.warn('Could not load servers from Firestore:', err);
      }
    };
    void fetchServers();
  }, [uid]);

  // Handle avatar upload
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setFormAvatarPreview(localUrl);

    // Upload to Drive folder 'server' if configured
    try {
      if (drive.hasActiveSession && drive.uploadFile) {
        const res = await drive.uploadFile({
          file,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          folderType: 'server',
        });
        if (res?.fileId) {
          await drive.makeFilePublic(res.fileId);
          setFormAvatarPreview(`https://lh3.googleusercontent.com/d/${res.fileId}=s1600`);
        }
      }
    } catch (err) {
      console.warn('Failed to upload server avatar to Drive:', err);
    }
  };

  // Handle banner upload
  const handleBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setFormBannerPreview(localUrl);

    try {
      if (drive.hasActiveSession && drive.uploadFile) {
        const res = await drive.uploadFile({
          file,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          folderType: 'server',
        });
        if (res?.fileId) {
          await drive.makeFilePublic(res.fileId);
          setFormBannerPreview(`https://lh3.googleusercontent.com/d/${res.fileId}=s1600`);
        }
      }
    } catch (err) {
      console.warn('Failed to upload server banner to Drive:', err);
    }
  };

  // Create Server Action
  const handleCreateServer = async () => {
    if (!formName.trim() || createBusy) return;
    setCreateBusy(true);

    const newServerId = `server-${Date.now()}`;
    const newServer: ServerData = {
      id: newServerId,
      name: formName.trim(),
      creatorName: auth.currentUser?.displayName || 'You',
      description: formDesc.trim() || 'A new Shinzi community server.',
      iconUrl: formAvatarPreview || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150',
      bannerUrl: formBannerPreview || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800',
      memberCount: '1 member',
      isOfficial: false,
      isCreatedByMe: true,
      isPrivate: formIsPrivate,
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
          channels: [
            { id: `ch-sugg-${Date.now()}`, name: 'suggestions', type: 'text' },
          ],
        },
        {
          id: `cat-voice-${Date.now()}`,
          name: 'Voice Rooms',
          channels: [
            { id: `ch-v1-${Date.now()}`, name: 'Voice Room 1', type: 'voice', listenerCount: '0 People in' },
          ],
        },
        {
          id: `cat-logs-${Date.now()}`,
          name: 'Logs',
          channels: [
            { id: `ch-logs-${Date.now()}`, name: 'logs', type: 'text', isPrivate: true },
          ],
        },
      ],
    };

    try {
      if (uid) {
        await setDoc(doc(db, 'servers', newServerId), {
          ...newServer,
          ownerId: uid,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn('Firestore server write fallback:', err);
    }

    const updated = [newServer, ...createdServers];
    setCreatedServers(updated);
    localStorage.setItem('shinzi_created_servers', JSON.stringify(updated));

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

  // Toggle Category Collapse
  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  // Filtered servers for search
  const allServers = [...createdServers, ...joinedServers];
  const searchResults = searchQuery.trim()
    ? allServers.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.creatorName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase())
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
                  const match = allServers.find((s) => s.name.toLowerCase() === rec.toLowerCase()) || allServers[0];
                  return (
                    <div
                      key={rec}
                      className="sh-search-result-card"
                      style={{ backgroundImage: `url(${match.bannerUrl})` }}
                      onClick={() => {
                        handleJoinServer(match);
                        setActiveServer(match);
                        setSelectedChannel(match.categories[0]?.channels[0]);
                        setShowSearchModal(false);
                      }}
                    >
                      <div className="sh-search-result-overlay" />
                      <div className="sh-search-result-body">
                        <img
                          src={match.iconUrl}
                          alt={match.name}
                          className="sh-search-result-avatar"
                        />
                        <div className="sh-search-result-info">
                          <span className="sh-search-result-name">{match.name}</span>
                          <span className="sh-search-result-creator">by {match.creatorName || 'Roblox'}</span>
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
                  style={{ backgroundImage: `url(${srv.bannerUrl})` }}
                  onClick={() => {
                    handleJoinServer(srv);
                    setRecentSearches((prev) => Array.from(new Set([srv.name, ...prev])).slice(0, 5));
                    setActiveServer(srv);
                    setSelectedChannel(srv.categories[0]?.channels[0]);
                    setShowSearchModal(false);
                  }}
                >
                  <div className="sh-search-result-overlay" />
                  <div className="sh-search-result-body">
                    <img
                      src={srv.iconUrl}
                      alt={srv.name}
                      className="sh-search-result-avatar"
                    />
                    <div className="sh-search-result-info">
                      <span className="sh-search-result-name">{srv.name}</span>
                      <span className="sh-search-result-creator">by {srv.creatorName || 'Shinzi'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sh-servers-empty">
              <Search size={32} color="#636b75" />
              <div className="sh-servers-empty-title">No Results</div>
              <div className="sh-servers-empty-desc">We couldn't find any server matching "{searchQuery}".</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================
  // RENDER: FULL SERVER DETAILS VIEW (20261109_223029)
  // ==========================================================
  if (showDetailsModal && activeServer) {
    return (
      <div className="sh-server-details-page">
        <div
          className="sh-server-details-banner"
          style={{ backgroundImage: `url(${activeServer.bannerUrl})` }}
        >
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
            <img
              src={activeServer.iconUrl}
              alt={activeServer.name}
              className="sh-server-details-avatar"
            />
          </div>

          <div className="sh-server-details-title-row">
            <h1 className="sh-server-details-title">{activeServer.name}</h1>
            {activeServer.isOfficial && <CheckCircle2 size={20} color="#5865F2" fill="#5865F2" />}
          </div>

          <p className="sh-server-details-desc">
            {activeServer.description || 'This is the 1st server of the Shinzi hub by the way.'}
          </p>

          <div className="sh-server-details-stats">
            {activeServer.memberCount} • {activeServer.isOfficial ? 'official • ' : ''} {activeServer.onlineCount || '10,900 online'}
          </div>

          <div className="sh-server-details-mutual">
            <User size={16} />
            <span>6 friends are mutual</span>
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
              onClick={() => alert('Notifications updated')}
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

            <button
              type="button"
              className="sh-server-menu-item sh-server-menu-danger"
              onClick={() => {
                if (confirm('Are you sure you want to block this server?')) {
                  setShowDetailsModal(false);
                  setActiveServer(null);
                }
              }}
            >
              <span>Block server</span>
              <Ban size={18} color="#ff4b4b" />
            </button>

            <button
              type="button"
              className="sh-server-menu-item sh-server-menu-danger"
              onClick={() => {
                if (confirm('Leave this server?')) {
                  setShowDetailsModal(false);
                  setActiveServer(null);
                }
              }}
            >
              <span>Leave server</span>
              <LogOut size={18} color="#ff4b4b" />
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
        <div
          className="sh-server-banner-header"
          style={{ backgroundImage: `url(${activeServer.bannerUrl})` }}
        >
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
              <img
                src={activeServer.iconUrl}
                alt={activeServer.name}
                className="sh-server-header-avatar"
              />
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

            {/* 4 Header Actions from sketch: Event, Invite, Search, > */}
            <div className="sh-server-header-actions">
              <button
                type="button"
                className="sh-servers-icon-btn"
                title="Events"
                onClick={() => alert('Server events')}
              >
                <Calendar size={18} />
              </button>

              <button
                type="button"
                className="sh-servers-icon-btn"
                title="Invite People"
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

        {/* Categories and Channels List */}
        <div className="sh-server-channels-content">
          {activeServer.categories.map((cat) => {
            const isCollapsed = collapsedCategories[cat.id];
            return (
              <div key={cat.id} className="sh-category-group">
                <div
                  className="sh-category-header"
                  onClick={() => toggleCategory(cat.id)}
                >
                  <span>{cat.name}</span>
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
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
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#949ba4' }}>
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
                    navigator.clipboard?.writeText(window.location.origin + `/servers?invite=${activeServer.id}`);
                    setInviteCopied(true);
                    setTimeout(() => setInviteCopied(false), 2000);
                  }}
                >
                  <div className="sh-invite-share-icon">
                    {inviteCopied ? <Check size={22} color="#5865F2" /> : <Copy size={22} />}
                  </div>
                  <span className="sh-invite-share-label">{inviteCopied ? 'Copied!' : 'Copy Link'}</span>
                </button>

                <button
                  type="button"
                  className="sh-invite-share-item"
                  onClick={() => alert('Select friends to send invite')}
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
                    const text = encodeURIComponent(`Join my server ${activeServer.name} on Shinzi: ${window.location.origin}/servers?invite=${activeServer.id}`);
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
                  <option value="# chat"># chat</option>
                  <option value="# welcome"># welcome</option>
                  <option value="# chill-chat"># chill-chat</option>
                </select>
              </div>

              {/* Expiry Dropdown */}
              <div className="sh-invite-field">
                <label>Expiry</label>
                <select
                  className="sh-invite-select"
                  value={inviteExpiry}
                  onChange={(e) => setInviteExpiry(e.target.value)}
                >
                  <option value="Never ∞">Never ∞</option>
                  <option value="24 Hours">24 Hours</option>
                  <option value="1 Week">1 Week</option>
                  <option value="1 Month">1 Month</option>
                  <option value="12 Month">12 Month</option>
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
  // RENDER: MAIN SERVERS DASHBOARD (20261109_222440 & 222405)
  // ==========================================================
  return (
    <div className="sh-servers-page">
      {/* Top Bar with + and Q (NO 3-dots menu per user request) */}
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
                  style={{ backgroundImage: `url(${srv.bannerUrl})` }}
                  onClick={() => {
                    setActiveServer(srv);
                    setSelectedChannel(srv.categories[0]?.channels[0]);
                  }}
                >
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
              <div className="sh-servers-empty-desc">Tap the + button to create your own community server!</div>
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
                  style={{ backgroundImage: `url(${srv.bannerUrl})` }}
                  onClick={() => {
                    setActiveServer(srv);
                    setSelectedChannel(srv.categories[0]?.channels[0]);
                  }}
                >
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
              <div className="sh-servers-empty-title">No joined servers</div>
              <div className="sh-servers-empty-desc">Search and discover exciting servers to join!</div>
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
                style={formBannerPreview ? { backgroundImage: `url(${formBannerPreview})` } : {}}
                onClick={() => bannerInputRef.current?.click()}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#ffffff' }}>
                  image
                </span>
                <span className="sh-create-thumbnail-label">
                  {formBannerPreview ? 'Change Thumbnail / Banner' : 'Server Thumbnail / Banner'}
                </span>
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
                  style={formAvatarPreview ? { backgroundImage: `url(${formAvatarPreview})` } : {}}
                  onClick={() => avatarInputRef.current?.click()}
                  title="Upload Server Profile (Image / GIF)"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#ffffff' }}>
                    account_circle
                  </span>
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
                <label className="sh-create-label">Server Description</label>
                <textarea
                  className="sh-create-textarea"
                  placeholder="What is your server about?"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>

              {/* Private Server Toggle */}
              <div className="sh-create-toggle-row">
                <div className="sh-create-toggle-text">
                  <span className="sh-create-toggle-title">Private Server</span>
                  <span className="sh-create-toggle-desc">You can change settings any time</span>
                </div>
                <button
                  type="button"
                  className={`sh-settings-toggle ${formIsPrivate ? 'sh-settings-toggle-on' : ''}`}
                  onClick={() => setFormIsPrivate(!formIsPrivate)}
                  role="switch"
                  aria-checked={formIsPrivate}
                >
                  <span className="sh-settings-toggle-knob" />
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                className="sh-create-submit-btn"
                disabled={!formName.trim() || createBusy}
                onClick={handleCreateServer}
              >
                {createBusy ? 'Creating…' : 'Create Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation matching Shinzi Chat */}
      <nav className="shc-bottom" aria-label="Main navigation">
        <button
          type="button"
          onClick={() => {
            if (onOpenChat) onOpenChat();
            else window.location.href = '/chat';
          }}
          aria-label="AI"
        >
          <Sparkles size={22} />
        </button>

        <button
          type="button"
          className="shc-bottom-active"
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
          <MessageCircle size={23} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (onOpenProfile) onOpenProfile();
            else window.location.href = '/profile';
          }}
          aria-label="Profile"
        >
          <User size={23} />
        </button>
      </nav>
    </div>
  );
}
