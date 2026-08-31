import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(ROOT, relative);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(error.code === "ENOENT" ? 404 : 500);
        res.end(error.message);
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function withPage(origin, search, run) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/work/fixtures/student-home-tlp-overlay.html${search}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await run(page);
  } finally {
    await browser.close();
  }
}

function overlayState() {
  const overlay = document.getElementById("tlp-overlay");
  const dimmer = document.getElementById("tlp-dimmer");
  const fillNow = document.getElementById("tlp-fill-now");
  const sidebarLink = document.getElementById("sidebar-feedback-link");
  const fee = document.getElementById("fee-dialog");
  const classFeedback = document.getElementById("divSubjectFeedback");
  const attendanceButton = document.getElementById("open-attendance");

  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  return {
    overlaySuppressed: overlay?.dataset.cuimsClearSuppressed || "",
    dimmerSuppressed: dimmer?.dataset.cuimsClearSuppressed || "",
    overlayVisible: visible(overlay),
    dimmerVisible: visible(dimmer),
    fillNowVisible: visible(fillNow),
    sidebarVisible: visible(sidebarLink),
    sidebarText: sidebarLink?.innerText.trim() || "",
    feeVisible: visible(fee),
    classFeedbackVisible: visible(classFeedback),
    attendanceClickable: Boolean(attendanceButton) && visible(attendanceButton),
  };
}

test("e2e: Teaching & Learning overlay is removed while dashboard stays usable", async (t) => {
  const { server, origin } = await startStaticServer();
  t.after(() => server.close());

  await withPage(origin, "", async (page) => {
    await page.waitForFunction(
      () => document.getElementById("tlp-overlay")?.dataset.cuimsClearSuppressed === "feedback",
      { timeout: 5000 },
    );

    const state = await page.evaluate(overlayState);
    assert.equal(state.overlayVisible, false);
    assert.equal(state.dimmerVisible, false);
    assert.equal(state.fillNowVisible, false);
    assert.equal(state.sidebarVisible, true);
    assert.match(state.sidebarText, /Teaching and Learning Process/i);
    assert.equal(state.feeVisible, true);
    assert.equal(state.classFeedbackVisible, false);
    assert.equal(state.attendanceClickable, true);

    const clicked = await page.evaluate(() => {
      const button = document.getElementById("open-attendance");
      let count = 0;
      button.addEventListener("click", () => {
        count += 1;
      });
      button.click();
      return count;
    });
    assert.equal(clicked, 1);
  });
});

test("e2e: overlay shown after load via style change is still suppressed", async (t) => {
  const { server, origin } = await startStaticServer();
  t.after(() => server.close());

  await withPage(origin, "?delayed=1", async (page) => {
    await page.waitForFunction(
      () => document.getElementById("tlp-overlay")?.dataset.cuimsClearSuppressed === "feedback",
      { timeout: 7000 },
    );
    const state = await page.evaluate(overlayState);
    assert.equal(state.overlayVisible, false);
    assert.equal(state.dimmerVisible, false);
    assert.equal(state.sidebarVisible, true);
    assert.equal(state.feeVisible, true);
  });
});

test("e2e: quiet-mode off leaves the Teaching & Learning overlay visible", async (t) => {
  const { server, origin } = await startStaticServer();
  t.after(() => server.close());

  await withPage(origin, "?feedback=off", async (page) => {
    await page.waitForSelector("#tlp-fill-now");
    await page.waitForFunction(() => document.body.dataset.cuimsClearReady !== "never");
    await new Promise((resolve) => setTimeout(resolve, 800));
    const state = await page.evaluate(overlayState);
    assert.equal(state.overlayVisible, true);
    assert.equal(state.fillNowVisible, true);
    assert.equal(state.sidebarVisible, true);
  });
});
