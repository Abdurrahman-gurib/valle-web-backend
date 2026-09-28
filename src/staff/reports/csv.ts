/**
 * RFC 4180 CSV with a UTF-8 BOM so Excel opens accented names correctly.
 * Values starting with =, +, - or @ are prefixed with a quote so a guest name
 * can never become a spreadsheet formula (CSV injection).
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' ? String(v) : v;
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
