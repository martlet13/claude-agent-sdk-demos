import type { NichePreset } from "./types.js";

export const STARTER_PRESETS: NichePreset[] = [
  {
    id: "wall-art",
    name: "Wall art / print",
    listingType: "physical",
    description:
      "Printable or shipped wall art: lifestyle mockups, room scenes, and SEO copy for art prints.",
    defaultAspectRatio: "4:5",
    promptHints:
      "Focus on gallery-quality composition, room-safe palettes, and print-shop language. Do not invent a shop brand. Avoid trademarked characters.",
    sampleThemes: [
      "Minimal botanical line drawings in sage and cream",
      "Moody coastal lighthouse at dusk",
      "Abstract terracotta sun over desert dunes",
    ],
  },
  {
    id: "digital-download",
    name: "Digital download",
    listingType: "download",
    description:
      "Instant-download products: planners, templates, clip art, or printable files.",
    defaultAspectRatio: "1:1",
    promptHints:
      "Emphasize file format, what the buyer receives, and instant-download expectations. Keep claims factual. No branded mascots.",
    sampleThemes: [
      "Neutral wedding seating chart templates",
      "Classroom reward sticker sheet",
      "Minimal weekly meal planner pages",
    ],
  },
  {
    id: "custom-product",
    name: "Custom physical product",
    listingType: "physical",
    description:
      "Made-to-order or personalized physical goods with variation-friendly copy.",
    defaultAspectRatio: "1:1",
    promptHints:
      "Call out personalization options without inventing shop policies. Keep materials and making claims generic unless the seller provides them.",
    sampleThemes: [
      "Hand-stamped leather keychain with initials",
      "Custom watercolor pet portrait from a photo",
      "Personalized wooden cutting board",
    ],
  },
];

export function getPreset(id: string): NichePreset | undefined {
  return STARTER_PRESETS.find((preset) => preset.id === id);
}

export function requirePreset(id: string): NichePreset {
  const preset = getPreset(id);
  if (!preset) {
    throw new Error(`Unknown preset: ${id}`);
  }
  return preset;
}
