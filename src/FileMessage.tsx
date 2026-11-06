import React, { useState, useEffect } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { GoogleDownloadIcon } from './GoogleIcons';
import { formatBytes, isMediaDownloaded, markMediaDownloaded, downloadToDevice } from './downloadHelper';

interface FileMessageProps {
  message: {
    id?: string;
    fileUrl?: string;
    originalUrl?: string;
    driveFileId?: string | null;
    driveOwnerUid?: string;
    fileName?: string;
    sizeBytes?: number;
    mimeType?: string;
    createdAt?: any;
    deletedFromDrive?: boolean;
    [key: string]: any;
  };
  own: boolean;
  onNotify?: (title: string, text: string) => void;
}

export const FileMessage: React.FC<FileMessageProps> = ({
  message,
  own,
  onNotify,
}) => {
  const fileKey = message.id || message.driveFileId || message.fileName || 'file';
  const [isDownloaded, setIsDownloaded] = useState(() =>
    isMediaDownloaded(fileKey, own)
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExpired, setIsExpired] = useState(Boolean(message.deletedFromDrive));

  // 14-day expiry check
  useEffect(() => {
    if (message.deletedFromDrive) {
      setIsExpired(true);
      return;
    }
    if (message.createdAt?.toMillis) {
      const age = Date.now() - message.createdAt.toMillis();
      if (age > 14 * 24 * 60 * 60 * 1000) {
        setIsExpired(true);
      }
    }
  }, [message.createdAt, message.deletedFromDrive]);

  if (isExpired) {
    return (
      <div className="shc-file-expired-box">
        <AlertCircle size={20} className="shc-file-expired-icon" />
        <span>File is unavailable. Please ask sender to send again.</span>
      </div>
    );
  }

  const fileName = message.fileName || 'file';
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() || 'FILE' : 'FILE';
  const sizeText = formatBytes(message.sizeBytes);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;

    setIsDownloading(true);
    const targetUrl = message.originalUrl || message.fileUrl || `/api/media?fileId=${encodeURIComponent(message.driveFileId || '')}&dl=1&name=${encodeURIComponent(fileName)}`;

    const success = await downloadToDevice(targetUrl, fileName);
    setIsDownloading(false);

    if (success) {
      markMediaDownloaded(fileKey);
      setIsDownloaded(true);
      onNotify?.('Download complete', `Saved ${fileName} to your device.`);
    } else {
      onNotify?.('Download failed', 'Please try again.');
    }
  };

  return (
    <div className={`shc-file-card ${own ? 'shc-file-own' : ''}`} onClick={handleDownload}>
      <div className="shc-file-badge">
        <span>{ext.slice(0, 4)}</span>
      </div>

      <div className="shc-file-info">
        <strong className="shc-file-name" title={fileName}>
          {fileName}
        </strong>
        <span className="shc-file-meta">
          {sizeText} · {ext}
        </span>
      </div>

      <button
        type="button"
        className="shc-file-dl-btn"
        onClick={handleDownload}
        disabled={isDownloading}
        aria-label={isDownloaded ? 'File downloaded' : 'Download file'}
      >
        {isDownloading ? (
          <Loader2 size={18} className="shc-spin" />
        ) : isDownloaded ? (
          <Check size={18} className="shc-file-done-check" />
        ) : (
          <GoogleDownloadIcon size={18} />
        )}
      </button>
    </div>
  );
};
export default FileMessage;
