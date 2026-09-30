import { connect } from "./cdp.mjs";
const browser = await connect();
const pages = await browser.pages();
for (const p of pages) console.log(" tab:", p.url().slice(0, 100));
if (process.argv[2] === "--close-portal") for (const p of pages) if (/cuchd\.in/.test(p.url())) await p.close();
await browser.disconnect();
