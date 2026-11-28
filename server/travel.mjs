import {readFile, stat} from "node:fs/promises";

const root = new URL("../travel/", import.meta.url);
const types = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp"
};

export async function serveTravel(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {status: 405, headers: {Allow: "GET, HEAD"}});
  }
  if (url.pathname === "/travel") {
    return new Response(null, {status: 308, headers: {Location: "/travel/" + url.search}});
  }

  const path = url.pathname.slice("/travel/".length) || "index.html";
  const extension = path.split(".").at(-1);
  if (!Object.hasOwn(types, extension) || !path.split("/").every(segment => /^[a-z0-9_-][a-z0-9._-]*$/i.test(segment))) {
    return new Response("Not found", {status: 404});
  }

  try {
    const file = new URL(path, root);
    const info = await stat(file);
    if (!info.isFile()) return new Response("Not found", {status: 404});
    const tag = '"' + info.size.toString(16) + "-" + Math.trunc(info.mtimeMs).toString(16) + '"';
    const headers = {
      "Content-Type": types[extension],
      "Cache-Control": types[extension].startsWith("image/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "ETag": tag
    };
    if (request.headers.get("If-None-Match") === tag) return new Response(null, {status: 304, headers});
    const body = request.method === "HEAD" ? null : await readFile(file);
    return new Response(body, {headers: {...headers, "Content-Length": String(info.size)}});
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return new Response("Not found", {status: 404});
    throw error;
  }
}
