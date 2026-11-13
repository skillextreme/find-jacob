/**
 * The invitation card: event details, RSVP, calendar actions and the optional
 * "join the park" character picker. All event text comes from the config and all
 * guest-entered text is written with textContent, never as markup.
 */
import { CHARACTER_IDS, EVENT, LIMITS, formatEventDate, formatEventTime, type CharacterId } from "./event.config.ts";
import { ApiError, saveRsvp, type Attendees, type RsvpPayload } from "./api.ts";
import { GUESTS, guestIcon } from "./art.ts";
import { googleCalendarUrl, icsDataHref, icsFileName } from "./calendar.ts";
import { clearRsvp, loadRsvp, newIdentity, storeRsvp, type LocalRsvp } from "./storage.ts";

export interface InviteHooks {
  announce(message: string): void;
  reducedMotion(): boolean;
  /** Fresh public attendee data. `arriveSelf` is true when this device's character just joined. */
  onAttendees(attendees: Attendees, you: number | null, arriveSelf: boolean): void;
  /** Bring the park into view (on phones the card sits below it). */
  showPark(): void;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.nameMax);
}

function firstName(name: string): string {
  return (name.split(" ")[0] ?? "").slice(0, LIMITS.publicNameMax);
}

export class Invite {
  private $: <T extends HTMLElement>(sel: string) => T;
  private saving = false;
  private dodged = false;
  private lastPointer: { type: string; at: number } | null = null;
  private pending: { payload: RsvpPayload; record: LocalRsvp; kind: "rsvp" | "join" } | null = null;

  constructor(
    private root: HTMLElement,
    private hooks: InviteHooks,
  ) {
    this.$ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    root.innerHTML = this.template();
    this.wire();
    this.showInitialView();
  }

  focusHeading(): void {
    this.$("#invite-title").focus({ preventScroll: false });
  }

  setCount(total: number | null): void {
    const el = this.$("#rsvp-count");
    if (total === null || total <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = total === 1 ? "1 person is coming so far." : `${total} people are coming so far.`;
  }

  /* ---------- Markup ---------- */

  private template(): string {
    const row = (label: string, body: string) => `<div class="details__row"><dt>${esc(label)}</dt><dd>${body}</dd></div>`;
    const map = EVENT.mapUrl
      ? `<a class="btn btn--small" id="map-link" href="${esc(EVENT.mapUrl)}" target="_blank" rel="noopener">Open map</a>`
      : "";
    const sizes = Array.from({ length: EVENT.maxPartySize }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
    const chars = CHARACTER_IDS.map(
      (id) =>
        `<label class="char"><input type="radio" name="character" value="${id}" /><span class="char__art">${guestIcon(id)}</span><span class="sr-only">${esc(GUESTS[id].label)}</span></label>`,
    ).join("");

    return `
<div class="card">
  <div class="card__trim" aria-hidden="true"></div>
  <div class="card__body">
    <h2 id="invite-title" tabindex="-1">You found me! Now come hang out.</h2>
    <p class="lead">It’s my birthday. Let’s spend an afternoon in the park.</p>
    <p class="event-name">${esc(EVENT.title)}</p>
    <dl class="details">
      ${row("When", `<strong>${esc(formatEventDate())}</strong><br />${esc(formatEventTime())} <span class="muted">(${esc(EVENT.timeZoneLabel)})</span>`)}
      ${row("Where", `<strong>${esc(EVENT.venue)}</strong><br />${esc(EVENT.meetingPoint)} ${map}`)}
      ${row("The plan", esc(EVENT.plan))}
      ${row("What to wear", esc(EVENT.bring))}
      ${EVENT.rainPlan ? row("If it rains", esc(EVENT.rainPlan)) : ""}
      ${EVENT.rsvpDeadline ? row("Reply by", esc(EVENT.rsvpDeadline)) : ""}
      ${EVENT.plusOnesAllowed ? row("Plus-ones", "Welcome. Bring whoever you like, just tell me how many.") : ""}
    </dl>

    <section class="rsvp" aria-labelledby="rsvp-h">
      <form id="rsvp-form" novalidate>
        <h3 id="rsvp-h">Are you coming?</h3>
        <p id="rsvp-count" class="muted" hidden></p>
        <div class="field">
          <label for="rsvp-name">Your name</label>
          <input id="rsvp-name" name="name" type="text" maxlength="${LIMITS.nameMax}" autocomplete="name" autocapitalize="words" enterkeyhint="done" aria-describedby="rsvp-name-err" />
          <p id="rsvp-name-err" class="field__err" hidden>Add your name so I know who’s coming.</p>
        </div>
        <div class="field" ${EVENT.plusOnesAllowed ? "" : "hidden"}>
          <label for="rsvp-size">How many of you? <span class="muted">Including you.</span></label>
          <select id="rsvp-size" name="partySize">${sizes}</select>
        </div>
        <div class="rsvp__actions" id="rsvp-actions">
          <button type="button" id="rsvp-yes" class="btn btn--primary">I’m coming</button>
          <button type="button" id="rsvp-no" class="btn btn--ghost">Can’t make it</button>
          <p id="dodge-msg" class="rsvp__dodge" aria-live="polite"></p>
        </div>
        <p id="rsvp-saving" class="muted" role="status" hidden>Saving…</p>
        <div id="rsvp-error" class="notice notice--error" role="alert" hidden>
          <p id="rsvp-error-text"></p>
          <button type="button" id="rsvp-retry" class="btn btn--small">Try again</button>
          <button type="button" id="rsvp-fresh" class="btn btn--small" hidden>Send as a new response</button>
        </div>
      </form>

      <div id="view-yes" hidden>
        <h3 id="yes-h" tabindex="-1">See you at the picnic</h3>
        <p id="yes-sum" class="muted"></p>
        <div class="cal">
          <a id="cal-google" class="btn btn--primary" href="${esc(googleCalendarUrl())}" target="_blank" rel="noopener">Add to Google Calendar</a>
          <a id="cal-ics" class="btn btn--ghost" href="${esc(icsDataHref())}" download="${esc(icsFileName())}">Download calendar file</a>
        </div>
        <p class="muted small">If plans change, I’ll tell you on WhatsApp. A saved calendar entry won’t update by itself.</p>

        <fieldset class="join" id="join">
          <legend>Join the park <span class="muted">(optional)</span></legend>
          <p class="small">Pick a character to stand at the picnic in the drawing.</p>
          <div class="join__grid">${chars}</div>
          <label class="check">
            <input type="checkbox" id="join-show" />
            <span>Show my first name (<b id="join-first"></b>) under my character. Other guests will see it. It stays hidden unless you tick this.</span>
          </label>
          <div class="join__actions">
            <button type="button" id="join-btn" class="btn btn--primary" disabled>Join the park</button>
            <button type="button" id="leave-btn" class="btn btn--link" hidden>Leave the picture</button>
          </div>
          <p id="join-status" class="muted small" role="status"></p>
          <div id="join-error" class="notice notice--error" role="alert" hidden>
            <p id="join-error-text"></p>
            <button type="button" id="join-retry" class="btn btn--small">Try again</button>
          </div>
        </fieldset>
        <button type="button" id="change-yes" class="btn btn--link">Change my response</button>
      </div>

      <div id="view-no" hidden>
        <h3 id="no-h" tabindex="-1">You’ll be missed. Thanks for letting me know.</h3>
        <button type="button" id="change-no" class="btn btn--link">Change my response</button>
      </div>
    </section>
  </div>
</div>`;
  }

  /* ---------- Behaviour ---------- */

  private wire(): void {
    const form = this.$<HTMLFormElement>("#rsvp-form");
    const nameInput = this.$<HTMLInputElement>("#rsvp-name");
    const noBtn = this.$<HTMLButtonElement>("#rsvp-no");

    form.addEventListener("submit", (e) => e.preventDefault());
    nameInput.addEventListener("input", () => this.setNameError(false));
    this.$("#rsvp-yes").addEventListener("click", () => this.submit("yes"));

    // The decline joke: the button slips away once, then stays put and works normally.
    // It never submits anything by itself. Keyboard and reduced-motion guests get a still button.
    noBtn.addEventListener("pointerdown", (e) => {
      this.lastPointer = { type: e.pointerType, at: performance.now() };
    });
    noBtn.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && this.canDodge()) this.dodge();
    });
    noBtn.addEventListener("click", () => {
      const p = this.lastPointer;
      this.lastPointer = null;
      const byTouch = p !== null && p.type !== "mouse" && performance.now() - p.at < 1500;
      if (byTouch && this.canDodge()) {
        this.dodge();
        return;
      }
      void this.submit("no");
    });

    this.$("#rsvp-retry").addEventListener("click", () => void this.send());
    this.$("#rsvp-fresh").addEventListener("click", () => {
      if (!this.pending) return;
      const fresh = newIdentity();
      this.pending.payload = { ...this.pending.payload, ...fresh };
      this.pending.record = { ...this.pending.record, ...fresh, saved: false };
      clearRsvp();
      storeRsvp(this.pending.record);
      void this.send();
    });

    this.$("#change-yes").addEventListener("click", () => this.showForm(true));
    this.$("#change-no").addEventListener("click", () => this.showForm(true));

    // Join the park.
    const joinBtn = this.$<HTMLButtonElement>("#join-btn");
    this.root.querySelectorAll<HTMLInputElement>('input[name="character"]').forEach((r) =>
      r.addEventListener("change", () => {
        joinBtn.disabled = false;
      }),
    );
    joinBtn.addEventListener("click", () => void this.join(this.selectedCharacter()));
    this.$("#leave-btn").addEventListener("click", () => void this.join(null));
    this.$("#join-retry").addEventListener("click", () => void this.send());
  }

  private canDodge(): boolean {
    return !this.dodged && !this.saving && !this.hooks.reducedMotion();
  }

  private dodge(): void {
    this.dodged = true;
    this.$("#rsvp-actions").classList.add("has-dodged");
    this.$("#dodge-msg").textContent = "Okay, okay. Your call.";
  }

  private showInitialView(): void {
    const rec = loadRsvp();
    if (rec?.saved) this.showSaved(rec, false);
    else this.showForm(false, rec);
  }

  private showForm(focus: boolean, rec: LocalRsvp | null = loadRsvp()): void {
    this.$("#rsvp-form").hidden = false;
    this.$("#view-yes").hidden = true;
    this.$("#view-no").hidden = true;
    this.setError(null);
    if (rec) {
      this.$<HTMLInputElement>("#rsvp-name").value = rec.name;
      this.$<HTMLSelectElement>("#rsvp-size").value = String(rec.partySize);
    }
    if (focus) this.$<HTMLInputElement>("#rsvp-name").focus();
  }

  private showSaved(rec: LocalRsvp, focus: boolean): void {
    this.$("#rsvp-form").hidden = true;
    const yes = rec.status === "yes";
    this.$("#view-yes").hidden = !yes;
    this.$("#view-no").hidden = yes;
    if (yes) {
      const who = rec.partySize > 1 ? `${rec.name}, ${rec.partySize} people` : rec.name;
      this.$("#yes-sum").textContent = `You’re down as ${who}.`;
      this.$("#join-first").textContent = firstName(rec.name);
      this.$<HTMLInputElement>("#join-show").checked = rec.showName;
      this.root.querySelectorAll<HTMLInputElement>('input[name="character"]').forEach((r) => {
        r.checked = r.value === rec.character;
      });
      const joined = rec.character !== null;
      this.$<HTMLButtonElement>("#join-btn").textContent = joined ? "Update my character" : "Join the park";
      this.$<HTMLButtonElement>("#join-btn").disabled = !joined;
      this.$("#leave-btn").hidden = !joined;
      this.$("#join-status").textContent = joined ? "You’re in the park picture." : "";
      this.setJoinError(null);
    }
    if (focus) this.$(yes ? "#yes-h" : "#no-h").focus();
  }

  private selectedCharacter(): CharacterId | null {
    const picked = this.root.querySelector<HTMLInputElement>('input[name="character"]:checked');
    return picked && (CHARACTER_IDS as readonly string[]).includes(picked.value) ? (picked.value as CharacterId) : null;
  }

  private setNameError(on: boolean): void {
    this.$("#rsvp-name-err").hidden = !on;
    this.$("#rsvp-name").setAttribute("aria-invalid", on ? "true" : "false");
  }

  private setSaving(on: boolean): void {
    this.saving = on;
    this.root.querySelector(".rsvp")!.setAttribute("aria-busy", on ? "true" : "false");
    for (const id of ["#rsvp-yes", "#rsvp-no", "#rsvp-retry", "#rsvp-fresh", "#join-btn", "#leave-btn", "#join-retry"]) {
      const b = this.$<HTMLButtonElement>(id);
      if (on) {
        b.dataset.wasDisabled = b.disabled ? "1" : "";
        b.disabled = true;
      } else if (b.dataset.wasDisabled !== undefined) {
        b.disabled = b.dataset.wasDisabled === "1";
        delete b.dataset.wasDisabled;
      }
    }
    this.$("#rsvp-saving").hidden = !on || this.pending?.kind !== "rsvp";
    if (on && this.pending?.kind === "join") this.$("#join-status").textContent = "Saving…";
  }

  private setError(err: ApiError | null): void {
    const box = this.$("#rsvp-error");
    box.hidden = err === null;
    if (!err) return;
    this.$("#rsvp-error-text").textContent = this.errorText(err);
    this.$("#rsvp-fresh").hidden = err.code !== "invalid_token";
    this.$("#rsvp-retry").hidden = err.code === "invalid_token";
  }

  private setJoinError(err: ApiError | null): void {
    this.$("#join-error").hidden = err === null;
    if (err) {
      this.$("#join-error-text").textContent = this.errorText(err);
      this.$("#join-status").textContent = "";
    }
  }

  private errorText(err: ApiError): string {
    switch (err.code) {
      case "invalid_token":
        return `This device’s saved response couldn’t be verified, so nothing was changed. ${EVENT.hostContact} to update it, or send this as a new response.`;
      case "rate_limited":
        return "Too many tries from this connection. Wait a few minutes, then try again. Your details are still here.";
      case "invalid":
        return "Something in that response wasn’t accepted. Check your name and try again.";
      default:
        return "That didn’t save. Your details are still here, so just try again.";
    }
  }

  /** Validates the form and sends a yes or no. */
  private async submit(status: "yes" | "no"): Promise<void> {
    if (this.saving) return;
    const name = cleanName(this.$<HTMLInputElement>("#rsvp-name").value);
    if (!name) {
      this.setNameError(true);
      this.$<HTMLInputElement>("#rsvp-name").focus();
      return;
    }
    const rawSize = Number(this.$<HTMLSelectElement>("#rsvp-size").value);
    const partySize = EVENT.plusOnesAllowed ? Math.min(EVENT.maxPartySize, Math.max(1, Math.round(rawSize) || 1)) : 1;

    const existing = loadRsvp();
    const identity = existing ?? { ...newIdentity(), character: null, showName: false, saved: false };
    const record: LocalRsvp = { ...identity, name, status, partySize, saved: false } as LocalRsvp;
    // Keep the id and token before the first request, so a retry after a dropped connection
    // or a reload updates the same response instead of adding a second one.
    if (!existing) storeRsvp(record);
    this.pending = { kind: "rsvp", record, payload: this.toPayload(record) };
    await this.send();
  }

  private async join(character: CharacterId | null): Promise<void> {
    if (this.saving) return;
    const rec = loadRsvp();
    if (!rec?.saved || rec.status !== "yes") return;
    const record: LocalRsvp = { ...rec, character, showName: character !== null && this.$<HTMLInputElement>("#join-show").checked };
    this.pending = { kind: "join", record, payload: this.toPayload(record) };
    await this.send();
  }

  private toPayload(r: LocalRsvp): RsvpPayload {
    return {
      id: r.id,
      token: r.token,
      name: r.name,
      status: r.status,
      partySize: r.partySize,
      character: r.character,
      publicName: r.character && r.showName ? firstName(r.name) || null : null,
    };
  }

  /** Sends the pending request. Retries reuse the same id and token, so they can't create a duplicate. */
  private async send(): Promise<void> {
    const job = this.pending;
    if (!job || this.saving) return;
    this.setError(null);
    this.setJoinError(null);
    this.setSaving(true);
    try {
      const res = await saveRsvp(job.payload);
      const record: LocalRsvp = { ...job.record, saved: true };
      storeRsvp(record);
      this.pending = null;
      this.setSaving(false);
      this.showSaved(record, job.kind === "rsvp");
      const joinedNow = job.kind === "join" && record.character !== null;
      this.hooks.onAttendees(res.attendees, res.you, joinedNow);
      if (job.kind === "rsvp") {
        this.hooks.announce(record.status === "yes" ? "Saved. See you at the picnic." : "Saved. You’ll be missed. Thanks for letting me know.");
      } else {
        this.hooks.announce(joinedNow ? "Your character has joined the picnic." : "Your character has left the picture.");
        if (joinedNow) this.hooks.showPark();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("server", "Unexpected error");
      this.setSaving(false);
      // A failed save never shows a confirmation and never adds a character.
      if (job.kind === "rsvp") this.setError(err);
      else this.setJoinError(err);
    }
  }
}
