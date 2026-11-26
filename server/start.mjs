import {createServer} from "node:http";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import {localDb} from "../scripts/local-db.mjs";
import worker from "../dist/server/index.js";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const dbFile = process.env.DB_FILE || ".local/quiz.sqlite";

mkdirSync(dirname(dbFile), {recursive: true});
const DB = localDb(dbFile);

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
  console.log("Listening on http://" + host + ":" + port + "  db=" + dbFile);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
