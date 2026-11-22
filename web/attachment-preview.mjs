const maxText = 65536;
export function attachmentPreview(view) {
  if (view.kind === 'image') return { kind: 'image', data: view.data };
  if (['text', 'markdown'].includes(view.kind)) return {
    kind: 'text', language: view.language, text: view.text.slice(0, maxText), truncated: view.text.length > maxText,
  };
  if (view.kind === 'table') return {
    kind: 'table', rows: view.rows.slice(0, 40).map(row => row.slice(0, 12).map(cell => String(cell).slice(0, 1000))),
    truncated: view.rows.length > 40 || view.rows.some(row => row.length > 12 || row.some(cell => String(cell).length > 1000)),
  };
  if (view.kind === 'workbook') {
    const sheet = view.sheets[0];
    if (!sheet) return { kind: 'text', text: 'This workbook has no sheets.' };
    const rows = Array.from({ length: Math.min(sheet.maxRow, 40) }, () => Array(Math.min(sheet.maxCol, 12)).fill(''));
    for (const cell of sheet.cells) if (cell.row <= rows.length && cell.col <= rows[0]?.length) rows[cell.row - 1][cell.col - 1] = String(cell.value).slice(0, 1000);
    return { kind: 'table', rows, note: sheet.name + ' · first sheet', truncated: sheet.maxRow > 40 || sheet.maxCol > 12 || view.sheets.length > 1 };
  }
  let text;
  if (view.kind === 'word') text = view.blocks.flatMap(block => block.type === 'paragraph' ? [block.text] : block.rows.flatMap(row => row.map(cell => cell.map(paragraph => paragraph.text).join(' ')).join('\t'))).join('\n\n');
  if (view.kind === 'slides') text = view.slides.map((slide, index) => 'Slide ' + (index + 1) + '\n' + slide.shapes.flatMap(shape => shape.paragraphs.map(paragraph => paragraph.text)).join('\n')).join('\n\n');
  if (text !== undefined) return { kind: 'text', text: text.slice(0, maxText), truncated: text.length > maxText, note: 'Extracted text preview' };
  return { kind: 'unsupported', notice: view.notice || 'A preview is unavailable for this file type.' };
}
