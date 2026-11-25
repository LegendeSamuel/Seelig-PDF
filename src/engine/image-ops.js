import { MAX_CANVAS_DIM, MAX_CANVAS_PIXELS } from '../security/limits.js';

export async function sanitizeAndConvertImage(bytes, {
  targetFormat = 'png',
  quality = 0.88,
  maxWidth = MAX_CANVAS_DIM
} = {}) {
  const blob = new Blob([bytes]);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');

  try {
    let targetW = bitmap.width;
    let targetH = bitmap.height;
    const capW = Math.max(32, Math.min(MAX_CANVAS_DIM, Number(maxWidth) || MAX_CANVAS_DIM));

    if (targetW > capW) {
      targetH = Math.round((targetH * capW) / targetW);
      targetW = capW;
    }
    if (targetH > MAX_CANVAS_DIM) {
      targetW = Math.round((targetW * MAX_CANVAS_DIM) / targetH);
      targetH = MAX_CANVAS_DIM;
    }
    if (targetW * targetH > MAX_CANVAS_PIXELS) {
      const ratio = Math.sqrt(MAX_CANVAS_PIXELS / (targetW * targetH));
      targetW = Math.max(1, Math.floor(targetW * ratio));
      targetH = Math.max(1, Math.floor(targetH * ratio));
    }

    canvas.width = Math.max(1, targetW);
    canvas.height = Math.max(1, targetH);
    const ctx = canvas.getContext('2d');
    if (targetFormat === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Redrawing strips EXIF/metadata and neutralizes malformed image chunks
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const mime =
      targetFormat === 'jpeg'
        ? 'image/jpeg'
        : targetFormat === 'webp'
          ? 'image/webp'
          : 'image/png';

    const outBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (res) => (res ? resolve(res) : reject(new Error('Bildkonvertierung fehlgeschlagen.'))),
        mime,
        quality
      );
    });

    return {
      width: canvas.width,
      height: canvas.height,
      format: targetFormat,
      bytes: new Uint8Array(await outBlob.arrayBuffer())
    };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
