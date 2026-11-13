/**
 * The park scene: one layered SVG with a cream cover cut by a circular mask.
 * Every placed element has a stable id and a normalized (0–1) position per layout, and the
 * same positions drive both drawing and hit detection.
 */
import * as art from "./art.ts";
import { C } from "./art.ts";
import { LIMITS, type Companion } from "./event.config.ts";

export type Mode = "landscape" | "portrait";
export interface Pt {
  x: number;
  y: number;
}
export interface PublicGuest {
  key?: string;
  character: string;
  displayName?: string;
  /** Where the guest chose to stand: two 0–1 numbers inside the picnic area. */
  pos?: [number, number];
  /** People they are bringing, drawn as named pets. */
  pets?: Companion[];
  secrets?: number;
}

/** The part of each composition where guests may stand (as fractions of the scene). */
const GUEST_AREA = {
  landscape: { x0: 0.04, x1: 0.58, y0: 0.45, y1: 0.96 },
  portrait: { x0: 0.08, x1: 0.92, y0: 0.53, y1: 0.97 },
};
const PET_OFFSETS: [number, number][] = [[50, 8], [-50, 10], [88, 18], [-88, 18]];

type Spot = [x: number, y: number, scale: number];
interface ItemDef {
  id: string;
  cls?: string;
  svg: string;
  /** Flat items lie on the ground and are drawn under everything standing. */
  flat?: boolean;
  L: Spot;
  P: Spot;
  /** Position relative to another item, in scene units, instead of L/P. */
  rel?: { to: string; dx: number; dy: number };
}

const SVG_NS = "http://www.w3.org/2000/svg";

const flyer = art.person({ skin: "#E0A77A", hair: "#5A3320", hairStyle: "short", shirt: "#7EC3E6", bottom: "#3F5368" });
const reader = art.person({ skin: "#8C5A3C", hair: "#1D1A1A", hairStyle: "long", shirt: "#FFD25E", bottom: "#5E7FA8" });
const jogger = art.person({ skin: "#F0C5A0", hair: "#6B4A2E", hairStyle: "pony", shirt: "#6CCDBB", bottom: "#4B4A6B" });

const ITEMS: ItemDef[] = [
  { id: "pond", svg: art.pond(), flat: true, L: [0.7, 0.9, 1], P: [0.27, 0.91, 0.82] },
  { id: "blanket", svg: art.blanket(), flat: true, L: [0.33, 0.74, 1], P: [0.4, 0.69, 0.92] },
  { id: "jacob", cls: "jacob", svg: art.jacob(), L: [0, 0, 1], P: [0, 0, 0.95], rel: { to: "blanket", dx: 132, dy: -88 } },
  { id: "balloons", svg: art.balloons(), L: [0, 0, 1], P: [0, 0, 0.9], rel: { to: "blanket", dx: -172, dy: -18 } },
  { id: "dog", cls: "dog", svg: `<g class="dog-move"><g class="dog-flip"><g class="dog-roam">${art.dog()}</g></g></g>`, L: [0.19, 0.5, 0.95], P: [0.3, 0.43, 0.9] },
  { id: "bush", cls: "bush", svg: art.bush(true), L: [0.67, 0.5, 1], P: [0.56, 0.345, 0.85] },
  { id: "duck", cls: "duck", svg: art.duck(), L: [0.565, 0.8, 0.95], P: [0.56, 0.86, 0.9] },
  { id: "bench", svg: art.bench(), L: [0.1, 0.77, 1], P: [0.79, 0.8, 0.85] },
  { id: "reader", cls: "walker", svg: `<g class="roam roam-stroll">${reader}</g>`, L: [0.155, 0.79, 0.95], P: [0.665, 0.815, 0.85] },
  { id: "flyer", cls: "walker flyer", svg: `<g class="roam roam-kite">${flyer}<g transform="translate(25,-62)">${art.kite(70, -300)}</g></g>`, L: [0.8, 0.6, 0.95], P: [0.16, 0.53, 0.85] },
  { id: "jogger", cls: "walker", svg: `<g class="roam roam-jog">${jogger}</g>`, L: [0.47, 0.41, 0.72], P: [0.4, 0.335, 0.68] },
  { id: "tree1", svg: art.tree(0), L: [0.045, 0.53, 1.2], P: [0.05, 0.37, 0.95] },
  { id: "tree2", svg: art.tree(1), L: [0.115, 0.375, 0.8], P: [0.0, 0.62, 1.1] },
  { id: "tree3", svg: art.tree(1), L: [0.955, 0.5, 1.2], P: [0.97, 0.335, 0.9] },
  { id: "tree4", svg: art.tree(0), L: [0.885, 0.365, 0.8], P: [0.33, 0.268, 0.55] },
  { id: "tree5", svg: art.tree(0), L: [0.3, 0.335, 0.6], P: [0.8, 0.262, 0.5] },
  { id: "tree6", svg: art.tree(1), L: [0.78, 0.335, 0.6], P: [0.99, 0.5, 0.8] },
  { id: "pine1", svg: art.pine(), L: [0.03, 0.95, 1.5], P: [0.04, 0.995, 1.25] },
  { id: "pine2", svg: art.pine(), L: [0.985, 0.86, 1.4], P: [0.97, 0.995, 1.15] },
  { id: "pine3", svg: art.pine(), L: [0.225, 0.345, 0.62], P: [0.17, 0.272, 0.55] },
  { id: "pine4", svg: art.pine(), L: [0.64, 0.33, 0.55], P: [0.92, 0.27, 0.5] },
  { id: "bush2", cls: "gnome-bush", svg: art.bush(false, true), L: [0.27, 0.92, 1], P: [0.1, 0.8, 0.8] },
  { id: "bush3", svg: art.bush(), L: [0.87, 0.71, 0.9], P: [0.45, 0.48, 0.7] },
  { id: "bush4", svg: art.bush(), L: [0.39, 0.4, 0.7], P: [0.9, 0.62, 0.75] },
];

/** Offsets from the blanket centre where guest characters stand, best spots first. */
const GUEST_SPOTS: [number, number][] = [
  [-38, 112], [38, 112], [-114, 96], [114, 96], [-190, 62], [190, 62],
  [-236, -8], [236, 0], [-196, -74], [40, -128], [-118, -112], [-40, -124],
  [0, 182], [-76, 176], [76, 176], [-152, 160], [152, 160], [-230, 130],
  [230, 130], [250, -62], [-80, -182], [0, -188], [-160, -172], [-250, -130],
];

/** Centre of each interactive element, as an offset from its feet in local units. */
const CENTER_DY: Record<string, number> = { jacob: -78, dog: -30, duck: -20, bush: -26 };

/* ---------- Path geometry ---------- */

type P4 = [Pt, Pt, Pt, Pt];
const pt = (x: number, y: number): Pt => ({ x, y });
const PATHS: Record<Mode, { segs: P4[]; w0: number; w1: number; horizon: number }> = {
  landscape: {
    segs: [
      [pt(0.4, 1.03), pt(0.44, 0.82), pt(0.64, 0.78), pt(0.58, 0.6)],
      [pt(0.58, 0.6), pt(0.54, 0.47), pt(0.7, 0.41), pt(0.73, 0.305)],
    ],
    w0: 0.085,
    w1: 0.012,
    horizon: 0.3,
  },
  portrait: {
    segs: [
      [pt(0.86, 1.03), pt(0.84, 0.86), pt(1.0, 0.74), pt(0.97, 0.56)],
      [pt(0.97, 0.56), pt(0.94, 0.42), pt(0.64, 0.36), pt(0.6, 0.245)],
    ],
    w0: 0.2,
    w1: 0.03,
    horizon: 0.24,
  },
};

function cubic([a, b, c, d]: P4, t: number): Pt {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y };
}

function samplePath(mode: Mode, W: number, H: number): { p: Pt; w: number }[] {
  const def = PATHS[mode];
  const out: { p: Pt; w: number }[] = [];
  const per = 24;
  def.segs.forEach((seg, si) => {
    for (let i = si === 0 ? 0 : 1; i <= per; i++) {
      const t = (si + i / per) / def.segs.length;
      const q = cubic(seg, i / per);
      out.push({ p: { x: q.x * W, y: q.y * H }, w: (def.w1 + (def.w0 - def.w1) * Math.pow(1 - t, 1.5)) * W });
    }
  });
  return out;
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

export class Park {
  readonly svg: SVGSVGElement;
  mode: Mode = "landscape";
  W = 1600;
  H = 1000;

  private bg: SVGGElement;
  private flat: SVGGElement;
  private standing: SVGGElement;
  /** Flat cream overlay with a round hole. Far cheaper to redraw on phones than an SVG mask. */
  private cover: HTMLDivElement;
  private hole: SVGCircleElement;
  private box = { left: 0, top: 0 };
  private lensOn = true;
  readonly lens: SVGGElement;
  readonly plane: SVGGElement;
  private els = new Map<string, SVGGElement>();
  private spots = new Map<string, Spot>();
  private guests: PublicGuest[] = [];
  /** Set to let this device's guest drag their own character. Called with the new position on drop. */
  onGuestDrop: ((pos: [number, number]) => void) | null = null;
  /** True while the guest is holding their character. */
  dragging = false;
  private you: number | null = null;
  private inv: DOMMatrix | null = null;
  private fwd: DOMMatrix | null = null;

  constructor(holder: HTMLElement) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "park");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML =
      `<g id="bg"></g><g id="flat"></g><g id="standing"></g><g id="labels"></g>` +
      // The circle below is never drawn: it records where the window is, in scene units.
      `<defs><circle id="mask-hole" r="0"/></defs>` +
      `<g id="lens"><g id="hint-plane" style="display:none">${art.paperPlane()}</g></g>`;
    this.svg = svg;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    this.bg = q("#bg");
    this.flat = q("#flat");
    this.standing = q("#standing");
    this.hole = q("#mask-hole");
    this.lens = q("#lens");
    this.plane = q("#hint-plane");

    for (const def of ITEMS) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("id", `it-${def.id}`);
      g.setAttribute("class", `item ${def.cls ?? ""}`.trim());
      g.innerHTML = def.svg;
      (def.flat ? this.flat : this.standing).appendChild(g);
      this.els.set(def.id, g);
    }
    holder.appendChild(svg);
    this.cover = document.createElement("div");
    this.cover.id = "cover";
    holder.appendChild(this.cover);
  }

  /** Recomputes the composition for a viewport. Safe to call on every resize. */
  layout(vw: number, vh: number): void {
    const aspect = vw / Math.max(vh, 1);
    this.mode = aspect >= 1 ? "landscape" : "portrait";
    if (this.mode === "landscape") {
      this.H = 1000;
      this.W = Math.round(1000 * Math.min(2.4, Math.max(1.15, aspect)));
    } else {
      this.W = 600;
      this.H = Math.round(600 / Math.min(1, Math.max(0.42, aspect)));
    }
    const { W, H, mode } = this;
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.svg.setAttribute("preserveAspectRatio", mode === "portrait" ? "xMidYMax slice" : "xMidYMid slice");
    // Place items.
    this.spots.clear();
    const key = mode === "landscape" ? "L" : "P";
    for (const def of ITEMS) {
      if (def.rel) continue;
      const [nx, ny, s] = def[key];
      this.spots.set(def.id, [nx * W, ny * H, s]);
    }
    for (const def of ITEMS) {
      if (!def.rel) continue;
      const base = this.spots.get(def.rel.to)!;
      this.spots.set(def.id, [base[0] + def.rel.dx * base[2], base[1] + def.rel.dy * base[2], def[key][2]]);
    }
    for (const [id, [x, y, s]] of this.spots) {
      this.els.get(id)!.setAttribute("transform", `translate(${f(x)},${f(y)}) scale(${s})`);
    }

    this.drawBackground();
    this.renderGuests(null);
    this.refreshMatrix();
  }

  private drawBackground(): void {
    const { W, H, mode } = this;
    const hz = PATHS[mode].horizon * H;
    const samples = samplePath(mode, W, H);
    const left: string[] = [];
    const right: string[] = [];
    samples.forEach((s, i) => {
      const a = samples[Math.max(0, i - 1)].p;
      const b = samples[Math.min(samples.length - 1, i + 1)].p;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      left.push(`${f(s.p.x + (nx * s.w) / 2)},${f(s.p.y + (ny * s.w) / 2)}`);
      right.push(`${f(s.p.x - (nx * s.w) / 2)},${f(s.p.y - (ny * s.w) / 2)}`);
    });
    const pathD = `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
    const cs = mode === "landscape" ? 1 : 0.62;
    const cloud = (x: number, y: number, s: number, cls: string) =>
      `<g transform="translate(${f(x * W)},${f(y * H)}) scale(${s * cs})"><g class="cloud ${cls}">${art.cloud()}</g></g>`;
    const fly = (x: number, y: number, fill: string, cls: string) =>
      `<g transform="translate(${f(x * W)},${f(y * H)}) scale(${cs + 0.1})"><g class="flutter ${cls}">${art.butterfly(fill)}</g></g>`;

    this.bg.innerHTML =
      `<rect x="-20" y="-20" width="${W + 40}" height="${f(hz + 60)}" fill="${C.sky}"/>` +
      `<g id="sun" transform="translate(${f(W * 0.1)},${f(H * 0.09)}) scale(${cs})"><circle r="74" fill="${C.butter}" opacity=".4"/><circle r="50" fill="${C.butter}"/>` +
      `<g class="sun-shades"><path d="M-36,-12 h30 v10 a13,13 0 0 1 -26,0 z M6,-12 h30 v10 a13,13 0 0 1 -26,0 z" fill="${C.ink}"/><path d="M-40,-10 h80" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/><path d="M-16,20 q16,12 32,0" fill="none" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/></g></g>` +
      cloud(0.3, 0.1, 1.1, "c1") + cloud(0.62, 0.17, 0.8, "c2") + cloud(0.9, 0.08, 1, "c3") +
      `<ellipse cx="${f(W * 0.22)}" cy="${f(hz + 50)}" rx="${f(W * 0.4)}" ry="105" fill="${C.hill}"/>` +
      `<ellipse cx="${f(W * 0.8)}" cy="${f(hz + 60)}" rx="${f(W * 0.46)}" ry="120" fill="${C.leaf2}"/>` +
      `<rect x="-20" y="${f(hz)}" width="${W + 40}" height="${f(H - hz + 20)}" fill="${C.grass}"/>` +
      `<ellipse cx="${f(W * 0.2)}" cy="${f(H * 0.66)}" rx="${f(W * 0.34)}" ry="${f(H * 0.1)}" fill="${C.grass2}" opacity=".55"/>` +
      `<ellipse cx="${f(W * 0.82)}" cy="${f(H * 0.52)}" rx="${f(W * 0.3)}" ry="${f(H * 0.07)}" fill="${C.grass2}" opacity=".55"/>` +
      `<ellipse cx="${f(W * 0.55)}" cy="${f(H * 0.97)}" rx="${f(W * 0.5)}" ry="${f(H * 0.08)}" fill="${C.grass2}" opacity=".55"/>` +
      `<path d="${pathD}" fill="${C.path}" stroke="${C.pathEdge}" stroke-width="4" stroke-linejoin="round"/>` +
      fly(0.44, 0.52, C.butter, "f1") + fly(0.7, 0.66, "#FFFDF5", "f2");

    // Grass tufts and flowers, scattered with a fixed seed so the park is the same on every visit.
    const rnd = mulberry(mode === "landscape" ? 7 : 11);
    const pond = this.spots.get("pond")!;
    const blanket = this.spots.get("blanket")!;
    const free = (x: number, y: number) => {
      for (const s of samples) if (Math.hypot(s.p.x - x, s.p.y - y) < s.w / 2 + 16) return false;
      if (((x - pond[0]) / (165 * pond[2])) ** 2 + ((y - pond[1]) / (66 * pond[2])) ** 2 < 1) return false;
      if (Math.abs(x - blanket[0]) < 150 * blanket[2] && Math.abs(y - blanket[1]) < 62 * blanket[2]) return false;
      return true;
    };
    const bits: { y: number; html: string }[] = [];
    const count = mode === "landscape" ? 84 : 60;
    const colours = ["#FFFDF5", C.butter, "#FFFDF5", "#CDE9F5"];
    for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
      const x = rnd() * W;
      const y = hz + 34 + rnd() * (H - hz - 44);
      const kind = rnd();
      const pick = Math.floor(rnd() * colours.length);
      if (!free(x, y)) continue;
      i++;
      const depth = (y - hz) / (H - hz);
      const s = (0.6 + depth * 0.7) * (mode === "landscape" ? 1 : 0.85);
      const inner = kind < 0.66 ? `<g class="tuft">${art.tuft()}</g>` : art.flower(colours[pick]);
      bits.push({ y, html: `<g transform="translate(${f(x)},${f(y)}) scale(${s.toFixed(2)})">${inner}</g>` });
    }
    bits.sort((a, b) => a.y - b.y);
    this.flat.querySelector("#scatter")?.remove();
    const scatter = document.createElementNS(SVG_NS, "g");
    scatter.setAttribute("id", "scatter");
    scatter.innerHTML = bits.map((b) => b.html).join("");
    this.flat.insertBefore(scatter, this.flat.firstChild);
  }

  private sortStanding(): void {
    const kids = Array.from(this.standing.children) as SVGGElement[];
    kids.sort((a, b) => Number(a.dataset.y ?? 0) - Number(b.dataset.y ?? 0));
    for (const k of kids) this.standing.appendChild(k);
  }

  /* ---------- Guests ---------- */

  /** Shows guest characters at the picnic. `arrive` animates one guest (or all) dropping in. */
  setGuests(guests: PublicGuest[], you: number | null, arrive: number | "all" | null): void {
    let list = guests;
    let me = you;
    if (list.length > LIMITS.maxVisibleGuests) {
      // Representative set: keep the first spots, and always keep this device's own character.
      list = guests.slice(0, LIMITS.maxVisibleGuests);
      if (me !== null && me >= LIMITS.maxVisibleGuests) {
        list[LIMITS.maxVisibleGuests - 1] = guests[me];
        me = LIMITS.maxVisibleGuests - 1;
      }
    }
    this.guests = list;
    this.you = me;
    this.renderGuests(arrive === "all" ? "all" : arrive !== null ? me : null);
  }

  private areaRect(): { x0: number; x1: number; y0: number; y1: number } {
    const a = GUEST_AREA[this.mode];
    return { x0: a.x0 * this.W, x1: a.x1 * this.W, y0: a.y0 * this.H, y1: a.y1 * this.H };
  }

  private renderGuests(arrive: number | "all" | null): void {
    this.standing.querySelectorAll(".guest").forEach((n) => n.remove());
    // Names sit in their own layer on top, so a guest standing in front never hides one.
    const labels = this.svg.querySelector("#labels")!;
    labels.replaceChildren();
    const b = this.spots.get("blanket");
    if (b) {
      const xs = this.mode === "portrait" ? 0.8 : 1;
      const gs = this.mode === "portrait" ? 0.72 : 0.8;
      const area = this.areaRect();
      this.guests.forEach((guest, i) => {
        const [dx, dy] = GUEST_SPOTS[i % GUEST_SPOTS.length];
        // A guest who placed their character stands there; everyone else gets a spot round the blanket.
        const x = guest.pos ? area.x0 + guest.pos[0] * (area.x1 - area.x0) : b[0] + dx * xs * b[2];
        const y = guest.pos ? area.y0 + guest.pos[1] * (area.y1 - area.y0) : b[1] + dy * b[2];
        const mine = i === this.you;
        const g = document.createElementNS(SVG_NS, "g");
        const animate = arrive === "all" || arrive === i;
        g.setAttribute("class", `item guest${mine ? " you" : ""}${animate ? " arrive" : ""}`);
        g.setAttribute("transform", `translate(${f(x)},${f(y)}) scale(${gs})`);
        g.dataset.y = String(y);
        g.style.setProperty("--wd", `${-((i * 1.7) % 7).toFixed(1)}s`);
        if (animate) g.style.setProperty("--delay", `${arrive === "all" ? i * 70 : 0}ms`);
        const pets = (guest.pets ?? []).slice(0, PET_OFFSETS.length);
        g.innerHTML =
          `<g class="guest-in">` +
          (mine ? `<ellipse class="you-ring" cx="0" cy="2" rx="36" ry="11" fill="none" stroke="${C.butterDeep}" stroke-width="5"/>` : "") +
          pets.map((p, k) => `<g class="pet" transform="translate(${PET_OFFSETS[k][0]},${PET_OFFSETS[k][1]})${PET_OFFSETS[k][0] < 0 ? " scale(-1,1)" : ""}">${art.petFigure(p.pet)}</g>`).join("") +
          art.guestFigure(guest.character) +
          `</g>`;

        const tags = document.createElementNS(SVG_NS, "g");
        tags.setAttribute("class", `tags${animate ? " arrive" : ""}`);
        tags.setAttribute("transform", `translate(${f(x)},${f(y)}) scale(${gs})`);
        const tag = (text: string, tx: number, ty: number, cls: string) => {
          const t = document.createElementNS(SVG_NS, "text");
          t.setAttribute("class", cls);
          t.setAttribute("x", String(tx));
          t.setAttribute("y", String(ty));
          t.setAttribute("text-anchor", "middle");
          t.textContent = text; // plain text, never markup
          tags.appendChild(t);
        };
        if (guest.displayName) {
          // Neighbours in a row alternate between two heights so their names don't run together.
          const low = pets.length > 0 || guest.pos ? false : Math.round(dx / 76 + 10) % 2 !== 0;
          tag(guest.displayName, 0, low ? 50 : 26, "guest-name");
        }
        pets.forEach((p, k) => tag(p.name, PET_OFFSETS[k][0], PET_OFFSETS[k][1] + (k < 2 ? 40 : 22), "guest-name pet-name"));
        labels.appendChild(tags);
        this.standing.appendChild(g);
        if (mine) this.makeDraggable(g, tags as SVGGElement, i, x, y, gs);
      });
    }
    for (const [id, [, y]] of this.spots) {
      const el = this.els.get(id)!;
      if (el.parentNode === this.standing) el.dataset.y = String(y);
    }
    this.sortStanding();
  }

  /** Lets this device's guest pick their character up and put it down anywhere in the picnic area. */
  private makeDraggable(g: SVGGElement, tags: SVGGElement, index: number, x0: number, y0: number, gs: number): void {
    let start: Pt | null = null;
    let cur = { x: x0, y: y0 };
    let moved = false;
    const place = (x: number, y: number) => {
      const t = `translate(${f(x)},${f(y)}) scale(${gs})`;
      g.setAttribute("transform", t);
      tags.setAttribute("transform", t);
    };
    g.addEventListener("pointerdown", (e) => {
      if (!this.onGuestDrop || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      this.refreshMatrix();
      start = this.toScene(e.clientX, e.clientY);
      moved = false;
      try {
        g.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      g.classList.add("dragging");
      this.dragging = true;
    });
    g.addEventListener("pointermove", (e) => {
      if (!start) return;
      const p = this.toScene(e.clientX, e.clientY);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 6 * this.unitsPerPx()) return;
      moved = true;
      const a = this.areaRect();
      cur = { x: Math.min(a.x1, Math.max(a.x0, x0 + p.x - start.x)), y: Math.min(a.y1, Math.max(a.y0, y0 + p.y - start.y)) };
      place(cur.x, cur.y);
    });
    const end = (commit: boolean) => {
      if (!start) return;
      start = null;
      this.dragging = false;
      g.classList.remove("dragging");
      if (!moved) return;
      if (!commit) {
        place(x0, y0);
        return;
      }
      const a = this.areaRect();
      const pos: [number, number] = [(cur.x - a.x0) / (a.x1 - a.x0), (cur.y - a.y0) / (a.y1 - a.y0)];
      this.guests[index] = { ...this.guests[index], pos };
      x0 = cur.x;
      y0 = cur.y;
      g.dataset.y = String(cur.y);
      this.sortStanding();
      this.onGuestDrop?.(pos);
    };
    // Browsers ignore touch-action on shapes inside an SVG, so stop the page scrolling here instead.
    g.addEventListener("touchstart", (e) => { if (this.onGuestDrop) e.preventDefault(); }, { passive: false });
    g.addEventListener("pointerup", () => end(true));
    g.addEventListener("pointercancel", () => end(false));
  }

  /* ---------- Little effects ---------- */

  /** A word that floats up and fades, in scene coordinates. */
  pop(x: number, y: number, text: string): void {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("class", "pop");
    t.setAttribute("x", f(x));
    t.setAttribute("y", f(y));
    t.setAttribute("text-anchor", "middle");
    t.style.fontSize = `${f(22 * Math.max(1, this.unitsPerPx()))}px`;
    t.textContent = text;
    this.svg.appendChild(t);
    window.setTimeout(() => t.remove(), 1500);
  }

  /** A burst of paper confetti. */
  confetti(x: number, y: number): void {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "confetti");
    g.setAttribute("transform", `translate(${f(x)},${f(y)})`);
    const colours = [C.butter, "#8FCBE6", "#FFFDF5", C.leaf2, "#B79AE0", C.butterDeep];
    let html = "";
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
      const d = 70 + Math.random() * 90;
      html += `<rect class="bit" x="-4" y="-6" width="8" height="12" rx="2" fill="${colours[i % colours.length]}" style="--tx:${f(Math.cos(a) * d)}px;--ty:${f(Math.sin(a) * d - 60)}px;--rot:${Math.round(Math.random() * 720 - 360)}deg"/>`;
    }
    g.innerHTML = html;
    this.svg.appendChild(g);
    window.setTimeout(() => g.remove(), 1700);
  }

  /* ---------- Geometry ---------- */

  el(id: string): SVGGElement {
    return this.els.get(id)!;
  }

  /** Visual centre of an element in scene units. */
  center(id: string): Pt {
    const [x, y, s] = this.spots.get(id)!;
    return { x, y: y + (CENTER_DY[id] ?? 0) * s };
  }

  scaleOf(id: string): number {
    return this.spots.get(id)![2];
  }

  refreshMatrix(): void {
    const m = this.svg.getScreenCTM();
    this.fwd = m ? DOMMatrix.fromMatrix(m) : null;
    const b = this.svg.getBoundingClientRect();
    this.box = { left: b.left, top: b.top };
    this.inv = this.fwd ? this.fwd.inverse() : null;
  }

  toScene(clientX: number, clientY: number): Pt {
    if (!this.inv) this.refreshMatrix();
    if (!this.inv) return { x: this.W / 2, y: this.H / 2 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(this.inv);
    return { x: p.x, y: p.y };
  }

  toClient(x: number, y: number): Pt {
    if (!this.fwd) this.refreshMatrix();
    if (!this.fwd) return { x: 0, y: 0 };
    const p = new DOMPoint(x, y).matrixTransform(this.fwd);
    return { x: p.x, y: p.y };
  }

  /** Scene units per CSS pixel. */
  unitsPerPx(): number {
    if (!this.fwd) this.refreshMatrix();
    return this.fwd ? 1 / this.fwd.a : 1;
  }

  /** The part of the scene that is actually on screen (the SVG may be cropped at the edges). */
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    const r = this.svg.getBoundingClientRect();
    const a = this.toScene(r.left, r.top);
    const b = this.toScene(r.right, r.bottom);
    return { x0: Math.max(0, a.x), y0: Math.max(0, a.y), x1: Math.min(this.W, b.x), y1: Math.min(this.H, b.y) };
  }

  /* ---------- Cover and lens ---------- */

  setHole(x: number, y: number, r: number): void {
    this.hole.setAttribute("cx", f(x));
    this.hole.setAttribute("cy", f(y));
    this.hole.setAttribute("r", f(Math.max(0, r)));
    const c = this.toClient(x, y);
    const st = this.cover.style;
    st.setProperty("--x", `${(c.x - this.box.left).toFixed(1)}px`);
    st.setProperty("--y", `${(c.y - this.box.top).toFixed(1)}px`);
    st.setProperty("--r", `${Math.max(0, r / this.unitsPerPx()).toFixed(1)}px`);
  }

  /** Shows or hides the ring and centre dot (hidden while the window expands). */
  setLens(on: boolean): void {
    if (on === this.lensOn) return;
    this.lensOn = on;
    this.cover.classList.toggle("no-lens", !on);
  }

  setCover(state: "hidden" | "covering" | "gone"): void {
    this.svg.dataset.cover = state;
  }
}
