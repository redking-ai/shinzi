/**
 * callService.ts
 * Real-time WebRTC 1080p Calling Engine for Shinzi
 * Supports Discord-style voice calls, video calls, screen-sharing,
 * audio level detection (1-4 wave indicators), and audio routing.
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
  deleteDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

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
  ],
};

class CallEngine {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private unsubscribeCallDoc: Unsubscribe | null = null;

  // Web Audio for speaking detection
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // Ringtone oscillators
  private ringtoneInterval: number | null = null;

  public activeCall: CallSession | null = null;
  public isCaller: boolean = false;
  public localVolumeLevel: number = 0; // 0, 1, 2, 3, 4
  public remoteVolumeLevel: number = 0; // 0, 1, 2, 3, 4

  // Event Listeners
  public onCallStateChange: ((call: CallSession | null) => void) | null = null;
  public onLocalStreamReady: ((stream: MediaStream) => void) | null = null;
  public onRemoteStreamReady: ((stream: MediaStream) => void) | null = null;
  public onScreenStreamReady: ((stream: MediaStream | null) => void) | null = null;
  public onSpeakingLevelChange: ((localLevel: number, remoteLevel: number) => void) | null = null;

  // 1. Audio Level Analyzer
  private initAudioLevelAnalyzer(stream: MediaStream, isRemote: boolean = false) {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
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
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      const playTone = () => {
        if (!this.activeCall || this.activeCall.status !== 'ringing') {
          this.stopRingtone();
          return;
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'incoming') {
          // Standard phone ringing pitch
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          osc.frequency.setValueAtTime(480, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 1.2);
        } else {
          // Outgoing call beep: 440Hz short pulse
          osc.type = 'sine';
          osc.frequency.setValueAtTime(425, ctx.currentTime);
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.8);
        }
      };

      playTone();
      this.ringtoneInterval = window.setInterval(playTone, type === 'incoming' ? 2400 : 3000);
    } catch {}
  }

  public stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
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
    this.cleanup();
    this.isCaller = true;

    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const callRef = doc(db, 'calls', callId);

    // Get 1080p camera / audio constraints
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: params.type === 'video'
        ? {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 24 },
            facingMode: 'user',
          }
        : false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
    this.initAudioLevelAnalyzer(this.localStream, false);

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks to WebRTC
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.localStream!);
    });

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStreamReady) this.onRemoteStreamReady(this.remoteStream);
        this.initAudioLevelAnalyzer(this.remoteStream, true);
      }
    };

    // ICE Candidate gathering
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        void updateDoc(callRef, {
          callerCandidates: arrayUnion(event.candidate.toJSON()),
        });
      }
    };

    // Create WebRTC Offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const callData: CallSession = {
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
      offer: { type: offer.type, sdp: offer.sdp },
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
      startedAt: serverTimestamp(),
    };

    await setDoc(callRef, callData);
    this.activeCall = callData;
    this.playRingtone('outgoing');
    this.listenToCall(callId);

    if (this.onCallStateChange) this.onCallStateChange(this.activeCall);
    return callId;
  }

  // 4. Accept Incoming Call
  public async answerCall(call: CallSession): Promise<void> {
    this.stopRingtone();
    this.isCaller = false;
    this.activeCall = call;

    const callRef = doc(db, 'calls', call.id);

    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: call.type === 'video'
        ? {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 24 },
            facingMode: 'user',
          }
        : false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
    this.initAudioLevelAnalyzer(this.localStream, false);

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    this.localStream.getTracks().forEach((track) => {
      this.peerConnection?.addTrack(track, this.localStream!);
    });

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        if (this.onRemoteStreamReady) this.onRemoteStreamReady(this.remoteStream);
        this.initAudioLevelAnalyzer(this.remoteStream, true);
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        void updateDoc(callRef, {
          receiverCandidates: arrayUnion(event.candidate.toJSON()),
        });
      }
    };

    if (call.offer) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(call.offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      await updateDoc(callRef, {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'connected',
        connectedAt: serverTimestamp(),
        receiverVideoOn: call.type === 'video',
      });
    }

    this.listenToCall(call.id);
  }

  // 5. Decline or Hangup Call
  public async endCall(): Promise<void> {
    this.stopRingtone();
    if (this.activeCall?.id) {
      try {
        const callRef = doc(db, 'calls', this.activeCall.id);
        await updateDoc(callRef, {
          status: this.activeCall.status === 'ringing' && !this.isCaller ? 'declined' : 'ended',
          endedAt: serverTimestamp(),
        });
      } catch {}
    }
    this.cleanup();
  }

  // 6. Toggle Microphone Mute
  public async toggleMute(): Promise<boolean> {
    if (!this.localStream || !this.activeCall) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const isMuted = !audioTrack.enabled;

      const field = this.isCaller ? 'callerMuted' : 'receiverMuted';
      try {
        await updateDoc(doc(db, 'calls', this.activeCall.id), {
          [field]: isMuted,
        });
      } catch {}
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

    const field = this.isCaller ? 'callerDeafened' : 'receiverDeafened';
    try {
      await updateDoc(doc(db, 'calls', this.activeCall.id), {
        [field]: isDeafened,
      });
    } catch {}
    return isDeafened;
  }

  // 8. Toggle Video Camera (1080p)
  public async toggleVideo(): Promise<boolean> {
    if (!this.activeCall) return false;
    const isVideoCurrentlyOn = this.isCaller ? this.activeCall.callerVideoOn : this.activeCall.receiverVideoOn;

    if (isVideoCurrentlyOn) {
      // Turn off video: stop video tracks
      this.localStream?.getVideoTracks().forEach((track) => {
        track.stop();
        this.localStream?.removeTrack(track);
      });
      const field = this.isCaller ? 'callerVideoOn' : 'receiverVideoOn';
      await updateDoc(doc(db, 'calls', this.activeCall.id), { [field]: false });
      return false;
    } else {
      // Turn on 1080p video
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 24 },
            facingMode: 'user',
          },
        });
        const videoTrack = camStream.getVideoTracks()[0];
        if (videoTrack && this.peerConnection) {
          this.localStream?.addTrack(videoTrack);
          this.peerConnection.addTrack(videoTrack, this.localStream!);

          // Renegotiate WebRTC offer
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          const field = this.isCaller ? 'callerVideoOn' : 'receiverVideoOn';
          await updateDoc(doc(db, 'calls', this.activeCall.id), {
            [field]: true,
            offer: { type: offer.type, sdp: offer.sdp },
          });
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

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: facingMode },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
        },
      });

      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack) {
        this.localStream.addTrack(newTrack);
        const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newTrack);
        } else {
          this.peerConnection.addTrack(newTrack, this.localStream);
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
      // Stop screen share
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      if (this.onScreenStreamReady) this.onScreenStreamReady(null);

      // Restore camera if video was on
      const field = this.isCaller ? 'callerScreenSharing' : 'receiverScreenSharing';
      await updateDoc(doc(db, 'calls', this.activeCall.id), { [field]: false });
      return false;
    } else {
      // Start Screen Share with native Android/browser prompt
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            frameRate: { ideal: 60, min: 30 },
          } as any,
          audio: true,
        });

        this.screenStream = stream;
        if (this.onScreenStreamReady) this.onScreenStreamReady(this.screenStream);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && this.peerConnection) {
          const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(videoTrack);
          } else {
            this.peerConnection.addTrack(videoTrack, stream);
          }

          videoTrack.onended = () => {
            void this.toggleScreenShare();
          };

          const field = this.isCaller ? 'callerScreenSharing' : 'receiverScreenSharing';
          await updateDoc(doc(db, 'calls', this.activeCall.id), { [field]: true });
        }
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

  // 12. Listen to Call Document Updates & Candidates
  private listenToCall(callId: string) {
    if (this.unsubscribeCallDoc) this.unsubscribeCallDoc();

    this.unsubscribeCallDoc = onSnapshot(doc(db, 'calls', callId), async (snapshot) => {
      if (!snapshot.exists()) {
        this.cleanup();
        return;
      }

      const data = { id: snapshot.id, ...snapshot.data() } as CallSession;
      this.activeCall = data;

      if (data.status === 'connected') {
        this.stopRingtone();
      }

      if (data.status === 'ended' || data.status === 'declined') {
        this.stopRingtone();
        this.cleanup();
        if (this.onCallStateChange) this.onCallStateChange(null);
        return;
      }

      // Handle Answer for Caller
      if (this.isCaller && data.answer && this.peerConnection && !this.peerConnection.currentRemoteDescription) {
        const answerDesc = new RTCSessionDescription(data.answer);
        await this.peerConnection.setRemoteDescription(answerDesc);
      }

      // Handle ICE candidates
      if (this.peerConnection) {
        const candidates = this.isCaller ? data.receiverCandidates : data.callerCandidates;
        if (Array.isArray(candidates)) {
          for (const cand of candidates) {
            try {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            } catch {}
          }
        }
      }

      if (this.onCallStateChange) this.onCallStateChange(this.activeCall);
    });
  }

  // 13. Full Cleanup
  public cleanup() {
    this.stopRingtone();
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.unsubscribeCallDoc) {
      this.unsubscribeCallDoc();
      this.unsubscribeCallDoc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
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
