import { describe, expect, it } from "vitest";
import {
  buildInventoryUpdate,
  hasVariations,
  moneyToNumber,
  parseInventoryResponse,
  variationSummary,
} from "../src/shared/inventory.js";
import type { InventorySnapshot } from "../src/shared/types.js";

const snapshot: InventorySnapshot = {
  products: [
    {
      propertyValues: [{ propertyId: 200, propertyName: "Color", values: ["Sage"] }],
      offerings: [{ price: 18, quantity: 2, isEnabled: true }],
    },
    {
      propertyValues: [{ propertyId: 200, propertyName: "Color", values: ["Terracotta"] }],
      offerings: [{ price: 22, quantity: 4, isEnabled: true }],
    },
  ],
  priceOnProperty: [],
  quantityOnProperty: [],
  skuOnProperty: [],
};

describe("inventory helpers", () => {
  it("parses Etsy GET inventory and skips deleted rows", () => {
    const parsed = parseInventoryResponse({
      products: [
        {
          is_deleted: true,
          property_values: [{ property_id: 200, property_name: "Color", values: ["Gone"] }],
          offerings: [{ price: { amount: 100, divisor: 100 }, quantity: 1, is_enabled: true }],
        },
        {
          sku: "keep",
          property_values: [{ property_id: 200, property_name: "Color", values: ["Sage"] }],
          offerings: [
            { is_deleted: true, price: { amount: 1, divisor: 1 }, quantity: 9, is_enabled: true },
            { price: { amount: 1850, divisor: 100 }, quantity: 3, is_enabled: true },
          ],
        },
      ],
      price_on_property: [200],
      quantity_on_property: [],
      sku_on_property: [],
    });
    expect(parsed?.products).toHaveLength(1);
    expect(parsed?.products[0].offerings).toEqual([{ price: 18.5, quantity: 3, isEnabled: true }]);
    expect(parsed?.priceOnProperty).toEqual([200]);
    expect(hasVariations(parsed)).toBe(true);
    expect(variationSummary(parsed)).toBe("Color: Sage");
  });

  it("returns undefined when there are no variation properties", () => {
    expect(
      parseInventoryResponse({
        products: [
          {
            property_values: [],
            offerings: [{ price: 10, quantity: 1, is_enabled: true }],
          },
        ],
      }),
    ).toBeUndefined();
    expect(hasVariations(undefined)).toBe(false);
    expect(variationSummary(undefined)).toBe("");
  });

  it("uses the seller price unless the source listing priced by property", () => {
    const uniform = buildInventoryUpdate(snapshot, { price: 29.5, quantity: 7 });
    expect(uniform.products).toEqual([
      {
        sku: "",
        property_values: [{ property_id: 200, property_name: "Color", values: ["Sage"] }],
        offerings: [{ price: 29.5, quantity: 7, is_enabled: true }],
      },
      {
        sku: "",
        property_values: [{ property_id: 200, property_name: "Color", values: ["Terracotta"] }],
        offerings: [{ price: 29.5, quantity: 7, is_enabled: true }],
      },
    ]);
    expect(uniform.sku_on_property).toEqual([]);

    const priced = buildInventoryUpdate(
      { ...snapshot, priceOnProperty: [200], quantityOnProperty: [200] },
      { price: 29.5, quantity: 7 },
    );
    expect((priced.products as Array<{ offerings: Array<{ price: number; quantity: number }> }>)[1].offerings[0]).toEqual({
      price: 22,
      quantity: 4,
      is_enabled: true,
    });
  });

  it("reads money objects and plain numbers", () => {
    expect(moneyToNumber({ amount: 1999, divisor: 100 })).toBe(19.99);
    expect(moneyToNumber(12)).toBe(12);
    expect(moneyToNumber(null)).toBe(0);
  });
});
