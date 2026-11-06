import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { GoogleDownloadIcon, GooglePlayIcon } from './GoogleIcons';
import { formatBytes, isMediaDownloaded, markMediaDownloaded, downloadToDevice } from './downloadHelper';

export interface MediaItem {
  id?: string;
  type: 'image' | 'video';
  mediaUrl: string;
  originalUrl?: string;
  driveFileId?: string | null;
  fileName?: string;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

interface MediaGridProps {
  items: MediaItem[];
  caption?: string;
  own: boolean;
  messageId: string;
  createdAt?: any;
  deletedFromDrive?: boolean;
  onOpenImage: (item: MediaItem) => void;
  onOpenVideo: (item: MediaItem) => void;
  onOpenGallery: (items: MediaItem[], startIndex: number) => void;
  onNotify?: (title: string, text: string) => void;
}

export const MediaGrid: React.FC<MediaGridProps> = ({
  items,
  caption,
  own,
  messageId,
  createdAt,
  deletedFromDrive,
  onOpenImage,
  onOpenVideo,
  onOpenGallery,
  onNotify,
}) => {
  const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    items.forEach((it, idx) => {
      const key = it.id || `${messageId}_${idx}`;
      init[key] = isMediaDownloaded(key, own);
    });
    return init;
  });

  const [downloadingMap, setDownloadingMap] = useState<Record<string, boolean>>({});
  const [isExpired, setIsExpired] = useState(Boolean(deletedFromDrive));

  // Check 14-day expiry rule
  useEffect(() => {
    if (deletedFromDrive) {
      setIsExpired(true);
      return;
    }
    if (createdAt?.toMillis) {
      const now = Date.now();
      const age = now - createdAt.toMillis();
      if (age > 14 * 24 * 60 * 60 * 1000) {
        setIsExpired(true);
      }
    }
  }, [createdAt, deletedFromDrive]);

  if (!items || items.length === 0) return null;

  if (isExpired) {
    return (
      <div className="shc-media-expired-box">
        <AlertCircle size={20} className="shc-media-expired-icon" />
        <span>Photo / video is unavailable. Please ask sender to send again.</span>
      </div>
    );
  }

  const handleDownloadItem = async (e: React.MouseEvent, it: MediaItem, idx: number) => {
    e.stopPropagation();
    const key = it.id || `${messageId}_${idx}`;
    if (downloadingMap[key] || downloadedMap[key]) return;

    setDownloadingMap((prev) => ({ ...prev, [key]: true }));

    const url = it.originalUrl || it.mediaUrl;
    const name = it.fileName || (it.type === 'video' ? 'video.mp4' : 'photo.jpg');

    const success = await downloadToDevice(url, name);
    setDownloadingMap((prev) => ({ ...prev, [key]: false }));

    if (success) {
      markMediaDownloaded(key);
      setDownloadedMap((prev) => ({ ...prev, [key]: true }));
      onNotify?.('Download complete', `Saved ${name} to your device.`);
    } else {
      onNotify?.('Download failed', 'Please try again.');
    }
  };

  const handleItemClick = (it: MediaItem, idx: number) => {
    const key = it.id || `${messageId}_${idx}`;
    const isDownloaded = downloadedMap[key];

    // If not downloaded yet, clicking triggers download
    if (!isDownloaded) {
      void handleDownloadItem({ stopPropagation: () => {} } as any, it, idx);
      return;
    }

    if (items.length > 4 && idx === 3) {
      onOpenGallery(items, 3);
      return;
    }

    if (it.type === 'video') {
      onOpenVideo(it);
    } else {
      onOpenImage(it);
    }
  };

  const total = items.length;
  let layoutClass = 'shc-grid-1';
  if (total === 2) layoutClass = 'shc-grid-2';
  else if (total === 3) layoutClass = 'shc-grid-3';
  else if (total >= 4) layoutClass = 'shc-grid-4';

  const visibleItems = total > 4 ? items.slice(0, 4) : items;
  const remainingCount = total - 3;

  return (
    <div className="shc-media-group-container">
      <div className={`shc-media-grid ${layoutClass}`}>
        {visibleItems.map((it, idx) => {
          const key = it.id || `${messageId}_${idx}`;
          const isDownloaded = downloadedMap[key];
          const isDownloading = downloadingMap[key];
          const isMoreCell = total > 4 && idx === 3;

          return (
            <div
              key={key}
              className={`shc-media-cell cell-${idx + 1}`}
              onClick={() => handleItemClick(it, idx)}
            >
              {it.type === 'video' ? (
                <video
                  src={it.mediaUrl}
                  className={`shc-media-content ${!isDownloaded ? 'shc-media-blurred' : ''}`}
                  preload="metadata"
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={it.mediaUrl}
                  alt={it.fileName || 'Photo'}
                  className={`shc-media-content ${!isDownloaded ? 'shc-media-blurred' : ''}`}
                  loading="lazy"
                  decoding="async"
                />
              )}

              {/* WhatsApp-style Download Pill when not downloaded */}
              {!isDownloaded && (
                <div
                  className="shc-media-dl-pill"
                  onClick={(e) => void handleDownloadItem(e, it, idx)}
                  role="button"
                  tabIndex={0}
                  aria-label="Download media"
                >
                  {isDownloading ? (
                    <Loader2 size={16} className="shc-spin" />
                  ) : (
                    <>
                      <GoogleDownloadIcon size={16} />
                      <span>{formatBytes(it.sizeBytes)}</span>
                    </>
                  )}
                </div>
              )}

              {/* Video Play Button when downloaded */}
              {isDownloaded && it.type === 'video' && !isMoreCell && (
                <div className="shc-video-play-btn" aria-label="Play video">
                  <GooglePlayIcon size={26} />
                </div>
              )}

              {/* +N Remaining Overlay for 4th Cell */}
              {isMoreCell && (
                <div className="shc-media-more-overlay">
                  <span>+{remainingCount}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {caption && <div className="shc-media-caption">{caption}</div>}
    </div>
  );
};
export default MediaGrid;
