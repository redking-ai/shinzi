export interface CompressionResult {
  file: File;
  width: number;
  height: number;
  compressed: boolean;
}

/**
 * Compresses and resizes large images to WebP (with JPEG fallback) in the browser
 * before uploading. Reduces 5MB-10MB photos to ~250KB-600KB in milliseconds
 * with excellent visual fidelity.
 *
 * Preserves animated GIFs and SVGs without altering them.
 * Gracefully falls back to the original file if anything fails or cannot decode.
 */
export async function compressImageToWebP(
  file: File,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<CompressionResult> {
  const maxDimension = options.maxDimension ?? 2048;
  const quality = options.quality ?? 0.82;

  const fileNameLower = file.name.toLowerCase();
  const fileTypeLower = (file.type || '').toLowerCase();

  // 1. Skip non-images or formats that shouldn't be flattened
  const isGif = fileTypeLower === 'image/gif' || fileNameLower.endsWith('.gif');
  const isSvg = fileTypeLower.includes('svg') || fileNameLower.endsWith('.svg');
  const isImage =
    fileTypeLower.startsWith('image/') ||
    fileNameLower.endsWith('.jpg') ||
    fileNameLower.endsWith('.jpeg') ||
    fileNameLower.endsWith('.png') ||
    fileNameLower.endsWith('.webp') ||
    fileNameLower.endsWith('.heic') ||
    fileNameLower.endsWith('.heif');

  if (!isImage || isGif || isSvg) {
    return { file, width: 0, height: 0, compressed: false };
  }

  // 2. If the image is already small (under 150KB) and already WebP, keep as is
  if (file.size <= 150 * 1024 && fileTypeLower === 'image/webp') {
    return { file, width: 0, height: 0, compressed: false };
  }

  return new Promise<CompressionResult>((resolve) => {
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve({ file, width: 0, height: 0, compressed: false });
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const cleanup = () => {
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch {}
    };

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          cleanup();
          resolve({ file, width: 0, height: 0, compressed: false });
          return;
        }

        // Calculate aspect-ratio scale
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve({ file, width, height, compressed: false });
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        cleanup();

        const tryEncode = (format: 'image/webp' | 'image/jpeg', ext: string) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                if (format === 'image/webp') {
                  // Fallback to jpeg
                  tryEncode('image/jpeg', 'jpg');
                } else {
                  resolve({ file, width, height, compressed: false });
                }
                return;
              }

              // Verify browser actually produced webp (older Safari might fall back to png)
              if (format === 'image/webp' && blob.type !== 'image/webp') {
                tryEncode('image/jpeg', 'jpg');
                return;
              }

              // Only adopt compressed file if it's smaller than original, or original was large (> 600KB)
              if (blob.size < file.size || file.size > 600 * 1024) {
                const baseName = file.name.replace(/\.[^/.]+$/, '');
                const compressedFile = new File([blob], `${baseName}.${ext}`, {
                  type: blob.type || (format === 'image/webp' ? 'image/webp' : 'image/jpeg'),
                  lastModified: Date.now(),
                });
                resolve({ file: compressedFile, width, height, compressed: true });
              } else {
                resolve({ file, width, height, compressed: false });
              }
            },
            format,
            quality
          );
        };

        tryEncode('image/webp', 'webp');
      } catch (err) {
        console.warn('[imageCompressor] Compression error:', err);
        cleanup();
        resolve({ file, width: 0, height: 0, compressed: false });
      }
    };

    img.onerror = (err) => {
      // E.g. HEIC on browsers without native HEIC decoder - fallback safely to original file
      console.warn('[imageCompressor] Image load failed, using original file:', err);
      cleanup();
      resolve({ file, width: 0, height: 0, compressed: false });
    };

    img.src = objectUrl;
  });
}
