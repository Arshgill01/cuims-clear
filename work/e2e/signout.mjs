import { connect } from "./cdp.mjs";
const browser = await connect();
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
const { cookies } = await cdp.send("Network.getAllCookies");
let n = 0;
for (const c of cookies.filter((c) => /cuchd\.in$/.test(c.domain.replace(/^\./, "")))) { await cdp.send("Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path }); n++; }
console.log("deleted cuchd.in cookies:", n);
await browser.disconnect();
