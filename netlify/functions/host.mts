import type { Config } from "@netlify/functions";
import { adminKeyMatches, hostSummary } from "../lib/core.ts";
import { blobKV, json } from "../lib/store.ts";

/** Private host view. Needs the ADMIN_KEY environment variable set in Netlify. */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const expected = process.env.ADMIN_KEY;
  if (!expected) return json(503, { error: "admin_key_not_set" });
  const given = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-admin-key");
  if (!adminKeyMatches(given, expected)) return json(401, { error: "unauthorized" });
  try {
    return json(200, await hostSummary(blobKV()));
  } catch (err) {
    console.error("host failed", err);
    return json(500, { error: "server_error" });
  }
};

export const config: Config = { path: "/api/host" };
