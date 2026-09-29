// Start Firefox ourselves and attach Puppeteer over WebDriver BiDi.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
export async function launchFirefox({ headless = true, prefs = {} } = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "ffprof-"));
  const all = { "browser.shell.checkDefaultBrowser": false, "datareporting.policy.dataSubmissionEnabled": false, "browser.startup.homepage_override.mstone": "ignore", "extensions.autoDisableScopes": 0, "remote.prefs.recommended": true, "xpinstall.signatures.required": false, ...prefs };
  writeFileSync(path.join(profile, "user.js"), Object.entries(all).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  const args = ["--profile", profile, "--no-remote", "--remote-debugging-port", "0", ...(headless ? ["--headless"] : []), "about:blank"];
  const proc = spawn("/Applications/Firefox.app/Contents/MacOS/firefox", args, { stdio: ["ignore", "pipe", "pipe"] });
  const ws = await new Promise((resolve, reject) => {
    const onData = (d) => { const m = String(d).match(/WebDriver BiDi listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); };
    proc.stdout.on("data", onData); proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("firefox did not start")), 60000);
  });
  const browser = await puppeteer.connect({ browserWSEndpoint: ws + "/session", protocol: "webDriverBiDi" });
  browser.__kill = () => { try { proc.kill("SIGKILL"); } catch {} };
  return browser;
}
