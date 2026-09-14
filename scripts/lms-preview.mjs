#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const firefox = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const fixtures = new URL("../tests/fixtures/lms/", import.meta.url);
const port = Number(process.env.PORT) || 8766;
const types = { ".css": "text/css", ".js": "text/javascript", ".html": "text/html" };

const stub = `<link rel="stylesheet" href="/lms.css" />
<script>
window.chrome = {
  storage: {
    local: {
      get: (defaults, cb) => cb({ ...defaults, lmsClear: sessionStorage.getItem("clear") !== "false" }),
      set: (value) => sessionStorage.setItem("clear", String(value.lmsClear !== false)),
    },
    onChanged: { addListener() {} },
  },
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  const parsed = new URL(url, location.href);
  const response = await nativeFetch(parsed.pathname + parsed.search, opts);
  Object.defineProperty(response, "url", { value: "https://lms.cuchd.in" + parsed.pathname + parsed.search });
  return response;
};
</script>
<script src="/lms-model.js"></script>
<script src="/lms.js"></script>`;

function fixture(name) {
  return readFileSync(new URL(name, fixtures), "utf8")
    .replace("<html", '<html class="cc-lms-pending"')
    .replace("</head>", '<link rel="stylesheet" href="/lms.css" /></head>')
    .replace("</body>", `${stub}\n</body>`);
}

function page(req) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/my/courses.php" && url.searchParams.get("paged") === "2") return fixture("page2.html");
  if (url.pathname === "/my/courses.php") return fixture("directory.html");
  if (url.pathname === "/course/view.php") return fixture("course.html");
  if (url.pathname === "/login/index.php") return fixture("login.html");
  if (url.pathname === "/" || url.pathname === "/my/" || url.pathname === "/my/index.php") {
    return fixture("directory.html");
  }
  const asset = url.pathname.replace(/^\//, "");
    if (["lms.css", "lms.js", "lms-model.js", "lms-boot.js"].includes(asset)) {
    return readFileSync(new URL(asset, firefox));
  }
  return null;
}

createServer((req, res) => {
  try {
    const body = page(req);
    if (body == null) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const type = types[extname(new URL(req.url, "http://127.0.0.1").pathname)] || "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(body);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`LMS fixtures: http://127.0.0.1:${port}/my/courses.php\n`);
});
