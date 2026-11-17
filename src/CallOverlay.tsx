import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Smartphone,
  Headphones,
  ChevronDown,
  UserPlus,
  ScreenShare,
  RefreshCw,
  ArrowLeft,
  Check,
} from 'lucide-react';
import { callEngine, type CallSession } from './callService';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import './CallOverlay.css';

interface CallOverlayProps {
  currentUid: string;
  currentProfile: any;
  onOpenAddUser?: () => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  currentUid,
  currentProfile,
  onOpenAddUser,
}) => {
  const [call, setCall] = useState<CallSession | null>(null);
  const [minimized, setMinimized] = useState<boolean>(false);
  const [fullscreenScreenShare, setFullscreenScreenShare] = useState<boolean>(false);
  const isCaller = call?.callerId === currentUid;

  // Audio & video stream states
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Live speaking volume levels: 0 (none), 1 (soft), 2 (medium), 3 (high), 4 (loud)
  const [localSpeakingLevel, setLocalSpeakingLevel] = useState<number>(0);
  const [remoteSpeakingLevel, setRemoteSpeakingLevel] = useState<number>(0);

  // Call duration counter
  const [durationSeconds, setDurationSeconds] = useState<number>(0);

  // Mute / Deafened states
  const [isSelfMuted, setIsSelfMuted] = useState<boolean>(false);
  const [isDeafened, setIsDeafened] = useState<boolean>(false);

  // Camera facing mode
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Audio output popup
  const [showAudioPopup, setShowAudioPopup] = useState<boolean>(false);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<'speaker' | 'mobile' | 'device'>('mobile');
  const [hasBluetoothDevice, setHasBluetoothDevice] = useState<boolean>(false);

  // Draggable floating box coordinates
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number }>({
    x: typeof window !== 'undefined' ? window.innerWidth - 108 : 260,
    y: 80,
  });
  const isDraggingRef = useRef<boolean>(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Video element refs
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Subscribe to call engine events
  useEffect(() => {
    callEngine.onCallStateChange = (newCall) => {
      setCall(newCall ? { ...newCall } : null);
      if (!newCall) {
        setMinimized(false);
        setFullscreenScreenShare(false);
        setDurationSeconds(0);
        setIsSelfMuted(false);
        setIsDeafened(false);
      }
    };

    callEngine.onLocalStreamReady = (s) => setLocalStream(s);
    callEngine.onRemoteStreamReady = (s) => setRemoteStream(s);
    callEngine.onScreenStreamReady = (s) => setScreenStream(s);
    callEngine.onSpeakingLevelChange = (lLevel, rLevel) => {
      setLocalSpeakingLevel(lLevel);
      setRemoteSpeakingLevel(rLevel);
    };

    return () => {
      callEngine.onCallStateChange = null;
      callEngine.onLocalStreamReady = null;
      callEngine.onRemoteStreamReady = null;
      callEngine.onScreenStreamReady = null;
      callEngine.onSpeakingLevelChange = null;
    };
  }, []);

  // Listen for Incoming Calls across all user conversations
  useEffect(() => {
    if (!currentUid) return;
    const q = query(
      collection(db, 'conversations'),
      where('memberIds', 'array-contains', currentUid)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const incomingCall = data.activeCall as CallSession | undefined;
          if (
            incomingCall &&
            incomingCall.status === 'ringing' &&
            incomingCall.receiverId === currentUid
          ) {
            if (!callEngine.activeCall || callEngine.activeCall.id !== incomingCall.id) {
              callEngine.activeCall = incomingCall;
              callEngine.isCaller = false;
              callEngine.playRingtone('incoming');
              setCall({ ...incomingCall });
              callEngine.listenToCall(incomingCall.id, incomingCall.convId);
            }
          }
        });
      },
      (err) => {
        console.warn('[CallOverlay] Conversation incoming call listener error:', err);
      }
    );
    return () => unsubscribe();
  }, [currentUid]);

  // Deep Link & Native Wake-up Call Intent listener
  useEffect(() => {
    // 1. Check window.location query on immediate startup
    try {
      const sp = new URLSearchParams(window.location.search);
      const urlCallId = sp.get('id');
      const urlConvId = sp.get('conv');
      const urlCaller = sp.get('caller');
      const urlAvatar = sp.get('avatar');
      const urlType = (sp.get('type') || 'voice') as 'voice' | 'video';

      if (urlCallId && (!call || call.id !== urlCallId)) {
        const immediateCall: CallSession = {
          id: urlCallId,
          convId: urlConvId || 'default',
          callerId: 'remote',
          callerName: urlCaller || 'Incoming Call',
          callerPhotoURL: urlAvatar || '/icon-192.png',
          receiverId: currentUid || 'self',
          receiverName: currentProfile?.displayName || 'You',
          receiverPhotoURL: currentProfile?.photoURL || '/icon-192.png',
          type: urlType,
          status: 'ringing',
          startedAt: Date.now(),
        };
        callEngine.activeCall = immediateCall;
        callEngine.isCaller = false;
        callEngine.playRingtone('incoming');
        setCall(immediateCall);
        callEngine.listenToCall(urlCallId, urlConvId || undefined);
      }
    } catch {}

    // 2. Query pending native call if app was woken up from killed / locked state
    try {
      const cap = (window as any).Capacitor;
      if (typeof cap?.Plugins?.ShinziNotification?.getPendingCall === 'function') {
        cap.Plugins.ShinziNotification.getPendingCall().then((res: any) => {
          if (res?.callId) {
            window.dispatchEvent(new CustomEvent('shinzi:incomingCall', { detail: res }));
          }
        }).catch(() => {});
      }
    } catch {}

    const handleIncomingCallEvent = async (e: any) => {
      const { callId, convId, caller, avatar, type } = e.detail || {};
      if (callId && (!call || call.id !== callId)) {
        const immediateCall: CallSession = {
          id: callId,
          convId: convId || 'default',
          callerId: 'remote',
          callerName: caller || 'Incoming Call',
          callerPhotoURL: avatar || '/icon-192.png',
          receiverId: currentUid || 'self',
          receiverName: currentProfile?.displayName || 'You',
          receiverPhotoURL: currentProfile?.photoURL || '/icon-192.png',
          type: type || 'voice',
          status: 'ringing',
          startedAt: Date.now(),
        };
        callEngine.activeCall = immediateCall;
        callEngine.isCaller = false;
        callEngine.playRingtone('incoming');
        setCall(immediateCall);
        callEngine.listenToCall(callId, convId || undefined);

        try {
          const callSnap = await getDoc(doc(db, 'calls', callId));
          if (callSnap.exists()) {
            const data = callSnap.data() as CallSession;
            if (data.status === 'ringing') {
              callEngine.activeCall = data;
              callEngine.isCaller = data.callerId === currentUid;
              if (!callEngine.isCaller) {
                callEngine.playRingtone('incoming');
              }
              setCall({ ...data });
              callEngine.listenToCall(callId, convId || data.convId);
            } else {
              setCall(null);
              callEngine.cleanup();
            }
          } else {
            setCall(null);
            callEngine.cleanup();
          }
        } catch {}
      }
    };
    window.addEventListener('shinzi:incomingCall', handleIncomingCallEvent);
    return () => window.removeEventListener('shinzi:incomingCall', handleIncomingCallEvent);
  }, [currentUid, call, currentProfile]);

  // Sync Native Ongoing Notification in Android StatusBar
  useEffect(() => {
    const cap = (window as any).Capacitor;
    if (!cap?.Plugins?.ShinziNotification) return;

    if (call && (call.status === 'connected' || call.status === 'ringing')) {
      const isIncoming = call.status === 'ringing' && !isCaller;
      const callerTitle = isCaller ? (call.receiverName || 'Friend') : (call.callerName || 'Friend');
      if (typeof cap?.Plugins?.ShinziNotification?.showCallNotification === 'function') {
        void cap.Plugins.ShinziNotification.showCallNotification({
          callerName: callerTitle,
          callId: call.id,
          convId: call.convId,
          callType: call.type,
          isConnected: call.status === 'connected',
          isIncoming,
          isMuted: isSelfMuted,
          isDeafened: isDeafened,
        }).catch(() => {});
      }
    } else {
      if (typeof cap?.Plugins?.ShinziNotification?.clearCallNotification === 'function') {
        void cap.Plugins.ShinziNotification.clearCallNotification().catch(() => {});
      }
    }
  }, [call?.status, isSelfMuted, isDeafened, isCaller, call?.receiverName, call?.callerName, call?.id, call?.convId, call?.type]);

  // Native notification actions listener (Pickup, Decline, Hangup, Self Mute, Mute Sound)
  useEffect(() => {
    const cap = (window as any).Capacitor;
    if (typeof cap?.Plugins?.ShinziNotification?.addListener !== 'function') return;

    const handle = cap.Plugins.ShinziNotification.addListener(
      'onCallAction',
      (data: { action: string; callId: string }) => {
        if (!data?.action) return;
        if (data.action === 'hangup' || data.action === 'decline') {
          void callEngine.endCall();
        } else if (data.action === 'pickup') {
          if (call && !isCaller && call.status === 'ringing') {
            void callEngine.answerCall(call);
          }
        } else if (data.action === 'self_mute') {
          void callEngine.toggleMute().then((muted) => setIsSelfMuted(muted));
        } else if (data.action === 'mute_sound') {
          void callEngine.toggleDeafen().then((deafened) => setIsDeafened(deafened));
        }
      }
    );

    return () => {
      if (handle && typeof handle.remove === 'function') handle.remove();
    };
  }, [call, isCaller]);

  // Duration timer for connected calls
  useEffect(() => {
    if (call?.status === 'connected') {
      const timer = setInterval(() => {
        setDurationSeconds((sec) => sec + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
    setDurationSeconds(0);
  }, [call?.status]);

  // Check for connected Bluetooth / Headset devices
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const hasExternal = devices.some(
          (d) =>
            d.kind === 'audiooutput' &&
            (d.label.toLowerCase().includes('bluetooth') ||
              d.label.toLowerCase().includes('headset') ||
              d.label.toLowerCase().includes('headphones'))
        );
        setHasBluetoothDevice(hasExternal);
      }).catch(() => {});
    }
  }, [showAudioPopup]);

  // Bind media streams to HTML video elements
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, call?.callerVideoOn, call?.receiverVideoOn]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, call?.callerVideoOn, call?.receiverVideoOn]);

  useEffect(() => {
    if (screenShareVideoRef.current && (screenStream || remoteStream)) {
      const activeScreen = screenStream || remoteStream;
      screenShareVideoRef.current.srcObject = activeScreen;
    }
  }, [screenStream, remoteStream, call?.callerScreenSharing, call?.receiverScreenSharing]);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  // Format Duration 00:00
  const durationText = useMemo(() => {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [durationSeconds]);

  // Identify roles
  const isIncoming = call?.status === 'ringing' && !isCaller;
  const isOutgoingRinging = call?.status === 'ringing' && isCaller;

  const oppositeName = isCaller ? call?.receiverName : call?.callerName;
  const oppositeAvatar = isCaller ? call?.receiverPhotoURL : call?.callerPhotoURL;

  const myName = currentProfile?.displayName || currentProfile?.username || 'You';
  const myAvatar = currentProfile?.photoURL || '/icon-192.png';

  // Video and screen sharing status flags
  const isOppositeVideoOn = isCaller ? Boolean(call?.receiverVideoOn) : Boolean(call?.callerVideoOn);
  const isMyVideoOn = isCaller ? Boolean(call?.callerVideoOn) : Boolean(call?.receiverVideoOn);

  const isOppositeScreenSharing = isCaller ? Boolean(call?.receiverScreenSharing) : Boolean(call?.callerScreenSharing);
  const isMyScreenSharing = isCaller ? Boolean(call?.callerScreenSharing) : Boolean(call?.receiverScreenSharing);

  const isOppositeMuted = isCaller ? Boolean(call?.receiverMuted) : Boolean(call?.callerMuted);

  // Audio Route Selector
  const handleSelectAudioOutput = (device: 'speaker' | 'mobile' | 'device') => {
    setSelectedAudioOutput(device);
    setShowAudioPopup(false);
    void callEngine.setAudioOutputDevice(device);
  };

  // Flip Camera
  const handleFlipCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    await callEngine.flipCamera(nextMode);
  };

  // Floating Tile Touch Drag Handlers (VID-20261116-WA0022)
  const onTouchStartFloating = (e: React.TouchEvent | React.MouseEvent) => {
    isDraggingRef.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffsetRef.current = {
      x: clientX - floatingPos.x,
      y: clientY - floatingPos.y,
    };
  };

  const onTouchMoveFloating = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const newX = Math.max(10, Math.min(window.innerWidth - 98, clientX - dragOffsetRef.current.x));
    const newY = Math.max(20, Math.min(window.innerHeight - 98, clientY - dragOffsetRef.current.y));
    setFloatingPos({ x: newX, y: newY });
  };

  const onTouchEndFloating = () => {
    isDraggingRef.current = false;
  };

  // Audio tag for WebRTC voice playback
  const audioNode = (
    <audio
      ref={(el) => {
        remoteAudioRef.current = el;
        if (el && remoteStream) {
          el.srcObject = remoteStream;
          el.play().catch(() => {});
        }
      }}
      autoPlay
      playsInline
      style={{
        position: 'fixed',
        top: -9999,
        left: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );

  if (!call) return audioNode;

  // 1. Fullscreen Incoming Call Screen (20261116_190800)
  if (isIncoming) {
    return (
      <div className="shc-call-overlay" role="dialog" aria-modal="true" aria-label="Incoming call">
        {audioNode}
        <div className="shc-incoming-screen">
          <div className="shc-incoming-top">
            <span className="shc-incoming-title">Incoming Call</span>
            <h1 className="shc-incoming-name">{oppositeName || 'Friend'}</h1>
          </div>

          <div className="shc-incoming-center">
            <div className="shc-incoming-avatar-wrap">
              <img
                src={oppositeAvatar || '/icon-192.png'}
                alt={oppositeName || 'Caller'}
                className="shc-incoming-avatar-img"
              />
            </div>
          </div>

          <div className="shc-incoming-actions">
            {/* Green Pick Up Button (Left) */}
            <button
              type="button"
              className="shc-incoming-btn shc-incoming-pickup"
              onClick={() => void callEngine.answerCall(call)}
              title="Pick up"
              aria-label="Pick up call"
            >
              <Phone size={32} />
            </button>

            {/* Red Decline Button (Right) */}
            <button
              type="button"
              className="shc-incoming-btn shc-incoming-decline"
              onClick={() => void callEngine.endCall()}
              title="Decline"
              aria-label="Decline call"
            >
              <PhoneOff size={32} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Draggable In-App Floating Box (20261116_191720, VID-20261116-WA0022)
  const isRemoteSpeaking = remoteSpeakingLevel > 0;
  const isMeSpeaking = localSpeakingLevel > 0;
  const activeSpeakerAvatar = isRemoteSpeaking ? oppositeAvatar : myAvatar;
  const activeSpeakerName = isRemoteSpeaking ? oppositeName : myName;

  const floatingCard = minimized ? (
    <div
      className="shc-floating-tile"
      style={{ left: floatingPos.x, top: floatingPos.y }}
      onTouchStart={onTouchStartFloating}
      onTouchMove={onTouchMoveFloating}
      onTouchEnd={onTouchEndFloating}
      onMouseDown={onTouchStartFloating}
      onMouseMove={onTouchMoveFloating}
      onMouseUp={onTouchEndFloating}
      onClick={() => setMinimized(false)}
      role="button"
      tabIndex={0}
      title="Tap to expand call"
      aria-label="Expand call"
    >
      <img
        src={activeSpeakerAvatar || '/icon-192.png'}
        alt={activeSpeakerName || 'User'}
        className="shc-floating-avatar"
      />
      <span className="shc-floating-name">{activeSpeakerName || 'Call'}</span>

      {/* Voice Wave Indicator on floating box */}
      {(isRemoteSpeaking || isMeSpeaking) && (
        <div className="shc-voice-wave shc-wave-1" />
      )}
    </div>
  ) : null;

  // 3. Fullscreen Screen Share Expander (20261116_194940)
  if (fullscreenScreenShare && isOppositeScreenSharing) {
    return (
      <div className="shc-fullscreen-screen-view">
        {audioNode}
        <div className="shc-fullscreen-topbar">
          <button
            type="button"
            className="shc-call-icon-btn"
            onClick={() => setFullscreenScreenShare(false)}
            aria-label="Back to call"
          >
            <ArrowLeft size={24} />
          </button>
          <span style={{ marginLeft: 12, fontWeight: 600 }}>
            {oppositeName}'s Screen
          </span>
        </div>
        <video
          ref={screenShareVideoRef}
          autoPlay
          playsInline
          className="shc-fullscreen-video"
        />
      </div>
    );
  }

  // 4. Main Active Call Screen (20261116_190713, IMG-20261116-WA0021)
  return (
    <>
      {floatingCard}
      <div
        className="shc-call-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Active call"
        style={{ display: minimized ? 'none' : 'flex' }}
      >
        {audioNode}
        <div className="shc-active-screen">
        {/* Top Bar */}
        <div className="shc-call-topbar">
          <button
            type="button"
            className="shc-call-icon-btn"
            onClick={() => setMinimized(true)}
            title="Minimize to floating window"
            aria-label="Minimize call"
          >
            <ChevronDown size={28} />
          </button>

          <div className="shc-call-info-pill">
            <span>{oppositeName || 'Direct Call'}</span>
            <span className="shc-call-timer">
              {isOutgoingRinging ? 'Ringing...' : durationText}
            </span>
          </div>

          <button
            type="button"
            className="shc-call-icon-btn"
            onClick={() => onOpenAddUser?.()}
            title="Add user to call"
            aria-label="Add user to call"
          >
            <UserPlus size={22} />
          </button>
        </div>

        {/* Split Participant Grid */}
        <div className="shc-call-grid">
          {/* Top Tile: Opposite User */}
          <div
            className={`shc-participant-tile ${remoteSpeakingLevel > 0 ? 'speaking' : ''} ${
              isOppositeScreenSharing ? 'screen-active' : ''
            }`}
            onClick={() => {
              if (isOppositeScreenSharing) {
                setFullscreenScreenShare(true);
              }
            }}
          >
            {isOppositeScreenSharing ? (
              // Live Shared Screen
              <>
                <video
                  ref={(el) => {
                    screenShareVideoRef.current = el;
                    if (el && (screenStream || remoteStream)) {
                      el.srcObject = screenStream || remoteStream;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="shc-video-feed"
                />
                <span className="shc-screen-expand-hint">Tap to expand full screen</span>
              </>
            ) : isOppositeVideoOn ? (
              // 1080p Video Feed
              <video
                ref={(el) => {
                  remoteVideoRef.current = el;
                  if (el && remoteStream) {
                    el.srcObject = remoteStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                className="shc-video-feed"
              />
            ) : (
              // Voice Avatar + Animated GIF + Waves (20261116_190719)
              <div className="shc-avatar-wave-container">
                <img
                  src={oppositeAvatar || '/icon-192.png'}
                  alt={oppositeName || 'User'}
                  className="shc-participant-avatar"
                />

                {/* Ringing Phone badge if opposite user hasn't picked up (20261116_190741) */}
                {isOutgoingRinging && (
                  <div className="shc-ringing-badge" title="Ringing...">
                    <PhoneCall size={18} />
                  </div>
                )}

                {/* 4-Level Dynamic Sound Waves */}
                {remoteSpeakingLevel >= 1 && <div className="shc-voice-wave shc-wave-1" />}
                {remoteSpeakingLevel >= 2 && <div className="shc-voice-wave shc-wave-2" />}
                {remoteSpeakingLevel >= 3 && <div className="shc-voice-wave shc-wave-3" />}
                {remoteSpeakingLevel >= 4 && <div className="shc-voice-wave shc-wave-4" />}

                {/* Mute Badge if opposite user is muted */}
                {isOppositeMuted && (
                  <div className="shc-muted-badge" title="Muted">
                    <MicOff size={15} />
                  </div>
                )}
              </div>
            )}

            <div className="shc-participant-name-pill">
              <span>{oppositeName || 'Friend'}</span>
            </div>
          </div>

          {/* Bottom Tile: Current User (Red King) */}
          <div
            className={`shc-participant-tile ${localSpeakingLevel > 0 ? 'speaking' : ''}`}
          >
            {isMyScreenSharing ? (
              // Sharing Screen Notice (20261116_194418)
              <div className="shc-screen-sharing-box">
                <ScreenShare size={48} className="shc-screen-share-icon" />
                <span style={{ fontSize: 16, fontWeight: 600 }}>You are sharing screen</span>
              </div>
            ) : isMyVideoOn ? (
              // Self Camera 1080p Preview
              <video
                ref={(el) => {
                  localVideoRef.current = el;
                  if (el && localStream) {
                    el.srcObject = localStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                className="shc-video-feed"
              />
            ) : (
              // Voice Avatar + Waves
              <div className="shc-avatar-wave-container">
                <img
                  src={myAvatar}
                  alt={myName}
                  className="shc-participant-avatar"
                />

                {/* 4-Level Sound Waves for Me */}
                {localSpeakingLevel >= 1 && <div className="shc-voice-wave shc-wave-1" />}
                {localSpeakingLevel >= 2 && <div className="shc-voice-wave shc-wave-2" />}
                {localSpeakingLevel >= 3 && <div className="shc-voice-wave shc-wave-3" />}
                {localSpeakingLevel >= 4 && <div className="shc-voice-wave shc-wave-4" />}

                {/* Muted Badge */}
                {isSelfMuted && (
                  <div className="shc-muted-badge" title="Muted">
                    <MicOff size={15} />
                  </div>
                )}
              </div>
            )}

            <div className="shc-participant-name-pill">
              {isSelfMuted && <MicOff size={14} color="#da373c" />}
              <span>{myName}</span>
            </div>
          </div>
        </div>

        {/* Audio Output Route Popup Menu (20261116_190728) */}
        {showAudioPopup && (
          <div className="shc-audio-popup">
            <button
              type="button"
              className={`shc-audio-item ${selectedAudioOutput === 'speaker' ? 'selected' : ''}`}
              onClick={() => handleSelectAudioOutput('speaker')}
            >
              <div className="shc-audio-left">
                <Volume2 size={18} />
                <span>Speaker</span>
              </div>
              {selectedAudioOutput === 'speaker' && <Check size={16} className="shc-check-icon" />}
            </button>

            <button
              type="button"
              className={`shc-audio-item ${selectedAudioOutput === 'mobile' ? 'selected' : ''}`}
              onClick={() => handleSelectAudioOutput('mobile')}
            >
              <div className="shc-audio-left">
                <Smartphone size={18} />
                <span>Mobile</span>
              </div>
              {selectedAudioOutput === 'mobile' && <Check size={16} className="shc-check-icon" />}
            </button>

            {hasBluetoothDevice && (
              <button
                type="button"
                className={`shc-audio-item ${selectedAudioOutput === 'device' ? 'selected' : ''}`}
                onClick={() => handleSelectAudioOutput('device')}
              >
                <div className="shc-audio-left">
                  <Headphones size={18} />
                  <span>Device</span>
                </div>
                {selectedAudioOutput === 'device' && <Check size={16} className="shc-check-icon" />}
              </button>
            )}
          </div>
        )}

        {/* Bottom Control Bar */}
        <div className="shc-call-bottom-bar">
          {/* 1. Video Toggle / Camera Flip in video mode */}
          {isMyVideoOn ? (
            <button
              type="button"
              className="shc-control-btn active"
              onClick={handleFlipCamera}
              title="Flip Camera"
              aria-label="Flip camera front/back"
            >
              <RefreshCw size={22} />
            </button>
          ) : (
            <button
              type="button"
              className="shc-control-btn"
              onClick={() => void callEngine.toggleVideo()}
              title="Turn on Camera"
              aria-label="Turn on camera"
            >
              <Video size={22} />
            </button>
          )}

          {/* 2. Microphone Mute Toggle */}
          <button
            type="button"
            className={`shc-control-btn ${isSelfMuted ? 'danger-on' : ''}`}
            onClick={async () => {
              const muted = await callEngine.toggleMute();
              setIsSelfMuted(muted);
            }}
            title={isSelfMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-label="Toggle microphone"
          >
            {isSelfMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          {/* 3. Speaker / Audio Route Selector (20261116_190728) */}
          <button
            type="button"
            className={`shc-control-btn ${showAudioPopup ? 'active' : ''}`}
            onClick={() => setShowAudioPopup((prev) => !prev)}
            title="Audio Output Device"
            aria-label="Select audio output"
          >
            {isDeafened ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </button>

          {/* 4. Screen Sharing Button or Stop Video / Stop Screen Share Button */}
          {isMyVideoOn ? (
            /* Red Cut Video Call Button (20261116_195539) */
            <button
              type="button"
              className="shc-control-btn danger-on"
              onClick={() => void callEngine.toggleVideo()}
              title="Turn off video (back to voice)"
              aria-label="Turn off video"
            >
              <VideoOff size={24} />
            </button>
          ) : !isMyScreenSharing ? (
            <button
              type="button"
              className="shc-control-btn"
              onClick={() => void callEngine.toggleScreenShare()}
              title="Share Screen"
              aria-label="Start screen share"
            >
              <ScreenShare size={22} />
            </button>
          ) : (
            /* Red Stop Screen Share Button (20261116_190815, 20261116_194418: 4 buttons mode) */
            <button
              type="button"
              className="shc-control-btn stop-share-btn"
              onClick={() => void callEngine.toggleScreenShare()}
              title="Stop sharing screen"
              aria-label="Stop screen share"
            >
              <ScreenShare size={24} />
            </button>
          )}

          {/* 5. End Call Button (Shown when not in 4-button screen-sharing mode) */}
          {!isMyScreenSharing && (
            <button
              type="button"
              className="shc-control-btn end-btn"
              onClick={() => void callEngine.endCall()}
              title="End Call"
              aria-label="End call"
            >
              <PhoneOff size={26} />
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
};

export default CallOverlay;
