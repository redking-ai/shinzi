/**
 * callService.ts
 * Real-time WebRTC 1080p Calling Engine for Shinzi
 * Supports Discord-style voice calls, video calls, screen-sharing,
 * audio level detection (1-4 wave indicators), and audio routing.
 */

import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { sendWebPushToUser } from './pushService';

export interface CallSession {
  id: string;
  convId: string;
  callerId: string;
  callerName: string;
  callerPhotoURL: string;
  receiverId: string;
  receiverName: string;
  receiverPhotoURL: string;
  type: 'voice' | 'video';
  status: 'ringing' | 'connected' | 'ended' | 'declined' | 'busy';
  offer?: any;
  answer?: any;
  callerCandidates?: any[];
  receiverCandidates?: any[];
  callerMuted?: boolean;
  receiverMuted?: boolean;
  callerDeafened?: boolean;
  receiverDeafened?: boolean;
  callerScreenSharing?: boolean;
  receiverScreenSharing?: boolean;
  callerVideoOn?: boolean;
  receiverVideoOn?: boolean;
  startedAt?: any;
  connectedAt?: any;
  endedAt?: any;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443?transport=tcp',
        'turn:standard.relay.metered.ca:80',
        'turn:standard.relay.metered.ca:80?transport=tcp',
        'turn:standard.relay.metered.ca:443',
        'turn:standard.relay.metered.ca:443?transport=tcp',
        'turns:standard.relay.metered.ca:443',
        'turns:standard.relay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};

function enhanceOpusSdp(sdp: string): string {
  if (!sdp) return sdp;
  let enhanced = sdp;
  const m = enhanced.match(/a=rtpmap:(\d+) opus\/48000/);
  if (m) {
    const pt = m[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt} ([^\\r\\n]+)`);
    if (fmtpRegex.test(enhanced)) {
      enhanced = enhanced.replace(fmtpRegex, (_match, params) => {
        const clean = params
          .replace(/;?useinbandfec=\d/, '')
          .replace(/;?stereo=\d/, '')
          .replace(/;?sprop-stereo=\d/, '')
          .replace(/;?maxaveragebitrate=\d+/, '')
          .replace(/;?cbr=\d/, '');
        return `a=fmtp:${pt} ${clean};useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000;cbr=1`;
      });
    } else {
      enhanced = enhanced.replace(
        new RegExp(`(a=rtpmap:${pt} opus\/48000[^\\r\\n]*)`),
        `$1\r\na=fmtp:${pt} useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000;cbr=1`
      );
    }
  }
  return enhanced;
}

class CallEngine {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  public activeCall: CallSession | null = null;
  public isCaller: boolean = false;
  private videoSender: RTCRtpSender | null = null;

  private ringtoneInterval: number | null = null;
  private ringtoneCtx: AudioContext | null = null;
  private ringTimeoutId: number | null = null;
  private screenAnimInterval: any = null;
  private unsubscribeCallDoc: Unsubscribe | null = null;
  private processedCandidates: Set<string> = new Set();
  private candidateQueue: RTCIceCandidateInit[] = [];

  // Audio volume analyzer
  private audioCtx: AudioContext | null = null;
  private animFrameId: number | null = null;
  public localVolumeLevel: number = 0;
  public remoteVolumeLevel: number = 0;

  // UI Event Callbacks
  public onCallStateChange: ((call: CallSession | null) => void) | null = null;
  public onLocalStreamReady: ((stream: MediaStream | null) => void) | null = null;
  public onRemoteStreamReady: ((stream: MediaStream | null) => void) | null = null;
  public onScreenStreamReady: ((stream: MediaStream | null) => void) | null = null;
  public onSpeakingLevelChange: ((localLevel: number, remoteLevel: number) => void) | null = null;

  // Robust UserMedia capture with constraints fallback (prevents OverconstrainedError on Android 11 front camera)
  private async getMediaStreamWithFallback(type: 'voice' | 'video'): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: false, // Disables aggressive noise suppression that clipped voice syllables like "outside raining"
        autoGainControl: true,
        channelCount: 1, // Mono channel uses 50% less bandwidth, preventing packet loss & jitter
        sampleRate: 48000,
      },
      video: type === 'video'
        ? {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: 'user',
          }
        : false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('[CallEngine] High constraints failed, trying basic constraints:', err);
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video' ? true : false,
      });
    }
  }

  // 1. Audio Level Analyzer (Levels 0 to 4)
  private initAudioLevelAnalyzer(stream: MediaStream, isRemote: boolean) {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        this.audioCtx = new AudioContextClass();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }

      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!this.activeCall || this.activeCall.status === 'ended') return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        // 4 volume levels:
        // 0: quiet, 1: soft, 2: medium, 3: high, 4: max loud
        let level = 0;
        if (avg > 75) level = 4;
        else if (avg > 48) level = 3;
        else if (avg > 25) level = 2;
        else if (avg > 10) level = 1;

        if (isRemote) {
          this.remoteVolumeLevel = level;
        } else {
          this.localVolumeLevel = level;
        }

        if (this.onSpeakingLevelChange) {
          this.onSpeakingLevelChange(this.localVolumeLevel, this.remoteVolumeLevel);
        }

        this.animFrameId = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('[CallEngine] Audio analyzer init error:', e);
    }
  }

  // 2. Play Realistic Ringtones via Web Audio
  public playRingtone(type: 'incoming' | 'outgoing') {
    this.stopRingtone();
    // On native Android APK, incoming calls ring with the native Android device ringtone
    const isNative = typeof (window as any).Capacitor !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
    if (type === 'incoming' && isNative) {
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      this.ringtoneCtx = new AudioContextClass();

      const playTone = () => {
        if (!this.activeCall || this.activeCall.status !== 'ringing') {
          this.stopRingtone();
          return;
        }
        if (!this.ringtoneCtx) return;
        if (this.ringtoneCtx.state === 'suspended') {
          void this.ringtoneCtx.resume();
        }

        const osc = this.ringtoneCtx.createOscillator();
        const gain = this.ringtoneCtx.createGain();
        osc.connect(gain);
        gain.connect(this.ringtoneCtx.destination);

        if (type === 'incoming') {
          // Continuous Vibration on incoming call
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate([1000, 1000]); } catch {}
          }
          const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
          void cap?.Plugins?.ShinziNotification?.startCallVibration?.().catch(() => {});

          // Standard phone ringing pitch: 440Hz + 480Hz
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, this.ringtoneCtx.currentTime);
          osc.frequency.setValueAtTime(480, this.ringtoneCtx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.25, this.ringtoneCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.ringtoneCtx.currentTime + 1.2);
          osc.start(this.ringtoneCtx.currentTime);
          osc.stop(this.ringtoneCtx.currentTime + 1.2);
        } else {
          // Outgoing call beep: 425Hz short pulse
          osc.type = 'sine';
          osc.frequency.setValueAtTime(425, this.ringtoneCtx.currentTime);
          gain.gain.setValueAtTime(0.18, this.ringtoneCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.ringtoneCtx.currentTime + 0.8);
          osc.start(this.ringtoneCtx.currentTime);
          osc.stop(this.ringtoneCtx.currentTime + 0.8);
        }
      };

      playTone();
      this.ringtoneInterval = window.setInterval(playTone, type === 'incoming' ? 2400 : 3000);
    } catch {}
  }

  public stopRingtone() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(0); } catch {}
    }
    const cap = typeof window !== 'undefined' ? (window as any).Capacitor : null;
    void cap?.Plugins?.ShinziNotification?.stopCallVibration?.().catch(() => {});

    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.ringtoneCtx) {
      try {
        void this.ringtoneCtx.close();
      } catch {}
      this.ringtoneCtx = null;
    }
  }

  // 3. Start an Outgoing Call
  public async startCall(params: {
    convId: string;
    callerId: string;
    callerName: string;
    callerPhotoURL: string;
    receiverId: string;
    receiverName: string;
    receiverPhotoURL: string;
    type: 'voice' | 'video';
  }): Promise<string> {
    const cap = (window as any).Capacitor;
    if (typeof cap?.Plugins?.ShinziNotification?.requestBatteryOptimization === 'function') {
      void cap.Plugins.ShinziNotification.requestBatteryOptimization().catch(() => {});
    }

    this.cleanup();
    this.isCaller = true;

    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const initialCallData: CallSession = {
      id: callId,
      convId: params.convId,
      callerId: params.callerId,
      callerName: params.callerName,
      callerPhotoURL: params.callerPhotoURL,
      receiverId: params.receiverId,
      receiverName: params.receiverName,
      receiverPhotoURL: params.receiverPhotoURL,
      type: params.type,
      status: 'ringing',
      offer: null,
      answer: null,
      callerCandidates: [],
      receiverCandidates: [],
      callerMuted: false,
      receiverMuted: false,
      callerDeafened: false,
      receiverDeafened: false,
      callerScreenSharing: false,
      receiverScreenSharing: false,
      callerVideoOn: params.type === 'video',
      receiverVideoOn: false,
      startedAt: Date.now(),
    };

    // IMMEDIATELY update state so the calling overlay pops up instantly on the user's screen!
    this.activeCall = initialCallData;
    if (this.onCallStateChange) {
      this.onCallStateChange(this.activeCall);
    }
    this.playRingtone('outgoing');

    // Auto-cut call after 30 seconds if receiver does not answer
    if (this.ringTimeoutId) clearTimeout(this.ringTimeoutId);
    this.ringTimeoutId = window.setTimeout(() => {
      if (this.activeCall && this.activeCall.status === 'ringing') {
        console.log('[CallEngine] Call unanswered after 30s, auto-hanging up...');
        void this.endCall();
      }
    }, 30000);

    // Wake up receiver device via FCM push even when the app is DEAD / closed!
    void sendWebPushToUser({
      recipientUid: params.receiverId,
      title: params.callerName,
      text: params.type === 'video' ? 'Incoming Video Call...' : 'Incoming Voice Call...',
      icon: params.callerPhotoURL,
      convId: params.convId,
      senderUid: params.callerId,
      type: 'incoming_call',
      callId,
      callType: params.type,
    });

    try {
      this.localStream = await this.getMediaStreamWithFallback(params.type);
      if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
      this.initAudioLevelAnalyzer(this.localStream, false);

      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.peerConnection = new RTCPeerConnection(ICE_SERVERS);
      this.candidateQueue = [];

      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection?.iceConnectionState;
        console.log('[CallEngine] ICE Connection State:', state);
        if (state === 'failed') {
          console.warn('[CallEngine] ICE failed across NAT. Initiating ICE restart...');
          void this.handleIceFailure();
        }
      };

      // Add local audio track
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.peerConnection.addTrack(audioTrack, this.localStream);
      } else {
        this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      }

      // Add local video track or pre-allocate video transceiver without dummy stall track
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        this.videoSender = this.peerConnection.addTrack(videoTrack, this.localStream);
      } else {
        const trans = this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        this.videoSender = trans.sender;
      }

      // Handle remote tracks with stable stream handling
      this.peerConnection.ontrack = (event) => {
        let streamChanged = false;
        if (event.streams && event.streams[0]) {
          if (this.remoteStream !== event.streams[0]) {
            this.remoteStream = event.streams[0];
            streamChanged = true;
          }
        } else if (event.track) {
          if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
            streamChanged = true;
          }
          if (!this.remoteStream.getTracks().includes(event.track)) {
            this.remoteStream.addTrack(event.track);
            streamChanged = true;
          }
        }
        if (streamChanged && this.remoteStream && this.onRemoteStreamReady) {
          this.onRemoteStreamReady(this.remoteStream);
        }
        if (event.track.kind === 'audio' && this.remoteStream) {
          this.initAudioLevelAnalyzer(this.remoteStream, true);
        }
      };

      // ICE Candidate gathering
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.activeCall?.convId) {
          const candJson = event.candidate.toJSON();
          // Write to conversation activeCall
          void updateDoc(doc(db, 'conversations', this.activeCall.convId), {
            'activeCall.callerCandidates': arrayUnion(candJson),
          }).catch(() => {});
          // Also try calls/{callId}
          void updateDoc(doc(db, 'calls', callId), {
            callerCandidates: arrayUnion(candJson),
          }).catch(() => {});
        }
      };

      // Create WebRTC Offer with Opus FEC enhancement
      const offer = await this.peerConnection.createOffer();
      const enhancedOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: enhanceOpusSdp(offer.sdp || ''),
      });
      await this.peerConnection.setLocalDescription(enhancedOffer);

      const finalCallData: CallSession = {
        ...initialCallData,
        offer: { type: enhancedOffer.type, sdp: enhancedOffer.sdp },
      };

      this.activeCall = finalCallData;

      // 1) Write to conversations/{convId} (100% permitted by existing security rules)
      const convRef = doc(db, 'conversations', params.convId);
      await setDoc(
        convRef,
        {
          activeCall: finalCallData,
          memberIds: [params.callerId, params.receiverId],
        },
        { merge: true }
      );

      // 2) Also try writing to calls/{callId}
      void setDoc(doc(db, 'calls', callId), finalCallData).catch(() => {});

      // 3) Listen to call state updates
      this.listenToCall(callId, params.convId);

      if (this.onCallStateChange) {
        this.onCallStateChange(this.activeCall);
      }
      return callId;
    } catch (err) {
      console.error('[CallEngine] startCall error:', err);
      this.cleanup();
      throw err;
    }
  }

  // 4. Accept Incoming Call
  public async answerCall(call: CallSession): Promise<void> {
    const cap = (window as any).Capacitor;
    if (typeof cap?.Plugins?.ShinziNotification?.requestBatteryOptimization === 'function') {
      void cap.Plugins.ShinziNotification.requestBatteryOptimization().catch(() => {});
    }

    this.stopRingtone();
    this.isCaller = false;
    this.activeCall = { ...call, status: 'connected' };
    if (this.onCallStateChange) {
      this.onCallStateChange(this.activeCall);
    }

    if (this.ringTimeoutId) {
      clearTimeout(this.ringTimeoutId);
      this.ringTimeoutId = null;
    }

    try {
      this.localStream = await this.getMediaStreamWithFallback(call.type);
      if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
      this.initAudioLevelAnalyzer(this.localStream, false);

      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      this.peerConnection = new RTCPeerConnection(ICE_SERVERS);
      this.candidateQueue = [];

      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection?.iceConnectionState;
        console.log('[CallEngine] ICE Connection State:', state);
        if (state === 'failed') {
          console.warn('[CallEngine] ICE failed across NAT. Initiating ICE restart...');
          void this.handleIceFailure();
        }
      };

      // Add local audio track
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.peerConnection.addTrack(audioTrack, this.localStream);
      } else {
        this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      }

      // Add local video track or pre-allocate video transceiver without dummy stall track
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        this.videoSender = this.peerConnection.addTrack(videoTrack, this.localStream);
      } else {
        const trans = this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        this.videoSender = trans.sender;
      }

      this.peerConnection.ontrack = (event) => {
        let streamChanged = false;
        if (event.streams && event.streams[0]) {
          if (this.remoteStream !== event.streams[0]) {
            this.remoteStream = event.streams[0];
            streamChanged = true;
          }
        } else if (event.track) {
          if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
            streamChanged = true;
          }
          if (!this.remoteStream.getTracks().includes(event.track)) {
            this.remoteStream.addTrack(event.track);
            streamChanged = true;
          }
        }
        if (streamChanged && this.remoteStream && this.onRemoteStreamReady) {
          this.onRemoteStreamReady(this.remoteStream);
        }
        if (event.track.kind === 'audio' && this.remoteStream) {
          this.initAudioLevelAnalyzer(this.remoteStream, true);
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.activeCall?.convId) {
          const candJson = event.candidate.toJSON();
          void updateDoc(doc(db, 'conversations', this.activeCall.convId), {
            'activeCall.receiverCandidates': arrayUnion(candJson),
          }).catch(() => {});
          void updateDoc(doc(db, 'calls', call.id), {
            receiverCandidates: arrayUnion(candJson),
          }).catch(() => {});
        }
      };

      if (call.offer) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(call.offer));
        const answer = await this.peerConnection.createAnswer();
        const enhancedAnswer = new RTCSessionDescription({
          type: answer.type,
          sdp: enhanceOpusSdp(answer.sdp || ''),
        });
        await this.peerConnection.setLocalDescription(enhancedAnswer);

        // Drain any ICE candidates received before answer
        await this.drainCandidateQueue();

        const updates = {
          'activeCall.answer': { type: enhancedAnswer.type, sdp: enhancedAnswer.sdp },
          'activeCall.status': 'connected',
          'activeCall.connectedAt': Date.now(),
          'activeCall.receiverVideoOn': call.type === 'video',
        };

        void updateDoc(doc(db, 'conversations', call.convId), updates).catch(() => {});
        void updateDoc(doc(db, 'calls', call.id), {
          answer: { type: answer.type, sdp: answer.sdp },
          status: 'connected',
          connectedAt: Date.now(),
          receiverVideoOn: call.type === 'video',
        }).catch(() => {});
      }

      this.listenToCall(call.id, call.convId);
    } catch (err) {
      console.error('[CallEngine] answerCall error:', err);
      this.cleanup();
    }
  }

  // 5. Decline or Hangup Call
  public async endCall(notifyPeer: boolean = true): Promise<void> {
    this.stopRingtone();
    const current = this.activeCall;
    this.cleanup();

    if (notifyPeer && current) {
      const updates = {
        'activeCall.status': current.status === 'ringing' && !this.isCaller ? 'declined' : 'ended',
        'activeCall.endedAt': Date.now(),
      };
      if (current.convId) {
        // Clear activeCall after 1.5s so both peers get the 'ended' status
        void updateDoc(doc(db, 'conversations', current.convId), updates).catch(() => {});
        setTimeout(() => {
          void updateDoc(doc(db, 'conversations', current.convId), {
            activeCall: null,
          }).catch(() => {});
        }, 1500);
      }
      if (current.id) {
        void updateDoc(doc(db, 'calls', current.id), {
          status: updates['activeCall.status'],
          endedAt: Date.now(),
        }).catch(() => {});
      }
      const peerUid = this.isCaller ? current.receiverId : current.callerId;
      if (peerUid) {
        void sendWebPushToUser({
          recipientUid: peerUid,
          title: 'Shinzi',
          text: 'Call ended',
          convId: current.convId,
          senderUid: this.isCaller ? current.callerId : current.receiverId,
          type: 'call_ended',
          callId: current.id,
        });
      }
    }
  }

  // 6. Toggle Microphone Mute
  public async toggleMute(): Promise<boolean> {
    if (!this.localStream || !this.activeCall) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const isMuted = !audioTrack.enabled;

      const field = this.isCaller ? 'activeCall.callerMuted' : 'activeCall.receiverMuted';
      if (this.activeCall.convId) {
        void updateDoc(doc(db, 'conversations', this.activeCall.convId), {
          [field]: isMuted,
        }).catch(() => {});
      }
      void updateDoc(doc(db, 'calls', this.activeCall.id), {
        [this.isCaller ? 'callerMuted' : 'receiverMuted']: isMuted,
      }).catch(() => {});
      return isMuted;
    }
    return false;
  }

  // 7. Toggle Deafen / Speaker Mute (Mutes all incoming audio)
  public async toggleDeafen(): Promise<boolean> {
    if (!this.activeCall) return false;
    const isDeafened = this.isCaller ? !this.activeCall.callerDeafened : !this.activeCall.receiverDeafened;

    if (this.remoteStream) {
      this.remoteStream.getAudioTracks().forEach((track) => {
        track.enabled = !isDeafened;
      });
    }

    const field = this.isCaller ? 'activeCall.callerDeafened' : 'activeCall.receiverDeafened';
    if (this.activeCall.convId) {
      void updateDoc(doc(db, 'conversations', this.activeCall.convId), {
        [field]: isDeafened,
      }).catch(() => {});
    }
    void updateDoc(doc(db, 'calls', this.activeCall.id), {
      [this.isCaller ? 'callerDeafened' : 'receiverDeafened']: isDeafened,
    }).catch(() => {});
    return isDeafened;
  }

  // 8. Toggle Video Camera (1080p)
  public async toggleVideo(): Promise<boolean> {
    if (!this.activeCall) return false;
    const isVideoCurrentlyOn = this.isCaller ? this.activeCall.callerVideoOn : this.activeCall.receiverVideoOn;

    if (isVideoCurrentlyOn) {
      this.localStream?.getVideoTracks().forEach((track) => {
        track.stop();
        this.localStream?.removeTrack(track);
      });
      if (this.videoSender) {
        await this.videoSender.replaceTrack(null).catch(() => {});
      }
      const field = this.isCaller ? 'activeCall.callerVideoOn' : 'activeCall.receiverVideoOn';
      if (this.activeCall.convId) {
        void updateDoc(doc(db, 'conversations', this.activeCall.convId), { [field]: false }).catch(() => {});
      }
      void updateDoc(doc(db, 'calls', this.activeCall.id), {
        [this.isCaller ? 'callerVideoOn' : 'receiverVideoOn']: false,
      }).catch(() => {});
      return false;
    } else {
      try {
        let camStream: MediaStream;
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
              facingMode: 'user',
            },
          });
        } catch {
          camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        const videoTrack = camStream.getVideoTracks()[0];
        if (videoTrack) {
          this.localStream?.getVideoTracks().forEach((t) => {
            t.stop();
            this.localStream?.removeTrack(t);
          });
          this.localStream?.addTrack(videoTrack);
          if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);

          if (this.videoSender) {
            await this.videoSender.replaceTrack(videoTrack).catch(() => {});
          } else if (this.peerConnection) {
            this.videoSender = this.peerConnection.addTrack(videoTrack, this.localStream!);
          }

          const field = this.isCaller ? 'activeCall.callerVideoOn' : 'activeCall.receiverVideoOn';
          if (this.activeCall.convId) {
            void updateDoc(doc(db, 'conversations', this.activeCall.convId), { [field]: true }).catch(() => {});
          }
          void updateDoc(doc(db, 'calls', this.activeCall.id), {
            [this.isCaller ? 'callerVideoOn' : 'receiverVideoOn']: true,
          }).catch(() => {});
        }
        return true;
      } catch (err) {
        console.warn('[CallEngine] Camera access error:', err);
        return false;
      }
    }
  }

  // 9. Flip Camera (Front / Back)
  public async flipCamera(facingMode: 'user' | 'environment'): Promise<void> {
    if (!this.localStream || !this.peerConnection) return;
    try {
      const currentVideoTrack = this.localStream.getVideoTracks()[0];
      if (currentVideoTrack) {
        currentVideoTrack.stop();
        this.localStream.removeTrack(currentVideoTrack);
      }

      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
        });
      } catch {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
        });
      }

      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack) {
        this.localStream.addTrack(newTrack);
        if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
        if (this.videoSender) {
          await this.videoSender.replaceTrack(newTrack).catch(() => {});
        } else if (this.peerConnection) {
          this.videoSender = this.peerConnection.addTrack(newTrack, this.localStream);
        }
      }
    } catch (e) {
      console.warn('[CallEngine] Flip camera failed:', e);
    }
  }

  // 10. Toggle Screen Share
  public async toggleScreenShare(): Promise<boolean> {
    if (!this.activeCall) return false;
    const isCurrentlySharing = this.isCaller ? this.activeCall.callerScreenSharing : this.activeCall.receiverScreenSharing;

    if (isCurrentlySharing) {
      const cap = (window as any).Capacitor;
      if (typeof cap?.Plugins?.ShinziNotification?.stopNativeScreenCapture === 'function') {
        void cap.Plugins.ShinziNotification.stopNativeScreenCapture().catch(() => {});
      }
      if (this.screenAnimInterval) {
        clearInterval(this.screenAnimInterval);
        this.screenAnimInterval = null;
      }
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      if (this.onScreenStreamReady) this.onScreenStreamReady(null);

      // Revert video sender to active camera track or null
      const camTrack = this.localStream?.getVideoTracks()[0] || null;
      if (this.videoSender) {
        await this.videoSender.replaceTrack(camTrack).catch(() => {});
      }

      const field = this.isCaller ? 'activeCall.callerScreenSharing' : 'activeCall.receiverScreenSharing';
      if (this.activeCall.convId) {
        void updateDoc(doc(db, 'conversations', this.activeCall.convId), { [field]: false }).catch(() => {});
      }
      void updateDoc(doc(db, 'calls', this.activeCall.id), {
        [this.isCaller ? 'callerScreenSharing' : 'receiverScreenSharing']: false,
      }).catch(() => {});
      return false;
    } else {
      try {
        const cap = (window as any).Capacitor;
        let isNativeAndroid = false;
        // In Android APK, trigger native MediaProjection service
        if (typeof cap?.Plugins?.ShinziNotification?.startNativeScreenCapture === 'function') {
          try {
            await cap.Plugins.ShinziNotification.startNativeScreenCapture();
            isNativeAndroid = true;
          } catch (nativeErr) {
            console.warn('[CallEngine] Native MediaProjection cancelled/denied:', nativeErr);
            return false;
          }
        }

        let stream: MediaStream | null = null;
        if (!isNativeAndroid && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          } catch (displayErr) {
            console.warn('[CallEngine] getDisplayMedia error:', displayErr);
          }
        }

        // Active animated screen canvas capture stream (continuous 30fps) for WebView / mobile
        if (!stream) {
          const canvas = document.createElement('canvas');
          canvas.width = 720;
          canvas.height = 1280;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            let frameCount = 0;
            const myName = this.isCaller ? (this.activeCall.callerName || 'Shinzi') : (this.activeCall.receiverName || 'Shinzi');
            const screenImg = new Image();
            let hasDecodedFrame = false;
            let isRendering = false;
            let lastDrawnSrc = '';

            const drawScreen = async () => {
              if (isRendering) return;
              isRendering = true;
              frameCount++;

              try {
                // 1. If native Android MediaProjection screen capture is active, paint the real device screen
                if (isNativeAndroid && typeof cap?.Plugins?.ShinziNotification?.getLatestScreenFrame === 'function') {
                  const res = await cap.Plugins.ShinziNotification.getLatestScreenFrame();
                  if (res?.frame) {
                    if (res.frame !== lastDrawnSrc) {
                      lastDrawnSrc = res.frame;
                      await new Promise<void>((resolve) => {
                        screenImg.onload = () => {
                          hasDecodedFrame = true;
                          if (screenImg.naturalWidth > 0 && canvas.width !== screenImg.naturalWidth) {
                            canvas.width = screenImg.naturalWidth;
                            canvas.height = screenImg.naturalHeight;
                          }
                          ctx.drawImage(screenImg, 0, 0);
                          resolve();
                        };
                        screenImg.onerror = () => resolve();
                        screenImg.src = res.frame;
                      });
                    } else if (hasDecodedFrame && screenImg.naturalWidth > 0) {
                      ctx.drawImage(screenImg, 0, 0);
                    }
                    return;
                  }
                }

                if (hasDecodedFrame && screenImg.naturalWidth > 0) {
                  ctx.drawImage(screenImg, 0, 0);
                  return;
                }

              // 2. Fallback visualizer if native frame is not yet available
              const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
              grad.addColorStop(0, '#0a0d14');
              grad.addColorStop(0.5, '#121520');
              grad.addColorStop(1, '#1b1d2a');
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              // Pulsing glow circle in center
              const centerX = canvas.width / 2;
              const centerY = canvas.height / 2 - 80;
              const pulse = Math.sin(frameCount * 0.06) * 12;
              ctx.fillStyle = 'rgba(88, 101, 242, 0.15)';
              ctx.beginPath();
              ctx.arc(centerX, centerY, 90 + pulse, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#5865f2';
              ctx.beginPath();
              ctx.arc(centerX, centerY, 70, 0, Math.PI * 2);
              ctx.fill();

              // Screen Share Icon drawn on canvas
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 4;
              ctx.strokeRect(centerX - 25, centerY - 22, 50, 34);
              ctx.beginPath();
              ctx.moveTo(centerX - 10, centerY + 12);
              ctx.lineTo(centerX + 10, centerY + 12);
              ctx.moveTo(centerX, centerY + 12);
              ctx.lineTo(centerX, centerY + 22);
              ctx.moveTo(centerX - 15, centerY + 22);
              ctx.lineTo(centerX + 15, centerY + 22);
              ctx.stroke();

              // Title
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 34px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`${myName}'s Screen Stream`, centerX, centerY + 130);

              // Subtitle
              ctx.font = '18px sans-serif';
              ctx.fillStyle = '#949ba4';
              const timeStr = new Date().toLocaleTimeString();
              ctx.fillText(`Live Stream Active • 60FPS • ${timeStr}`, centerX, centerY + 170);
            } catch (err) {
              console.warn('[CallEngine] drawScreen error:', err);
            } finally {
              isRendering = false;
            }
          };

            drawScreen();
            try {
              stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
            } catch {}

            if (this.screenAnimInterval) {
              clearInterval(this.screenAnimInterval);
            }
            this.screenAnimInterval = setInterval(() => {
              if (!this.screenStream) {
                if (this.screenAnimInterval) {
                  clearInterval(this.screenAnimInterval);
                  this.screenAnimInterval = null;
                }
                return;
              }
              void drawScreen();
            }, 1000 / 30);
          }
        }

        if (!stream) {
          console.warn('[CallEngine] Display media stream could not be created.');
          return false;
        }

        this.screenStream = stream;
        if (this.onScreenStreamReady) this.onScreenStreamReady(this.screenStream);

        const videoTrack = stream?.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = true;
          if (this.videoSender) {
            await this.videoSender.replaceTrack(videoTrack).catch(() => {});
          } else if (this.peerConnection) {
            this.videoSender = this.peerConnection.addTrack(videoTrack, stream!);
          }

          videoTrack.onended = () => {
            void this.toggleScreenShare();
          };
        }

        const field = this.isCaller ? 'activeCall.callerScreenSharing' : 'activeCall.receiverScreenSharing';
        if (this.activeCall.convId) {
          void updateDoc(doc(db, 'conversations', this.activeCall.convId), { [field]: true }).catch(() => {});
        }
        void updateDoc(doc(db, 'calls', this.activeCall.id), {
          [this.isCaller ? 'callerScreenSharing' : 'receiverScreenSharing']: true,
        }).catch(() => {});

        return true;
      } catch (err) {
        console.warn('[CallEngine] Screen share cancelled:', err);
        return false;
      }
    }
  }

  // 11. Audio Routing (Speaker vs Earpiece vs Bluetooth)
  public async setAudioOutputDevice(deviceType: 'speaker' | 'mobile' | 'device'): Promise<void> {
    try {
      const cap = (window as any).Capacitor;
      if (typeof cap?.Plugins?.ShinziNotification?.setAudioRoute === 'function') {
        void cap.Plugins.ShinziNotification.setAudioRoute({
          route: deviceType === 'device' ? 'device' : (deviceType === 'mobile' ? 'earpiece' : 'speaker'),
        }).catch(() => {});
      }

      const audioElements = document.querySelectorAll('audio');
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

      let targetDeviceId = '';
      if (deviceType === 'speaker') {
        const speaker = audioOutputs.find((d) => d.label.toLowerCase().includes('speaker'));
        if (speaker) targetDeviceId = speaker.deviceId;
      } else if (deviceType === 'device') {
        const extDevice = audioOutputs.find(
          (d) =>
            d.label.toLowerCase().includes('bluetooth') ||
            d.label.toLowerCase().includes('headset') ||
            d.label.toLowerCase().includes('headphones')
        );
        if (extDevice) targetDeviceId = extDevice.deviceId;
      }

      audioElements.forEach((el: any) => {
        if (typeof el.setSinkId === 'function') {
          void el.setSinkId(targetDeviceId);
        }
      });
    } catch (e) {
      console.warn('[CallEngine] setAudioOutputDevice error:', e);
    }
  }

  // 12. Listen to Call Updates & ICE Candidates
  public listenToCall(callId: string, convId?: string) {
    if (this.unsubscribeCallDoc) {
      this.unsubscribeCallDoc();
      this.unsubscribeCallDoc = null;
    }

    const targetConvId = convId || this.activeCall?.convId;
    if (!targetConvId) return;

    this.unsubscribeCallDoc = onSnapshot(
      doc(db, 'conversations', targetConvId),
      async (snapshot) => {
        if (!snapshot.exists()) {
          void this.endCall(false);
          return;
        }

        const data = snapshot.data();
        const callData = data?.activeCall as CallSession | undefined;

        if (!callData || callData.id !== callId || callData.status === 'ended' || callData.status === 'declined') {
          void this.endCall(false);
          return;
        }

        this.activeCall = callData;

        if (callData.status === 'connected') {
          this.stopRingtone();
        }

        // Handle WebRTC Answer for Caller
        if (this.isCaller && callData.answer && this.peerConnection) {
          const currentRemoteSdp = this.peerConnection.remoteDescription?.sdp;
          if (!currentRemoteSdp || currentRemoteSdp !== callData.answer.sdp) {
            try {
              const answerDesc = new RTCSessionDescription(callData.answer);
              await this.peerConnection.setRemoteDescription(answerDesc);
              await this.drainCandidateQueue();
            } catch (e) {
              console.warn('[CallEngine] setRemoteDescription error:', e);
            }
          }
        }

        // Handle updated offer / ICE restart for Receiver
        if (!this.isCaller && callData.offer && this.peerConnection && this.peerConnection.remoteDescription) {
          if (callData.offer.sdp && callData.offer.sdp !== this.peerConnection.remoteDescription.sdp) {
            try {
              console.log('[CallEngine] Receiver applying updated offer / ICE restart...');
              await this.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
              const answer = await this.peerConnection.createAnswer();
              const enhancedAnswer = new RTCSessionDescription({
                type: answer.type,
                sdp: enhanceOpusSdp(answer.sdp || ''),
              });
              await this.peerConnection.setLocalDescription(enhancedAnswer);
              await this.drainCandidateQueue();
              if (callData.convId) {
                void updateDoc(doc(db, 'conversations', callData.convId), {
                  'activeCall.answer': { type: enhancedAnswer.type, sdp: enhancedAnswer.sdp },
                }).catch(() => {});
              }
            } catch (err) {
              console.warn('[CallEngine] Receiver ICE restart offer handling error:', err);
            }
          }
        }

        // Sync ICE candidates
        if (this.peerConnection) {
          const candidates = this.isCaller ? callData.receiverCandidates : callData.callerCandidates;
          if (Array.isArray(candidates)) {
            for (const cand of candidates) {
              const candStr = JSON.stringify(cand);
              if (!this.processedCandidates.has(candStr)) {
                this.processedCandidates.add(candStr);
                if (!this.peerConnection.remoteDescription || !this.peerConnection.remoteDescription.type) {
                  this.candidateQueue.push(cand);
                } else {
                  try {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                  } catch {
                    this.candidateQueue.push(cand);
                  }
                }
              }
            }
          }
        }

        if (this.onCallStateChange) {
          this.onCallStateChange(this.activeCall);
        }
      },
      (err) => {
        console.warn('[CallEngine] listenToCall error:', err);
      }
    );
  }

  private async drainCandidateQueue() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    const queued = [...this.candidateQueue];
    this.candidateQueue = [];
    for (const cand of queued) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[CallEngine] addIceCandidate from queue error:', e);
      }
    }
  }

  private async handleIceFailure() {
    if (!this.peerConnection || !this.activeCall || this.activeCall.status !== 'connected') return;
    try {
      if (this.isCaller) {
        console.log('[CallEngine] Caller initiating ICE restart...');
        const offer = await this.peerConnection.createOffer({ iceRestart: true });
        const enhancedOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: enhanceOpusSdp(offer.sdp || ''),
        });
        await this.peerConnection.setLocalDescription(enhancedOffer);
        if (this.activeCall.convId) {
          void updateDoc(doc(db, 'conversations', this.activeCall.convId), {
            'activeCall.offer': { type: enhancedOffer.type, sdp: enhancedOffer.sdp },
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[CallEngine] handleIceFailure error:', e);
    }
  }

  // 13. Full Cleanup
  public cleanup() {
    const cap = (window as any).Capacitor;
    if (typeof cap?.Plugins?.ShinziNotification?.stopNativeScreenCapture === 'function') {
      void cap.Plugins.ShinziNotification.stopNativeScreenCapture().catch(() => {});
    }
    this.stopRingtone();
    if (this.ringTimeoutId) {
      clearTimeout(this.ringTimeoutId);
      this.ringTimeoutId = null;
    }
    if (this.screenAnimInterval) {
      clearInterval(this.screenAnimInterval);
      this.screenAnimInterval = null;
    }
    this.candidateQueue = [];
    this.videoSender = null;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.unsubscribeCallDoc) {
      this.unsubscribeCallDoc();
      this.unsubscribeCallDoc = null;
    }
    this.processedCandidates.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.remoteStream = null;
    this.activeCall = null;
    this.localVolumeLevel = 0;
    this.remoteVolumeLevel = 0;

    if (this.onCallStateChange) this.onCallStateChange(null);
    if (this.onScreenStreamReady) this.onScreenStreamReady(null);
  }
}

export const callEngine = new CallEngine();
