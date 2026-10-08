// Local-only review harness: real Firefox popup/background code, fixture CUIMS.
// No credentials, cookies or requests reach the university from this preview.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "outputs/cuims-clear-firefox");
const fixture = fs.readFileSync(path.join(root, "tests/fixtures/marks/regular.html"), "utf8");
const TIMETABLE_HTML = fs.readFileSync(path.join(root, "tests/fixtures/timetable/current.html"), "utf8");
const stub = `(() => {
const listeners = [], data = JSON.parse(sessionStorage.getItem('marks-preview-data') || '{"uid":"24BCS00000","password":"fixture-only","popupView":"marks"}');
window.marksPreview = {requests:Number(sessionStorage.getItem('marks-preview-requests')||0),data};
function save(){sessionStorage.setItem('marks-preview-data',JSON.stringify(data));}
function counter(){const node=document.getElementById('preview-check');if(node)node.textContent='Fixture preview · extension requests: '+marksPreview.requests;}
document.addEventListener('DOMContentLoaded',counter);
function pick(defaults) { return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,key in data?data[key]:value])); }
window.chrome = {
 storage:{local:{get(defaults,callback){const value=pick(defaults);callback?.(value);return Promise.resolve(value);},set(values,callback){const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:data[key],newValue:value};data[key]=value;}save();listeners.forEach(fn=>fn(changes,'local'));callback?.();return Promise.resolve();},remove(keys,callback){const changes={};for(const key of [keys].flat()){changes[key]={oldValue:data[key]};delete data[key];}save();listeners.forEach(fn=>fn(changes,'local'));callback?.();return Promise.resolve();}},onChanged:{addListener(fn){listeners.push(fn);}}},
 runtime:{getManifest:()=>({version:'0.10.0'}),getURL:p=>p,lastError:null,sendMessage(message,callback){ if(message.type==='cuims-clear:marks-read') previewDaemon.fetchRegularMarks({force:message.refresh===true}).then(callback); else if(message.type==='cuims-clear:timetable-read') previewDaemon.fetchCachedTimetable().then(callback); else callback?.({error:'Preview only'}); }},
 permissions:{contains(_options,callback){callback?.(true);return Promise.resolve(true);}},tabs:{query:async()=>[]}
};
window.previewDaemon = CuimsAttendance.createDaemon({storage:chrome.storage.local,loginTabPresent:async()=>false,fetchImpl:async(target,options)=>{
 marksPreview.requests++;sessionStorage.setItem('marks-preview-requests',String(marksPreview.requests));counter(); const old=options.body && new URLSearchParams(options.body).get(CuimsMarks.SESSION_NAME)==='25262';
 const html=new URL(target).pathname === '/frmMyTimeTable.aspx' ? ${JSON.stringify('<h6>24BCS00000</h6>'+TIMETABLE_HTML)} : old?${JSON.stringify(fixture)}.replace('selected="selected" value="26271"','value="26271"').replace('value="25262"','selected="selected" value="25262"'):${JSON.stringify(fixture)};
 return {url:target,status:200,text:async()=>html};
},solveCaptcha:async()=>''});
})();`;
const server = http.createServer((req,res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/preview-api.js") { res.setHeader("content-type", "text/javascript"); res.end(stub); return; }
  if (url.pathname === "/") {
    const html = fs.readFileSync(path.join(source, "popup.html"), "utf8").replace('<script src="themes.js"></script>', '<script src="attendance-parse.js"></script><script src="attendance-model.js"></script><script src="attendance-client.js"></script><script src="marks.js"></script><script src="timetable.js"></script><script src="attendance-daemon.js"></script><script src="preview-api.js"></script><script src="themes.js"></script>');
    res.setHeader("content-type", "text/html"); res.end(html.replace('</body>','<aside id="preview-check" style="position:fixed;left:460px;top:20px;font:14px system-ui">Fixture preview</aside></body>')); return;
  }
  const filename = path.resolve(source, "." + decodeURIComponent(url.pathname));
  if (!filename.startsWith(source + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {res.writeHead(404);res.end();return;}
  res.setHeader("content-type", filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : "text/plain");
  res.end(fs.readFileSync(filename));
});
server.listen(4179,"127.0.0.1",()=>console.log("Marks popup preview: http://127.0.0.1:4179"));
