import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { SpotifyPresenceData } from './spotifyService';

interface SpotifyListeningCardProps {
  presence: SpotifyPresenceData | null | undefined;
  onTrackClick?: () => void;
}

export default function SpotifyListeningCard({ presence, onTrackClick }: SpotifyListeningCardProps) {
  const [currentProgress, setCurrentProgress] = useState<number>(presence?.progressMs || 0);

  useEffect(() => {
    if (!presence || !presence.isPlaying) {
      setCurrentProgress(presence?.progressMs || 0);
      return;
    }

    const startProgress = presence.progressMs || 0;
    const startTime = presence.updatedAt || Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(presence.durationMs, startProgress + elapsed);
      setCurrentProgress(progress);
    }, 1000);

    return () => clearInterval(interval);
  }, [presence]);

  if (!presence || !presence.isPlaying) return null;

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const duration = presence.durationMs || 1;
  const progressPercent = Math.min(100, Math.max(0, (currentProgress / duration) * 100));

  return (
    <div className="sh-sp-listening-card" onClick={onTrackClick}>
      {/* Top Header: Listening on Spotify with little Spotify icon */}
      <div className="sh-sp-listening-head">
        <span className="sh-sp-listening-title">Listening on Spotify</span>
        <Icon icon="logos:spotify-icon" width={16} height={16} className="sh-sp-listening-logo" />
      </div>

      <div className="sh-sp-listening-body">
        {/* Album Artwork */}
        <div className="sh-sp-album-art-wrap">
          <img
            src={presence.albumArtUrl || '/icon-192.png'}
            alt=""
            className="sh-sp-album-art"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/icon-192.png';
            }}
          />
        </div>

        {/* Info Column */}
        <div className="sh-sp-info-col">
          <div className="sh-sp-track-name" title={presence.trackName}>
            {presence.trackName}
          </div>
          <div className="sh-sp-artist-name" title={presence.artistName}>
            {presence.artistName}
          </div>

          {/* Player Progress Bar with white fill */}
          <div className="sh-sp-player-bar-row">
            <div className="sh-sp-progress-track">
              <div
                className="sh-sp-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="sh-sp-timestamps">
              <span className="sh-sp-time-left">{formatTime(currentProgress)}</span>
              <span className="sh-sp-time-right">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
