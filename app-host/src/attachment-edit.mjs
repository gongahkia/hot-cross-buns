import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

export function selectedPages(value, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 2000 || typeof value !== 'string' || value.length > 2000) throw new Error('Choose a valid PDF page range.');
  if (!value.trim()) { if (count > 300) throw new Error('Select up to 300 PDF pages.'); return Array.from({ length: count }, (_, i) => i); }
  const pages = new Set();
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error('Use page numbers such as 1-3, 5.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > count) throw new Error('A selected page is outside this PDF.');
    for (let page = first; page <= last; page++) { pages.add(page - 1); if (pages.size > 300) throw new Error('Select up to 300 PDF pages.'); }
  }
  return [...pages].sort((a, b) => a - b);
}
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function validateAttachmentEdit(edit) {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit) || Object.keys(edit).some(k => !['crop','annotations','pages','notes'].includes(k)) || typeof (edit.notes ?? '') !== 'string' || (edit.notes || '').length > 16000 || typeof (edit.pages ?? '') !== 'string') throw new Error('Invalid attachment changes.');
  const crop = edit.crop;
  if (crop && (!unit(crop.x) || !unit(crop.y) || !unit(crop.width) || !unit(crop.height) || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001)) throw new Error('Choose a crop inside the image.');
  if (!Array.isArray(edit.annotations ?? []) || (edit.annotations?.length || 0) || (edit.notes || '').trim()) throw new Error('Attachment annotations are unavailable.');
}
export async function editAttachment(name, bytes, edit) {
  validateAttachmentEdit(edit);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('This attachment is too large to edit.');
  if (/\.(png|jpe?g|webp)$/i.test(name)) {
    if (edit.pages) throw new Error('Page selection is only available for PDFs.');
    const image = await loadImage(bytes);
    if (image.width * image.height > 32000000) throw new Error('Edit images with up to 32 million pixels.');
    const crop = edit.crop || { x: 0, y: 0, width: 1, height: 1 };
    const w = Math.max(1, Math.round(image.width * crop.width)), h = Math.max(1, Math.round(image.height * crop.height));
    const canvas = createCanvas(w, h), context = canvas.getContext('2d');
    context.drawImage(image, crop.x * image.width, crop.y * image.height, image.width * crop.width, image.height * crop.height, 0, 0, w, h);
    return { name: name.replace(/\.[^.]+$/, '') + '.png', bytes: canvas.toBuffer('image/png') };
  }
  if (/\.pdf$/i.test(name)) {
    if (edit.crop) throw new Error('Cropping is available for images; use PDF page selection for documents.');
    const original = await PDFDocument.load(bytes), pages = selectedPages(edit.pages || '', original.getPageCount());
    const output = await PDFDocument.create();
    for (const page of await output.copyPages(original,pages)) output.addPage(page);
    return { name, bytes: Buffer.from(await output.save()) };
  }
  if (edit.crop || edit.pages) throw new Error('Cropping is available for images; page selection is available for PDFs.');
  return null;
}
