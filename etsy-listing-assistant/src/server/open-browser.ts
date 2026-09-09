import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export interface BrowserLaunch {
  command: string;
  args: string[];
  /** True when the browser was asked for a dedicated new window. */
  newWindow: boolean;
}

const CHROMIUM_CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
  ],
};

const FIREFOX_CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
  ],
  darwin: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
  linux: ["/usr/bin/firefox", "/snap/bin/firefox"],
};

/**
 * Decide how to open the local UI in a *new* browser window on this computer.
 * Prefers a Chromium-based browser (`--new-window`), then Firefox, then the
 * platform default opener (which reuses an existing window / opens a tab).
 */
export function browserLaunch(
  url: string,
  options: {
    platform?: NodeJS.Platform;
    exists?: (file: string) => boolean;
    browserPath?: string;
  } = {},
): BrowserLaunch {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? ((file: string) => fs.existsSync(file));

  const explicit = options.browserPath?.trim();
  if (explicit) {
    const isFirefox = /firefox/i.test(explicit);
    return {
      command: explicit,
      args: isFirefox ? ["-new-window", url] : ["--new-window", url],
      newWindow: true,
    };
  }

  const chromium = (CHROMIUM_CANDIDATES[platform] ?? []).find(exists);
  if (chromium) {
    return { command: chromium, args: ["--new-window", url], newWindow: true };
  }
  const firefox = (FIREFOX_CANDIDATES[platform] ?? []).find(exists);
  if (firefox) {
    return { command: firefox, args: ["-new-window", url], newWindow: true };
  }

  if (platform === "win32") {
    // `start` needs an empty title argument so the URL is not treated as a window title.
    return { command: "cmd", args: ["/c", "start", "", url], newWindow: false };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url], newWindow: false };
  }
  return { command: "xdg-open", args: [url], newWindow: false };
}

export function openBrowserWindow(url: string, browserPath?: string): BrowserLaunch {
  const launch = browserLaunch(url, { browserPath: browserPath ?? process.env.ETSY_ASSISTANT_BROWSER });
  const child = spawn(launch.command, launch.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    // Fall back to the platform opener if the chosen browser binary failed to start.
    if (launch.newWindow) {
      const fallback = browserLaunch(url, { exists: () => false });
      execFile(fallback.command, fallback.args, () => undefined);
    }
  });
  child.unref();
  return launch;
}

export async function waitForUrl(url: string, timeoutMs = 30_000, intervalMs = 400): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status === 404) return true;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function shouldAutoOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ETSY_ASSISTANT_NO_OPEN !== "1" && env.CI !== "true";
}

async function main(): Promise<void> {
  const url = process.argv[2] || process.env.ETSY_ASSISTANT_UI_URL || "http://127.0.0.1:5173";
  if (!shouldAutoOpen()) {
    console.log(`[open-ui] Skipped (ETSY_ASSISTANT_NO_OPEN=1). UI: ${url}`);
    return;
  }
  const ready = await waitForUrl(url);
  if (!ready) {
    console.log(
      `[open-ui] ${url} did not answer within 30s (ERR_CONNECTION_REFUSED in the browser).\n` +
        `[open-ui] Check the [ui] lines above: if port 5173 is busy, stop the other process or run\n` +
        `[open-ui]   npx vite --port 5174   and   ETSY_ASSISTANT_UI_URL=http://127.0.0.1:5174 npm run open:ui`,
    );
    return;
  }
  const launch = openBrowserWindow(url);
  console.log(
    `[open-ui] Opened ${url} in ${launch.newWindow ? "a new browser window" : "your default browser"} (${launch.command}).`,
  );
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[open-ui] ${error instanceof Error ? error.message : String(error)}`);
  });
}
