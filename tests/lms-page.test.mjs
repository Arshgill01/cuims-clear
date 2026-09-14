import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const model = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-model.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../outputs/cuims-clear-firefox/lms.js", import.meta.url), "utf8");
const href = (id) => `https://lms.cuchd.in/course/view.php?id=${id}`;

class Node {
  constructor(tag = "div", attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.style = {};
    this.dataset = { ...(attrs.dataset || {}) };
    this.attributes = { ...attrs };
    this.id = attrs.id || "";
    this.className = attrs.class || "";
    this._text = attrs.text || "";
    this.href = attrs.href || "";
    this.type = attrs.type || "";
    this.value = "";
    this.htmlFor = "";
    this.placeholder = "";
    this.listeners = {};
    this.classList = {
      add: (...names) => {
        this.className = [...new Set(`${this.className} ${names.join(" ")}`.trim().split(/\s+/))].join(" ");
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
      remove: (...names) => {
        this.className = this.className.split(/\s+/).filter(Boolean).filter((n) => !names.includes(n)).join(" ");
      },
      toggle: (name, force) => {
        const on = force ?? !this.className.split(/\s+/).includes(name);
        this.classList.remove(name);
        if (on) this.classList.add(name);
      },
    };
  }
  get textContent() {
    return `${this._text}${this.children.map((c) => c.textContent).join("")}`;
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
    if (name === "href") this.href = value;
  }
  getAttribute(name) {
    if (name === "href") return this.href || null;
    if (name === "title") return this.attributes.title || this.attributes["title"] || null;
    return this.attributes[name] ?? null;
  }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? Object.assign(new Node("span"), { _text: node }) : node;
      child.parentElement = this;
      this.children.push(child);
    }
  }
  prepend(node) {
    node.parentElement = this;
    this.children.unshift(node);
  }
  before(node) {
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    node.parentElement = parent;
    parent.children.splice(index, 0, node);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  matches(selector) {
    return match(this, selector);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    if (selector === ".mc-card[data-name][data-url]") {
      return walk(this).filter((node) => node.className.split(/\s+/).includes("mc-card") && node.dataset.name && node.dataset.url);
    }
    if (selector.includes("block_course_list") || selector.includes("coursename")) return [];
    if (selector.includes('a[href*="paged="]')) {
      return walk(this).filter((node) => node.tagName === "A" && String(node.href || node.getAttribute?.("href") || "").includes("paged="));
    }
    return walk(this).filter((node) => match(node, selector));
  }
}

function walk(node, acc = []) {
  acc.push(node);
  for (const child of node.children) walk(child, acc);
  return acc;
}

function match(node, selector) {
  return selector.split(",").some((part) => matchPath(node, part.trim()));
}

function matchPath(node, selector) {
  const steps = selector.split(/\s+/).filter(Boolean);
  if (steps.length === 1) return matchSimple(node, steps[0]);
  const ancestor = node.parentElement;
  return matchSimple(node, steps.at(-1)) && ancestor && walkUp(ancestor, steps.slice(0, -1).join(" "));
}

function walkUp(node, selector) {
  for (let current = node; current; current = current.parentElement) {
    if (matchPath(current, selector)) return true;
  }
  return false;
}

function matchSimple(node, selector) {
  const id = selector.match(/^#([A-Za-z0-9_-]+)$/);
  if (id) return node.id === id[1];
  const cls = selector.match(/^\.([A-Za-z0-9_-]+)$/);
  if (cls) return node.className.split(/\s+/).includes(cls[1]);
  const tagged = selector.match(/^([A-Za-z0-9]+)$/);
  if (tagged) return node.tagName === tagged[1].toUpperCase();
  const taggedId = selector.match(/^([A-Za-z0-9]+)#([A-Za-z0-9_-]+)$/);
  if (taggedId) return node.tagName === taggedId[1].toUpperCase() && node.id === taggedId[2];
  return false;
}

function card(name, url) {
  const node = new Node("div", { class: "mc-card" });
  node.dataset.name = name;
  node.dataset.url = url;
  return node;
}

function mount({
  path = "/my/courses.php",
  hash = "",
  href: pageHref = `https://lms.cuchd.in${path}`,
  heading = "",
  bodyClass = "path-my",
  login = false,
  signedIn = true,
  lmsClear = true,
  cards = [],
  hangFetch = false,
} = {}) {
  const body = new Node("body", { class: bodyClass + (login ? " notloggedin" : "") });
  const documentElement = new Node("html");
  const usernav = new Node("div", { id: "usernavigation" });
  if (signedIn) usernav.append(new Node("div", { class: "usermenu", text: "Student" }));
  const header = new Node("header", { id: "page-header" });
  const headings = new Node("div", { class: "page-header-headings" });
  if (heading) headings.append(new Node("h1", { text: heading }));
  header.append(headings);
  const region = new Node("div", { id: "region-main" });
  for (const item of cards) region.append(item);
  if (hangFetch) region.append(new Node("a", { href: "https://lms.cuchd.in/my/courses.php?paged=2" }));
  if (login) region.append(new Node("form", { class: "loginform" }));
  const pageRoot = new Node("div", { id: "page" });
  pageRoot.append(header, region);
  body.append(usernav, pageRoot);
  documentElement.append(body);

  let replaced;
  const storage = { lmsClear };
  const listeners = [];
  const document = {
    readyState: "complete",
    body,
    documentElement,
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => Object.assign(new Node("span"), { _text: text }),
    querySelector: (sel) => body.querySelector(sel) || (sel.includes("html") ? documentElement : null),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    getElementById: (id) => body.querySelector(`#${id}`),
    addEventListener() {},
  };
  const location = {
    pathname: path,
    hash,
    href: pageHref + hash,
    origin: "https://lms.cuchd.in",
    replace: (url) => { replaced = url; },
  };
  const context = vm.createContext({
    URL, URLSearchParams, Date, AbortSignal, Set, Map,
    window: {},
    globalThis: {},
    chrome: {
      storage: {
        local: {
          get: (defaults, cb) => cb({ ...defaults, lmsClear: storage.lmsClear }),
          set: (value) => { Object.assign(storage, value); },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    location,
    document,
    fetch: hangFetch
      ? () => new Promise(() => {})
      : async () => ({ ok: false, url: "https://lms.cuchd.in/my/courses.php", text: async () => "" }),
    DOMParser: class { parseFromString() { return document; } },
  });
  context.window.top = context.window;
  context.globalThis = context;
  vm.runInContext(model, context);
  vm.runInContext(page, context);
  return { body, storage, replaced, document, click(id) { body.querySelector(`#${id}`).listeners.click(); } };
}

test("directory paints enrolled courses before extra pages finish loading", () => {
  const { body } = mount({
    hangFetch: true,
    cards: [
      card("CONT_24CST-302 :: COMPUTER NETWORKS", href(2)),
      card("24CST-302_24BCS_KRG-601A_ALL :: COMPUTER NETWORKS", href(3)),
    ],
  });
  assert.equal(body.querySelector("h2").textContent, "Computer Networks");
  assert.equal(body.querySelectorAll(".cc-course-link").length, 2);
});

test("directory pairs CONT materials with 601A work and titles the subject once", () => {
  const { body } = mount({
    cards: [
      card("CONT_24CST-302 :: COMPUTER NETWORKS", href(2)),
      card("24CST-302_24BCS_KRG-601A_ALL :: COMPUTER NETWORKS", href(3)),
    ],
  });
  assert.equal(body.querySelector("#cc-directory").hidden, false);
  assert.match(body.querySelector(".cc-count").textContent, /1 subject/);
  assert.equal(body.querySelector("h2").textContent, "Computer Networks");
  const links = body.querySelectorAll(".cc-course-link");
  assert.equal(links[0].href, href(2));
  assert.equal(links[1].href, href(3));
});

test("original-view hash and toggle hide the directory without dropping the native page", () => {
  const { body, storage, click } = mount({
    hash: "#original",
    cards: [card("CONT_24CST-302 :: COMPUTER NETWORKS", href(2))],
  });
  assert.equal(body.querySelector("#cc-directory").hidden, true);
  assert.equal(body.className.includes("cc-lms"), false);
  assert.equal(storage.lmsClear, true);
  click("cc-view-toggle");
  assert.equal(body.querySelector("#cc-directory").hidden, false);
  assert.equal(storage.lmsClear, true);
});

test("course pages rewrite the Moodle title and link the paired semester area", async () => {
  const { body } = mount({
    path: "/course/view.php",
    href: "http://127.0.0.1:8766/course/view.php",
    heading: "CONT_24CST-302 :: COMPUTER NETWORKS",
    bodyClass: "path-course path-course-view course-2",
    cards: [
      card("CONT_24CST-302 :: COMPUTER NETWORKS", href(2)),
      card("24CST-302_24BCS_KRG-601A_ALL :: COMPUTER NETWORKS", href(3)),
    ],
  });
  assert.equal(body.querySelector("h1").textContent, "Computer Networks");
  await new Promise((resolve) => setImmediate(resolve));
  const nav = body.querySelector(".cc-course-nav");
  assert.equal(nav.hidden, false);
  assert.match(nav.textContent, /Syllabus & Materials/);
  assert.match(nav.textContent, /Semester Work/);
  assert.equal(nav.querySelector("a").getAttribute("aria-current"), "page");
});

test("unsigned LMS pages offer CUIMS sign-in and never rewrite the dashboard", () => {
  const loggedOut = mount({ login: true, signedIn: false, path: "/login/index.php" });
  assert.match(loggedOut.body.querySelector(".cc-sign-in").href, /cuims-clear-lms/);
  assert.equal(loggedOut.body.querySelector("#cc-toolbar"), null);

  const home = mount({ path: "/my/" });
  assert.equal(home.replaced, "https://lms.cuchd.in/my/courses.php");

  const keep = mount({ path: "/", hash: "#original" });
  assert.equal(keep.replaced, undefined);
});
