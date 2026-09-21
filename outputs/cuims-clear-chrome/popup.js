const DEFAULT_SETTINGS = {
  autoAdvanceUid: true,
  autoSolveCaptcha: true,
  autoSubmitLogin: true,
  blockEvents: true,
  blockFeedback: true,
};

const form = document.querySelector("#settings-form");
const autoAdvance = document.querySelector("#auto-advance");
const autoSolveCaptcha = document.querySelector("#auto-solve-captcha");
const autoSubmitLogin = document.querySelector("#auto-submit-login");
const blockEvents = document.querySelector("#block-events");
const blockFeedback = document.querySelector("#block-feedback");
const status = document.querySelector("#status");

let statusTimer;

function showStatus(message) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  autoAdvance.checked = settings.autoAdvanceUid;
  autoSolveCaptcha.checked = settings.autoSolveCaptcha;
  autoSubmitLogin.checked = settings.autoSubmitLogin;
  blockEvents.checked = settings.blockEvents;
  blockFeedback.checked = settings.blockFeedback;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  chrome.storage.local.set(
    {
      autoAdvanceUid: autoAdvance.checked,
      autoSolveCaptcha: autoSolveCaptcha.checked,
      autoSubmitLogin: autoSubmitLogin.checked,
      blockEvents: blockEvents.checked,
      blockFeedback: blockFeedback.checked,
    },
    () => {
      showStatus("Changes saved");
    },
  );
});

document.querySelector(".lms-open-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  showStatus("Opening LMS…");
  chrome.runtime.sendMessage({ type: "cuims-clear:launch-lms" }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      showStatus("Could not open LMS. Refresh CUIMS and try again.");
      return;
    }
    window.close();
  });
});
