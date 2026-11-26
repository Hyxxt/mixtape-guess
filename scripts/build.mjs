import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
const dist=join(root,"dist");
const types={"index.html":"text/html; charset=utf-8","style.css":"text/css; charset=utf-8","game.js":"application/javascript; charset=utf-8","music.js":"application/javascript; charset=utf-8","catalog.json":"application/json; charset=utf-8","boombox.webp":"image/webp"};
const records={};
for(const [name,type] of Object.entries(types)){
  const data=await readFile(join(dist,name));
  records["/"+name]=[type,name.endsWith("webp")?data.toString("base64"):data.toString("utf8")];
}
const catalog=JSON.parse(records["/catalog.json"][1]);
if(catalog.length<10 || new Set(catalog.map(s=>s.name)).size!==catalog.length) throw Error("Invalid song catalog");
const worker=(await readFile(join(root,"server/api.mjs"),"utf8")).replace(/^export function /gm,"function ");
const wrapper=`
const assets=${JSON.stringify(records)};
const api=createApi(JSON.parse(assets["/catalog.json"][1]));
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path.startsWith("/api/")) return api(request,env);
  const asset=assets[path==="/"?"/index.html":path];
  if(!Array.isArray(asset)) return new Response("Not found",{status:404});
  if(request.method!=="GET" && request.method!=="HEAD")return new Response(null,{status:405});
  const [type,content]=asset;
  const body=type==="image/webp"?Uint8Array.from(atob(content),x=>x.charCodeAt(0)):content;
  return new Response(request.method==="HEAD"?null:body,{headers:{"Content-Type":type,"Cache-Control":type==="image/webp"?"public, max-age=86400":"no-cache","X-Content-Type-Options":"nosniff"}});
}};
`;
await mkdir(join(dist,"server"),{recursive:true});
await writeFile(join(dist,"server/index.js"),worker+wrapper);
console.log("Built worker with "+catalog.length+" playable titles.");
