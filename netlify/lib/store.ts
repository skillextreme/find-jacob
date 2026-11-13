import { getStore } from "@netlify/blobs";
import type { KV } from "./core.ts";

/** Netlify Blobs with strong consistency, so a guest sees their own RSVP straight away. */
export function blobKV(): KV {
  const store = getStore({ name: "rsvps", consistency: "strong" });
  return {
    get: (key) => store.get(key, { type: "json" }),
    set: async (key, value) => {
      await store.setJSON(key, value);
    },
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
