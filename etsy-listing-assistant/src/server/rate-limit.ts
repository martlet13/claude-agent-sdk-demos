export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class CreatePacer {
  private lastAt = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  async wait(): Promise<void> {
    const now = this.clock.now();
    const waitFor = this.lastAt + this.minIntervalMs - now;
    if (waitFor > 0) {
      await this.clock.sleep(waitFor);
    }
    this.lastAt = this.clock.now();
  }
}

export function retryAfterMs(headers: Headers, fallbackMs = 5000): number {
  const raw = headers.get("retry-after");
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(250, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(250, date - Date.now());
  return fallbackMs;
}
