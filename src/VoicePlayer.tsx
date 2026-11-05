import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, AlertCircle, Loader2 } from 'lucide-react';
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { getCachedAudioUrl, cacheAudioBlob } from './voiceCache';

interface VoicePlayerProps {
  message: {
    id?: string;
    audioUrl?: string;
    driveFileId?: string | null;
    driveOwnerUid?: string;
    durationSeconds?: number;
    duration?: string;
    senderId?: string;
    status?: 'uploading' | 'ready' | 'error' | string;
    createdAt?: any;
    listenedBy?: string[];
    listenedAt?: any;
    deletedFromDrive?: boolean;
    expiresAt?: any;
    [key: string]: any;
  };
  currentUid?: string | null;
  conversationId: string;
  own: boolean;
  onNotify?: (title: string, text: string) => void;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({
  message,
  currentUid,
  conversationId,
  own,
  onNotify,
}) => {
  const initialDuration = useMemo(() => {
    if (message.durationSeconds && isFinite(message.durationSeconds) && !isNaN(message.durationSeconds)) {
      return message.durationSeconds;
    }
    if (typeof message.duration === 'string' && message.duration.includes(':')) {
      const parts = message.duration.split(':').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] * 60 + parts[1];
      }
    }
    return 0;
  }, [message.durationSeconds, message.duration]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(initialDuration);
  const [isUnavailable, setIsUnavailable] = useState(Boolean(message.deletedFromDrive));
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Check 30-day expiry or 2-day listened expiry
  useEffect(() => {
    if (message.deletedFromDrive) {
      setIsUnavailable(true);
      return;
    }

    const now = Date.now();
    let isExpired = false;

    // Check 30-day default expiry from creation
    if (message.createdAt?.toMillis) {
      const createdMillis = message.createdAt.toMillis();
      if (now - createdMillis > 30 * 24 * 60 * 60 * 1000) {
        isExpired = true;
      }
    }

    // Check 2-day expiry after being listened to
    if (message.listenedAt?.toMillis) {
      const listenedMillis = message.listenedAt.toMillis();
      if (now - listenedMillis > 2 * 24 * 60 * 60 * 1000) {
        isExpired = true;
      }
    }

    if (isExpired) {
      setIsUnavailable(true);
      // If current user is sender and Drive file is still tracked, delete from Drive
      if (own && message.driveFileId && conversationId && message.id) {
        fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: message.driveFileId,
            ownerUid: currentUid,
          }),
        }).catch(() => {});

        updateDoc(doc(db, 'conversations', conversationId, 'messages', message.id), {
          deletedFromDrive: true,
        }).catch(() => {});
      }
    }
  }, [
    message.createdAt,
    message.listenedAt,
    message.deletedFromDrive,
    message.driveFileId,
    message.id,
    conversationId,
    currentUid,
    own,
  ]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  const formatSeconds = (sec: number) => {
    if (!sec || !isFinite(sec) || isNaN(sec)) return '0:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  };

  const loadAudioStream = useCallback(async (): Promise<string | null> => {
    const msgId = message.id || '';
    if (!msgId) return null;

    // 1. Check local IndexedDB cache first (instant client CDN)
    const cached = await getCachedAudioUrl(msgId);
    if (cached) {
      setResolvedAudioUrl(cached);
      return cached;
    }

    // 2. Direct data URI or stored blob
    if (message.audioUrl && message.audioUrl.startsWith('data:')) {
      return message.audioUrl;
    }

    // 3. Fallback to /api/voice or audioUrl
    let fetchUrl = message.audioUrl;
    if (!fetchUrl && message.driveFileId) {
      fetchUrl = `/api/voice?fileId=${encodeURIComponent(message.driveFileId)}&ownerUid=${encodeURIComponent(
        message.driveOwnerUid || message.senderId || ''
      )}`;
    }

    if (!fetchUrl) {
      if (message.status === 'uploading') {
        onNotify?.('Voice note is uploading', 'The sender is still uploading this voice note to Google Drive.');
      } else {
        setIsUnavailable(true);
      }
      return null;
    }

    // Fetch and store in local device cache
    try {
      setIsLoading(true);
      const res = await fetch(fetchUrl);
      if (res.status === 410 || res.status === 404) {
        setIsUnavailable(true);
        setIsLoading(false);
        return null;
      }
      if (!res.ok) {
        throw new Error(`Failed to load audio (${res.status})`);
      }

      const blob = await res.blob();
      const objectUrl = await cacheAudioBlob(msgId, blob);
      setResolvedAudioUrl(objectUrl);
      setIsLoading(false);
      return objectUrl;
    } catch (err) {
      setIsLoading(false);
      console.warn('[VoicePlayer] Could not fetch voice stream:', err);
      return fetchUrl;
    }
  }, [message.id, message.audioUrl, message.driveFileId, message.driveOwnerUid, message.senderId, message.status, onNotify]);

  const markAsListened = useCallback(() => {
    if (!own && conversationId && message.id && currentUid) {
      const updates: Record<string, any> = {
        listenedBy: arrayUnion(currentUid),
      };
      if (!message.listenedAt) {
        updates.listenedAt = serverTimestamp();
      }
      updateDoc(
        doc(db, 'conversations', conversationId, 'messages', message.id),
        updates
      ).catch(() => {});
    }
  }, [own, conversationId, message.id, currentUid, message.listenedAt]);

  const togglePlay = async () => {
    if (isUnavailable) {
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio();

      audioRef.current.ontimeupdate = () => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
      };

      audioRef.current.onloadedmetadata = () => {
        if (
          audioRef.current &&
          audioRef.current.duration &&
          isFinite(audioRef.current.duration) &&
          !isNaN(audioRef.current.duration)
        ) {
          setDuration(audioRef.current.duration);
        }
      };

      audioRef.current.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audioRef.current.onerror = () => {
        setIsPlaying(false);
        setIsLoading(false);
        setIsUnavailable(true);
      };
    }

    const audio = audioRef.current;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    let urlToPlay = resolvedAudioUrl;
    if (!urlToPlay) {
      urlToPlay = await loadAudioStream();
    }

    if (!urlToPlay) return;

    if (audio.src !== urlToPlay) {
      audio.src = urlToPlay;
    }

    try {
      setIsLoading(true);
      await audio.play();
      setIsPlaying(true);
      setIsLoading(false);
      markAsListened();
    } catch (err) {
      setIsLoading(false);
      setIsPlaying(false);
      console.warn('[VoicePlayer] playback error:', err);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  if (isUnavailable) {
    return (
      <div className={`shc-voice ${own ? 'shc-voice-own' : ''} shc-voice-unavailable`}>
        <AlertCircle size={18} className="shc-voice-icon-err" />
        <span className="shc-voice-unavailable-text">
          Voice note unavailable (expired or deleted).
        </span>
      </div>
    );
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`shc-voice ${own ? 'shc-voice-own' : ''}`}>
      <button
        type="button"
        className="shc-voice-btn"
        onClick={togglePlay}
        disabled={isLoading || message.status === 'uploading'}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {isLoading || message.status === 'uploading' ? (
          <Loader2 size={18} className="shc-spin" />
        ) : isPlaying ? (
          <Pause size={18} />
        ) : (
          <Play size={18} />
        )}
      </button>

      <div className="shc-voice-scrubber-wrap">
        <div className="shc-voice-track">
          <div
            className="shc-voice-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="shc-voice-slider"
          aria-label="Voice progress slider"
        />
      </div>

      <span className="shc-voice-time">
        {formatSeconds(currentTime)} / {formatSeconds(duration)}
      </span>

      {message.status === 'uploading' && (
        <span className="shc-voice-status-tag">Syncing…</span>
      )}
    </div>
  );
};
export default VoicePlayer;
