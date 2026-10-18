// Pure Code128 SVG encoder.
//
// Implements Code Set B (uppercase + lowercase + digits + common
// punctuation). This covers 99% of warehouse labels (item codes,
// batch numbers, serial numbers). Code Set C (double-density digits)
// and Code Set A (control chars) omitted — a follow-up if we need it.
//
// Algorithm:
//   Start B (104) | data chars | checksum | stop (106) | 2-bar terminator
//
// Each symbol is 11 modules wide (start/data/checksum/stop) except the
// stop character which appends 2 extra modules for the trailing bar
// pattern. Output is an SVG string ready to embed in @react-pdf/renderer
// or a plain HTML print.
//
// Fully deterministic, no runtime deps beyond the browser/Node runtime.
// Chose SVG over PNG so scaling to any label size is loss-less.

// Code128 module patterns (0-106). Each entry is 11 characters of
// "1"/"0" — 1 = bar, 0 = space. From the ISO/IEC 15417 standard.
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011", // stop (106) — 13 modules
];

const START_B = 104;
const STOP = 106;

// Code Set B: value = charCodeAt - 32 for 32..127.
function valueForChar(c: string): number {
  const code = c.charCodeAt(0);
  if (code < 32 || code > 127) {
    throw new Error(`Code128B: character "${c}" (0x${code.toString(16)}) is outside 32..127`);
  }
  return code - 32;
}

// Encode a string to the value sequence used for pattern lookup +
// checksum computation.
export function encodeCode128B(data: string): number[] {
  const values = data.split("").map(valueForChar);
  let checksum = START_B;
  values.forEach((v, i) => {
    checksum += v * (i + 1);
  });
  checksum = checksum % 103;
  return [START_B, ...values, checksum, STOP];
}

export interface BarcodeSvgOptions {
  moduleWidth?: number;      // px per bar module (default 2)
  height?: number;           // px, bar height (default 60)
  showText?: boolean;        // render human-readable text under bars
  fontSize?: number;         // default 12
  quietZoneModules?: number; // whitespace on each side (default 10)
}

// Render a Code128B SVG string for `data`. Throws on invalid chars.
export function renderCode128Svg(data: string, opts: BarcodeSvgOptions = {}): string {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;
  const showText = opts.showText ?? true;
  const fontSize = opts.fontSize ?? 12;
  const quiet = opts.quietZoneModules ?? 10;

  const sequence = encodeCode128B(data);
  const patternStr = sequence.map((v) => PATTERNS[v]).join("");
  const modules = patternStr.length;
  const totalWidth = (modules + quiet * 2) * moduleWidth;
  const totalHeight = height + (showText ? fontSize + 4 : 0);

  const bars: string[] = [];
  let x = quiet * moduleWidth;
  let i = 0;
  while (i < patternStr.length) {
    if (patternStr[i] === "1") {
      let runLen = 1;
      while (i + runLen < patternStr.length && patternStr[i + runLen] === "1") runLen++;
      const w = runLen * moduleWidth;
      bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`);
      x += w;
      i += runLen;
    } else {
      x += moduleWidth;
      i += 1;
    }
  }
  const text = showText
    ? `<text x="${totalWidth / 2}" y="${height + fontSize}" font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="#000">${escapeXml(data)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">${bars.join("")}${text}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string),
  );
}

// Convenience: HTML page with a grid of labels for printing.
// Given rows [{ barcode, title, subtitle }], produces an A4-friendly
// HTML doc the browser's Ctrl+P can send to a Zebra / Brother printer.
export interface LabelRow {
  barcode: string;
  title?: string;
  subtitle?: string;
}
export interface LabelGridOptions {
  columns?: number;      // labels per row (default 3)
  labelWidthMm?: number; // default 63.5 (Avery L7160)
  labelHeightMm?: number; // default 38.1
  gapMm?: number;         // default 2.5
  barcodeOpts?: BarcodeSvgOptions;
}

export function renderLabelGridHtml(
  rows: LabelRow[],
  opts: LabelGridOptions = {},
): string {
  const columns = opts.columns ?? 3;
  const labelWidth = opts.labelWidthMm ?? 63.5;
  const labelHeight = opts.labelHeightMm ?? 38.1;
  const gap = opts.gapMm ?? 2.5;
  const cells = rows.map((r) => {
    const svg = renderCode128Svg(r.barcode, {
      ...opts.barcodeOpts,
      moduleWidth: opts.barcodeOpts?.moduleWidth ?? 1.4,
      height: opts.barcodeOpts?.height ?? 40,
    });
    return `<div class="label">
  ${r.title ? `<div class="title">${escapeXml(r.title)}</div>` : ""}
  ${svg}
  ${r.subtitle ? `<div class="subtitle">${escapeXml(r.subtitle)}</div>` : ""}
</div>`;
  }).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: A4; margin: 5mm; }
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .grid {
    display: grid;
    grid-template-columns: repeat(${columns}, ${labelWidth}mm);
    gap: ${gap}mm;
  }
  .label {
    width: ${labelWidth}mm;
    height: ${labelHeight}mm;
    padding: 2mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .title { font-size: 10pt; font-weight: 600; margin-bottom: 1mm; }
  .subtitle { font-size: 8pt; color: #444; margin-top: 1mm; }
  svg { max-width: 100%; height: auto; }
</style>
</head><body>
<div class="grid">${cells}</div>
</body></html>`;
}
