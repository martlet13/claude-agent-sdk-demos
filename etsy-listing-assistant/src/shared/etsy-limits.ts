/** Etsy listing field limits used for validation and UI hints. */
export const ETSY_LIMITS = {
  titleMax: 140,
  descriptionMax: 13000,
  tagMaxCount: 13,
  tagMaxLength: 20,
  materialMaxCount: 13,
  materialMaxLength: 20,
  imageMaxCount: 10,
  imageMinCount: 1,
  priceMin: 0.2,
  quantityMin: 1,
} as const;

export const ETSY_SCOPES = [
  "listings_r",
  "listings_w",
  "shops_r",
] as const;

export const ETSY_OAUTH_SCOPES = ETSY_SCOPES.join(" ");
