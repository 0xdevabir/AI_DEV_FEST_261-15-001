// All PDF work happens in the browser: pdf.js reads/inspects, pdf-lib builds the package.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { detectExpiry } from './logic.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True if the bytes start with the %PDF- signature (allowing a little leading junk, as readers do). */
export function looksLikePdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  return head.includes('%PDF-');
}

/**
 * Inspect a PDF. Returns { pages, text, textTitle, detectedExpiry } or throws Error('encrypted'|'damaged').
 * Both libraries must be able to open the file, because the package builder uses pdf-lib.
 */
export async function inspectPdf(buf) {
  let doc;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false });
  try {
    doc = await task.promise;
  } catch (e) {
    console.warn('pdf.js could not open file', e);
    if (e && e.name === 'PasswordException') throw new Error('encrypted');
    throw new Error('damaged');
  }
  const pages = doc.numPages;
  let text = '';
  try {
    for (let i = 1; i <= Math.min(pages, 2); i++) {
      const p = await doc.getPage(i);
      const c = await p.getTextContent();
      text += c.items.map((it) => it.str).join(' ') + '\n';
    }
  } catch {
    /* text is only a hint */
  }
  await task.destroy();

  try {
    const lib = await PDFDocument.load(buf, { ignoreEncryption: true });
    if (lib.isEncrypted) throw new Error('encrypted');
    if (lib.getPageCount() !== pages && lib.getPageCount() === 0) throw new Error('damaged');
  } catch (e) {
    if (e.message !== 'encrypted') console.warn('pdf-lib could not open file', e);
    throw new Error(e.message === 'encrypted' ? 'encrypted' : 'damaged');
  }

  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    pages,
    textTitle: clean.slice(0, 300),
    detectedExpiry: detectExpiry(clean),
  };
}

/** Render page 1 of a PDF to a small data URL thumbnail. */
export async function thumbnail(buf, width = 120) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    await task.destroy();
  }
}

// ---------------- Package builder ----------------

const A4 = [595.28, 841.89];
const FOOTER_H = 28; // reserved band at the bottom of every page for the footer
const NAVY = rgb(0.06, 0.2, 0.33);
const GREY = rgb(0.35, 0.35, 0.35);

/** Standard PDF fonts only cover WinAnsi; replace anything else so unseen packs never crash the build. */
function ansi(s) {
  return String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function wrap(text, font, size, maxW) {
  const words = ansi(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= maxW || !line) line = tryLine;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cut text to one line that fits maxW, ending with "..." when shortened. */
function fitLine(text, font, size, maxW) {
  let s = ansi(text);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

function drawCover(pdf, page, fonts, tender, included, madeOn, indexStart) {
  const { bold, reg } = fonts;
  const [W, H] = A4;
  const L = 56;
  const R = W - 56;
  let y = H - 70;

  page.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: NAVY });
  page.drawText('TENDER SUBMISSION PACKAGE', { x: L, y: H - 62, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(ansi(tender.tender_id), { x: L, y: H - 90, size: 13, font: reg, color: rgb(0.85, 0.92, 1) });
  y = H - 160;

  const rows = [
    ['Tender ID', tender.tender_id],
    ['Tender title', tender.title],
    ['Procuring entity', tender.procuring_entity],
    ['Bidder', tender.bidder],
    ['Submission deadline', tender.submission_deadline],
    ['Package made on', madeOn],
  ];
  for (const [k, v] of rows) {
    page.drawText(k, { x: L, y, size: 11, font: bold, color: GREY });
    const lines = wrap(v || '-', reg, 11, R - (L + 150));
    lines.forEach((ln, i) => page.drawText(ln, { x: L + 150, y: y - i * 14, size: 11, font: reg }));
    y -= Math.max(1, lines.length) * 14 + 8;
  }

  y -= 10;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: NAVY });
  y -= 24;
  page.drawText('Included documents (in order)', { x: L, y, size: 13, font: bold, color: NAVY });
  y -= 22;
  page.drawText('#', { x: L, y, size: 10, font: bold, color: GREY });
  page.drawText('Document', { x: L + 26, y, size: 10, font: bold, color: GREY });
  page.drawText('Pages', { x: R - 110, y, size: 10, font: bold, color: GREY });
  page.drawText('Starts on', { x: R - 50, y, size: 10, font: bold, color: GREY });
  y -= 6;
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: GREY });
  y -= 16;

  const startPages = [];
  let cursor = indexStart;
  for (const d of included) {
    startPages.push(cursor);
    cursor += d.pages;
  }

  // Pick the largest font size at which every row fits above the footer, so no document is ever dropped.
  // At the smallest size titles are cut to one line (30 files × one line always fits).
  const titleW = R - 130 - (L + 26);
  const room = y - (FOOTER_H + 24);
  const layout = (size, oneLine) => {
    const lh = size + 2;
    const gap = Math.round(size * 0.6);
    const titles = included.map((d) => (oneLine ? [fitLine(d.title_en, reg, size, titleW)] : wrap(d.title_en, reg, size, titleW)));
    const height = titles.reduce((h, lines) => h + lines.length * lh + gap, 0);
    return { size, lh, gap, titles, height };
  };
  let fit = null;
  for (const size of [11, 10, 9, 8]) {
    fit = layout(size, false);
    if (fit.height <= room) break;
  }
  if (fit.height > room) fit = layout(7, true);

  const { size, lh, gap, titles } = fit;
  included.forEach((d, i) => {
    const lines = titles[i];
    page.drawText(String(i + 1), { x: L, y, size, font: reg });
    lines.forEach((ln, j) => page.drawText(ln, { x: L + 26, y: y - j * lh, size, font: reg }));
    page.drawText(String(d.pages), { x: R - 100, y, size, font: reg });
    page.drawText(String(startPages[i]), { x: R - 40, y, size, font: reg });
    y -= lines.length * lh + gap;
  });

  return startPages;
}

/** Draw the footer "<tender_id> | Page X of Y" centered in the reserved bottom band. */
function drawFooter(page, font, text) {
  const { width } = page.getSize();
  const size = 9;
  const tw = font.widthOfTextAtSize(text, size);
  page.drawLine({ start: { x: 36, y: FOOTER_H - 4 }, end: { x: width - 36, y: FOOTER_H - 4 }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) });
  page.drawText(text, { x: (width - tw) / 2, y: 10, size, font, color: rgb(0.1, 0.1, 0.1) });
}

/**
 * Copy one source page onto a fresh page of the same visible size, scaled down so that it
 * sits entirely above the footer band. This guarantees the footer never covers content.
 */
function placeShrunk(pdf, embedded, srcW, srcH, rotation) {
  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const W = swap ? srcH : srcW; // visible size after rotation
  const H = swap ? srcW : srcH;
  const page = pdf.addPage([W, H]);
  const s = (H - FOOTER_H) / H;
  const dw = W * s;
  const dh = H * s;
  const ox = (W - dw) / 2;
  const oy = FOOTER_H;
  // Draw so the rotated content lands in the box [ox, oy, dw, dh].
  const opts = { xScale: s, yScale: s };
  if (rot === 0) page.drawPage(embedded, { ...opts, x: ox, y: oy });
  else if (rot === 90) page.drawPage(embedded, { ...opts, x: ox, y: oy + dh, rotate: degrees(-90) });
  else if (rot === 180) page.drawPage(embedded, { ...opts, x: ox + dw, y: oy + dh, rotate: degrees(180) });
  else page.drawPage(embedded, { ...opts, x: ox + dw, y: oy, rotate: degrees(90) });
  return page;
}

/**
 * Build the package.
 * docs: [{ req, file: { name, buf, pages } }] already filtered + sorted by order.
 * options: { indexPng?: Uint8Array (bonus Bangla/English index page image), seal?: { png, pages:"spec", pos, size } }
 * Returns Uint8Array.
 */
export async function buildPackage(tender, docs, options = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${ansi(tender.tender_id)} Package`);
  pdf.setSubject(ansi(tender.title));
  pdf.setAuthor(ansi(tender.bidder));
  pdf.setCreator('Tender Package Builder');
  const fonts = { bold: await pdf.embedFont(StandardFonts.HelveticaBold), reg: await pdf.embedFont(StandardFonts.Helvetica) };

  const madeOn = options.madeOn || new Date().toISOString().slice(0, 10);
  const included = docs.map((d) => ({ title_en: d.req.title_en, pages: d.file.pages }));
  const hasIndex = !!options.renderIndex;
  const firstDocPage = hasIndex ? 3 : 2;

  const cover = pdf.addPage(A4);
  const startPages = drawCover(pdf, cover, fonts, tender, included, madeOn, firstDocPage);

  if (hasIndex) {
    const png = await options.renderIndex(startPages);
    const img = await pdf.embedPng(png);
    const p = pdf.addPage(A4);
    const [W, H] = A4;
    const s = Math.min(W / img.width, (H - FOOTER_H) / img.height);
    p.drawImage(img, { x: (W - img.width * s) / 2, y: FOOTER_H + (H - FOOTER_H - img.height * s), width: img.width * s, height: img.height * s });
  }

  for (const d of docs) {
    const src = await PDFDocument.load(d.file.buf, { ignoreEncryption: false });
    const srcPages = src.getPages();
    const embedded = await pdf.embedPages(srcPages);
    srcPages.forEach((sp, i) => {
      const { width, height } = sp.getSize();
      placeShrunk(pdf, embedded[i], width, height, sp.getRotation().angle);
    });
  }

  const pages = pdf.getPages();
  const total = pages.length;

  if (options.seal) {
    const { png, pageNumbers, pos, size } = options.seal;
    const img = await pdf.embedPng(png);
    for (const n of pageNumbers) {
      const p = pages[n - 1];
      if (!p) continue;
      const { width, height } = p.getSize();
      const w = size;
      const h = (img.height / img.width) * w;
      const m = 24;
      const x = pos.endsWith('left') ? m : pos.endsWith('center') ? (width - w) / 2 : width - m - w;
      const y = pos.startsWith('top') ? height - m - h : FOOTER_H + 6;
      p.drawImage(img, { x, y, width: w, height: h, opacity: 0.9 });
    }
  }

  const id = ansi(tender.tender_id);
  pages.forEach((p, i) => drawFooter(p, fonts.reg, `${id} | Page ${i + 1} of ${total}`));

  return { bytes: await pdf.save(), total, startPages };
}
