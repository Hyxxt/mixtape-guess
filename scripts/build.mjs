import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {createHash} from "node:crypto";
const root=fileURLToPath(new URL("../",import.meta.url));
const dist=join(root,"dist");
const types={"index.html":"text/html; charset=utf-8","style.css":"text/css; charset=utf-8","game.js":"application/javascript; charset=utf-8","music.js":"application/javascript; charset=utf-8","catalog.json":"application/json; charset=utf-8","boombox.webp":"image/webp","og-cover.jpg":"image/jpeg"};
const records={};
for(const [name,type] of Object.entries(types)){
  const data=await readFile(join(dist,name));
  const digest=createHash("sha256").update(data).digest("hex").slice(0,16);
  records["/"+name]=[type,type.startsWith("image/")?data.toString("base64"):data.toString("utf8"),digest];
}
const page=records["/index.html"];
page[1]=page[1].replace(/(href|src)="(style\.css|game\.js|music\.js|boombox\.webp)(?:\?v=[^"]*)?"/g,
  (_,attribute,name)=>attribute+'="'+name+'?v='+records["/"+name][2]+'"');
page[2]=createHash("sha256").update(page[1]).digest("hex").slice(0,16);
const catalog=JSON.parse(records["/catalog.json"][1]);
if(catalog.length<10 || new Set(catalog.map(s=>s.name)).size!==catalog.length) throw Error("Invalid song catalog");
const worker=(await readFile(join(root,"server/api.mjs"),"utf8")).replace(/^export function /gm,"function ");
const wrapper=`
const assets=${JSON.stringify(records)};
const api=createApi(JSON.parse(assets["/catalog.json"][1]));
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith("/api/")) return api(request,env);
  const asset=assets[path==="/"?"/index.html":path];
  if(!Array.isArray(asset)) return new Response("Not found",{status:404});
  if(request.method!=="GET" && request.method!=="HEAD")return new Response(null,{status:405});
  const [type,content,digest]=asset;
  const immutable=url.searchParams.get("v")===digest;
  const headers={"Content-Type":type,"ETag":'"'+digest+'"',"Cache-Control":immutable?"public, max-age=31536000, immutable":"no-cache","X-Content-Type-Options":"nosniff"};
  if(request.headers.get("If-None-Match")===headers.ETag)return new Response(null,{status:304,headers});
  const body=type.startsWith("image/")?Uint8Array.from(atob(content),x=>x.charCodeAt(0)):content;
  return new Response(request.method==="HEAD"?null:body,{headers});
}};
`;
await mkdir(join(dist,"server"),{recursive:true});
await writeFile(join(dist,"server/index.js"),worker+wrapper);
console.log("Built worker with "+catalog.length+" playable titles.");
