import {createServer} from "node:http";
import {mkdirSync} from "node:fs";
import {localDb} from "./local-db.mjs";
import worker from "../dist/server/index.js";
const port=Number(process.env.QUIZ_PORT||18746);
mkdirSync(".local",{recursive:true});
const DB=localDb(".local/quiz.sqlite");
const origin="http://127.0.0.1:"+port;
const server=createServer(async(req,res)=>{
  try{
    let size=0;const parts=[];
    for await(const part of req){size+=part.length;if(size>2048){res.writeHead(413);res.end();return;}parts.push(part);}
    const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,body:parts.length?Buffer.concat(parts):undefined});
    const out=await worker.fetch(request,{DB});
    res.writeHead(out.status,Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }catch{res.writeHead(500);res.end("Server error");}
});
server.listen(port,"127.0.0.1",()=>console.log("Local: "+origin));
