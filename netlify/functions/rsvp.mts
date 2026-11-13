import type { Config, Context } from "@netlify/functions";
import { handleRsvp } from "../lib/core.ts";
import { blobKV, json } from "../lib/store.ts";

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 4096) return json(413, { error: "too_large" });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  try {
    const reply = await handleRsvp(body, context.ip || "unknown", blobKV());
    return json(reply.status, reply.body);
  } catch (err) {
    console.error("rsvp failed", err);
    return json(500, { error: "server_error" });
  }
};

export const config: Config = { path: "/api/rsvp" };
