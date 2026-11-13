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
const base = { id: ID_A, token: TOKEN_A, name: "Asha Rao", status: "yes", partySize: 2, character: null, publicName: null, companions: [{ name: "Ben", pet: "1.2" }] };
const solo = { id: ID_A, token: TOKEN_A, name: "Asha Rao", status: "yes", partySize: 1, character: null };

test("creates one response and repeats are idempotent", async () => {
  const kv = memoryKV();
  const first = await handleRsvp(base, "1.1.1.1", kv, 1000);
  expect(first.status).toBe(200);
  // Saying yes always adds a character (random when none was sent) with the first name.
  expect(first.body).toMatchObject({ ok: true, attendees: { totalComing: 2, guests: [{ displayName: "Asha", pets: [{ name: "Ben" }] }] }, you: 0 });
  const guest = (first.body.attendees as { guests: { character: string; key: string }[] }).guests[0];
  expect(guest.character).toMatch(/^\d\.\d\.\d\.\d\.\d$/);
  expect(guest.key).toMatch(/^[0-9a-f]{12}$/);
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

test("changing to no updates the count and removes the character and pets together", async () => {
  const kv = memoryKV();
  await handleRsvp({ ...base, character: "2.4.0.2.3" }, "1.1.1.1", kv, 1000);
  await handleRsvp({ ...solo, id: ID_B, token: TOKEN_B, name: "Ben", character: "sky" }, "2.2.2.2", kv, 2000);
  let pub = await publicAttendees(kv);
  expect(pub.totalComing).toBe(3);
  expect(pub.guests).toMatchObject([
    { character: "2.4.0.2.3", displayName: "Asha", pets: [{ name: "Ben", pet: "1.2" }] },
    { character: "4.5.0.1.2", displayName: "Ben" }, // an old preset name is still understood
  ]);
  expect(pub.guests[1].pets).toBeUndefined();

  const res = await handleRsvp({ ...base, status: "no" }, "1.1.1.1", kv, 3000);
  expect(res.body).toMatchObject({ you: null, attendees: { totalComing: 1, guests: [{ displayName: "Ben" }] } });
  pub = await publicAttendees(kv);
  expect(pub.guests.length).toBe(1);
  expect(JSON.stringify(pub)).not.toContain("Asha");
});

test("everyone a guest brings must be named, and each becomes a pet", async () => {
  const kv = memoryKV();
  const send = (patch: Record<string, unknown>) => handleRsvp({ ...base, ...patch }, "1.1.1.1", kv);
  expect((await send({ companions: [] })).body).toEqual({ error: "companions_required" });
  expect((await send({ companions: undefined })).body).toEqual({ error: "companions_required" });
  expect((await send({ partySize: 3 })).body).toEqual({ error: "companions_required" });
  expect((await send({ companions: [{ name: "  ", pet: "0.0" }] })).body).toEqual({ error: "invalid_companion_name" });
  expect((await send({ companions: [{ name: "Ben", pet: "9.9" }] })).body).toEqual({ error: "invalid_pet" });
  expect((await kv.list("responses/")).length).toBe(0);
  // A missing pet is filled in at random; it is never left out.
  const ok = await send({ partySize: 3, companions: [{ name: "Ben" }, { name: "Chitra", pet: "2.4" }] });
  expect(ok.status).toBe(200);
  const pets = (ok.body.attendees as { guests: { pets: { name: string; pet: string }[] }[] }).guests[0].pets;
  expect(pets.map((p) => p.name)).toEqual(["Ben", "Chitra"]);
  expect(pets[0].pet).toMatch(/^[0-2]\.[0-4]$/);
  expect(pets[1].pet).toBe("2.4");
});

test("a guest can place their character; bad positions are refused", async () => {
  const kv = memoryKV();
  expect((await handleRsvp({ ...solo, pos: [0.25, 0.8] }, "1.1.1.1", kv)).status).toBe(200);
  expect((await publicAttendees(kv)).guests[0].pos).toEqual([0.25, 0.8]);
  for (const pos of [[2, 0.5], [0.5], ["a", "b"], [Number.NaN, 0.1], "middle"]) {
    expect((await handleRsvp({ ...solo, pos }, "1.1.1.1", kv)).body).toEqual({ error: "invalid_position" });
  }
  expect((await publicAttendees(kv)).guests[0].pos).toEqual([0.25, 0.8]);
});

test("reports the caller's own character index privately", async () => {
  const kv = memoryKV();
  await handleRsvp(base, "1.1.1.1", kv, 1000);
  const res = await handleRsvp({ ...solo, id: ID_B, token: TOKEN_B, name: "Ben" }, "2.2.2.2", kv, 2000);
  expect(res.body.you).toBe(1);
});

test("public data shows first names only: no surnames, ids or tokens, and nobody who said no", async () => {
  const kv = memoryKV();
  await handleRsvp({ ...solo, character: "0.3.2.3.4", publicName: "Something Else" }, "1.1.1.1", kv);
  await handleRsvp({ ...solo, id: ID_B, token: TOKEN_B, name: "Ben Thomas", status: "no" }, "2.2.2.2", kv);
  const pub = await publicAttendees(kv);
  // The public name always comes from the name given; a guest cannot hide it or swap it.
  expect(pub.totalComing).toBe(1);
  expect(pub.guests).toMatchObject([{ character: "0.3.2.3.4", displayName: "Asha" }]);
  const text = JSON.stringify(pub);
  expect(text).not.toContain("Rao");
  expect(text).not.toContain("Ben");
  expect(text).not.toContain(ID_A);
  expect(text).not.toContain(sha256(TOKEN_A));
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
  expect(await bad({ character: "9.0.0.0.0" })).toBe(400);
  expect(await bad({ id: "not-an-id" })).toBe(400);
  expect(await bad({ token: "short" })).toBe(400);
  expect((await handleRsvp(null, "1.1.1.1", kv)).status).toBe(400);
  expect((await kv.list("responses/")).length).toBe(0);
  // Names are trimmed and stored as plain text.
  await handleRsvp({ ...base, name: "  <b>Asha</b>\n Rao  " }, "1.1.1.1", kv);
  expect((await hostSummary(kv)).responses[0].name).toBe("<b>Asha</b> Rao");
});

test("throttles writes to 60 per IP per 10 minutes", async () => {
  const kv = memoryKV();
  const t0 = 1_000_000;
  for (let i = 0; i < 60; i++) expect((await handleRsvp(base, "5.5.5.5", kv, t0 + i)).status).toBe(200);
  expect((await handleRsvp(base, "5.5.5.5", kv, t0 + 70)).status).toBe(429);
  expect((await handleRsvp(base, "6.6.6.6", kv, t0 + 71)).status).toBe(200);
  expect((await handleRsvp(base, "5.5.5.5", kv, t0 + 10 * 60 * 1000 + 100)).status).toBe(200);
});

test("host summary lists everyone without token hashes", async () => {
  const kv = memoryKV();
  await handleRsvp(base, "1.1.1.1", kv, 1000);
  await handleRsvp({ ...solo, id: ID_B, token: TOKEN_B, name: "Ben", status: "no" }, "2.2.2.2", kv, 2000);
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
