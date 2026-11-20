import React, { useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Dices, RotateCcw, X } from 'lucide-react';
import ColorPickerModal from './ColorPickerModal';
import {
  DISPLAY_EFFECTS,
  WEB_GRADIENTS_LIBRARY,
  type DisplayNameStyleConfig,
  type TextStyleEffect,
  type GradientPreset,
} from './webGradientsData';
import { applyStyleToText } from './textStyleService';
import { extractMaterialYouTheme } from './materialYouTheme';
import './DisplayNameStyleModal.css';

interface DisplayNameStyleModalProps {
  isOpen: boolean;
  rawDisplayName: string;
  username: string;
  pronouns?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  initialStyle?: DisplayNameStyleConfig | null;
  onApply: (style: DisplayNameStyleConfig) => void;
  onClose: () => void;
}

const BUILT_IN_FONT_OPTIONS = [
  { id: 'standard', name: 'Standard' },
  { id: 'journal', name: 'Journal' },
  { id: 'ashetic', name: 'Aesthetic' },
  { id: 'bold', name: 'Bold' },
  { id: 'newashetic', name: 'New Aesthetic' },
  { id: 'arabic', name: 'Arabic' },
  { id: 'superboldwhite', name: 'Super Bold' },
  { id: 'superboldblack', name: 'Sans Bold' },
  { id: 'latte', name: 'Latte' },
  { id: 'weird', name: 'Gothic' },
];

const PRESET_GRADIENT_SWATCHES: [string, string][] = [
  ['#ff0844', '#ffb199'], // Warm Flame
  ['#f6d365', '#fda085'], // Sunset Fire
  ['#00f2fe', '#4facfe'], // Electric Cyan
  ['#a855f7', '#ec4899'], // Neon Purple / Pink
  ['#84fab0', '#8fd3f4'], // Spring Mint
  ['#fbc2eb', '#a6c1ee'], // Cotton Candy
  ['#f7971e', '#ffd200'], // Golden Velvet
  ['#6a11cb', '#2575fc'], // Royal Blue
];

const GRADIENT_CATEGORIES = [
  'All',
  'Fire & Sunset',
  'Neon & Cyber',
  'Ocean & Aqua',
  'Pastel & Gummy',
  'Cosmic & Luxury',
];

export default function DisplayNameStyleModal({
  isOpen,
  rawDisplayName,
  username,
  pronouns,
  avatarUrl,
  bannerUrl,
  initialStyle,
  onApply,
  onClose,
}: DisplayNameStyleModalProps) {
  // Working state inside the modal
  const [currentFontId, setCurrentFontId] = useState<string>(
    initialStyle?.fontId || 'standard'
  );
  const [currentFontName, setCurrentFontName] = useState<string>(
    initialStyle?.fontName || 'Standard'
  );
  const [currentEffectId, setCurrentEffectId] = useState<string>(
    initialStyle?.effectId || 'standard'
  );
  const [currentColors, setCurrentColors] = useState<[string, string]>(
    initialStyle?.colors || ['#f45a18', '#ffd447']
  );
  const [currentGradientCss, setCurrentGradientCss] = useState<string>(
    initialStyle?.gradientCss || 'none'
  );

  // Sub-sheet modals
  const [activeSheet, setActiveSheet] = useState<'font' | 'effect' | 'color' | null>(null);
  const [colorPickerTarget, setColorPickerTarget] = useState<'start' | 'end' | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [surpriseLoading, setSurpriseLoading] = useState(false);

  if (!isOpen) return null;

  // Active effect object
  const activeEffectObj = DISPLAY_EFFECTS.find((e) => e.id === currentEffectId);

  // Live preview text with font transformation
  const previewText = applyStyleToText(rawDisplayName || 'Shinzi User', currentFontId);

  // Live preview CSS
  const isStyled = currentEffectId !== 'standard' && currentGradientCss !== 'none';
  const previewTextStyle: React.CSSProperties = isStyled
    ? {
        backgroundImage: currentGradientCss,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        display: 'inline-block',
        textShadow: activeEffectObj?.textShadow || undefined,
      }
    : {
        color: '#FFFFFF',
      };

  // Font Selection
  const handleSelectFont = (fontId: string, fontName: string) => {
    setCurrentFontId(fontId);
    setCurrentFontName(fontName);
    setActiveSheet(null);
  };

  // Effect Selection
  const handleSelectEffect = (effect: TextStyleEffect) => {
    setCurrentEffectId(effect.id);
    if (effect.id === 'standard') {
      setCurrentGradientCss('none');
    } else {
      setCurrentColors(effect.colors);
      setCurrentGradientCss(effect.css);
    }
    setActiveSheet(null);
  };

  // WebGradient Preset Selection
  const handleSelectWebGradient = (preset: GradientPreset) => {
    setCurrentEffectId('gradient');
    setCurrentColors(preset.colors);
    setCurrentGradientCss(preset.css);
    setActiveSheet(null);
  };

  // Custom Colors updated via color wheel
  const handleColorWheelSelect = (hex: string) => {
    if (!colorPickerTarget) return;
    const newColors: [string, string] =
      colorPickerTarget === 'start'
        ? [hex, currentColors[1]]
        : [currentColors[0], hex];

    setCurrentColors(newColors);
    const newCss = `linear-gradient(135deg, ${newColors[0]} 0%, ${newColors[1]} 100%)`;
    setCurrentGradientCss(newCss);
    if (currentEffectId === 'standard') {
      setCurrentEffectId('gradient');
    }
  };

  // Quick Preset Swatch Clicked in Color Sheet
  const handleSelectColorSwatch = (colors: [string, string]) => {
    setCurrentColors(colors);
    const newCss = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
    setCurrentGradientCss(newCss);
    if (currentEffectId === 'standard') {
      setCurrentEffectId('gradient');
    }
  };

  // Surprise Me Handler (Material You Image Analysis)
  const handleSurpriseMe = async () => {
    setSurpriseLoading(true);
    try {
      const img = bannerUrl || avatarUrl;
      const theme = await extractMaterialYouTheme(img);

      // Pick a stylish font
      const randomFonts = ['journal', 'ashetic', 'bold', 'newashetic'];
      const chosenFont = randomFonts[Math.floor(Math.random() * randomFonts.length)];
      const fontObj = BUILT_IN_FONT_OPTIONS.find((f) => f.id === chosenFont);
      setCurrentFontId(chosenFont);
      setCurrentFontName(fontObj?.name || 'Journal');

      // Create rich gradient matching profile colors
      const newColors: [string, string] = [theme.accent || '#38bdf8', theme.primary || '#818cf8'];
      setCurrentColors(newColors);
      setCurrentEffectId('prism');
      setCurrentGradientCss(`linear-gradient(135deg, ${newColors[0]} 0%, ${newColors[1]} 100%)`);
    } finally {
      setSurpriseLoading(false);
    }
  };

  // Remove Style
  const handleRemoveStyle = () => {
    setCurrentFontId('standard');
    setCurrentFontName('Standard');
    setCurrentEffectId('standard');
    setCurrentColors(['#FFFFFF', '#FFFFFF']);
    setCurrentGradientCss('none');
  };

  // Apply changes to parent
  const handleApply = () => {
    onApply({
      fontId: currentFontId,
      fontName: currentFontName,
      effectId: currentEffectId,
      colors: currentColors,
      gradientCss: currentGradientCss,
    });
    onClose();
  };

  // Filtered Web Gradients
  const filteredGradients =
    selectedCategory === 'All'
      ? WEB_GRADIENTS_LIBRARY
      : WEB_GRADIENTS_LIBRARY.filter((g) => g.category === selectedCategory);

  return (
    <div className="sh-style-modal-backdrop" role="dialog" aria-modal="true">
      <div className="sh-style-modal-window">
        {/* Header */}
        <header className="sh-style-modal-header">
          <button
            type="button"
            className="sh-style-header-back"
            onClick={onClose}
            aria-label="Go back"
          >
            <ArrowLeft size={22} />
          </button>
          <h2 className="sh-style-header-title">Change Display Name Style</h2>
          <div style={{ width: 24 }} />
        </header>

        {/* Top Preview Card (Matches Red Circle in IMG-20261120-WA0011) */}
        <section className="sh-style-preview-container">
          <div className="sh-style-mini-card">
            {/* Mini Banner */}
            <div
              className="sh-style-mini-banner"
              style={
                bannerUrl
                  ? { backgroundImage: `url("${bannerUrl}")` }
                  : { background: 'linear-gradient(135deg, #1e1035, #0f2942)' }
              }
            />

            {/* Mini Avatar & Identity */}
            <div className="sh-style-mini-body">
              <div className="sh-style-mini-avatar-wrap">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="sh-style-mini-avatar-img" />
                ) : (
                  <div className="sh-style-mini-avatar-fallback">
                    {(rawDisplayName || username || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="sh-style-mini-status-dot" />
              </div>

              {/* Styled Display Name Preview */}
              <div className="sh-style-mini-name-row">
                <span className="sh-style-mini-display-name" style={previewTextStyle}>
                  {previewText}
                </span>
              </div>

              <div className="sh-style-mini-details">
                <span className="sh-style-mini-username">{username || 'username'}</span>
                {pronouns && (
                  <>
                    <span className="sh-style-mini-bullet">•</span>
                    <span className="sh-style-mini-pronouns">{pronouns}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 3 Settings Rows (Font, Effect, Color) - IMG-20261120-WA0012 */}
        <div className="sh-style-settings-group">
          {/* Row 1: Font */}
          <div
            className="sh-style-row"
            onClick={() => setActiveSheet('font')}
            role="button"
            tabIndex={0}
          >
            <div className="sh-style-row-info">
              <span className="sh-style-row-label">Font</span>
              <span className="sh-style-row-value">{currentFontName}</span>
            </div>
            <div className="sh-style-row-right">
              <ChevronRight size={18} className="sh-style-chevron" />
            </div>
          </div>

          {/* Row 2: Effect */}
          <div
            className="sh-style-row"
            onClick={() => setActiveSheet('effect')}
            role="button"
            tabIndex={0}
          >
            <div className="sh-style-row-info">
              <span className="sh-style-row-label">Effect</span>
              <span className="sh-style-row-value">
                {activeEffectObj?.name || 'Standard'}
              </span>
            </div>
            <div className="sh-style-row-right">
              <ChevronRight size={18} className="sh-style-chevron" />
            </div>
          </div>

          {/* Row 3: Color */}
          <div
            className="sh-style-row"
            onClick={() => setActiveSheet('color')}
            role="button"
            tabIndex={0}
          >
            <div className="sh-style-row-info">
              <span className="sh-style-row-label">Color</span>
              <span className="sh-style-row-value">
                {currentColors[0]} &rarr; {currentColors[1]}
              </span>
            </div>
            <div className="sh-style-row-right">
              <div
                className="sh-style-row-swatch"
                style={{
                  background:
                    currentGradientCss === 'none'
                      ? '#FFFFFF'
                      : currentGradientCss,
                }}
              />
              <ChevronRight size={18} className="sh-style-chevron" />
            </div>
          </div>
        </div>

        {/* Surprise Me & Remove Buttons */}
        <div className="sh-style-actions-row">
          <button
            type="button"
            className="sh-style-surprise-btn"
            disabled={surpriseLoading}
            onClick={() => void handleSurpriseMe()}
          >
            <Dices size={18} />
            <span>{surpriseLoading ? 'Matching…' : 'Surprise Me'}</span>
          </button>

          <button
            type="button"
            className="sh-style-remove-btn"
            onClick={handleRemoveStyle}
          >
            <span>Remove Style</span>
          </button>
        </div>

        {/* Apply Button */}
        <div className="sh-style-bottom-bar">
          <button type="button" className="sh-style-apply-btn" onClick={handleApply}>
            Apply
          </button>
        </div>

        {/* =========================================================================
            SUB-SHEET 1: FONT PICKER (Matches IMG-20261120-WA0014)
            Shows boxes with 'Text' in each font + font name label
           ========================================================================= */}
        {activeSheet === 'font' && (
          <div
            className="sh-subsheet-overlay"
            onClick={() => setActiveSheet(null)}
            role="dialog"
            aria-modal="true"
          >
            <div className="sh-subsheet-panel" onClick={(e) => e.stopPropagation()}>
              <div className="sh-subsheet-handle" />
              <div className="sh-subsheet-header">
                <button
                  type="button"
                  className="sh-subsheet-close"
                  onClick={() => setActiveSheet(null)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
                <h3 className="sh-subsheet-title">Font</h3>
                <button
                  type="button"
                  className="sh-subsheet-select-btn"
                  onClick={() => setActiveSheet(null)}
                >
                  Select
                </button>
              </div>

              {/* Grid of Font Boxes showing 'Text' + Style Name */}
              <div className="sh-font-grid">
                {BUILT_IN_FONT_OPTIONS.map((font) => {
                  const isSelected = currentFontId === font.id;
                  const sampleText = applyStyleToText('Text', font.id);
                  return (
                    <button
                      key={font.id}
                      type="button"
                      className={`sh-font-box ${isSelected ? 'sh-font-box-active' : ''}`}
                      onClick={() => handleSelectFont(font.id, font.name)}
                    >
                      <span className="sh-font-sample">{sampleText}</span>
                      <span className="sh-font-name">{font.name}</span>
                      {isSelected && <div className="sh-font-indicator" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SUB-SHEET 2: EFFECT PICKER (Matches IMG-20261120-WA0009 & 400+ Gradients)
           ========================================================================= */}
        {activeSheet === 'effect' && (
          <div
            className="sh-subsheet-overlay"
            onClick={() => setActiveSheet(null)}
            role="dialog"
            aria-modal="true"
          >
            <div className="sh-subsheet-panel" onClick={(e) => e.stopPropagation()}>
              <div className="sh-subsheet-handle" />
              <div className="sh-subsheet-header">
                <button
                  type="button"
                  className="sh-subsheet-close"
                  onClick={() => setActiveSheet(null)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
                <h3 className="sh-subsheet-title">Effect</h3>
                <button
                  type="button"
                  className="sh-subsheet-select-btn"
                  onClick={() => setActiveSheet(null)}
                >
                  Select
                </button>
              </div>

              {/* Discord Main Effects (Standard, Gradient, Neon, Toon, Pop, Gummy, Prism) */}
              <span className="sh-subsheet-section-title">DISCORD STYLES</span>
              <div className="sh-effect-grid">
                {DISPLAY_EFFECTS.map((eff) => {
                  const isSelected = currentEffectId === eff.id;
                  return (
                    <button
                      key={eff.id}
                      type="button"
                      className={`sh-effect-box ${isSelected ? 'sh-effect-box-active' : ''}`}
                      onClick={() => handleSelectEffect(eff)}
                    >
                      <span
                        className="sh-effect-sample"
                        style={
                          eff.id !== 'standard'
                            ? {
                                backgroundImage: eff.css,
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                textShadow: eff.textShadow || undefined,
                              }
                            : { color: '#FFFFFF' }
                        }
                      >
                        {eff.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 400+ Web Gradients Section */}
              <div className="sh-subsheet-divider" />
              <div className="sh-subsheet-categories-header">
                <span className="sh-subsheet-section-title">400+ DESIGNER GRADIENTS</span>
                <div className="sh-category-pills">
                  {GRADIENT_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`sh-category-pill ${selectedCategory === cat ? 'sh-category-pill-active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sh-web-gradient-grid">
                {filteredGradients.map((g) => {
                  const isSelected =
                    currentGradientCss.toLowerCase() === g.css.toLowerCase();
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`sh-web-gradient-card ${isSelected ? 'sh-web-gradient-card-active' : ''}`}
                      onClick={() => handleSelectWebGradient(g)}
                    >
                      <div
                        className="sh-web-gradient-chip"
                        style={{ background: g.css }}
                      />
                      <span className="sh-web-gradient-name">{g.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SUB-SHEET 3: COLOR CUSTOMIZER (Matches IMG-20261120-WA0010 with 2 Boxes)
            User specified: 2 custom boxes (Start Color & End Color) on the bar.
            Tapping opens our circular color wheel titled 'Pick Text Color'!
           ========================================================================= */}
        {activeSheet === 'color' && (
          <div
            className="sh-subsheet-overlay"
            onClick={() => setActiveSheet(null)}
            role="dialog"
            aria-modal="true"
          >
            <div className="sh-subsheet-panel" onClick={(e) => e.stopPropagation()}>
              <div className="sh-subsheet-handle" />
              <div className="sh-subsheet-header">
                <button
                  type="button"
                  className="sh-subsheet-close"
                  onClick={() => setActiveSheet(null)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
                <h3 className="sh-subsheet-title">Color</h3>
                <button
                  type="button"
                  className="sh-subsheet-select-btn"
                  onClick={() => setActiveSheet(null)}
                >
                  Select
                </button>
              </div>

              {/* 2-Box Gradient Bar (Start Color left, End Color right) */}
              <div className="sh-color-gradient-bar-wrap">
                <div
                  className="sh-color-gradient-track"
                  style={{
                    background: `linear-gradient(90deg, ${currentColors[0]} 0%, ${currentColors[1]} 100%)`,
                  }}
                >
                  {/* Left Box (Start Color) */}
                  <div
                    className="sh-color-endpoint-box"
                    style={{ backgroundColor: currentColors[0] }}
                    onClick={() => setColorPickerTarget('start')}
                    role="button"
                    tabIndex={0}
                    title="Change Start Color"
                  >
                    <span className="sh-color-endpoint-tag">1</span>
                  </div>

                  {/* Right Box (End Color) */}
                  <div
                    className="sh-color-endpoint-box"
                    style={{ backgroundColor: currentColors[1] }}
                    onClick={() => setColorPickerTarget('end')}
                    role="button"
                    tabIndex={0}
                    title="Change End Color"
                  >
                    <span className="sh-color-endpoint-tag">2</span>
                  </div>
                </div>
              </div>

              {/* Preset Swatches Row */}
              <div className="sh-color-swatches-row">
                {PRESET_GRADIENT_SWATCHES.map((colors, i) => {
                  const css = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
                  const isSelected =
                    currentColors[0].toUpperCase() === colors[0].toUpperCase() &&
                    currentColors[1].toUpperCase() === colors[1].toUpperCase();
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`sh-color-swatch-pill ${isSelected ? 'sh-color-swatch-pill-active' : ''}`}
                      style={{ background: css }}
                      onClick={() => handleSelectColorSwatch(colors)}
                    >
                      {isSelected && <Check size={14} color="#ffffff" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>

              {/* Reset Button */}
              <div className="sh-color-reset-wrap">
                <button
                  type="button"
                  className="sh-color-reset-btn"
                  onClick={() =>
                    handleSelectColorSwatch(['#f45a18', '#ffd447'])
                  }
                >
                  <RotateCcw size={16} />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Circular Color Wheel Modal (Screenshot_20261120-165854_Shinzi) */}
        <ColorPickerModal
          isOpen={Boolean(colorPickerTarget)}
          title="Pick Text Color"
          initialColor={
            colorPickerTarget === 'start' ? currentColors[0] : currentColors[1]
          }
          onSelect={handleColorWheelSelect}
          onClose={() => setColorPickerTarget(null)}
        />
      </div>
    </div>
  );
}
