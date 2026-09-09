import { describe, expect, it } from "vitest";
import { CreatePacer, retryAfterMs } from "../src/server/rate-limit.js";

describe("create pacer", () => {
  it("sleeps when listing creates are too close together", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const pacer = new CreatePacer(1_000, {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await pacer.wait();
    now += 200;
    await pacer.wait();
    expect(sleeps[0]).toBe(800);
  });
});

describe("retryAfterMs", () => {
  it("reads Retry-After seconds", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
  });
});
