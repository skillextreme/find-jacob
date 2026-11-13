import { createHash } from "node:crypto";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

const isPhone = (info: TestInfo) => info.project.name === "phone";

interface Lens {
  x: number;
  y: number;
  r: number;
}

/** Where the window currently is, in page pixels. */
async function lens(page: Page): Promise<Lens> {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>("#park")!;
    const hole = document.querySelector<SVGCircleElement>("#mask-hole")!;
    const m = svg.getScreenCTM()!;
    const p = new DOMPoint(hole.cx.baseVal.value, hole.cy.baseVal.value).matrixTransform(m);
    return { x: p.x, y: p.y, r: hole.r.baseVal.value * m.a };
  });
}

/** Centre of Jacob's body in page pixels. */
async function jacob(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const b = document.querySelector("#it-jacob .figure")!.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
}

async function touchDrag(page: Page, points: [number, number][]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first[0], y: first[1] }] });
  for (const [x, y] of rest) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Moves the window to a page position with the project's input: mouse, or press-and-drag. */
async function lookAt(page: Page, info: TestInfo, x: number, y: number): Promise<void> {
  if (!isPhone(info)) {
    await page.mouse.move(x - 40, y - 30);
    await page.mouse.move(x, y, { steps: 4 });
    return;
  }
  const l = await lens(page);
  const vp = page.viewportSize()!;
  const offset = l.r + 12; // the window sits above the finger
  const fy = y + offset;
  expect(fy, "the finger position must be on screen").toBeLessThan(vp.height - 2);
  const side = x > vp.width / 2 ? -1 : 1;
  await touchDrag(page, [
    [x + side * 60, fy - 50],
    [x + side * 30, fy - 25],
    [x, fy],
  ]);
}

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-state", "searching");
}

async function findJacob(page: Page, info: TestInfo): Promise<void> {
  const j = await jacob(page);
  await lookAt(page, info, j.x, j.y);
  await expect(page.locator("#jacob-bubble")).toBeVisible();
  await expect(page.locator("#jacob-bubble")).toHaveText("Found me?");
  if (isPhone(info)) await page.touchscreen.tap(j.x, j.y);
  else await page.mouse.click(j.x, j.y);
  await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
}

async function skipToInvite(page: Page): Promise<void> {
  await open(page);
  await page.locator("#skip").click();
  await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
  await expect(page.locator("#invite-title")).toBeFocused();
}

interface MockApi {
  posts: Record<string, unknown>[];
  failNext: number;
  guests: Record<string, unknown>[];
  delayMs: number;
}

/** Stands in for the Netlify functions. */
async function mockApi(page: Page): Promise<MockApi> {
  const api: MockApi = { posts: [], failNext: 0, guests: [], delayMs: 0 };
  let total = 0;
  await page.route("**/api/attendees", (route: Route) =>
    route.fulfill({ json: { totalComing: total, guests: api.guests } }),
  );
  await page.route("**/api/rsvp", async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    api.posts.push(body);
    if (api.delayMs) await new Promise((r) => setTimeout(r, api.delayMs));
    if (api.failNext > 0) {
      api.failNext--;
      return route.fulfill({ status: 500, json: { error: "server_error" } });
    }
    total = body.status === "yes" ? (body.partySize as number) : 0;
    api.guests =
      body.status === "yes"
        ? [
            {
              key: createHash("sha256").update(`guest:${String(body.id).toLowerCase()}`).digest("hex").slice(0, 12),
              character: body.character,
              displayName: String(body.name).split(" ")[0],
              ...(body.pos ? { pos: body.pos } : {}),
              ...(body.secrets ? { secrets: body.secrets } : {}),
              ...((body.companions as unknown[]).length ? { pets: body.companions } : {}),
            },
          ]
        : [];
    return route.fulfill({ json: { ok: true, attendees: { totalComing: total, guests: api.guests }, you: api.guests.length ? 0 : null } });
  });
  return api;
}

test.describe("search", () => {
  test("shows a preview, then the window follows the pointer or finger", async ({ page }, info) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("I found us a spot. Can you find me?");
    await expect(page.locator("#instruction")).toHaveText(isPhone(info) ? "Hold and drag to find me" : "Move around to find me");
    await expect(page.locator("#portrait svg")).toBeVisible();

    // A preview patch is visible before any input.
    const before = await lens(page);
    expect(before.r).toBeGreaterThan(50);
    await page.screenshot({ path: info.outputPath("1-hidden.png") });

    const vp = page.viewportSize()!;
    const tx = Math.round(vp.width * 0.3);
    const ty = Math.round(vp.height * 0.55);
    await lookAt(page, info, tx, ty);
    const after = await lens(page);
    // The centre is exactly where the guest pointed: no tracking lag.
    expect(Math.abs(after.x - tx)).toBeLessThan(2);
    expect(Math.abs(after.y - ty)).toBeLessThan(2);
    expect(after.r * 2).toBeGreaterThan(isPhone(info) ? 135 : 175);
    expect(after.r * 2).toBeLessThan(isPhone(info) ? 165 : 210);

    // The cover is still on everywhere else, and the page cannot scroll during the search.
    await expect(page.locator("#park")).toHaveAttribute("data-cover", "covering");
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

    // Pausing grows the window by about 15%.
    await page.waitForTimeout(900);
    const grown = await lens(page);
    expect(grown.r / after.r).toBeGreaterThan(1.12);
    expect(grown.r / after.r).toBeLessThan(1.18);
  });

  test("on a phone the window sits above the finger and stays after release", async ({ page }, info) => {
    test.skip(!isPhone(info), "touch only");
    await open(page);
    const before = await lens(page);
    await touchDrag(page, [
      [100, 520],
      [140, 500],
      [180, 480],
    ]);
    const l = await lens(page);
    expect(Math.abs(l.x - 180)).toBeLessThan(2);
    // Bottom edge of the window is above the fingertip.
    expect(l.y + before.r).toBeLessThan(480);
    await page.waitForTimeout(300);
    const later = await lens(page);
    expect(Math.abs(later.x - l.x) + Math.abs(later.y - l.y)).toBeLessThan(1);
  });

  test("optional discoveries react without finishing the game", async ({ page }, info) => {
    await open(page);
    for (const id of ["dog", "bush", "duck"]) {
      const c = await page.evaluate((sel) => {
        const b = document.querySelector(sel)!.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }, `#it-${id}`);
      await lookAt(page, info, c.x, c.y);
      await expect(page.locator(`#it-${id}`)).toHaveClass(/react/);
    }
    await expect(page.locator("#app")).toHaveAttribute("data-state", "searching");
    await expect(page.locator("#live")).toContainText(/duck/i);
  });

  test("finding Jacob reveals the whole park and the invitation", async ({ page }, info) => {
    await open(page);
    const j = await jacob(page);
    await lookAt(page, info, j.x, j.y);
    await expect(page.locator("#jacob-bubble")).toHaveText("Found me?");
    await expect(page.locator("#it-jacob")).toHaveClass(/wave/);
    await page.screenshot({ path: info.outputPath("2-found.png") });

    if (isPhone(info)) await page.touchscreen.tap(j.x, j.y);
    else await page.mouse.click(j.x, j.y);
    // Repeated input during the reveal cannot restart it.
    await expect(page.locator("#app")).toHaveAttribute("data-state", /revealing|invite/);
    if (!isPhone(info)) await page.mouse.click(j.x, j.y);
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
    await expect(page.locator("#park")).toHaveAttribute("data-cover", "gone");

    const card = page.locator("#invite");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("You found me! Now come hang out.");
    await expect(card).toContainText("It’s my birthday. Let’s spend an afternoon in the park.");
    await expect(card).toContainText("Sunday 15 November 2026");
    await expect(card).toContainText("3:00");
    await expect(card).toContainText("6:00 pm");
    await expect(card).toContainText("Cubbon Park");
    await expect(card).toContainText("active wear");
    await expect(card).toContainText("Exact spot will be shared on WhatsApp.");
    await expect(card).not.toContainText(/rain/i);
    await expect(card.locator("#map-link")).toHaveCount(0);
    await expect(page.locator("#invite-title")).toBeFocused();
    await expect(page.locator("#invite-title")).toBeInViewport();

    // The page scrolls normally after the game.
    if (isPhone(info)) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.getElementById("finder")!).touchAction)).toBe("auto");
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: info.outputPath("3-invitation.png") });
  });

  test("clues appear at about 10 and 20 seconds, and the last one finishes the game", async ({ page }, info) => {
    await open(page);
    const vp = page.viewportSize()!;
    // Look somewhere far from Jacob, and keep looking.
    await lookAt(page, info, vp.width * 0.15, vp.height * 0.4);
    await expect(page.locator("#hint-plane")).toBeHidden();
    await page.waitForTimeout(8_000);
    await expect(page.locator("#hint-plane")).toBeHidden();
    await expect(page.locator("#instruction")).toHaveText("Hint: follow the paper plane", { timeout: 4_000 });
    await expect(page.locator("#hint-plane")).toBeVisible();
    await expect(page.locator("#jacob-bubble")).toBeHidden();

    await expect(page.locator("#jacob-bubble")).toHaveText("Over here!", { timeout: 13_000 });
    await expect(page.locator("#jacob-bubble")).toBeVisible();
    // Progress is kept when the viewport changes (rotation).
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await expect(page.locator("#app")).toHaveAttribute("data-state", "searching");
    await expect(page.locator("#jacob-bubble")).toBeVisible();
    await page.setViewportSize(vp);
    await page.locator("#jacob-bubble").click();
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
  });

  test("keyboard only: arrow keys find Jacob and Enter opens the invitation", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.locator("#finder")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#live")).toContainText("Jacob isn't in view yet");

    const j = await jacob(page);
    for (let i = 0; i < 60; i++) {
      if (await page.locator("#jacob-bubble").isVisible()) break;
      const l = await lens(page);
      const dx = j.x - l.x;
      const dy = j.y - l.y;
      await page.keyboard.press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : dy > 0 ? "ArrowDown" : "ArrowUp");
    }
    await expect(page.locator("#instruction")).toHaveText("Use the arrow keys to find me");
    await expect(page.locator("#jacob-bubble")).toBeVisible();
    await expect(page.locator("#live")).toContainText("Jacob");
    await page.keyboard.press("Enter");
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
    await expect(page.locator("#invite-title")).toBeFocused();
  });

  test("the Reveal invitation control works from the keyboard", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#skip")).toBeFocused();
    await expect(page.locator("#skip")).toHaveText("Reveal invitation");
    await page.keyboard.press("Enter");
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
    await expect(page.locator("#invite")).toContainText("Cubbon Park");
  });

  test("reduced motion: the search still works and the reveal is a short fade", async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await findJacob(page, info);
    await expect(page.locator("#invite-title")).toBeFocused();
    await expect(page.locator("#invite")).toContainText("Sunday 15 November 2026");
  });
});

test.describe("rsvp", () => {
  test("the decline button runs away and can never be clicked or tapped", async ({ page }, info) => {
    const api = await mockApi(page);
    await skipToInvite(page);
    await page.locator("#rsvp-name").fill("Asha Rao");
    const no = page.locator("#rsvp-no");
    await no.scrollIntoViewIfNeeded();
    const vp = page.viewportSize()!;
    const spots = new Set<string>();

    for (let i = 0; i < 12; i++) {
      const box = (await no.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (isPhone(info)) {
        await page.touchscreen.tap(x, y);
      } else {
        await page.mouse.move(x, y, { steps: 6 });
        await page.mouse.down();
        await page.mouse.up();
      }
      await page.waitForTimeout(260);
      const after = (await no.boundingBox())!;
      // It left the spot that was aimed at and stayed fully on screen.
      expect(Math.hypot(after.x - box.x, after.y - box.y)).toBeGreaterThan(40);
      expect(after.x).toBeGreaterThanOrEqual(0);
      expect(after.y).toBeGreaterThanOrEqual(0);
      expect(after.x + after.width).toBeLessThanOrEqual(vp.width + 1);
      expect(after.y + after.height).toBeLessThanOrEqual(vp.height + 1);
      spots.add(`${Math.round(after.x / 40)},${Math.round(after.y / 40)}`);
    }
    expect(spots.size).toBeGreaterThan(5);
    expect(api.posts.length).toBe(0);
    await expect(page.locator("#view-no")).toBeHidden();
    await expect(page.locator("#dodge-msg")).not.toHaveText("");

    // Yes still works, and the runaway button goes away with the form.
    await page.locator("#rsvp-yes").click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    await expect(no).toBeHidden();
    expect(api.posts.length).toBe(1);
    expect(api.posts[0]).toMatchObject({ status: "yes" });
  });

  test("the decline button also runs under reduced motion; the keyboard can still decline", async ({ page }, info) => {
    const api = await mockApi(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await skipToInvite(page);
    await page.locator("#rsvp-name").fill("Kiran");
    const no = page.locator("#rsvp-no");
    await no.scrollIntoViewIfNeeded();
    const box = (await no.boundingBox())!;
    if (isPhone(info)) await page.touchscreen.tap(box.x + 20, box.y + 20);
    else await page.mouse.click(box.x + 20, box.y + 20);
    await page.waitForTimeout(150);
    const after = (await no.boundingBox())!;
    expect(Math.hypot(after.x - box.x, after.y - box.y)).toBeGreaterThan(40);
    expect(api.posts.length).toBe(0);

    await no.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "You’ll be missed. Thanks for letting me know." })).toBeFocused();
    expect(api.posts.length).toBe(1);
    expect(api.posts[0]).toMatchObject({ name: "Kiran", status: "no" });
    await expect(no).toBeHidden();
  });

  test("yes saves once, confirms and offers the calendar", async ({ page }, info) => {
    const api = await mockApi(page);
    api.delayMs = 300;
    await skipToInvite(page);

    // The name is required before anything is sent.
    await page.locator("#rsvp-yes").click();
    await expect(page.locator("#rsvp-name-err")).toBeVisible();
    expect(api.posts.length).toBe(0);

    await page.locator("#rsvp-name").fill("  Asha   Rao ");
    await page.locator("#rsvp-size").selectOption("2");
    // Bringing someone? Their name is required.
    await page.locator("#rsvp-yes").click();
    await expect(page.locator("#rsvp-comp-err")).toBeVisible();
    expect(api.posts.length).toBe(0);
    await page.getByLabel("Name of guest 2").fill("Ben");
    // A double tap sends one request.
    await page.locator("#rsvp-yes").dblclick();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeFocused();
    expect(api.posts.length).toBe(1);
    expect(api.posts[0]).toMatchObject({ name: "Asha Rao", status: "yes", partySize: 2, publicName: "Asha" });
    expect(String(api.posts[0].character)).toMatch(/^\d\.\d\.\d\.\d\.\d$/);
    expect(api.posts[0].companions).toMatchObject([{ name: "Ben" }]);
    await expect(page.locator("#park .pet")).toHaveCount(1);
    await expect(page.locator("#park .pet-name")).toHaveText("Ben");
    // The guest is in the park straight away, with their first name, and is told so.
    await expect(page.locator("#park .guest")).toHaveCount(1);
    await expect(page.locator("#park .guest-name").first()).toHaveText("Asha");
    await expect(page.locator("#join")).toContainText("everyone invited can see it");
    expect(String(api.posts[0].id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(api.posts[0].token)).toMatch(/^[0-9a-f]{64}$/);
    await expect(page.locator("#yes-sum")).toHaveText("You’re down as Asha Rao, with Ben.");

    const google = page.getByRole("link", { name: "Add to Google Calendar" });
    await expect(google).toBeVisible();
    const href = new URL((await google.getAttribute("href"))!);
    expect(href.searchParams.get("dates")).toBe("20261115T093000Z/20261115T123000Z");
    expect(href.searchParams.get("location")).toBe("Cubbon Park, Bengaluru");
    const ics = page.getByRole("link", { name: "Download calendar file" });
    await expect(ics).toHaveAttribute("href", "/jacob-birthday-2026.ics");
    const file = await page.request.get("/jacob-birthday-2026.ics");
    expect(file.ok()).toBe(true);
    expect(file.headers()["content-type"]).toContain("text/calendar");
    const icsText = await file.text();
    expect(icsText).toContain("DTSTART:20261115T093000Z\r\n");
    expect(icsText).toContain("DTEND:20261115T123000Z\r\n");
    expect(icsText).toContain("LOCATION:Cubbon Park\\, Bengaluru\r\n");
    await expect(page.getByRole("button", { name: "Change my response" })).toBeVisible();
    await expect(page.locator("#count-badge")).toHaveText("2 coming");
    await page.getByRole("heading", { name: "See you at the picnic" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("4-rsvp-yes.png") });
  });

  test("a failed save keeps the form, shows no confirmation, and the retry reuses the same response", async ({ page }) => {
    const api = await mockApi(page);
    api.failNext = 1;
    await skipToInvite(page);
    await page.locator("#rsvp-name").fill("Asha Rao");
    await page.locator("#rsvp-size").selectOption("3");
    await page.getByLabel("Name of guest 2").fill("Ben");
    await page.getByLabel("Name of guest 3").fill("Chitra");
    await page.locator("#rsvp-yes").click();

    await expect(page.locator("#rsvp-error")).toBeVisible();
    await expect(page.getByLabel("Name of guest 3")).toHaveValue("Chitra");
    await expect(page.locator("#rsvp-error")).toContainText("That didn’t save");
    await expect(page.locator("#rsvp-name")).toHaveValue("Asha Rao");
    await expect(page.locator("#rsvp-size")).toHaveValue("3");
    await expect(page.locator("#view-yes")).toBeHidden();
    await expect(page.locator("#count-badge")).toBeHidden();
    await expect(page.locator("#park .guest")).toHaveCount(0);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    expect(api.posts.length).toBe(2);
    expect(api.posts[1].id).toBe(api.posts[0].id);
    expect(api.posts[1].token).toBe(api.posts[0].token);
  });

  test("with the API unavailable the game and invitation still work", async ({ page }) => {
    // No mock: the preview server has no /api routes.
    await skipToInvite(page);
    await expect(page.locator("#invite")).toContainText("Cubbon Park");
    await page.locator("#rsvp-name").fill("Asha");
    await page.locator("#rsvp-yes").click();
    await expect(page.locator("#rsvp-error")).toBeVisible();
    await expect(page.locator("#rsvp-name")).toHaveValue("Asha");
    await expect(page.locator("#view-yes")).toBeHidden();
  });

  test("saying yes puts a named character in the park; the look and pets can be changed but not removed", async ({ page }, info) => {
    const api = await mockApi(page);
    await skipToInvite(page);
    await expect(page.locator(".rsvp__public")).toContainText("everyone invited can see");
    await page.locator("#rsvp-name").fill("Asha Rao");
    await page.locator("#rsvp-size").selectOption("3");
    await page.getByLabel("Name of guest 2").fill("Ben");
    await page.getByLabel("Name of guest 3").fill("Chitra");
    await page.locator("#rsvp-yes").click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();

    await expect(page.locator("#park .guest")).toHaveCount(1);
    await expect(page.locator("#park .guest-name:not(.pet-name)")).toHaveText("Asha");
    await expect(page.locator("#park .pet-name")).toHaveText(["Ben", "Chitra"]);
    // There is no way to hide the name, drop a pet or leave the picture.
    await expect(page.locator("#join-show, #leave-btn")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /leave|remove|hide/i })).toHaveCount(0);

    // Customise hair, clothes and a pet, then save: one request, same response.
    const save = page.getByRole("button", { name: "Save my look" });
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: "Curly" }).click();
    await page.getByRole("button", { name: "Top 4", exact: true }).click();
    await page.getByRole("button", { name: "Bottoms 2", exact: true }).click();
    await page.getByRole("button", { name: "Skin 5", exact: true }).click();
    await page.locator('.petrow').nth(1).getByRole("button", { name: "Bunny" }).click();
    await page.locator('.petrow').nth(1).getByRole("button", { name: "Pet colour 5" }).click();
    expect(api.posts.length).toBe(1);
    await save.click();
    await expect(page.locator("#join-status")).toHaveText("Saved. That’s you in the park now.");
    expect(api.posts.length).toBe(2);
    const look = String(api.posts[1].character).split(".");
    expect([look[0], look[1], look[3], look[4]]).toEqual(["4", "4", "3", "1"]);
    expect(api.posts[1].companions).toMatchObject([{ name: "Ben" }, { name: "Chitra", pet: "2.4" }]);
    expect(api.posts[1].id).toBe(api.posts[0].id);
    await expect(page.locator("#park .guest")).toHaveCount(1);
    await expect(page.locator("#park .pet")).toHaveCount(2);

    // Drag your own character to a new place in the park.
    await page.evaluate(() => window.scrollTo(0, 0));
    const me = page.locator("#park .guest.you .figure");
    await expect(me).toHaveCount(1);
    const from = (await me.boundingBox())!;
    const sx = from.x + from.width / 2;
    const sy = from.y + from.height / 2;
    if (isPhone(info)) {
      await touchDrag(page, [[sx, sy], [sx - 20, sy + 15], [sx - 50, sy + 40], [sx - 70, sy + 60]]);
    } else {
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx - 60, sy + 20, { steps: 5 });
      await page.mouse.move(sx - 140, sy + 60, { steps: 5 });
      await page.mouse.up();
    }
    await expect.poll(() => api.posts.length).toBe(3);
    const pos = api.posts[2].pos as number[];
    expect(pos.length).toBe(2);
    for (const n of pos) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
    await expect(page.locator("#live")).toHaveText(/Your character has moved/);
    await expect(page.locator("#park .guest.you .figure")).toHaveCount(1);
    const to = (await page.locator("#park .guest.you .figure").boundingBox())!;
    expect(to.x).toBeLessThan(from.x - 30);
    expect(to.y).toBeGreaterThan(from.y + 20);
    await page.waitForTimeout(600);
    await page.screenshot({ path: info.outputPath("5-joined.png") });

    // The look, the pets and the place all survive a reload, and the character is still draggable.
    await page.reload();
    await expect(page.locator("#park .guest.you")).toHaveCount(1);
    await expect(page.locator("#park .pet-name")).toHaveText(["Ben", "Chitra"]);
    const again = (await page.locator("#park .guest.you .figure").boundingBox())!;
    expect(Math.abs(again.x - to.x)).toBeLessThan(6);
    await expect(page.getByRole("button", { name: "Curly" })).toHaveAttribute("aria-pressed", "true");

    // Changing to no removes the character and its pets from the gathering.
    await page.getByRole("button", { name: "Change my response" }).click();
    await expect(page.getByLabel("Name of guest 2")).toHaveValue("Ben");
    await page.locator("#rsvp-no").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "You’ll be missed. Thanks for letting me know." })).toBeVisible();
    await expect(page.locator("#park .guest")).toHaveCount(0);
    await expect(page.locator("#park .pet")).toHaveCount(0);
    await expect(page.locator("#count-badge")).toBeHidden();
  });

  test("the park is lively after the reveal and hides a few secrets", async ({ page }) => {
    const api = await mockApi(page);
    await skipToInvite(page);
    // Jacob wears his party cap in the park and in the portrait.
    expect(await page.locator("#it-jacob").innerHTML()).toContain("M-14,-144 L1,-186");
    await page.evaluate(() => window.scrollTo(0, 0));
    // The other park-goers are moving.
    const jogger = page.locator("#it-jogger .figure");
    const a = (await jogger.boundingBox())!;
    await page.waitForTimeout(700);
    const b = (await jogger.boundingBox())!;
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(2);

    await expect(page.locator("#egg-chip")).toBeHidden();
    await page.locator("#it-pond ellipse").first().click({ force: true, position: { x: 22, y: 30 } });
    await expect(page.locator("#it-pond")).toHaveClass(/splash/);
    await expect(page.locator("#egg-chip")).toHaveText("Secrets found: 1 of 7");
    await page.locator("#it-jacob .figure").click({ force: true });
    await expect(page.locator("#park .confetti .bit")).toHaveCount(26);
    await expect(page.locator("#egg-chip")).toHaveText("Secrets found: 2 of 7");
    // Found secrets are remembered.
    await page.reload();
    await expect(page.locator("#egg-chip")).toHaveText("Secrets found: 2 of 7");

    // The leaderboard: empty until someone who said yes has found a secret.
    await expect(page.locator("#leaders")).toBeVisible();
    await expect(page.locator("#leaders")).toContainText("No one’s on the board yet");
    await expect(page.locator("#leaders li")).toHaveCount(0);
    await page.locator("#rsvp-name").fill("Asha Rao");
    await page.locator("#rsvp-yes").click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    expect(api.posts[0].secrets).toBe(2);
    await expect(page.locator("#leaders li")).toHaveText(["Asha2 of 7"]);
    await expect(page.locator("#leaders-empty")).toBeHidden();
    // Finding another one updates the board without asking the guest to do anything.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#it-duck").click({ force: true });
    await expect(page.locator("#egg-chip")).toHaveText("Secrets found: 3 of 7");
    await expect(page.locator("#leaders li")).toHaveText(["Asha3 of 7"]);
    expect(api.posts[1]).toMatchObject({ secrets: 3, status: "yes" });
    expect(api.posts[1].id).toBe(api.posts[0].id);
  });
});

test.describe("return visits", () => {
  test("a returning guest lands on the invitation, and Play again keeps the RSVP", async ({ page }, info) => {
    const api = await mockApi(page);
    await open(page);
    await findJacob(page, info);
    await page.locator("#rsvp-name").fill("Asha Rao");
    await page.locator("#rsvp-yes").click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem("fj.rsvp.v1"));

    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
    await expect(page.locator("#park")).toHaveAttribute("data-cover", "gone");
    await expect(page.locator("#invite")).toContainText("Sunday 15 November 2026");
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();

    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-state", "searching");
    await expect(page.locator("#park")).toHaveAttribute("data-cover", "covering");
    await expect(page.locator("#invite")).toBeHidden();
    await expect(page.locator("#park .guest")).toHaveCount(0);

    await findJacob(page, info);
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("fj.rsvp.v1"))).toBe(saved);
    expect(api.posts.length).toBe(1);
  });
});

test.describe("fallbacks", () => {
  test("if the artwork fails to load, a retry and a readable invitation appear", async ({ page }) => {
    await page.route(/\/assets\/park-.*\.js$/, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("#app")).toHaveAttribute("data-state", "invite");
    await expect(page.getByRole("button", { name: "Try the game again" })).toBeVisible();
    await expect(page.locator("#invite")).toContainText("Sunday 15 November 2026");
    await expect(page.locator("#invite")).toContainText("Cubbon Park");
    await expect(page.locator("#rsvp-yes")).toBeVisible();
  });

  test("works when localStorage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      });
    });
    await mockApi(page);
    await skipToInvite(page);
    await page.locator("#rsvp-name").fill("Asha");
    await page.locator("#rsvp-yes").click();
    await expect(page.getByRole("heading", { name: "See you at the picnic" })).toBeVisible();
  });

  test("host page asks for the key and never lists anything without it", async ({ page }) => {
    await page.goto("/host.html");
    await expect(page.locator("#status")).toHaveText("Enter your host key to see responses.");
    await expect(page.locator("#table-wrap")).toBeHidden();
    await page.route("**/api/host?key=*", (route) =>
      route.fulfill({
        json: {
          totalComing: 3,
          yesCount: 1,
          noCount: 1,
          responses: [
            { name: "<b>Asha</b>", status: "yes", partySize: 3, character: "fern", publicName: null, updatedAt: "2026-11-13T10:00:00Z" },
            { name: "Ben", status: "no", partySize: 1, character: null, publicName: null, updatedAt: "2026-11-13T11:00:00Z" },
          ],
        },
      }),
    );
    await page.locator("#key-input").fill("secret");
    await page.getByRole("button", { name: "Show responses" }).click();
    await expect(page.locator("#total")).toHaveText("3 people coming in total");
    await expect(page.locator("#rows tr")).toHaveCount(2);
    await expect(page.locator("#rows tr").first()).toContainText("<b>Asha</b>");
  });
});
