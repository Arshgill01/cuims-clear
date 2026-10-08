import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

export async function launchBrowser(name, { profileDir } = {}) {
  if (!["chrome", "firefox"].includes(name)) throw new Error("Choose chrome or firefox");
  const candidates = name === "firefox"
    ? [process.env.FIREFOX_BIN, "/usr/bin/firefox", "/usr/bin/firefox-esr", "/Applications/Firefox.app/Contents/MacOS/firefox"]
    : [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const executablePath = candidates.find((file) => file && existsSync(file));
  if (!executablePath) throw new Error(`Set ${name === "firefox" ? "FIREFOX_BIN" : "CHROME_BIN"} to an installed browser`);
  if (profileDir) mkdirSync(profileDir, { recursive: true });
  if (name === "firefox" && process.env.FIREFOX_CA_FILE) {
    if (!profileDir) throw new Error("A disposable profileDir is required when importing a test CA");
    mkdirSync(profileDir, { recursive: true });
    const certutil = process.env.CERTUTIL_BIN || "certutil";
    execFileSync(certutil, ["-N", "--empty-password", "-d", `sql:${profileDir}`]);
    execFileSync(certutil, ["-A", "-d", `sql:${profileDir}`, "-n", "CUIMS test environment CA", "-t", "C,,", "-i", process.env.FIREFOX_CA_FILE]);
  }
  return puppeteer.launch({
    browser: name === "firefox" ? "firefox" : "chrome",
    executablePath,
    ...(profileDir ? { userDataDir: profileDir } : {}),
    headless: process.env.HEADED !== "1",
    enableExtensions: true,
    ...(name === "chrome" ? { pipe: true, args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] } : {
      // Container testing only. Normal desktop runs retain Firefox's sandbox.
      ...(process.env.FIREFOX_TEST_SANDBOX === "off" ? {
        env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" },
        extraPrefsFirefox: { "security.sandbox.content.level": 0 },
      } : {}),
    }),
  });
}
