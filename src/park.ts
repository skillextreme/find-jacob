/**
 * The park scene: one layered SVG with a cream cover cut by a circular mask.
 * Every placed element has a stable id and a normalized (0–1) position per layout, and the
 * same positions drive both drawing and hit detection.
 */
import * as art from "./art.ts";
import { C } from "./art.ts";
import { LIMITS, type CharacterId } from "./event.config.ts";

export type Mode = "landscape" | "portrait";
export interface Pt {
  x: number;
  y: number;
}
export interface PublicGuest {
  character: CharacterId;
  displayName?: string;
}

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
  { id: "pond", svg: art.pond(), flat: true, L: [0.75, 0.87, 1], P: [0.27, 0.91, 0.82] },
  { id: "blanket", svg: art.blanket(), flat: true, L: [0.33, 0.74, 1], P: [0.4, 0.69, 0.92] },
  { id: "jacob", cls: "jacob", svg: art.jacob(), L: [0, 0, 1], P: [0, 0, 0.95], rel: { to: "blanket", dx: 132, dy: -88 } },
  { id: "balloons", svg: art.balloons(), L: [0, 0, 1], P: [0, 0, 0.9], rel: { to: "blanket", dx: -172, dy: -18 } },
  { id: "dog", cls: "dog", svg: `<g class="dog-move"><g class="dog-flip">${art.dog()}</g></g>`, L: [0.19, 0.5, 0.95], P: [0.3, 0.43, 0.9] },
  { id: "bush", cls: "bush", svg: art.bush(true), L: [0.67, 0.5, 1], P: [0.56, 0.345, 0.85] },
  { id: "duck", cls: "duck", svg: art.duck(), L: [0.6, 0.83, 0.95], P: [0.56, 0.86, 0.9] },
  { id: "bench", svg: art.bench(), L: [0.1, 0.77, 1], P: [0.79, 0.8, 0.85] },
  { id: "reader", cls: "walker", svg: reader, L: [0.155, 0.79, 0.95], P: [0.665, 0.815, 0.85] },
  { id: "flyer", cls: "walker flyer", svg: flyer + `<g transform="translate(25,-62)">${art.kite(70, -300)}</g>`, L: [0.8, 0.6, 0.95], P: [0.16, 0.53, 0.85] },
  { id: "jogger", cls: "walker", svg: jogger, L: [0.47, 0.41, 0.72], P: [0.4, 0.335, 0.68] },
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
  { id: "bush2", svg: art.bush(), L: [0.27, 0.92, 1], P: [0.1, 0.8, 0.8] },
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
  private cover: SVGRectElement;
  private maskRect: SVGRectElement;
  private hole: SVGCircleElement;
  private ring: SVGCircleElement;
  private dot: SVGCircleElement;
  readonly lens: SVGGElement;
  readonly plane: SVGGElement;
  private els = new Map<string, SVGGElement>();
  private spots = new Map<string, Spot>();
  private guests: PublicGuest[] = [];
  private you: number | null = null;
  private inv: DOMMatrix | null = null;
  private fwd: DOMMatrix | null = null;

  constructor(holder: HTMLElement) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "park");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML =
      `<g id="bg"></g><g id="flat"></g><g id="standing"></g>` +
      `<defs><mask id="cover-mask" maskUnits="userSpaceOnUse"><rect id="mask-rect" fill="#fff"/><circle id="mask-hole" fill="#000" r="0"/></mask></defs>` +
      `<rect id="cover" fill="${C.cream}" mask="url(#cover-mask)"/>` +
      `<g id="lens"><circle id="lens-ring" fill="none" stroke="${C.line}" stroke-width="3" opacity=".85"/>` +
      `<g id="hint-plane" style="display:none">${art.paperPlane()}</g>` +
      `<circle id="lens-dot" fill="${C.ink}"/></g>`;
    this.svg = svg;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    this.bg = q("#bg");
    this.flat = q("#flat");
    this.standing = q("#standing");
    this.cover = q("#cover");
    this.maskRect = q("#mask-rect");
    this.hole = q("#mask-hole");
    this.ring = q("#lens-ring");
    this.dot = q("#lens-dot");
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
    for (const r of [this.cover, this.maskRect]) {
      r.setAttribute("x", "-20");
      r.setAttribute("y", "-20");
      r.setAttribute("width", String(W + 40));
      r.setAttribute("height", String(H + 40));
    }
    const mask = this.svg.querySelector("#cover-mask")!;
    mask.setAttribute("x", "-20");
    mask.setAttribute("y", "-20");
    mask.setAttribute("width", String(W + 40));
    mask.setAttribute("height", String(H + 40));

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
      `<circle cx="${f(W * 0.1)}" cy="${f(H * 0.09)}" r="${f(74 * cs)}" fill="${C.butter}" opacity=".4"/>` +
      `<circle cx="${f(W * 0.1)}" cy="${f(H * 0.09)}" r="${f(50 * cs)}" fill="${C.butter}"/>` +
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

  private renderGuests(arrive: number | "all" | null): void {
    this.standing.querySelectorAll(".guest").forEach((n) => n.remove());
    const b = this.spots.get("blanket");
    if (b) {
      const xs = this.mode === "portrait" ? 0.8 : 1;
      const gs = this.mode === "portrait" ? 0.72 : 0.8;
      this.guests.forEach((guest, i) => {
        const [dx, dy] = GUEST_SPOTS[i % GUEST_SPOTS.length];
        const x = b[0] + dx * xs * b[2];
        const y = b[1] + dy * b[2];
        const g = document.createElementNS(SVG_NS, "g");
        const animate = arrive === "all" || arrive === i;
        g.setAttribute("class", `item guest${i === this.you ? " you" : ""}${animate ? " arrive" : ""}`);
        g.setAttribute("transform", `translate(${f(x)},${f(y)}) scale(${gs})`);
        g.dataset.y = String(y);
        if (animate) g.style.setProperty("--delay", `${arrive === "all" ? i * 70 : 0}ms`);
        g.innerHTML = `<g class="guest-in">${art.guestFigure(guest.character)}</g>`;
        if (guest.displayName) {
          const t = document.createElementNS(SVG_NS, "text");
          t.setAttribute("class", "guest-name");
          t.setAttribute("y", "24");
          t.setAttribute("text-anchor", "middle");
          t.textContent = guest.displayName; // plain text, never markup
          g.appendChild(t);
        }
        this.standing.appendChild(g);
      });
    }
    for (const [id, [, y]] of this.spots) {
      const el = this.els.get(id)!;
      if (el.parentNode === this.standing) el.dataset.y = String(y);
    }
    this.sortStanding();
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
    const xs = f(x), ys = f(y), rs = f(Math.max(0, r));
    this.hole.setAttribute("cx", xs);
    this.hole.setAttribute("cy", ys);
    this.hole.setAttribute("r", rs);
    this.ring.setAttribute("cx", xs);
    this.ring.setAttribute("cy", ys);
    this.ring.setAttribute("r", rs);
    this.dot.setAttribute("cx", xs);
    this.dot.setAttribute("cy", ys);
    this.dot.setAttribute("r", f(3.5 * this.unitsPerPx()));
    this.ring.setAttribute("stroke-width", f(3 * this.unitsPerPx()));
  }

  setCover(state: "hidden" | "covering" | "gone"): void {
    this.svg.dataset.cover = state;
  }
}
