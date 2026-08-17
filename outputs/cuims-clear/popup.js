const DEFAULT_SETTINGS = {
  uid: "",
  autoAdvanceUid: true,
  blockEvents: true,
  blockFeedback: true,
};

const form = document.querySelector("#settings-form");
const uid = document.querySelector("#uid");
const autoAdvance = document.querySelector("#auto-advance");
const blockEvents = document.querySelector("#block-events");
const blockFeedback = document.querySelector("#block-feedback");
const status = document.querySelector("#status");

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  uid.value = settings.uid;
  autoAdvance.checked = settings.autoAdvanceUid;
  blockEvents.checked = settings.blockEvents;
  blockFeedback.checked = settings.blockFeedback;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  chrome.storage.local.set(
    {
      uid: uid.value.trim(),
      autoAdvanceUid: autoAdvance.checked,
      blockEvents: blockEvents.checked,
      blockFeedback: blockFeedback.checked,
    },
    () => {
      status.textContent = "Saved";
      window.setTimeout(() => {
        status.textContent = "";
      }, 1500);
    },
  );
});
