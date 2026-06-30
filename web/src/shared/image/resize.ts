// resizeImageToBlob — даун-скейлит картинку через canvas и пересохраняет
// как baseline JPEG с правильным EXIF-rotation. Решает:
//   • iOS Safari progressive-JPG «шторка» (canvas всегда выдаёт baseline);
//   • HEIC/огромные фото с камеры — десериализуются canvas'ом в JPEG;
//   • EXIF rotation iPhone-камеры — createImageBitmap респектит ориентацию;
//   • upload в 5-10× меньше — мобильный канал тянет быстрее.
//
// Возвращает File, плюс реальные пиксельные width/height после ресайза —
// нужно для backend-стороны (photo-set передаёт ширину/высоту чтобы фронт
// в фиде сразу резервировал aspect-ratio без layout shift).
export interface ResizedImage {
  file: File;
  width: number;
  height: number;
}

export async function resizeImageToBlob(
  file: File,
  maxSize: number,
  quality: number,
): Promise<ResizedImage> {
  const source = await loadImageRespectingExif(file);
  const sourceW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sourceH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const { width, height } = scaleToFit(sourceW, sourceH, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unsupported');
  // Прозрачность не нужна, заполним фоном чтобы серых полей не было
  // даже если EXIF неожиданно не учёлся.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return new Promise<ResizedImage>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas_toblob_null'));
          return;
        }
        const baseName = file.name.replace(/\.\w+$/, '') || 'image';
        resolve({
          file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }),
          width,
          height,
        });
      },
      'image/jpeg',
      quality,
    );
  });
}

async function loadImageRespectingExif(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Старый Safari без второго аргумента — fallback ниже.
    }
  }
  return fileToHtmlImage(file);
}

function fileToHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = (): void => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode'));
    };
    img.src = url;
  });
}

function scaleToFit(w: number, h: number, maxSize: number): { width: number; height: number } {
  if (w <= maxSize && h <= maxSize) return { width: w, height: h };
  if (w >= h) return { width: maxSize, height: Math.round((h / w) * maxSize) };
  return { width: Math.round((w / h) * maxSize), height: maxSize };
}
