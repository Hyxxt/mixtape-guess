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

let DB;
let dbLabel = dbFile;
if (tursoUrl) {
  try {
    DB = await tursoDb({url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN});
    dbLabel = "turso";
    console.log("Using Turso/libSQL");
  } catch (error) {
    console.error("Turso unavailable, falling back to local SQLite: " + error.message);
    mkdirSync(dirname(dbFile), {recursive: true});
    DB = localDb(dbFile);
  }
} else {
  mkdirSync(dirname(dbFile), {recursive: true});
  DB = localDb(dbFile);
}

// 演示数据已全部下线：榜上只留真实玩家的成绩。
// 早期版本写入过固定 id 的演示账号，启动时逐个清掉（先删 best 再删 players，外键约束）。
const RETIRED_DEMO_IDS = ["d".repeat(64), "c".repeat(64), "b".repeat(64)];
async function dropDemoScores() {
  for (const id of RETIRED_DEMO_IDS) {
    try {
      await DB.prepare("DELETE FROM best WHERE owner=?").bind(id).run();
      await DB.prepare("DELETE FROM players WHERE id=?").bind(id).run();
    } catch (error) {
      console.warn("demo cleanup skipped: " + error.message);
    }
  }
}
await dropDemoScores();

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
    const request = new Request(new URL(req.url, origin(req)), {
      method: req.method,
      headers: req.headers,
      body: parts.length ? Buffer.concat(parts) : undefined
    });
    const out = await worker.fetch(request, {DB});
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  console.log("Listening on http://" + host + ":" + port + "  db=" + dbLabel);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
