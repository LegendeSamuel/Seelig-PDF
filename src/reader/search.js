export async function searchPdfDocument(pdfDoc, rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!pdfDoc || !query) {
    return { query: '', matches: [] };
  }
  const needle = query.toLowerCase();
  const matches = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    try {
      const textContent = await page.getTextContent();
      textContent.items.forEach((item, itemIndex) => {
        if (!('str' in item) || !item.str) return;
        const hay = item.str.toLowerCase();
        let pos = hay.indexOf(needle);
        while (pos !== -1) {
          matches.push({
            pageNumber: pageNum,
            itemIndex,
            offset: pos,
            length: needle.length
          });
          pos = hay.indexOf(needle, pos + needle.length);
        }
      });
    } finally {
      page.cleanup();
    }
  }

  return { query, matches };
}
