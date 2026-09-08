import crypto from "node:crypto";
import type { AspectRatio, ImageBrief } from "../shared/types.js";

const RATIOS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1600, height: 1600 },
  "4:5": { width: 1600, height: 2000 },
  "3:4": { width: 1500, height: 2000 },
  "16:9": { width: 1920, height: 1080 },
};

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
  <text x="${width * 0.12}" y="${height * 0.42}" fill="${ink}" font-family="Georgia, serif" font-size="${Math.round(width * 0.055)}" font-weight="600">${wrapSvgText(safeHeadline, 22)}</text>
  <text x="${width * 0.12}" y="${height * 0.78}" fill="${ink}" font-family="Georgia, serif" font-size="${Math.round(width * 0.028)}" opacity="0.75">${safeMotif}</text>
</svg>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapSvgText(text: string, width: number): string {
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
  return lines.slice(0, 4).join(" · ");
}
