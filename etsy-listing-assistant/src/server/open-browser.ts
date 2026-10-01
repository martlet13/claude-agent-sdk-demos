import { execFile } from "node:child_process";

/** Open the local UI in a new window. Set ETSY_ASSISTANT_NO_OPEN=1 to skip. */
export function maybeOpenBrowser(url: string): void {
  if (process.env.ETSY_ASSISTANT_NO_OPEN === "1") return;
  if (process.platform === "darwin") {
    execFile("open", ["--new", url], () => undefined);
    return;
  }
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], () => undefined);
    return;
  }
  execFile("xdg-open", [url], () => undefined);
}
