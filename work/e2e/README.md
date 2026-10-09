# Real-browser harness

Drives Chrome and Firefox with the packaged extension. `node_modules` is not
committed: run `npm install` here first.

## Portable UX checks

From the repository root, run `npm ci` first. Set `CHROME_BIN` / `FIREFOX_BIN`
when the browser is not at a standard Linux/macOS path.

```
node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/ux-browsers.mjs firefox /path/to/unpacked-store-package --baseline
```

The harness installs a disposable instrumented copy of the actual extension.
It intercepts every portal request, tests search/pagination/focus, dialog safety,
theme switching and removed-panel cleanup, and records JSON/screenshot evidence
in ignored `work/e2e/results`. Test instrumentation never enters the build.
`--baseline` records regressions without enforcing the new performance assertions.
`FIREFOX_TEST_SANDBOX=off` is available for constrained test containers only.
If a test environment uses a trusted proxy CA, `FIREFOX_CA_FILE` imports that
certificate into the disposable profile using `certutil` (`libnss3-tools`);
certificate verification remains enabled.

For one ordinary live page/login flow (no bursts or deliberate failures):

```
node work/e2e/live-observe.mjs firefox outputs/cuims-clear-firefox
# Fill the git-ignored .env using .env.example first:
node work/e2e/live-observe.mjs firefox outputs/cuims-clear-firefox --with-login
```

The live observer logs path/status/timing and selected rate headers only. It does
not log query strings, request bodies, cookies, page contents or credentials.
Account mode seeds a disposable extension/profile; both are deleted afterward.
An ordinary successful session is a lower bound on accepted traffic, never proof
of a numeric rate limit. Browser document/resources and extension background API
requests are different categories; this page observer does not capture worker
traffic. The extension's 40/10-minute budget and 30-second manual gap are local
policy, not measured CUIMS limits.

Offline (mocked CUIMS, no account needed):

- From the repository root, `node work/e2e/conservative-smoke.mjs`: real packaged
  Chrome worker and popup; validates the 60-second UI pause, cached attendance,
  HTTP 429/Retry-After, zero LMS requests or fallback tabs during cooldown,
  and duty-leave fetching/approval updates without opening a portal tab.
  Writes ignored artifacts under `work/e2e/results/conservative/`.

- `node e2e-captcha.mjs <chrome|firefox> <package dir> [labels.json] [count]`:
  real CUIMS captchas from `../corpus` on a mocked login page, through the real
  extension. `THEME=<id>` runs it with a theme restyling the page.
- `node e2e-bg.mjs chrome <package dir>`: service worker, its captcha path
  (`CuimsCaptcha.readBytes`), popup.
- `node solver-browsers.mjs [chrome|firefox]`: the shipped solver over every
  labelled captcha in each browser's own decoder and canvas, through both the
  background path (`readBytes`) and the login page path (`readImage`).
- `node probe-themes.mjs <chrome package dir>`: toolbar icon per theme, live theme switching.
- `node cuims-login-themes.mjs <chrome package dir> <out.png>`: the public CUIMS login page in several themes.

Live (a separate debug Chrome on port 9333 with its own profile; you save your
login in that window's popup once): `load.mjs` loads the Chrome package,
`record.mjs <log>` records every cuchd.in request and the extension's state,
`act.mjs`/`watch-open.mjs` click the popup, `cuims-pages.mjs` screenshots CUIMS
pages per theme. Delete the debug profile afterwards: it holds the saved login.
