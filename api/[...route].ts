import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../server/index.ts";

function readBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on("error", reject);
  });
}

/** Vercel Node function adapter for the shared Hono API. */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? "GET";
  const protocol = String(request.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = request.headers.host ?? "localhost";
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }

  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);
  const honoResponse = await app.fetch(new Request(`${protocol}://${host}${request.url ?? "/"}`, { method, headers, body }));

  response.statusCode = honoResponse.status;
  honoResponse.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await honoResponse.arrayBuffer()));
}
