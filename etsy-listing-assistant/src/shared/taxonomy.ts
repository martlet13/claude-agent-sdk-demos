import type { TaxonomyHit } from "./types.js";

export function searchTaxonomy(query: string, nodes: TaxonomyHit[]): TaxonomyHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes.slice(0, 25);
  return nodes
    .filter(
      (node) =>
        node.name.toLowerCase().includes(needle) ||
        node.path.toLowerCase().includes(needle) ||
        String(node.id) === needle,
    )
    .slice(0, 25);
}
