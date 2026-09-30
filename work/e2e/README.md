# Real-browser harness

Drives Chrome and Firefox with the packaged extension. `node_modules` is not
committed: run `npm install` here first.

Offline (mocked CUIMS, no account needed):

- `node e2e-captcha.mjs <chrome|firefox> <package dir> [labels.json] [count]`:
  real CUIMS captchas from `../corpus` on a mocked login page, through the real
  extension. `THEME=<id>` runs it with a theme restyling the page.
- `node e2e-bg.mjs chrome <package dir>`: service worker, offscreen captcha path, popup.
- `node probe-themes.mjs <chrome package dir>`: toolbar icon per theme, live theme switching.
- `node cuims-login-themes.mjs <chrome package dir> <out.png>`: the public CUIMS login page in several themes.

Live (a separate debug Chrome on port 9333 with its own profile; you save your
login in that window's popup once): `load.mjs` loads the Chrome package,
`record.mjs <log>` records every cuchd.in request and the extension's state,
`act.mjs`/`watch-open.mjs` click the popup, `cuims-pages.mjs` screenshots CUIMS
pages per theme. Delete the debug profile afterwards: it holds the saved login.
