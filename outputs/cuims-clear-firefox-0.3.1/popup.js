const DEFAULT_SETTINGS = {
  uid: "",
  password: "",
  autoAdvanceUid: true,
  blockEvents: true,
  blockFeedback: true,
};

const form = document.querySelector("#settings-form");
const uid = document.querySelector("#uid");
const password = document.querySelector("#password");
const autoAdvance = document.querySelector("#auto-advance");
const blockEvents = document.querySelector("#block-events");
const blockFeedback = document.querySelector("#block-feedback");
const status = document.querySelector("#status");
const togglePassword = document.querySelector("#toggle-password");
const clearLogin = document.querySelector("#clear-login");

let statusTimer;

function showStatus(message) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  uid.value = settings.uid;
  password.value = settings.password;
  autoAdvance.checked = settings.autoAdvanceUid;
  blockEvents.checked = settings.blockEvents;
  blockFeedback.checked = settings.blockFeedback;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  chrome.storage.local.set(
    {
      uid: uid.value.trim(),
      password: password.value,
      autoAdvanceUid: autoAdvance.checked,
      blockEvents: blockEvents.checked,
      blockFeedback: blockFeedback.checked,
    },
    () => {
      showStatus("Changes saved");
    },
  );
});

togglePassword.addEventListener("click", () => {
  const isHidden = password.type === "password";
  password.type = isHidden ? "text" : "password";
  togglePassword.textContent = isHidden ? "Hide" : "Show";
  togglePassword.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

clearLogin.addEventListener("click", () => {
  chrome.storage.local.remove(["uid", "password"], () => {
    uid.value = "";
    password.value = "";
    password.type = "password";
    togglePassword.textContent = "Show";
    togglePassword.setAttribute("aria-label", "Show password");
    showStatus("Saved login cleared");
    uid.focus();
  });
});
