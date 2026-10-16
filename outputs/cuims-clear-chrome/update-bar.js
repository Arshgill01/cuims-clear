// The "new version is out" bar on CUIMS pages, where students are every day.
// On Firefox its Update link is the only way an add-on can start its own
// update (see update-check.js); on Chrome it asks the background to install.
// × hides it for a day. It lives in a closed shadow root, so neither CUIMS's
// styles nor cuims-theme.js reach it.
(function () {
  const U = globalThis.CuimsUpdate;
  if (!U || typeof window === "undefined" || window !== window.top) return;

  const HOST_ID = "cuims-clear-update-bar";
  const firefox = chrome.runtime.getURL("").startsWith("moz-extension:");
  const current = chrome.runtime.getManifest().version;
  let info = U.normalize(null);
  let snoozeUntil = 0;

  function colours() {
    const themes = globalThis.CuimsThemes;
    const id = themes?.mirrored?.();
    if (id && id !== themes.DEFAULT) {
      // The theme's card, button and text colours, contrast-checked in themes.js.
      const t = themes.tokens(id);
      return { bg: t.surface, ink: t.ink, muted: t.muted, accent: t.accent, accentInk: t.accentInk };
    }
    return { bg: "#142033", ink: "#eef4ff", muted: "#b9c8e0", accent: "#2f6fed", accentInk: "#ffffff" };
  }

  function build() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });
    const c = colours();
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483645; }
      .bar { box-sizing: border-box; width: min(340px, calc(100vw - 32px)); padding: 12px 12px 12px 14px; border-radius: 10px;
        border-left: 4px solid ${c.accent}; background: ${c.bg}; color: ${c.ink}; box-shadow: 0 8px 24px rgba(0,0,0,.22);
        font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .head { display: flex; align-items: flex-start; gap: 8px; }
      .title { flex: 1 1 auto; margin: 0; font-weight: 750; }
      .close { flex: 0 0 auto; width: 26px; height: 26px; margin: -4px -4px 0 0; border: 0; border-radius: 6px; background: transparent;
        color: ${c.muted}; font: 700 17px/1 system-ui, sans-serif; cursor: pointer; }
      .close:hover { background: rgba(127,127,127,.18); }
      .note { margin: 4px 0 0; color: ${c.muted}; font-size: 12px; font-weight: 500; opacity: .92; }
      .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
      .update { display: inline-flex; align-items: center; min-height: 32px; padding: 0 14px; border: 0; border-radius: 8px;
        background: ${c.accent}; color: ${c.accentInk}; font: 750 13px/1 system-ui, sans-serif; text-decoration: none; cursor: pointer; }
      .update[aria-disabled="true"] { opacity: .6; cursor: default; }
      .update:focus-visible, .close:focus-visible { outline: 2px solid ${c.accent}; outline-offset: 2px; }
    </style>
    <div class="bar" role="status" aria-live="polite">
      <div class="head"><p class="title"></p><button type="button" class="close" aria-label="Hide for a day">×</button></div>
      <p class="note"></p>
      <div class="row"></div>
    </div>`;
    const title = shadow.querySelector(".title");
    const note = shadow.querySelector(".note");
    const row = shadow.querySelector(".row");
    title.textContent = `CUIMS Clear ${info.latest} is out`;

    if (firefox) {
      const link = document.createElement("a");
      link.className = "update";
      link.href = U.AMO_XPI;
      link.textContent = "Update";
      link.addEventListener("click", () => {
        note.textContent = "In Firefox's prompts choose Allow, then Add.";
      });
      row.append(link);
      note.textContent = "Firefox asks twice: Allow, then Add. Your saved login and attendance stay.";
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "update";
      button.textContent = "Update";
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-disabled") === "true") return;
        button.setAttribute("aria-disabled", "true");
        button.textContent = "Updating…";
        note.textContent = "Getting it from the Chrome Web Store.";
        chrome.runtime.sendMessage({ type: "cuims-clear:update-apply" }, (answer) => {
          void chrome.runtime.lastError;
          const status = answer?.status;
          if (status === "restarting") {
            note.textContent = "Restarting CUIMS Clear. This page reloads in a moment.";
            // The old content script stops working once the extension restarts.
            setTimeout(() => location.reload(), 2500);
            return;
          }
          button.removeAttribute("aria-disabled");
          button.textContent = "Update";
          note.textContent =
            status === "no_update" ? "Chrome hasn't got it to you yet. It updates by itself within a few hours."
            : status === "downloading" ? "Still downloading. Try again in a minute."
            : status === "throttled" ? "Chrome asked to wait a little. Try again in a few minutes."
            : "Couldn't update just now. Try again in a minute.";
        });
      });
      row.append(button);
      note.textContent = "One click. Your saved login and attendance stay.";
    }

    shadow.querySelector(".close").addEventListener("click", () => {
      snoozeUntil = Date.now() + U.SNOOZE_MS;
      chrome.storage.local.set({ updateSnoozeUntil: snoozeUntil });
      host.remove();
    });
    return host;
  }

  function paint() {
    const old = document.getElementById(HOST_ID);
    const show = U.available(info, current) && Date.now() >= snoozeUntil;
    if (!show) {
      old?.remove();
      return;
    }
    if (old?.dataset.version === info.latest) return;
    old?.remove();
    if (!document.body) return;
    const host = build();
    host.dataset.version = info.latest;
    document.body.append(host);
  }

  chrome.storage.local.get({ updateInfo: null, updateSnoozeUntil: 0 }, (stored) => {
    info = U.normalize(stored.updateInfo);
    snoozeUntil = Number(stored.updateSnoozeUntil) || 0;
    if (document.body) paint();
    else document.addEventListener("DOMContentLoaded", paint, { once: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.updateInfo) info = U.normalize(changes.updateInfo.newValue);
    if (changes.updateSnoozeUntil) snoozeUntil = Number(changes.updateSnoozeUntil.newValue) || 0;
    if (changes.updateInfo || changes.updateSnoozeUntil) paint();
  });
})();
