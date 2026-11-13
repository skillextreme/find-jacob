# Find Jacob in the Park

A birthday invitation with a quick search game. A circular window follows the cursor (or a finger, or the arrow keys) and shows small parts of a hidden park. Find Jacob, the whole park appears, and the invitation unfolds with an RSVP form, calendar links and an optional "join the park" character.

Live site: https://find-jacob.netlify.app

## Change the event details

Everything about the event lives in one file: [`src/event.config.ts`](src/event.config.ts). The invitation, the calendar exports and the server functions all read from it. Edit it and push to `main`; Netlify redeploys.

- **Map link:** set `mapUrl` to the pin. The "Open map" button only appears when it is not empty.
- **Times** are stored in UTC (`startUtc`, `endUtc`) and shown in the `timeZone` you set. 3:00–6:00 pm India time is 09:30–12:30 UTC.
- A calendar entry a guest has already added will **not** update when you change this file. Tell guests on WhatsApp if plans change.

## Deploy on Netlify

1. In Netlify, link the site to this GitHub repo and the `main` branch.
2. Build settings are read from [`netlify.toml`](netlify.toml), so nothing needs typing in: build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`.
3. Go to **Site configuration → Environment variables** and add `ADMIN_KEY` with a secret phrase of your choice (make it long and hard to guess).
4. Trigger a deploy (**Deploys → Trigger deploy**) so the functions pick up the key.

RSVPs are stored in Netlify Blobs, which is built in. There is no database to set up.

## See who is coming

Open `https://find-jacob.netlify.app/host.html?key=YOUR_ADMIN_KEY` (or open `/host.html` and type the key). It lists every response with name, yes or no, number of people and when it was last updated, plus the total headcount.

To correct or remove a response by hand, use the Netlify dashboard: **Blobs → rsvps → `responses/<id>`**.

## How RSVPs work

- A guest's device creates a response id and a private edit token. The server stores only a SHA-256 hash of the token. Sending the same id and token again updates the same response, so double taps and retries never create a second attendee.
- A guest can change their answer from the same device. A different device creates a new response (the host view shows both, and you can delete one in the Blobs dashboard).
- Everyone who says yes appears in the park with a character (random at first, changeable) and their first name. This is public to anyone with the link and is not optional; the form says so before they answer.
- The public list (`/api/attendees`) returns only the headcount and, for each yes, a character and first name. No surnames, ids or tokens, and nobody who said no.
- The "Can't make it" button runs away from the mouse or finger and can't be clicked. Only keyboard users (Tab, then Enter) can decline on the site.
- Anyone with the link can RSVP. Writes are limited to 20 per IP address per 10 minutes.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm test
```

`npm run dev` serves the game and invitation. The `/api/*` functions only run on Netlify (or under `netlify dev`); without them the game and the invitation still work and the RSVP form shows a retry message.

`npm test` builds the site, serves it and runs the Playwright tests on a desktop and a phone viewport, with the API mocked. It also unit tests the calendar file and the RSVP server logic.

## Tuning the game

Window size, pause-to-grow, and the 10 and 20 second clues are in `TUNING` at the top of [`src/search.ts`](src/search.ts). Element positions for the landscape and portrait compositions are in `ITEMS` in [`src/park.ts`](src/park.ts).

## Layout of the code

| Path | What it is |
|---|---|
| `src/event.config.ts` | Event details and limits (single source of truth) |
| `src/art.ts` | SVG drawings: Jacob, guests, dog, duck, trees, props |
| `src/park.ts` | Scene composition, mask and coordinates |
| `src/search.ts` | The search game: window, discoveries, clues, reveal |
| `src/invite.ts` | Invitation card, RSVP, calendar, join the park |
| `src/calendar.ts` | Google Calendar link and `.ics` file |
| `netlify/functions/*.mts` | `/api/rsvp`, `/api/attendees`, `/api/host` |
| `netlify/lib/core.ts` | RSVP rules (validation, tokens, throttle), unit tested |
| `tests/` | Playwright tests |
