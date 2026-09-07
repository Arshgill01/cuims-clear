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
  const MAX_CAPTCHA_ATTEMPTS = 99;

  function captchaAttempts() {
    return Number(sessionStorage.getItem(CAPTCHA_ATTEMPTS_KEY) || 0);
  }

  assert.equal(captchaAttempts(), 0);

  sessionStorage.setItem(CAPTCHA_ATTEMPTS_KEY, "1");
  assert.equal(captchaAttempts(), 1);
  assert.equal(captchaAttempts() >= MAX_CAPTCHA_ATTEMPTS, false);

  sessionStorage.setItem(CAPTCHA_ATTEMPTS_KEY, "99");
  assert.equal(captchaAttempts() >= MAX_CAPTCHA_ATTEMPTS, true);

  // Fresh UID step (no password field, no captcha) resets budget
  sessionStorage.removeItem(CAPTCHA_ATTEMPTS_KEY);
  assert.equal(captchaAttempts(), 0);
});

test("DOM lifecycle: auto-solve stops once the retry budget is spent", () => {
  const MAX_CAPTCHA_ATTEMPTS = 99;
  let attempts = 0;
  let autoSolve = true;

  function recordAttempt() {
    attempts += 1;
  }

  function shouldAutoSolve() {
    return autoSolve && attempts < MAX_CAPTCHA_ATTEMPTS;
  }

  recordAttempt();
  recordAttempt();
  assert.equal(shouldAutoSolve(), true);

  attempts = MAX_CAPTCHA_ATTEMPTS;
  assert.equal(shouldAutoSolve(), false);
});

test("DOM lifecycle: Chrome width-0 sidenav still classifies as feedback", () => {
  const FEEDBACK_WORDS = ["feedback", "survey", "rate your", "rating", "share your experience"];
  const FEEDBACK_CONTAINER_IDS = new Set([
    "divsubjectfeedback",
    "divstudenthostelfedback",
    "div_feedback",
  ]);

  function elementText(element) {
    const visible = (element.innerText || "").trim();
    if (visible) return visible.toLowerCase();
    return (element.textContent || "").trim().toLowerCase();
  }

  function isKnownFeedbackContainer(element) {
    const id = (element.id || "").toLowerCase();
    if (FEEDBACK_CONTAINER_IDS.has(id)) return true;
    return /feedbac?k/.test(id) && element.classList?.contains("sidenav");
  }

  function classifyModal(element, blockFeedback = true) {
    if (blockFeedback && isKnownFeedbackContainer(element)) return "feedback";
    const text = elementText(element);
    if (blockFeedback && FEEDBACK_WORDS.some((word) => text.includes(word))) {
      return "feedback";
    }
    return null;
  }

  // Chrome innerText on a closed sidenav is often whitespace-only.
  const closedSidenav = {
    id: "divSubjectFeedback",
    innerText: "\n    \n",
    textContent: "Student Class Feedback\nClose(X)",
    classList: { contains: (name) => name === "sidenav" },
  };

  assert.equal(classifyModal(closedSidenav), "feedback");

  const unknownClosed = {
    id: "randomOverlay",
    innerText: "\n",
    textContent: "Student Class Feedback",
    classList: { contains: () => false },
  };
  assert.equal(classifyModal(unknownClosed), "feedback");
});

test("DOM lifecycle: page shell is never treated as a feedback overlay", () => {
  function isPageShell(element) {
    if (!element || element.tagName === "FORM") return true;
    const text = (element.textContent || "").toLowerCase();
    const huge = element.width >= 800 && element.height >= 600;
    return text.includes("my course") && text.includes("announcements") && huge;
  }

  const shell = {
    tagName: "DIV",
    textContent: "My Course & Attendance Announcements (ALL) Feedback related to the Teaching and Learning Process",
    width: 1200,
    height: 800,
  };
  const card = {
    tagName: "DIV",
    textContent: "Click here to Fill Now !",
    width: 420,
    height: 160,
  };

  assert.equal(isPageShell(shell), true);
  assert.equal(isPageShell(card), false);
});

test("DOM lifecycle: unique popup copy climbs to a wrapper that is not the dashboard", () => {
  const DASHBOARD_LANDMARKS = ["my course", "announcements", "student facilitation", "mentor details"];

  function hasDashboardLandmarks(text) {
    const lower = text.toLowerCase();
    return DASHBOARD_LANDMARKS.filter((landmark) => lower.includes(landmark)).length >= 2;
  }

  function promptRoot(chain) {
    let best = chain[0];
    for (const node of chain) {
      if (hasDashboardLandmarks(node.text)) break;
      best = node;
    }
    return best;
  }

  const chain = [
    { name: "span", text: "filling out the feedback related to the teaching" },
    { name: "card", text: "Dear Student filling out the feedback related to the teaching" },
    { name: "overlay", text: "Dear Student filling out the feedback related to the teaching" },
    {
      name: "form1",
      text: "My Course Announcements Dear Student filling out the feedback related to the teaching",
    },
  ];

  assert.equal(promptRoot(chain).name, "overlay");
});

test("DOM lifecycle: teaching-learning popup copy is distinct from the dashboard shell", () => {
  const FEEDBACK_PROMPT_PHRASES = [
    "filling out the feedback related to the teaching",
    "teaching & learning process",
    "will take not more than 2 minutes",
  ];
  const DASHBOARD_LANDMARKS = ["my course", "announcements", "student facilitation", "mentor details"];

  function mentionsPrompt(text) {
    const lower = text.toLowerCase();
    return FEEDBACK_PROMPT_PHRASES.some((phrase) => lower.includes(phrase));
  }

  function hasDashboardLandmarks(text) {
    const lower = text.toLowerCase();
    return DASHBOARD_LANDMARKS.filter((landmark) => lower.includes(landmark)).length >= 2;
  }

  const popup =
    "Dear Student, Filling out the Feedback related to the Teaching & Learning Process and will take not more than 2 minutes.";
  const shell =
    "My Course & Attendance Announcements (ALL) Mentor Details Feedback related to the Teaching and Learning Process";

  assert.equal(mentionsPrompt(popup), true);
  assert.equal(hasDashboardLandmarks(popup), false);
  assert.equal(hasDashboardLandmarks(shell), true);
});

test("DOM lifecycle: Fill Now teaching-feedback prompt is treated as feedback", () => {
  const FEEDBACK_WORDS = [
    "feedback",
    "survey",
    "rate your",
    "rating",
    "share your experience",
    "fill now",
    "teaching & learning",
    "teaching and learning",
  ];

  function classifyText(text, blockFeedback = true) {
    const lower = text.toLowerCase();
    if (blockFeedback && FEEDBACK_WORDS.some((word) => lower.includes(word))) {
      return "feedback";
    }
    return null;
  }

  assert.equal(
    classifyText(
      "Dear Student, Filling out the Feedback related to the Teaching & Learning Process and will take not more than 2 minutes. Click here to Fill Now !",
    ),
    "feedback",
  );
  assert.equal(classifyText("Click here to Fill Now !"), "feedback");
  assert.equal(classifyText("Apply for Loan Documents"), null);
});

test("DOM lifecycle: modal classifier filters events and feedback while keeping essential dialogs", () => {
  const EVENT_WORDS = ["event", "workshop", "seminar", "fest", "competition", "register now"];
  const FEEDBACK_WORDS = ["feedback", "survey", "rate your", "rating", "share your experience"];

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
  assert.equal(classifyModal("Confirm fee payment for semester 5"), null);
  assert.equal(classifyModal("Hostel allotment confirmation"), null);
});
