import type { Config } from "@netlify/functions";
import { publicAttendees } from "../lib/core.ts";
import { blobKV, json } from "../lib/store.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  try {
    return json(200, await publicAttendees(blobKV()));
  } catch (err) {
    console.error("attendees failed", err);
    return json(500, { error: "server_error" });
  }
};

export const config: Config = { path: "/api/attendees" };
