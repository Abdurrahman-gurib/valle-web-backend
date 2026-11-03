import type { Response } from 'express';

/** Streams a PDF inline under `filename`, optionally with a Cache-Control policy. */
export function sendPdf(res: Response, pdf: Buffer, filename: string, cacheControl?: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.send(pdf);
}
