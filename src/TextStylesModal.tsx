import React, { useState, useRef } from 'react';
import { ArrowLeft, Plus, Type, Trash2 } from 'lucide-react';
import { useDriveStore } from './driveStore';
import {
  getAllTextStyles,
  saveCustomStyle,
  saveCustomFontStyle,
  deleteCustomStyle,
  parseTextStyleFile,
  extractFontFamilyFromTTF,
  registerFontFace,
  type TextStyleDefinition,
} from './textStyleService';

interface TextStylesModalProps {
  onBack: () => void;
  showToast?: (msg: string) => void;
}

export default function TextStylesModal({ onBack, showToast }: TextStylesModalProps) {
  const drive = useDriveStore();
  const [styles, setStyles] = useState<Record<string, TextStyleDefinition>>(() => getAllTextStyles());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStyles = () => {
    setStyles(getAllTextStyles());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();

    // Check for OFL.txt or license files
    const isLicenseFile =
      lowerName === 'ofl.txt' ||
      lowerName === 'license.txt' ||
      lowerName.startsWith('ofl') ||
      lowerName.includes('license');

    if (isLicenseFile) {
      const msg =
        'OFL.txt is the Open Font License text file, not a font. In that folder, please select the font file (e.g. BBHBogle-Regular.ttf) to import the actual font!';
      if (showToast) showToast(msg);
      else alert(msg);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const isFont = /\.(ttf|otf|woff|woff2)$/i.test(file.name);
    const isTxt = lowerName.endsWith('.txt');

    if (!isFont && !isTxt) {
      const msg = 'Please choose a font file (.ttf, .otf, .woff) or a text mapping (.txt).';
      if (showToast) showToast(msg);
      else alert(msg);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);

    // 1. Handle Font File (.ttf, .otf, .woff, .woff2)
    if (isFont) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          let fontFamily = extractFontFamilyFromTTF(arrayBuffer);
          if (!fontFamily) {
            fontFamily = file.name
              .replace(/\.(ttf|otf|woff|woff2)$/i, '')
              .replace(/[-_]?(regular|bold|italic|variablefont.*)$/i, '')
              .replace(/([a-z])([A-Z])/g, '$1 $2')
              .trim();
          }

          // Build Data URL for dynamic registration
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const mime = file.type || 'font/ttf';
          const dataUrl = `data:${mime};base64,${base64}`;

          // Register in document
          registerFontFace(fontFamily, dataUrl);

          // Save custom font style
          const saved = saveCustomFontStyle(fontFamily, dataUrl);
          refreshStyles();

          // Upload to user's Google Drive Shinzi/Text Styles folder
          try {
            if (!drive.hasActiveSession) {
              await drive.connectDrive(true);
            }
            await drive.uploadFile({
              file,
              fileName: file.name,
              mimeType: mime,
              folderType: 'textStyles',
            });
          } catch (err) {
            console.warn('Drive upload to Shinzi/Text Styles failed or skipped:', err);
          }

          const msg = `Added "${fontFamily}" font style! Use (ts ${saved.id})`;
          if (showToast) showToast(msg);
        } catch (err) {
          console.error('Font import error:', err);
          if (showToast) showToast('Failed to load font file.');
        } finally {
          setUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 2. Handle Text Mapping File (.txt)
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
      if (showToast) showToast(`Copied ${tag}`);
    } catch {
      if (showToast) showToast(`Use: ${tag}`);
    }
  };

  const styleList = Object.values(styles);

  return (
    <div className="sh-settings-page sh-ts-page">
      <header className="sh-settings-header">
        <div className="sh-settings-header-left">
          <button
            type="button"
            className="sh-settings-back-btn"
            onClick={onBack}
            aria-label="Back to Settings"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="sh-settings-title">Text styles</h1>
        </div>
        <div className="sh-settings-header-spacer" />
      </header>

      <main className="sh-settings-content" style={{ paddingBottom: 40 }}>
        {/* Hidden File Input supporting .txt and font files */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".txt,.ttf,.otf,.woff,.woff2"
          style={{ display: 'none' }}
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
            const sampleText = item.type === 'font'
              ? previewChars
              : Array.from(previewChars)
                  .map((c) => item.map?.[c] || c)
                  .join('');

            return (
              <div
                key={item.id}
                className="sh-ts-card"
              >
                <div className="sh-ts-icon-wrap">
                  <Type size={20} color="#ffffff" />
                </div>
                <div className="sh-ts-info">
                  <div className="sh-ts-name-row">
                    <span className="sh-ts-name">{item.name}</span>
                    {item.isCustom && <span className="sh-ts-badge">{item.type === 'font' ? 'Font' : 'Custom'}</span>}
                  </div>
                  <div
                    className="sh-ts-preview"
                    style={item.fontFamily ? { fontFamily: `"${item.fontFamily}", sans-serif` } : undefined}
                  >
                    {sampleText}
                  </div>
                  <div className="sh-ts-syntax">Tag: (ts {item.id}) or {'{'}ts {item.id}{'}'}</div>
                </div>

                <div className="sh-ts-actions">
                  <button
                    type="button"
                    className="sh-ts-copy-pill"
                    onClick={() => handleCopyTag(item.id)}
                    title="Copy tag"
                  >
                    <span>(ts {item.id})</span>
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
      </main>
    </div>
  );
}
