import {createServer} from "node:http";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {localDb} from "../scripts/local-db.mjs";
import {tursoDb} from "../scripts/turso-db.mjs";
import worker from "../dist/server/index.js";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const dbFile = process.env.DB_FILE || ".local/quiz.sqlite";
const tursoUrl = process.env.TURSO_DATABASE_URL;

async function openDatabase() {
  if (tursoUrl) {
    const connection = await tursoDb({url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN});
    console.log("Using Turso/libSQL");
    return connection;
  }
  mkdirSync(dirname(dbFile), {recursive: true});
  return localDb(dbFile);
}

let database;
function getDatabase() {
  database ??= openDatabase().catch(error => {
    console.error("Database unavailable: " + error.message);
    setTimeout(() => { database = null; }, 2000).unref();
    return null;
  });
  return database;
}

function origin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || ("127.0.0.1:" + port);
  return proto + "://" + hostHeader;
}

const server = createServer(async (req, res) => {
  try {
    let size = 0;
    const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > 2048) { res.writeHead(413); res.end(); return; }
      parts.push(part);
    }
    const url = new URL(req.url, origin(req));
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: parts.length ? Buffer.concat(parts) : undefined
    });
    const needsDatabase = url.pathname.startsWith("/api/") && !["/api/health", "/api/preview"].includes(url.pathname);
    const DB = needsDatabase ? await getDatabase() : null;
    if (needsDatabase && !DB) {
      res.writeHead(503, {"Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store"});
      res.end(JSON.stringify({error:"积分服务暂时无法连接，请稍后重试。"}));
      return;
    }
    const out = await worker.fetch(request, {DB});
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  console.log("Listening on http://" + host + ":" + port);
  void getDatabase();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
