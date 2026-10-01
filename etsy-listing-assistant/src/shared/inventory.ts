import type { InventorySnapshot, VariationProduct } from "./types.js";

export function moneyToNumber(price: unknown): number {
  if (typeof price === "number" && Number.isFinite(price)) return price;
  if (!price || typeof price !== "object") return 0;
  const obj = price as { amount?: unknown; divisor?: unknown };
  const amount = typeof obj.amount === "number" ? obj.amount : Number(obj.amount);
  const divisor = typeof obj.divisor === "number" ? obj.divisor : Number(obj.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return 0;
  return amount / divisor;
}

export function hasVariations(snapshot: InventorySnapshot | undefined | null): boolean {
  if (!snapshot?.products?.length) return false;
  return snapshot.products.some((product) => product.propertyValues.length > 0);
}

export function variationSummary(snapshot: InventorySnapshot | undefined | null): string {
  if (!hasVariations(snapshot) || !snapshot) return "";
  const byProperty = new Map<string, string[]>();
  for (const product of snapshot.products) {
    for (const property of product.propertyValues) {
      const name = property.propertyName.trim() || `Property ${property.propertyId}`;
      const existing = byProperty.get(name) ?? [];
      for (const value of property.values) {
        const trimmed = value.trim();
        if (trimmed && !existing.includes(trimmed)) existing.push(trimmed);
      }
      byProperty.set(name, existing);
    }
  }
  return [...byProperty.entries()]
    .map(([name, values]) => `${name}: ${values.join(", ")}`)
    .join(" · ");
}

export function parseInventoryResponse(payload: unknown): InventorySnapshot | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const data = payload as {
    products?: unknown;
    price_on_property?: unknown;
    quantity_on_property?: unknown;
    sku_on_property?: unknown;
  };
  if (!Array.isArray(data.products)) return undefined;

  const products: VariationProduct[] = [];
  for (const raw of data.products) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      is_deleted?: boolean;
      sku?: unknown;
      property_values?: unknown;
      offerings?: unknown;
    };
    if (item.is_deleted) continue;
    const propertyValues = parsePropertyValues(item.property_values);
    const offerings = parseOfferings(item.offerings);
    if (offerings.length === 0) continue;
    products.push({
      sku: typeof item.sku === "string" ? item.sku : undefined,
      propertyValues,
      offerings,
    });
  }

  const snapshot: InventorySnapshot = {
    products,
    priceOnProperty: intArray(data.price_on_property),
    quantityOnProperty: intArray(data.quantity_on_property),
    skuOnProperty: intArray(data.sku_on_property),
  };
  return hasVariations(snapshot) ? snapshot : undefined;
}

export function buildInventoryUpdate(
  snapshot: InventorySnapshot,
  overrides: { price: number; quantity: number },
): Record<string, unknown> {
  const priceOnProperty = snapshot.priceOnProperty ?? [];
  const quantityOnProperty = snapshot.quantityOnProperty ?? [];
  return {
    products: snapshot.products.map((product) => ({
      sku: "",
      property_values: product.propertyValues.map((property) => ({
        property_id: property.propertyId,
        property_name: property.propertyName,
        ...(property.scaleId ? { scale_id: property.scaleId } : {}),
        values: property.values,
      })),
      offerings: product.offerings.map((offering) => ({
        price: Number(
          (priceOnProperty.length > 0 ? offering.price : overrides.price).toFixed(2),
        ),
        quantity: quantityOnProperty.length > 0 ? offering.quantity : overrides.quantity,
        is_enabled: offering.isEnabled,
      })),
    })),
    price_on_property: priceOnProperty,
    quantity_on_property: quantityOnProperty,
    sku_on_property: [],
  };
}

function intArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parsePropertyValues(raw: unknown): VariationProduct["propertyValues"] {
  if (!Array.isArray(raw)) return [];
  const values: VariationProduct["propertyValues"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      property_id?: unknown;
      property_name?: unknown;
      scale_id?: unknown;
      values?: unknown;
    };
    const propertyId = Number(row.property_id);
    if (!Number.isInteger(propertyId) || propertyId <= 0) continue;
    const names = Array.isArray(row.values) ? row.values.map(String).map((value) => value.trim()).filter(Boolean) : [];
    if (names.length === 0) continue;
    const scaleId = Number(row.scale_id);
    values.push({
      propertyId,
      propertyName: String(row.property_name ?? "").trim() || `Property ${propertyId}`,
      scaleId: Number.isInteger(scaleId) && scaleId > 0 ? scaleId : undefined,
      values: names,
    });
  }
  return values;
}

function parseOfferings(raw: unknown): VariationProduct["offerings"] {
  if (!Array.isArray(raw)) return [];
  const offerings: VariationProduct["offerings"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      is_deleted?: boolean;
      is_enabled?: unknown;
      quantity?: unknown;
      price?: unknown;
    };
    if (row.is_deleted) continue;
    const quantity = Number(row.quantity);
    offerings.push({
      price: moneyToNumber(row.price),
      quantity: Number.isInteger(quantity) && quantity >= 0 ? quantity : 0,
      isEnabled: row.is_enabled !== false,
    });
  }
  return offerings;
}
