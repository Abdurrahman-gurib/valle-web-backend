/** pdfkit's document type comes from the global PDFKit namespace of @types/pdfkit. */
type PDFDocument = PDFKit.PDFDocument;

/**
 * Right-to-left paragraphs for pdfkit. fontkit shapes Arabic letters correctly
 * inside a word, but pdfkit lays words out left to right, so an Arabic
 * paragraph comes out in reverse word order with Latin fragments misplaced.
 * This lays lines out itself: words are measured, wrapped, then placed from
 * the right edge; runs of Latin words and numbers keep their own order.
 */

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«', '<': '>', '>': '<' };

/** Brackets are drawn as-is by the shaper; in an Arabic word they must be mirrored to keep their sense. */
const mirror = (w: string): string => (ARABIC.test(w) ? w.replace(/[()[\]{}«»<>]/g, (c) => MIRROR[c]) : w);

interface Segment {
  text: string;
  width: number;
  /** a run of one or more Latin/number words, kept left to right */
  ltr: boolean;
  /** drawn right after the previous segment with no space (part of the same word) */
  glued?: boolean;
}

/** A word that mixes Arabic letters with digits/Latin ("و10:") is split so each part shapes right. */
function splitMixed(w: string): string[] {
  if (!ARABIC.test(w) || !/[0-9A-Za-z]/.test(w)) return [w];
  return w.split(/([0-9A-Za-z][0-9A-Za-z@./+-]*)/).filter(Boolean);
}

/** Words grouped into direction runs; Latin runs (with their inner spaces) stay together. */
function segments(doc: PDFDocument, text: string): Segment[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: Segment[] = [];
  for (const w of words) {
    const parts = splitMixed(w);
    parts.forEach((part, i) => {
      const ltr = !ARABIC.test(part);
      const last = out[out.length - 1];
      if (i === 0 && ltr && last && last.ltr && !last.glued && parts.length === 1) {
        last.text += ' ' + part;
        last.width = doc.widthOfString(last.text);
      } else {
        const t = mirror(part);
        out.push({ text: t, width: doc.widthOfString(t), ltr, glued: i > 0 });
      }
    });
  }
  return out;
}

export interface RtlOptions {
  x: number;
  width: number;
  lineGap?: number;
  paragraphGap?: number;
  /** the number/bullet placed at the right edge, hanging before the text */
  prefix?: string;
}

/** Draws `text` right to left inside [x, x+width], from doc.y down; returns nothing, advances doc.y. */
export function rtlParagraph(doc: PDFDocument, text: string, o: RtlOptions): void {
  const space = doc.widthOfString(' ');
  const lineH = doc.currentLineHeight(true) + (o.lineGap ?? 1);
  const right = o.x + o.width;
  const segs = segments(doc, text);
  if (o.prefix) segs.unshift({ text: o.prefix, width: doc.widthOfString(o.prefix), ltr: true });

  // an LTR run that is too wide for a line is split back into words so it can wrap
  const units: Segment[] = [];
  for (const s of segs) {
    if (s.ltr && s.width > o.width) for (const w of s.text.split(' ')) units.push({ text: w, width: doc.widthOfString(w), ltr: true });
    else units.push(s);
  }

  // group glued parts back into words so a word never breaks across lines
  const words: Segment[][] = [];
  for (const u of units) {
    if (u.glued && words.length) words[words.length - 1].push(u);
    else words.push([u]);
  }
  const wordWidth = (wd: Segment[]) => wd.reduce((n, p) => n + p.width, 0);

  const lines: Segment[][][] = [];
  let line: Segment[][] = [];
  let used = 0;
  for (const wd of words) {
    const add = (line.length ? space : 0) + wordWidth(wd);
    if (line.length && used + add > o.width) { lines.push(line); line = []; used = 0; }
    line.push(wd);
    used += (line.length > 1 ? space : 0) + wordWidth(wd);
  }
  if (line.length) lines.push(line);

  for (const ln of lines) {
    if (doc.y + lineH > doc.page.height - doc.page.margins.bottom) doc.addPage();
    // pdfkit moves doc.y after every text() call: pin the line's y and restore it per word
    const y = doc.y;
    let cursor = right;
    for (const wd of ln) {
      for (const s of wd) {
        cursor -= s.width;
        doc.text(s.text, cursor, y, { lineBreak: false, width: s.width + 4 });
      }
      cursor -= space;
    }
    doc.y = y + lineH;
  }
  doc.y += o.paragraphGap ?? 0;
  doc.x = o.x;
}

/** One right-aligned line (labels, short values); wraps like a paragraph when long. */
export function rtlLine(doc: PDFDocument, text: string, o: RtlOptions): void {
  rtlParagraph(doc, text, o);
}

export const hasArabic = (s: string): boolean => ARABIC.test(s);
