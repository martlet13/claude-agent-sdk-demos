import { describe, expect, it } from "vitest";
import { templateFromListing, TemplateStore } from "../src/server/templates.js";
import { tempRoot } from "./helpers.js";

describe("publish templates", () => {
  it("clones shipping and policy fields from a seller listing", () => {
    const template = templateFromListing(
      {
        listingId: 555,
        title: "Oak Cutting Board",
        listingType: "physical",
        whoMade: "i_did",
        whenMade: "made_to_order",
        taxonomyId: 100,
        shopSectionId: 2,
        shippingProfileId: 9,
        readinessStateId: 4,
        returnPolicyId: 6,
        isSupply: false,
        processingMin: 3,
        processingMax: 5,
      },
      "Boards",
    );
    expect(template).toMatchObject({
      name: "Boards",
      sourceListingId: 555,
      shippingProfileId: 9,
      readinessStateId: 4,
      returnPolicyId: 6,
    });
  });

  it("renames and deletes named templates", () => {
    const store = new TemplateStore(tempRoot());
    const created = store.add(
      templateFromListing({
        listingId: 1,
        title: "Print",
        listingType: "physical",
        whoMade: "i_did",
        whenMade: "made_to_order",
        isSupply: false,
      }),
    );
    store.rename(created.id, "Wall art US");
    expect(store.get(created.id).name).toBe("Wall art US");
    store.delete(created.id);
    expect(store.list()).toHaveLength(0);
  });
});
