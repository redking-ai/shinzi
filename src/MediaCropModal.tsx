import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { X, Check, RotateCw, Crop } from 'lucide-react';
import { getCroppedImg } from './cropImageHelper';
import './MediaCropModal.css';

export interface MediaCropModalProps {
  imageSrc: string;
  cropShape?: 'round' | 'rect';
  aspect?: number;
  title?: string;
  onConfirm: (result: { file: File; dataUri: string }) => void;
  onCancel: () => void;
}

export const MediaCropModal: React.FC<MediaCropModalProps> = ({
  imageSrc,
  cropShape = 'rect',
  aspect = 1,
  title = 'Edit Image',
  onConfirm,
  onCancel,
}) => {
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);

  const onCropComplete = useCallback((_croppedArea: Area, pixelCrop: Area) => {
    setCroppedAreaPixels(pixelCrop);
  }, []);

  const handleApply = async () => {
    if (!croppedAreaPixels || processing) return;
    setProcessing(true);
    try {
      const result = await getCroppedImg(imageSrc, croppedAreaPixels);
      onConfirm(result);
    } catch (err) {
      console.error('Failed to crop image:', err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="sh-crop-modal" role="dialog" aria-modal="true" aria-label={title}>
      {/* Discord-style Header: ✕ on left, Edit Image in center, ✓ on right */}
      <header className="sh-crop-header">
        <button
          type="button"
          className="sh-crop-back-btn"
          onClick={onCancel}
          disabled={processing}
          aria-label="Cancel"
          title="Cancel"
        >
          <X size={22} />
        </button>
        <h2 className="sh-crop-title">{title}</h2>
        <button
          type="button"
          className="sh-crop-apply-btn"
          onClick={handleApply}
          disabled={processing}
          aria-label="Save"
          title="Save"
        >
          {processing ? <span className="shc-spinner shc-spinner-sm" /> : <Check size={22} />}
        </button>
      </header>

      {/* Static cropping view with Discord-style Box Scaler & 3x3 Grid */}
      <div className="sh-crop-container">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={true}
          objectFit="contain"
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          classes={{
            containerClassName: 'sh-cropper-crop-container',
            cropAreaClassName: cropShape === 'round' ? 'sh-cropper-area-round' : 'sh-cropper-area-rect',
          }}
        />
      </div>

      {/* Discord-style Bottom Controls with Zoom Percentage */}
      <footer className="sh-crop-footer">
        <div className="sh-crop-percentage">{Math.round(zoom * 100)}%</div>
        <div className="sh-crop-controls">
          <button
            type="button"
            className="sh-crop-ctrl-btn"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label="Rotate"
            title="Rotate"
          >
            <RotateCw size={20} />
          </button>

          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="sh-crop-slider"
            aria-label="Scale slider"
          />

          <button
            type="button"
            className="sh-crop-ctrl-btn"
            onClick={() => setZoom(1)}
            aria-label="Reset scale"
            title="Reset scale"
          >
            <Crop size={20} />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MediaCropModal;
