import { app } from "../server/index.ts";

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request);
}
