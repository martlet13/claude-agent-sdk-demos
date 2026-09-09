import crypto from "node:crypto";
import zlib from "node:zlib";
import type { AspectRatio, ImageBrief } from "../shared/types.js";

const RATIOS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1600, height: 1600 },
  "4:5": { width: 1600, height: 2000 },
  "3:4": { width: 1500, height: 2000 },
  "16:9": { width: 1920, height: 1080 },
};

const PNG_RATIOS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 800, height: 800 },
  "4:5": { width: 800, height: 1000 },
  "3:4": { width: 750, height: 1000 },
  "16:9": { width: 960, height: 540 },
};

export function listingImageFilename(filename: string): string {
  return filename.replace(/\.svg$/i, ".png");
}

function hashHue(seed: string): number {
  const digest = crypto.createHash("sha256").update(seed).digest();
  return digest[0] * 1.4;
}

export function defaultPalette(theme: string): [string, string, string] {
  const hue = hashHue(theme);
  return [
    `hsl(${hue % 360} 32% 28%)`,
    `hsl(${(hue + 28) % 360} 38% 72%)`,
    `hsl(${(hue + 190) % 360} 22% 92%)`,
  ];
}

export function briefsFromTheme(theme: string, count: number): ImageBrief[] {
  const motifs = [
    "centered emblem over textured paper",
    "wide lifestyle crop with generous negative space",
    "close detail of pattern and grain",
    "stacked typography over a soft wash",
    "geometric frame with botanical accents",
  ];
  return Array.from({ length: count }, (_, index) => {
    const filename = `promo-${String(index + 1).padStart(2, "0")}.svg`;
    return {
      filename,
      alt: `${theme} — promo image ${index + 1}`,
      headline: theme.length > 48 ? `${theme.slice(0, 45)}…` : theme,
      palette: defaultPalette(`${theme}:${index}`),
      motif: motifs[index % motifs.length],
    };
  });
}

export function renderPromoSvg(brief: ImageBrief, aspectRatio: AspectRatio): string {
  const { width, height } = RATIOS[aspectRatio];
  const [ink, mid, paper] = brief.palette;
  const safeHeadline = escapeXml(brief.headline);
  const safeMotif = escapeXml(brief.motif);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${paper}"/>
      <stop offset="100%" stop-color="${mid}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wash)"/>
  <rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.84}" height="${height * 0.84}" fill="none" stroke="${ink}" stroke-width="${Math.max(6, width / 220)}"/>
  <circle cx="${width * 0.78}" cy="${height * 0.22}" r="${Math.min(width, height) * 0.12}" fill="${ink}" opacity="0.12"/>
  <text x="${width * 0.12}" y="${height * 0.38}" fill="${ink}" font-family="Georgia, serif" font-size="${Math.round(width * 0.055)}" font-weight="600">${wrapSvgTspans(safeHeadline, 22, width * 0.12, Math.round(width * 0.07))}</text>
  <text x="${width * 0.12}" y="${height * 0.78}" fill="${ink}" font-family="Georgia, serif" font-size="${Math.round(width * 0.028)}" opacity="0.75">${safeMotif}</text>
</svg>
`;
}

export function renderPromoPng(brief: ImageBrief, aspectRatio: AspectRatio): Buffer {
  const { width, height } = PNG_RATIOS[aspectRatio];
  const pixels = Buffer.alloc(width * height * 4, 255);
  const [ink, mid, paper] = brief.palette.map(parseColor) as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  fillRect(pixels, width, height, 0, 0, width, height, paper);
  fillRect(pixels, width, height, 0, 0, width, Math.round(height * 0.42), mid);
  const inset = Math.round(Math.min(width, height) * 0.08);
  strokeRect(pixels, width, height, inset, inset, width - inset * 2, height - inset * 2, ink, 4);
  const motif = brief.motif.toLowerCase();
  if (motif.includes("emblem") || motif.includes("geometric") || motif.includes("sun")) {
    fillCircle(pixels, width, height, Math.round(width * 0.78), Math.round(height * 0.22), Math.round(Math.min(width, height) * 0.1), ink, 40);
  } else if (motif.includes("wave") || motif.includes("coastal") || motif.includes("wide")) {
    for (let i = 0; i < 5; i += 1) {
      const y = Math.round(height * 0.62 + i * 14);
      fillRect(pixels, width, height, inset + 20, y, width - inset * 2 - 40, 4, ink, 50);
    }
  } else {
    fillRect(pixels, width, height, Math.round(width * 0.7), Math.round(height * 0.14), Math.round(width * 0.14), Math.round(height * 0.14), ink, 28);
  }
  drawText(pixels, width, height, brief.headline.toUpperCase(), inset + 12, Math.round(height * 0.36), ink, 3);
  return encodePng(width, height, pixels);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function wrapSvgLines(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function wrapSvgTspans(text: string, width: number, x: number, lineHeight: number): string {
  return wrapSvgLines(text, width)
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${line}</tspan>`)
    .join("");
}

function parseColor(input: string): [number, number, number] {
  const hex = input.trim();
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    const full =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    return [
      Number.parseInt(full.slice(1, 3), 16),
      Number.parseInt(full.slice(3, 5), 16),
      Number.parseInt(full.slice(5, 7), 16),
    ];
  }
  const hsl = hex.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i);
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }
  return [28, 25, 23];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const value = Math.round(l * 255);
    return [value, value, value];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToChannel(p, q, hue + 1 / 3) * 255),
    Math.round(hueToChannel(p, q, hue) * 255),
    Math.round(hueToChannel(p, q, hue - 1 / 3) * 255),
  ];
}

function hueToChannel(p: number, q: number, t: number): number {
  let tone = t;
  if (tone < 0) tone += 1;
  if (tone > 1) tone -= 1;
  if (tone < 1 / 6) return p + (q - p) * 6 * tone;
  if (tone < 1 / 2) return q;
  if (tone < 2 / 3) return p + (q - p) * (2 / 3 - tone) * 6;
  return p;
}

function pixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function blend(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  alpha = 255,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = pixelIndex(width, x, y);
  const a = alpha / 255;
  pixels[i] = Math.round(rgb[0] * a + pixels[i] * (1 - a));
  pixels[i + 1] = Math.round(rgb[1] * a + pixels[i + 1] * (1 - a));
  pixels[i + 2] = Math.round(rgb[2] * a + pixels[i + 2] * (1 - a));
  pixels[i + 3] = 255;
}

function fillRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number],
  alpha = 255,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      blend(pixels, width, height, px, py, rgb, alpha);
    }
  }
}

function strokeRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number],
  thickness: number,
): void {
  fillRect(pixels, width, height, x, y, w, thickness, rgb);
  fillRect(pixels, width, height, x, y + h - thickness, w, thickness, rgb);
  fillRect(pixels, width, height, x, y, thickness, h, rgb);
  fillRect(pixels, width, height, x + w - thickness, y, thickness, h, rgb);
}

function fillCircle(
  pixels: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number],
  alpha = 255,
): void {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) {
        blend(pixels, width, height, x, y, rgb, alpha);
      }
    }
  }
}

// 5x7 uppercase glyphs packed as 7 rows of 5 bits.
const FONT_5X7: Record<string, number[]> = {
  A: [0b01000, 0b10100, 0b10100, 0b11100, 0b10100, 0b10100, 0b10100],
  B: [0b11000, 0b10100, 0b10100, 0b11000, 0b10100, 0b10100, 0b11000],
  C: [0b01100, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01100],
  D: [0b11000, 0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b11000],
  E: [0b11100, 0b10000, 0b10000, 0b11100, 0b10000, 0b10000, 0b11100],
  F: [0b11100, 0b10000, 0b10000, 0b11100, 0b10000, 0b10000, 0b10000],
  G: [0b01100, 0b10000, 0b10000, 0b10100, 0b10100, 0b10100, 0b01100],
  H: [0b10100, 0b10100, 0b10100, 0b11100, 0b10100, 0b10100, 0b10100],
  I: [0b11100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b11100],
  J: [0b00100, 0b00100, 0b00100, 0b00100, 0b10100, 0b10100, 0b01000],
  K: [0b10100, 0b10100, 0b11000, 0b10000, 0b11000, 0b10100, 0b10100],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11100],
  M: [0b10100, 0b11100, 0b11100, 0b10100, 0b10100, 0b10100, 0b10100],
  N: [0b10100, 0b11100, 0b11100, 0b11100, 0b10100, 0b10100, 0b10100],
  O: [0b01000, 0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b01000],
  P: [0b11000, 0b10100, 0b10100, 0b11000, 0b10000, 0b10000, 0b10000],
  Q: [0b01000, 0b10100, 0b10100, 0b10100, 0b10100, 0b11100, 0b01100],
  R: [0b11000, 0b10100, 0b10100, 0b11000, 0b10100, 0b10100, 0b10100],
  S: [0b01100, 0b10000, 0b10000, 0b01000, 0b00100, 0b00100, 0b11000],
  T: [0b11100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000],
  U: [0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b01000],
  V: [0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b01000, 0b01000],
  W: [0b10100, 0b10100, 0b10100, 0b10100, 0b11100, 0b11100, 0b10100],
  X: [0b10100, 0b10100, 0b01000, 0b01000, 0b01000, 0b10100, 0b10100],
  Y: [0b10100, 0b10100, 0b10100, 0b01000, 0b01000, 0b01000, 0b01000],
  Z: [0b11100, 0b00100, 0b00100, 0b01000, 0b10000, 0b10000, 0b11100],
  "0": [0b01000, 0b10100, 0b10100, 0b10100, 0b10100, 0b10100, 0b01000],
  "1": [0b01000, 0b11000, 0b01000, 0b01000, 0b01000, 0b01000, 0b11100],
  "2": [0b11000, 0b00100, 0b00100, 0b01000, 0b10000, 0b10000, 0b11100],
  "3": [0b11000, 0b00100, 0b00100, 0b11000, 0b00100, 0b00100, 0b11000],
  "4": [0b10100, 0b10100, 0b10100, 0b11100, 0b00100, 0b00100, 0b00100],
  "5": [0b11100, 0b10000, 0b10000, 0b11000, 0b00100, 0b00100, 0b11000],
  "6": [0b01100, 0b10000, 0b10000, 0b11000, 0b10100, 0b10100, 0b01000],
  "7": [0b11100, 0b00100, 0b00100, 0b01000, 0b01000, 0b10000, 0b10000],
  "8": [0b01000, 0b10100, 0b10100, 0b01000, 0b10100, 0b10100, 0b01000],
  "9": [0b01000, 0b10100, 0b10100, 0b01100, 0b00100, 0b00100, 0b11000],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0b11100, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 0b01000],
  "&": [0b01000, 0b10100, 0b01000, 0b11000, 0b10100, 0b10100, 0b01100],
};

function drawText(
  pixels: Buffer,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  scale: number,
): void {
  const maxWidth = width - x - 16;
  const glyphWidth = 6 * scale;
  const glyphHeight = 8 * scale;
  const words = text.split(/\s+/);
  let cx = x;
  let cy = y;
  for (const word of words) {
    const wordWidth = word.length * glyphWidth;
    if (cx > x && cx + wordWidth > x + maxWidth) {
      cx = x;
      cy += glyphHeight + scale;
    }
    if (cy > height - glyphHeight - 8) break;
    for (const char of word) {
      drawGlyph(pixels, width, height, char, cx, cy, rgb, scale);
      cx += glyphWidth;
    }
    cx += glyphWidth;
  }
}

function drawGlyph(
  pixels: Buffer,
  width: number,
  height: number,
  char: string,
  x: number,
  y: number,
  rgb: [number, number, number],
  scale: number,
): void {
  const rows = FONT_5X7[char] ?? FONT_5X7["-"];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (rows[row] & (0b10000 >> col)) {
        fillRect(pixels, width, height, x + col * scale, y + row * scale, scale, scale, rgb);
      }
    }
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
