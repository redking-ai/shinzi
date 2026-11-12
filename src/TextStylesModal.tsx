import React, { useState, useRef } from 'react';
import { ArrowLeft, Plus, Type, Trash2, Upload, Check } from 'lucide-react';
import { useDriveStore } from './driveStore';
import {
  getAllTextStyles,
  saveCustomStyle,
  deleteCustomStyle,
  parseTextStyleFile,
  type TextStyleDefinition,
} from './textStyleService';

interface TextStylesModalProps {
  onBack: () => void;
  showToast?: (msg: string) => void;
}

export default function TextStylesModal({ onBack, showToast }: TextStylesModalProps) {
  const drive = useDriveStore();
  const [styles, setStyles] = useState<Record<string, TextStyleDefinition>>(() => getAllTextStyles());
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStyles = () => {
    setStyles(getAllTextStyles());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.txt')) {
      if (showToast) showToast('Only .txt files are supported.');
      else alert('Only .txt files are supported.');
      return;
    }

    setUploading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const parsedMap = parseTextStyleFile(content);

      if (Object.keys(parsedMap).length === 0) {
        setUploading(false);
        if (showToast) showToast('Could not find valid character mappings in file.');
        else alert('Could not find valid character mappings in file.');
        return;
      }

      const rawName = file.name.replace(/\.txt$/i, '');
      const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      saveCustomStyle(formattedName, parsedMap);
      refreshStyles();

      // Upload to Google Drive Shinzi/Text Styles folder
      try {
        if (!drive.hasActiveSession) {
          await drive.connectDrive(true);
        }
        await drive.uploadFile({
          file,
          fileName: file.name,
          mimeType: 'text/plain',
          folderType: 'textStyles',
        });
      } catch (err) {
        console.warn('Drive upload to Shinzi/Text Styles failed or skipped:', err);
      } finally {
        setUploading(false);
      }

      const msg = `Added "${formattedName}" text style!`;
      if (showToast) showToast(msg);
    };

    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete text style "${name}"?`)) {
      deleteCustomStyle(id);
      refreshStyles();
      if (showToast) showToast(`Deleted "${name}"`);
    }
  };

  const handleCopyTag = (id: string) => {
    const tag = `(ts ${id})`;
    try {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(tag);
      }
      setCopiedTag(id);
      if (showToast) showToast(`Copied ${tag}`);
      setTimeout(() => setCopiedTag((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      if (showToast) showToast(`Use: ${tag}`);
    }
  };

  const styleList = Object.values(styles);

  return (
    <div className="sh-fullscreen-modal" style={{ background: '#0a0a0c', zIndex: 10000 }}>
      {/* Header matching notebook drawing 20261112_175229.jpg */}
      <div className="sh-fullscreen-modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          type="button"
          className="sh-servers-icon-btn"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#ffffff' }}>Text Styles</h2>
        <div style={{ width: 40 }} />
      </div>

      <div className="sh-fullscreen-modal-body" style={{ padding: '16px 14px 40px' }}>
        {/* Hidden input for .txt file uploads only */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".txt,text/plain"
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />

        {/* Top "+ Add new text style" button */}
        <button
          type="button"
          className="sh-ts-add-btn"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={18} />
          <span>{uploading ? 'Uploading to Drive...' : '+ Add new text style'}</span>
        </button>

        {/* Section title */}
        <div style={{ margin: '22px 0 10px', fontSize: 12, fontWeight: 700, color: '#949ba4', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Styles
        </div>

        {/* List of text styles */}
        <div className="sh-ts-list">
          {styleList.map((item) => {
            const previewChars = 'Aa Bb Cc 1 2 3';
            const sampleText = Array.from(previewChars)
              .map((c) => item.map[c] || c)
              .join('');

            return (
              <div
                key={item.id}
                className="sh-ts-card"
                onClick={() => handleCopyTag(item.id)}
              >
                <div className="sh-ts-icon-wrap">
                  <Type size={20} color="#ffffff" />
                </div>
                <div className="sh-ts-info">
                  <div className="sh-ts-name-row">
                    <span className="sh-ts-name">{item.name}</span>
                    {item.isCustom && <span className="sh-ts-badge">Custom</span>}
                  </div>
                  <div className="sh-ts-preview">{sampleText}</div>
                  <div className="sh-ts-syntax">Tag: (ts {item.id}) or {'{'}ts {item.id}{'}'}</div>
                </div>

                <div className="sh-ts-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="sh-ts-copy-pill"
                    onClick={() => handleCopyTag(item.id)}
                    title="Copy tag"
                  >
                    {copiedTag === item.id ? <Check size={14} color="#57f287" /> : <span>(ts {item.id})</span>}
                  </button>
                  {item.isCustom && (
                    <button
                      type="button"
                      className="sh-ts-delete-btn"
                      onClick={() => handleDelete(item.id, item.name)}
                      title="Delete custom style"
                    >
                      <Trash2 size={16} color="#ff4b4b" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom "+ Add new text style" button */}
        <button
          type="button"
          className="sh-ts-add-btn"
          style={{ marginTop: 24 }}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={18} />
          <span>{uploading ? 'Uploading to Drive...' : '+ Add new text style'}</span>
        </button>
      </div>
    </div>
  );
}
