import { destroyPdfDoc, openHardenedPdfDocument, renderPdfPageToCanvas } from './pdf-render.js';

export async function comparePdfPageVisual(bytesA, bytesB, pageNumber) {
  const [docA, docB] = await Promise.all([
    openHardenedPdfDocument(bytesA),
    openHardenedPdfDocument(bytesB)
  ]);

  const canvasA = document.createElement('canvas');
  const canvasB = document.createElement('canvas');
  const diffCanvas = document.createElement('canvas');

  try {
    const pageCountA = docA.numPages;
    const pageCountB = docB.numPages;
    const safePage = Math.max(1, Math.min(Math.max(pageCountA, pageCountB), pageNumber));

    if (safePage <= pageCountA) {
      await renderPdfPageToCanvas(docA, safePage, canvasA, { scale: 1.25 });
    } else {
      canvasA.width = 400;
      canvasA.height = 560;
    }
    if (safePage <= pageCountB) {
      await renderPdfPageToCanvas(docB, safePage, canvasB, { scale: 1.25 });
    } else {
      canvasB.width = canvasA.width;
      canvasB.height = canvasA.height;
    }

    const w = Math.max(canvasA.width, canvasB.width);
    const h = Math.max(canvasA.height, canvasB.height);
    diffCanvas.width = w;
    diffCanvas.height = h;

    const ctxA = canvasA.getContext('2d');
    const ctxB = canvasB.getContext('2d');
    const ctxDiff = diffCanvas.getContext('2d');

    const dataA = ctxA.getImageData(0, 0, canvasA.width, canvasA.height);
    const dataB = ctxB.getImageData(0, 0, canvasB.width, canvasB.height);
    const diffOut = ctxDiff.createImageData(w, h);

    let changedPixels = 0;
    const totalPixels = w * h;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const outIdx = (y * w + x) * 4;
        const inA = x < canvasA.width && y < canvasA.height;
        const inB = x < canvasB.width && y < canvasB.height;
        const idxA = (y * canvasA.width + x) * 4;
        const idxB = (y * canvasB.width + x) * 4;

        const rA = inA ? dataA.data[idxA] : 255;
        const gA = inA ? dataA.data[idxA + 1] : 255;
        const bA = inA ? dataA.data[idxA + 2] : 255;
        const rB = inB ? dataB.data[idxB] : 255;
        const gB = inB ? dataB.data[idxB + 1] : 255;
        const bB = inB ? dataB.data[idxB + 2] : 255;

        const delta = Math.abs(rA - rB) + Math.abs(gA - gB) + Math.abs(bA - bB);
        if (delta > 36 || inA !== inB) {
          changedPixels++;
          // Highlight differing pixel in Seelig amber (#f2a007)
          diffOut.data[outIdx] = 242;
          diffOut.data[outIdx + 1] = 160;
          diffOut.data[outIdx + 2] = 7;
          diffOut.data[outIdx + 3] = 255;
        } else {
          // Dimmed monochrome reference
          const lum = Math.round((rA * 0.3 + gA * 0.59 + bA * 0.11) * 0.55);
          diffOut.data[outIdx] = lum;
          diffOut.data[outIdx + 1] = lum;
          diffOut.data[outIdx + 2] = lum;
          diffOut.data[outIdx + 3] = 255;
        }
      }
    }

    ctxDiff.putImageData(diffOut, 0, 0);
    const diffPercent = totalPixels > 0 ? Math.round((changedPixels / totalPixels) * 10000) / 100 : 0;

    return {
      pageCountA,
      pageCountB,
      pageNumber: safePage,
      diffPercent,
      width: w,
      height: h,
      imageDataA: dataA,
      imageDataB: dataB,
      diffImageData: diffOut
    };
  } finally {
    canvasA.width = 0;
    canvasB.width = 0;
    diffCanvas.width = 0;
    await Promise.all([destroyPdfDoc(docA), destroyPdfDoc(docB)]);
  }
}

export function diffTextLines(textA, textB) {
  const linesA = String(textA || '').split('\n');
  const linesB = String(textB || '').split('\n');
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const report = [];

  for (const line of linesA) {
    if (!setB.has(line) && line.trim()) report.push(`- ${line}`);
  }
  for (const line of linesB) {
    if (!setA.has(line) && line.trim()) report.push(`+ ${line}`);
  }
  return report.length > 0 ? report.join('\n') : 'Keine Textunterschiede erkannt.';
}
