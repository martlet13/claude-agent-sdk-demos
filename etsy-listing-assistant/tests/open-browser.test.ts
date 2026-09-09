import { describe, expect, it } from "vitest";
import { browserLaunch, shouldAutoOpen } from "../src/server/open-browser.js";

const url = "http://127.0.0.1:8787";

describe("browserLaunch", () => {
  it("prefers a Chromium browser with --new-window on Windows", () => {
    const launch = browserLaunch(url, {
      platform: "win32",
      exists: (file) => file.includes("chrome.exe"),
    });
    expect(launch.newWindow).toBe(true);
    expect(launch.command).toMatch(/chrome\.exe$/);
    expect(launch.args).toEqual(["--new-window", url]);
  });

  it("falls back to Firefox's -new-window flag", () => {
    const launch = browserLaunch(url, {
      platform: "linux",
      exists: (file) => file === "/usr/bin/firefox",
    });
    expect(launch).toEqual({ command: "/usr/bin/firefox", args: ["-new-window", url], newWindow: true });
  });

  it("uses the platform opener when no known browser is installed", () => {
    expect(browserLaunch(url, { platform: "win32", exists: () => false })).toEqual({
      command: "cmd",
      args: ["/c", "start", "", url],
      newWindow: false,
    });
    expect(browserLaunch(url, { platform: "darwin", exists: () => false }).command).toBe("open");
    expect(browserLaunch(url, { platform: "linux", exists: () => false }).command).toBe("xdg-open");
  });

  it("honours an explicit browser path", () => {
    const launch = browserLaunch(url, { browserPath: "/opt/brave/brave", exists: () => false });
    expect(launch).toEqual({ command: "/opt/brave/brave", args: ["--new-window", url], newWindow: true });
  });
});

describe("shouldAutoOpen", () => {
  it("can be disabled for scripts and CI", () => {
    expect(shouldAutoOpen({})).toBe(true);
    expect(shouldAutoOpen({ ETSY_ASSISTANT_NO_OPEN: "1" })).toBe(false);
    expect(shouldAutoOpen({ CI: "true" })).toBe(false);
  });
});
