export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

/**
 * Crops an image given pixel coordinates from react-easy-crop,
 * drawing onto a canvas and outputting a blob and data URL.
 */
export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  outputType = 'image/jpeg',
  quality = 0.92
): Promise<{ file: File; dataUri: string }> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = Math.max(1, Math.round(pixelCrop.width));
  canvas.height = Math.max(1, Math.round(pixelCrop.height));

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        const ext = outputType === 'image/png' ? 'png' : 'jpg';
        const file = new File([blob], `cropped_${Date.now()}.${ext}`, {
          type: outputType,
        });
        const dataUri = canvas.toDataURL(outputType, quality);
        resolve({ file, dataUri });
      },
      outputType,
      quality
    );
  });
}
