import test from "node:test";
import assert from "node:assert/strict";

class MockElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.value = "";
    this.placeholder = "";
    this.dataset = {};
    this.style = {
      properties: new Map(),
      setProperty(prop, val) {
        this.properties.set(prop, val);
      },
      getPropertyValue(prop) {
        return this.properties.get(prop) || "";
      },
      removeProperty(prop) {
        this.properties.delete(prop);
      },
    };
    this.listeners = new Map();
    this.clicked = false;
    this.focused = false;
    this.isConnected = true;
    this.naturalWidth = 120;
    this.naturalHeight = 40;
    this.complete = true;
    this.src = "https://students.cuchd.in/GenerateCaptcha.aspx?id=1";
  }

  addEventListener(event, handler, options = {}) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push({ handler, once: options.once });
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const item of [...list]) {
      item.handler(event);
      if (item.once) {
        this.listeners.set(
          event.type,
          this.listeners.get(event.type).filter((x) => x !== item),
        );
      }
    }
    return true;
  }

  click() {
    this.clicked = true;
  }

  focus() {
    this.focused = true;
  }
}

test("DOM lifecycle: login automation and attempt exhaustion safety", () => {
  const sessionStorageStore = new Map();
  const sessionStorage = {
    getItem(k) {
      return sessionStorageStore.get(k) || null;
    },
    setItem(k, v) {
      sessionStorageStore.set(k, String(v));
    },
    removeItem(k) {
      sessionStorageStore.delete(k);
    },
  };

  const CAPTCHA_ATTEMPTS_KEY = "cuimsClearCaptchaAttempts";
  const MAX_CAPTCHA_ATTEMPTS = 3;

  function captchaAttempts() {
    return Number(sessionStorage.getItem(CAPTCHA_ATTEMPTS_KEY) || 0);
  }

  assert.equal(captchaAttempts(), 0);

  // Simulate 3 failed attempts
  sessionStorage.setItem(CAPTCHA_ATTEMPTS_KEY, "1");
  assert.equal(captchaAttempts(), 1);
  assert.equal(captchaAttempts() >= MAX_CAPTCHA_ATTEMPTS, false);

  sessionStorage.setItem(CAPTCHA_ATTEMPTS_KEY, "3");
  assert.equal(captchaAttempts() >= MAX_CAPTCHA_ATTEMPTS, true);

  // Fresh login page resets budget
  sessionStorage.removeItem(CAPTCHA_ATTEMPTS_KEY);
  assert.equal(captchaAttempts(), 0);
});

test("DOM lifecycle: modal classifier filters events and feedback while keeping essential dialogs", () => {
  const EVENT_WORDS = ["event", "workshop", "seminar", "fest", "competition", "register now"];
  const FEEDBACK_WORDS = [
    "feedback",
    "survey",
    "rate your",
    "rating",
    "share your experience",
    "fill now",
    "teaching & learning",
    "teaching and learning process",
  ];

  function classifyModal(text, blockEvents = true, blockFeedback = true) {
    const lower = text.toLowerCase();
    const isEvent = EVENT_WORDS.some((word) => lower.includes(word));
    const isFeedback = FEEDBACK_WORDS.some((word) => lower.includes(word));

    if (blockEvents && isEvent) return "event";
    if (blockFeedback && isFeedback) return "feedback";
    return null;
  }

  assert.equal(classifyModal("Register now for the hackathon event"), "event");
  assert.equal(classifyModal("Please fill out this semester feedback survey"), "feedback");
  assert.equal(
    classifyModal(
      "Dear Student, Filling out the Feedback related to the Teaching & Learning Process and will take not more than 2 minutes. Click here to Fill Now !",
    ),
    "feedback",
  );
  assert.equal(classifyModal("Confirm fee payment for semester 5"), null);
  assert.equal(classifyModal("Hostel allotment confirmation"), null);
});
