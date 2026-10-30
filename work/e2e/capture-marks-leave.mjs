// One-off: signs in with .env's login in a disposable Chrome profile and
// saves the server HTML of Marks View (current and one earlier session) and
// Duty Leave (as it opens, then its External tab) for building sanitized
// fixtures. Read-only: no form is submitted except CUIMS's own tab and
// session postbacks. Pages are at least eight seconds apart; a refusal stops
// everything. Raw HTML holds personal data: keep OUT outside the repository.
//   OUT=/tmp/somewhere [ONLY=marks|dl] ENV_FILE=../cuims-clear/.env node work/e2e/capture-marks-leave.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

process.loadEnvFile(path.resolve(process.env.ENV_FILE || ".env"));
assert.ok(process.env.CUIMS_UID && process.env.CUIMS_PASSWORD, "CUIMS_UID and CUIMS_PASSWORD in .env");
const out = process.env.OUT;
assert.ok(out, "OUT=<dir outside the repo>");
const only = process.env.ONLY || "";
mkdirSync(out, { recursive: true });
chmodSync(out, 0o700);
const pkg = path.resolve("outputs/cuims-clear-chrome");
const temp = mkdtempSync(path.join(tmpdir(), "cc-capture-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const save = (name, html) => {
  writeFileSync(path.join(out, name), html, { mode: 0o600 });
  console.log("saved", name, html.length);
};
const refused = (html) => /Whoops|Error\.aspx|frmErrorPage/i.test(html) || !/menu-content/.test(html);

// Runs CUIMS's own postback for a control and returns the new document.
async function postback(tab, script) {
  const [nav] = await Promise.all([tab.waitForNavigation({ waitUntil: "load", timeout: 45_000 }), tab.evaluate(script)]);
  return nav ? nav.text() : tab.content();
}

const browser = await launchBrowser("chrome", { profileDir: path.join(temp, "profile") });
try {
  const id = await browser.installExtension(pkg);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate((uid, password) => new Promise((resolve) => chrome.storage.local.set({ uid, password, cuimsTidy: false, rateNudge: { done: true }, autoAdvanceUid: true, autoSolveCaptcha: true, autoSubmitLogin: true }, resolve)), process.env.CUIMS_UID, process.env.CUIMS_PASSWORD);
  await popup.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "cuims-clear:open-cuims", tabId: 0 }, resolve)));
  const target = await browser.waitForTarget((t) => /students\.cuchd\.in/.test(t.url()), { timeout: 30_000 });
  const tab = await target.page();
  await tab.waitForFunction(() => /studenthome\.aspx/i.test(location.pathname), { timeout: 120_000, polling: 1000 });
  console.log("signed in");
  await wait(8_000);

  if (only === "" || only === "marks") {
    const response = await tab.goto("https://students.cuchd.in/frmStudentMarksView.aspx", { waitUntil: "load", timeout: 45_000 });
    const html = await response.text();
    save("marks-current.html", html);
    if (refused(html)) throw new Error("stop: marks page refused");
    const options = await tab.evaluate(() => {
      const select = document.querySelector("select[name*='ddlCAndPSession']");
      return select ? { id: select.id, values: [...select.options].map((o) => [o.value, o.textContent.trim(), o.selected]) } : null;
    });
    save("marks-sessions.json", JSON.stringify(options, null, 1));
    const earlier = options?.values.find((entry) => !entry[2] && entry[0]);
    if (earlier) {
      await wait(8_000);
      const next = await postback(tab, `(() => { const s = document.getElementById(${JSON.stringify(options.id)}); s.value = ${JSON.stringify(earlier[0])}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      save("marks-earlier.html", next);
      if (refused(next)) throw new Error("stop: earlier marks refused");
    }
    await wait(8_000);
  }

  // The lecture form after a date: the timings CUIMS offers for it, and the
  // list "Next Step" builds. Nothing is saved: the tab leaves before Save.
  if (only === "dlform") {
    const settle = async () => {
      await wait(1_500);
      await tab.waitForFunction(() => !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack(), { timeout: 45_000, polling: 300 });
      await wait(1_000);
    };
    await tab.goto("https://students.cuchd.in/frmStudentApplyDutyLeave.aspx", { waitUntil: "load", timeout: 45_000 });
    await wait(8_000);
    await postback(tab, `document.getElementById("ContentPlaceHolder1_rblType_1").click()`);
    await wait(8_000);
    await tab.evaluate(() => { const s = document.getElementById("ContentPlaceHolder1_ddlTypeNew"); s.value = "L"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    const [y, m, d] = String(process.env.DL_DATE).split("-").map(Number);
    // CUIMS wants a category before it lists a date's lectures.
    await tab.evaluate(() => { document.getElementById("ContentPlaceHolder1_ddlDLSource").value = "20"; });
    await wait(6_000);
    // Through CUIMS's own datepicker, so the text is in its format.
    const typed = await tab.evaluate((y, m, d) => {
      const input = $("#txtDate");
      input.datepicker("setDate", new Date(y, m - 1, d));
      const value = input.val();
      input[0].dispatchEvent(new Event("change", { bubbles: true }));
      return value;
    }, y, m, d);
    console.log("date typed as", typed);
    await settle();
    save("dlform-date-dom.html", await tab.content());
    const combo = await tab.evaluate(() => {
      const box = $find("rcbTime");
      return box ? box.get_items().toArray().map((item) => ({ text: item.get_text(), value: item.get_value(), checked: item.get_checked?.() })) : null;
    });
    save("dlform-combo.json", JSON.stringify(combo, null, 1));
    console.log("combo", JSON.stringify(combo));
    if (combo?.length) {
      await wait(6_000);
      // One free lecture ticked, the count typed, as a student would.
      const ticked = await tab.evaluate(() => {
        const box = [...document.querySelectorAll("#rcbTime_DropDown input[type=checkbox]")].find((input) => !input.disabled);
        if (!box) return "";
        box.checked = true;
        document.getElementById("ContentPlaceHolder1_txtLectureLeave").value = "1";
        return box.closest("li").querySelector("[id$=lblTime]")?.textContent || "";
      });
      console.log("ticked", ticked);
      await wait(500);
      await tab.evaluate(() => document.getElementById("ContentPlaceHolder1_b").click());
      await settle();
      save("dlform-step-dom.html", await tab.content());
    }
  }

  if (only === "" || only === "dl") {
    const response = await tab.goto("https://students.cuchd.in/frmStudentApplyDutyLeave.aspx", { waitUntil: "load", timeout: 45_000 });
    const html = await response.text();
    save("dl-open.html", html);
    if (refused(html)) throw new Error("stop: duty leave refused");
    await wait(8_000);
    // The radio's own onclick queues CUIMS's postback in page context.
    const next = await postback(tab, `document.getElementById("ContentPlaceHolder1_rblType_1").click()`);
    save("dl-external.html", next);
    const state = await tab.evaluate(() => ({ external: document.getElementById("ContentPlaceHolder1_rblType_1")?.checked, history: Boolean(document.getElementById("gvHistory") || document.getElementById("ContentPlaceHolder1_gvHistory")), internalPanel: Boolean(document.getElementById("ContentPlaceHolder1_pnlInternal")) }));
    console.log("external state", JSON.stringify(state));
    // What each Type renders: lecture pickers or a date range.
    // Type sits in the "upd" UpdatePanel: an async partial postback.
    for (const type of ["L", "D"]) {
      await wait(8_000);
      await tab.evaluate((value) => {
        const select = document.getElementById("ContentPlaceHolder1_ddlTypeNew");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, type);
      await wait(1_500);
      await tab.waitForFunction(() => !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack(), { timeout: 45_000, polling: 300 });
      await wait(1_000);
      save(`dl-external-${type}-dom.html`, await tab.content());
    }
  }
} catch (error) {
  console.log("stopped:", error.message);
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
