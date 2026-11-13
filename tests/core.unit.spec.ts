import { expect, test } from "@playwright/test";
import { adminKeyMatches, handleRsvp, hostSummary, publicAttendees, sha256, type KV } from "../netlify/lib/core.ts";

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
    set: async (k, v) => void data.set(k, structuredClone(v)),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const base = { id: ID_A, token: TOKEN_A, name: "Asha Rao", status: "yes", partySize: 2, character: null, publicName: null };

test("creates one response and repeats are idempotent", async () => {
  const kv = memoryKV();
  const first = await handleRsvp(base, "1.1.1.1", kv, 1000);
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ ok: true, attendees: { totalComing: 2, guests: [] }, you: null });
  // Double tap and retry: same id and token.
  await Promise.all([handleRsvp(base, "1.1.1.1", kv, 1001), handleRsvp(base, "1.1.1.1", kv, 1002)]);
  expect((await kv.list("responses/")).length).toBe(1);
  expect((await publicAttendees(kv)).totalComing).toBe(2);
});

test("stores only a hash of the edit token", async () => {
  const kv = memoryKV();
  await handleRsvp(base, "1.1.1.1", kv);
  const stored = JSON.stringify([...kv.data.values()]);
  expect(stored).not.toContain(TOKEN_A);
  expect(stored).toContain(sha256(TOKEN_A));
});

test("a wrong token cannot change a response", async () => {
  const kv = memoryKV();
  await handleRsvp(base, "1.1.1.1", kv);
  const res = await handleRsvp({ ...base, token: TOKEN_B, status: "no" }, "9.9.9.9", kv);
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: "invalid_token" });
  expect((await publicAttendees(kv)).totalComing).toBe(2);
});

test("changing to no updates the count and removes the character together", async () => {
  const kv = memoryKV();
  await handleRsvp({ ...base, character: "fern", publicName: "Asha" }, "1.1.1.1", kv, 1000);
  await handleRsvp({ ...base, id: ID_B, token: TOKEN_B, name: "Ben", partySize: 1, character: "sky" }, "2.2.2.2", kv, 2000);
  let pub = await publicAttendees(kv);
  expect(pub).toEqual({ totalComing: 3, guests: [{ character: "fern", displayName: "Asha" }, { character: "sky" }] });

  const res = await handleRsvp({ ...base, status: "no", character: "fern", publicName: "Asha" }, "1.1.1.1", kv, 3000);
  expect(res.body).toMatchObject({ you: null, attendees: { totalComing: 1, guests: [{ character: "sky" }] } });
  pub = await publicAttendees(kv);
  expect(pub).toEqual({ totalComing: 1, guests: [{ character: "sky" }] });
});

test("reports the caller's own character index privately", async () => {
  const kv = memoryKV();
  await handleRsvp({ ...base, character: "fern" }, "1.1.1.1", kv, 1000);
  const res = await handleRsvp({ ...base, id: ID_B, token: TOKEN_B, name: "Ben", partySize: 1, character: "sky" }, "2.2.2.2", kv, 2000);
  expect(res.body.you).toBe(1);
});

test("public data never includes names, ids or tokens unless opted in", async () => {
  const kv = memoryKV();
  await handleRsvp({ ...base, character: "plum", publicName: null }, "1.1.1.1", kv);
  const text = JSON.stringify(await publicAttendees(kv));
  expect(text).not.toContain("Asha");
  expect(text).not.toContain(ID_A);
  expect(text).not.toContain(sha256(TOKEN_A));
  // A public name without a character is dropped.
  await handleRsvp({ ...base, character: null, publicName: "Asha" }, "1.1.1.1", kv);
  expect(JSON.stringify(await publicAttendees(kv))).not.toContain("Asha");
});

test("validates input", async () => {
  const kv = memoryKV();
  const bad = async (patch: Record<string, unknown>) => (await handleRsvp({ ...base, ...patch }, "1.1.1.1", kv)).status;
  expect(await bad({ name: "   " })).toBe(400);
  expect(await bad({ name: "x".repeat(41) })).toBe(400);
  expect(await bad({ status: "maybe" })).toBe(400);
  expect(await bad({ partySize: 0 })).toBe(400);
  expect(await bad({ partySize: 6 })).toBe(400);
  expect(await bad({ partySize: 1.5 })).toBe(400);
  expect(await bad({ character: "dragon" })).toBe(400);
  expect(await bad({ character: "fern", publicName: "y".repeat(21) })).toBe(400);
  expect(await bad({ id: "not-an-id" })).toBe(400);
  expect(await bad({ token: "short" })).toBe(400);
  expect((await handleRsvp(null, "1.1.1.1", kv)).status).toBe(400);
  expect((await kv.list("responses/")).length).toBe(0);
  // Names are trimmed and stored as plain text.
  await handleRsvp({ ...base, name: "  <b>Asha</b>\n Rao  " }, "1.1.1.1", kv);
  expect((await hostSummary(kv)).responses[0].name).toBe("<b>Asha</b> Rao");
});

test("throttles writes to 20 per IP per 10 minutes", async () => {
  const kv = memoryKV();
  const t0 = 1_000_000;
  for (let i = 0; i < 20; i++) expect((await handleRsvp(base, "5.5.5.5", kv, t0 + i)).status).toBe(200);
  expect((await handleRsvp(base, "5.5.5.5", kv, t0 + 30)).status).toBe(429);
  expect((await handleRsvp(base, "6.6.6.6", kv, t0 + 31)).status).toBe(200);
  expect((await handleRsvp(base, "5.5.5.5", kv, t0 + 10 * 60 * 1000 + 100)).status).toBe(200);
});

test("host summary lists everyone without token hashes", async () => {
  const kv = memoryKV();
  await handleRsvp(base, "1.1.1.1", kv, 1000);
  await handleRsvp({ ...base, id: ID_B, token: TOKEN_B, name: "Ben", status: "no", partySize: 1 }, "2.2.2.2", kv, 2000);
  const sum = await hostSummary(kv);
  expect(sum).toMatchObject({ totalComing: 2, yesCount: 1, noCount: 1 });
  expect(sum.responses.map((r) => r.name)).toEqual(["Asha Rao", "Ben"]);
  expect(JSON.stringify(sum)).not.toContain("tokenHash");
});

test("admin key check", () => {
  expect(adminKeyMatches("secret phrase", "secret phrase")).toBe(true);
  expect(adminKeyMatches("wrong", "secret phrase")).toBe(false);
  expect(adminKeyMatches(null, "secret phrase")).toBe(false);
  expect(adminKeyMatches("anything", undefined)).toBe(false);
});
