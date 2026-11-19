import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import './ColorPickerModal.css';

interface ColorPickerModalProps {
  isOpen: boolean;
  title?: string;
  initialColor?: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}

const PRESET_SWATCHES = [
  '#5865F2', // Blurple
  '#57F287', // Green
  '#FEE75C', // Yellow
  '#EB459E', // Pink
  '#ED4245', // Red
  '#9B59B6', // Purple
  '#00A8FC', // Sky
  '#FFFFFF', // White
  '#4E5058', // Slate
  '#000000', // Black
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toH = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  let r = 0,
    g = 0,
    b = 0;
  const i = Math.floor((h / 60) % 6);
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const luma = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return luma > 180;
}

export default function ColorPickerModal({
  isOpen,
  title = 'Pick a Color',
  initialColor = '#000000',
  onSelect,
  onClose,
}: ColorPickerModalProps) {
  const [currentColor, setCurrentColor] = useState<string>('#000000');
  const [hexInput, setHexInput] = useState<string>('#000000');
  const [hue, setHue] = useState<number>(0);
  const [saturation, setSaturation] = useState<number>(0);
  const [value, setValue] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hueBarRef = useRef<HTMLDivElement | null>(null);
  const isDraggingWheel = useRef<boolean>(false);
  const isDraggingHue = useRef<boolean>(false);

  // Initialize values when opened
  useEffect(() => {
    if (!isOpen) return;
    const clean = initialColor && initialColor.trim() ? initialColor.trim() : '#000000';
    setCurrentColor(clean.toUpperCase());
    setHexInput(clean.toUpperCase());

    const rgb = hexToRgb(clean) || { r: 0, g: 0, b: 0 };
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setValue(hsv.v);
  }, [isOpen, initialColor]);

  const WHEEL_SIZE = 220;
  const RADIUS = WHEEL_SIZE / 2;

  // Redraw canvas wheel whenever Hue changes
  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

    // Circular clip path
    ctx.beginPath();
    ctx.arc(RADIUS, RADIUS, RADIUS, 0, Math.PI * 2);
    ctx.clip();

    // Horizontal gradient: white to pure hue
    const gradH = ctx.createLinearGradient(0, 0, WHEEL_SIZE, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, `hsl(${hue}, 100%, 50%)`);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

    // Vertical gradient: transparent to black
    const gradV = ctx.createLinearGradient(0, 0, 0, WHEEL_SIZE);
    gradV.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradV.addColorStop(1, '#000000');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

    ctx.restore();
  }, [hue, RADIUS, WHEEL_SIZE]);

  useEffect(() => {
    if (isOpen) {
      drawWheel();
    }
  }, [isOpen, drawWheel]);

  // Compute (x, y) position of thumb inside the wheel
  const getDotPos = useCallback(() => {
    const x0 = saturation * WHEEL_SIZE;
    const y0 = (1 - value) * WHEEL_SIZE;
    const dx = x0 - RADIUS;
    const dy = y0 - RADIUS;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > RADIUS) {
      return {
        x: RADIUS + (dx / dist) * RADIUS,
        y: RADIUS + (dy / dist) * RADIUS,
      };
    }
    return { x: x0, y: y0 };
  }, [saturation, value, RADIUS, WHEEL_SIZE]);

  // Update color from wheel coordinates
  const updateFromWheelCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      const dx = mx - RADIUS;
      const dy = my - RADIUS;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let px = mx;
      let py = my;
      if (dist > RADIUS) {
        px = RADIUS + (dx / dist) * RADIUS;
        py = RADIUS + (dy / dist) * RADIUS;
      }

      const newS = Math.max(0, Math.min(1, px / WHEEL_SIZE));
      const newV = Math.max(0, Math.min(1, 1 - py / WHEEL_SIZE));

      setSaturation(newS);
      setValue(newV);

      const rgb = hsvToRgb(hue, newS, newV);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setCurrentColor(hex);
      setHexInput(hex);
    },
    [RADIUS, WHEEL_SIZE, hue]
  );

  // Update color from Hue slider
  const updateFromHueBar = useCallback(
    (clientX: number) => {
      const bar = hueBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newHue = Math.round(pct * 360) % 360;

      setHue(newHue);
      const rgb = hsvToRgb(newHue, saturation, value);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setCurrentColor(hex);
      setHexInput(hex);
    },
    [saturation, value]
  );

  // Wheel pointer events
  const handleWheelPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDraggingWheel.current = true;
    updateFromWheelCoords(e.clientX, e.clientY);
  };

  const handleWheelPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingWheel.current) return;
    updateFromWheelCoords(e.clientX, e.clientY);
  };

  const handleWheelPointerUp = (e: React.PointerEvent) => {
    if (isDraggingWheel.current) {
      isDraggingWheel.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  // Hue bar pointer events
  const handleHuePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDraggingHue.current = true;
    updateFromHueBar(e.clientX);
  };

  const handleHuePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingHue.current) return;
    updateFromHueBar(e.clientX);
  };

  const handleHuePointerUp = (e: React.PointerEvent) => {
    if (isDraggingHue.current) {
      isDraggingHue.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  // Handle manual typing of #hex code
  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    if (!val.startsWith('#')) {
      val = '#' + val;
    }
    setHexInput(val);

    const rgb = hexToRgb(val);
    if (rgb) {
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setCurrentColor(hex);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setValue(hsv.v);
    }
  };

  // Handle preset swatch selection
  const handleSelectSwatch = (swatch: string) => {
    const clean = swatch.toUpperCase();
    setCurrentColor(clean);
    setHexInput(clean);
    const rgb = hexToRgb(clean) || { r: 0, g: 0, b: 0 };
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setValue(hsv.v);
  };

  if (!isOpen) return null;

  const dotPos = getDotPos();

  return (
    <div className="sh-color-picker-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sh-color-picker-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Drag handle pill */}
        <div className="sh-color-picker-handle" />

        {/* Header */}
        <div className="sh-color-picker-header">
          <button type="button" className="sh-color-picker-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <h3 className="sh-color-picker-title">{title}</h3>
          <button
            type="button"
            className="sh-color-picker-select-btn"
            onClick={() => {
              onSelect(currentColor);
              onClose();
            }}
          >
            Select
          </button>
        </div>

        {/* Custom #HEX input field */}
        <div className="sh-color-picker-hex-row">
          <div
            className="sh-color-picker-preview-chip"
            style={{ backgroundColor: currentColor }}
            aria-hidden="true"
          />
          <input
            type="text"
            className="sh-color-picker-hex-input"
            value={hexInput}
            onChange={handleHexInputChange}
            maxLength={7}
            placeholder="#000000"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {/* Preset Swatches Row */}
        <div className="sh-color-picker-swatches">
          {PRESET_SWATCHES.map((swatch) => {
            const isSelected = currentColor.toUpperCase() === swatch.toUpperCase();
            const light = isLightColor(swatch);
            return (
              <button
                key={swatch}
                type="button"
                className={`sh-color-picker-swatch ${isSelected ? 'sh-color-picker-swatch-active' : ''}`}
                style={{ backgroundColor: swatch }}
                onClick={() => handleSelectSwatch(swatch)}
                aria-label={`Select color ${swatch}`}
              >
                {isSelected && (
                  <Check
                    size={14}
                    color={light ? '#000000' : '#ffffff'}
                    strokeWidth={3}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Circular Color Wheel */}
        <div className="sh-color-picker-wheel-container">
          <div
            className="sh-color-picker-wheel-wrap"
            style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
            onPointerDown={handleWheelPointerDown}
            onPointerMove={handleWheelPointerMove}
            onPointerUp={handleWheelPointerUp}
          >
            <canvas
              ref={canvasRef}
              width={WHEEL_SIZE}
              height={WHEEL_SIZE}
              className="sh-color-picker-canvas"
            />
            {/* Draggable indicator dot */}
            <div
              className="sh-color-picker-dot"
              style={{
                left: `${dotPos.x}px`,
                top: `${dotPos.y}px`,
                backgroundColor: currentColor,
              }}
            />
          </div>
        </div>

        {/* Bottom Rainbow Hue Slider Bar */}
        <div className="sh-color-picker-slider-wrap">
          <div
            ref={hueBarRef}
            className="sh-color-picker-hue-bar"
            onPointerDown={handleHuePointerDown}
            onPointerMove={handleHuePointerMove}
            onPointerUp={handleHuePointerUp}
          >
            <div
              className="sh-color-picker-hue-thumb"
              style={{
                left: `${(hue / 360) * 100}%`,
                backgroundColor: `hsl(${hue}, 100%, 50%)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
