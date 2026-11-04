import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { ArrowLeft, Check, ZoomIn, ZoomOut } from 'lucide-react';
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
  cropShape = 'round',
  aspect = 1,
  title = 'Edit Avatar',
  onConfirm,
  onCancel,
}) => {
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
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
      {/* Header bar matching Root app */}
      <header className="sh-crop-header">
        <button
          type="button"
          className="sh-crop-back-btn"
          onClick={onCancel}
          disabled={processing}
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <h2 className="sh-crop-title">{title}</h2>
        <button
          type="button"
          className="sh-crop-apply-btn"
          onClick={handleApply}
          disabled={processing}
          aria-label="Save crop"
        >
          {processing ? <span className="shc-spinner shc-spinner-sm" /> : <Check size={22} />}
        </button>
      </header>

      {/* Static cropping view with movable & zoomable image */}
      <div className="sh-crop-container">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={false}
          objectFit="contain"
          onCropChange={setCrop}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
          classes={{
            containerClassName: 'sh-cropper-crop-container',
            cropAreaClassName: cropShape === 'round' ? 'sh-cropper-area-round' : 'sh-cropper-area-rect',
          }}
        />
      </div>

      {/* Bottom zoom controls */}
      <div className="sh-crop-controls">
        <button
          type="button"
          className="sh-crop-zoom-btn"
          onClick={() => setZoom((z) => Math.max(1, z - 0.2))}
          aria-label="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="sh-crop-slider"
          aria-label="Zoom slider"
        />
        <button
          type="button"
          className="sh-crop-zoom-btn"
          onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
          aria-label="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
      </div>
    </div>
  );
};

export default MediaCropModal;
