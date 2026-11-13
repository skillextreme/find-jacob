/**
 * Vector artwork. Every function returns SVG markup drawn around a local origin
 * (feet / base centre at 0,0, y going up into negative numbers), so the park can place
 * each piece with a single translate + scale.
 */
import { parseLook, parsePet } from "./event.config.ts";

export const C = {
  cream: "#FBF3E0",
  cream2: "#F3E6C8",
  line: "#2B5A45",
  ink: "#1F4D3A",
  sky: "#CDE9F5",
  skyLight: "#E6F4FA",
  grass: "#B7DB9C",
  grass2: "#A5D08B",
  hill: "#93C582",
  leaf: "#6FAE6A",
  leaf2: "#86BF73",
  leafDark: "#4E8F5A",
  butter: "#FFE08A",
  butterDeep: "#F7CE5B",
  coral: "#F26B5B",
  path: "#F7E9C6",
  pathEdge: "#E6D3A3",
  water: "#A9D8EE",
  waterLight: "#CDEBF7",
  trunk: "#B98A5E",
  wood: "#C99B6B",
  hairBlack: "#1D1A1A",
} as const;

const OUT = `stroke="${C.line}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;

type Circle = [cx: number, cy: number, r: number];

/** Overlapping circles drawn as one soft-outlined shape. */
function blob(circles: Circle[], fill: string, outline = true): string {
  const fills = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join("");
  if (!outline) return fills;
  const edge = circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 2.5}" fill="${C.line}"/>`).join("");
  return edge + fills;
}

function shadow(rx: number, ry = 6): string {
  return `<ellipse cx="0" cy="2" rx="${rx}" ry="${ry}" fill="${C.ink}" opacity=".16"/>`;
}

/* ---------- People ---------- */

type HairStyle = "messy" | "bun" | "short" | "long" | "curly" | "cap" | "pony";

export interface PersonOpts {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  bottom: string;
  shoes?: string;
  grin?: boolean;
  pendant?: boolean;
  capColor?: string;
  partyHat?: boolean;
}

function hairMarkup(style: HairStyle, hair: string, capColor: string): string {
  const top = `<path d="M-19,-126 C-21,-151 21,-151 19,-126 C12,-138 -9,-140 -19,-126 Z" fill="${hair}"/>`;
  switch (style) {
    case "messy":
      return (
        `<path d="M-19.5,-126 C-26,-139 -18,-150 -10,-147 C-9,-156 3,-157 6,-150 C13,-156 24,-148 19,-139 C25,-135 22,-126 19.5,-124 C17,-133 10,-138 3,-135 C-4,-140 -12,-136 -15,-130 C-16,-127 -18,-124 -19.5,-126 Z" fill="${hair}"/>` +
        `<circle cx="-15" cy="-144" r="4.5" fill="${hair}"/><circle cx="13" cy="-149" r="4" fill="${hair}"/><circle cx="-2" cy="-152" r="4.5" fill="${hair}"/>` +
        `<path d="M-4,-137 q5,-5 10,-1" fill="none" stroke="${hair}" stroke-width="3.5" stroke-linecap="round"/>`
      );
    case "bun":
      return `<circle cx="0" cy="-151" r="8.5" fill="${hair}"/>` + top;
    case "long":
      return `<path d="M-20,-126 C-23,-153 23,-153 20,-126 L23,-98 L12,-98 L15,-124 C8,-138 -8,-138 -15,-124 L-12,-98 L-23,-98 Z" fill="${hair}"/>`;
    case "curly":
      return blob(
        [
          [-15, -137, 8],
          [-5, -145, 9],
          [6, -145, 9],
          [15, -137, 8],
          [-19, -127, 6],
          [19, -127, 6],
        ],
        hair,
        false,
      );
    case "cap":
      return (
        `<path d="M-19,-126 C-17,-120 -17,-118 -18,-116" fill="none" stroke="${hair}" stroke-width="4" stroke-linecap="round"/>` +
        `<path d="M-19.5,-130 C-19,-152 19,-152 19.5,-130 Z" fill="${capColor}" ${OUT}/>` +
        `<path d="M12,-132 h17 a3,3 0 0 1 0,6 h-17 z" fill="${capColor}" ${OUT}/>`
      );
    case "pony":
      return `<path d="M15,-138 C32,-140 31,-114 22,-106 C25,-118 21,-126 15,-128 Z" fill="${hair}"/>` + top;
    default:
      return top;
  }
}

function arm(side: -1 | 1, skin: string, shirt: string): string {
  const s = side;
  const limb = `M0,2 L${6 * s},36`;
  const sleeve = `M0,1 L${2.5 * s},14`;
  return (
    `<g transform="translate(${19 * s},-98)"><g class="arm ${s === 1 ? "arm-r" : "arm-l"}">` +
    `<path d="${limb}" fill="none" stroke="${C.line}" stroke-width="12.5" stroke-linecap="round"/>` +
    `<path d="${limb}" fill="none" stroke="${skin}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="${sleeve}" fill="none" stroke="${C.line}" stroke-width="15.5" stroke-linecap="round"/>` +
    `<path d="${sleeve}" fill="none" stroke="${shirt}" stroke-width="11" stroke-linecap="round"/>` +
    `</g></g>`
  );
}

function partyHat(): string {
  return (
    `<g transform="rotate(-10 0 -146)">` +
    `<path d="M-14,-144 L1,-186 L16,-144 Z" fill="${C.butter}" ${OUT}/>` +
    `<path d="M-9,-158 L11,-158 M-4.5,-171 L6.5,-171" fill="none" stroke="#8FCBE6" stroke-width="4.5"/>` +
    `<path d="M-14,-144 L1,-186 L16,-144 Z" fill="none" ${OUT}/>` +
    `<path d="M-16,-144 h34" fill="none" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cx="1" cy="-188" r="5" fill="#FFFDF5" ${OUT}/>` +
    `</g>`
  );
}

/** A standing figure about 155 units tall. */
export function person(o: PersonOpts): string {
  const shoes = o.shoes ?? "#ffffff";
  const mouth = o.grin
    ? `<path d="M-8.5,-121 Q0,-108 8.5,-121 Z" fill="#fff" stroke="${C.hairBlack}" stroke-width="1.6" stroke-linejoin="round"/>`
    : `<path d="M-6,-120 Q0,-114 6,-120" fill="none" stroke="${C.hairBlack}" stroke-width="1.8" stroke-linecap="round"/>`;
  const pendant = o.pendant
    ? `<path d="M-7,-104 L0,-90 L7,-104" fill="none" stroke="#f3f6f6" stroke-width="1.5" stroke-linecap="round"/><circle cx="0" cy="-89" r="2.8" fill="#8fd0e8" stroke="${C.line}" stroke-width="1"/>`
    : "";
  return (
    shadow(26) +
    `<g class="figure">` +
    `<rect x="-13" y="-42" width="10" height="40" rx="5" fill="${o.skin}" ${OUT}/>` +
    `<rect x="3" y="-42" width="10" height="40" rx="5" fill="${o.skin}" ${OUT}/>` +
    `<ellipse cx="-9" cy="-2" rx="9" ry="5" fill="${shoes}" ${OUT}/>` +
    `<ellipse cx="9" cy="-2" rx="9" ry="5" fill="${shoes}" ${OUT}/>` +
    `<path d="M-19,-68 h38 l2,32 h-18 l-3,-15 l-3,15 h-18 z" fill="${o.bottom}" ${OUT}/>` +
    arm(-1, o.skin, o.shirt) +
    arm(1, o.skin, o.shirt) +
    `<rect x="-20" y="-106" width="40" height="44" rx="11" fill="${o.shirt}" ${OUT}/>` +
    `<rect x="-5" y="-113" width="10" height="10" fill="${o.skin}"/>` +
    pendant +
    `<circle cx="-18" cy="-125" r="4" fill="${o.skin}" ${OUT}/><circle cx="18" cy="-125" r="4" fill="${o.skin}" ${OUT}/>` +
    `<circle cx="0" cy="-126" r="18.5" fill="${o.skin}" ${OUT}/>` +
    `<circle cx="-6.5" cy="-128" r="2.1" fill="${C.hairBlack}"/><circle cx="6.5" cy="-128" r="2.1" fill="${C.hairBlack}"/>` +
    mouth +
    hairMarkup(o.hairStyle, o.hair, o.capColor ?? o.shirt) +
    (o.partyHat ? partyHat() : "") +
    `</g>`
  );
}

export const JACOB: PersonOpts = {
  skin: "#B97A50",
  hair: C.hairBlack,
  hairStyle: "messy",
  shirt: C.coral,
  bottom: "url(#checks)",
  grin: true,
  pendant: true,
  partyHat: true,
};

export function jacob(): string {
  return person(JACOB);
}

/** Jacob's head and shoulders for the arrival screen. */
export function jacobPortrait(): string {
  return (
    `<svg viewBox="-48 -198 96 96" aria-hidden="true" focusable="false">` +
    `<circle cx="0" cy="-150" r="48" fill="${C.butter}"/>` +
    `<circle cx="0" cy="-150" r="40" fill="${C.cream}" opacity=".55"/>` +
    person(JACOB) +
    `<circle cx="0" cy="-150" r="46.5" fill="none" stroke="${C.line}" stroke-width="3"/>` +
    `</svg>`
  );
}

/* ---------- Guest looks ---------- */

export const SKINS = ["#F0C5A0", "#E0A77A", "#C98F63", "#A86C45", "#8C5A3C", "#5E3B27"];
export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: "messy", label: "Messy" },
  { id: "bun", label: "Bun" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "curly", label: "Curly" },
  { id: "cap", label: "Cap" },
  { id: "pony", label: "Ponytail" },
];
export const HAIR_COLORS = ["#1D1A1A", "#3B2416", "#6B4A2E", "#A8552E", "#C9CDD0"];
/** Coral is kept for Jacob, so nobody can dress as him. */
export const TOPS = ["#FFD25E", "#7EC3E6", "#8FCB7A", "#B79AE0", "#6CCDBB", "#FFFDF5", "#F5A9C4", "#3F5368"];
export const BOTTOMS = ["#3F5368", "#5E7FA8", "#F3E6C8", "#7C9A6D", "#4B4A6B", "#2E2B2B"];

function lookOpts(code: string): PersonOpts {
  const [skin, hair, hairColor, top, bottom] = parseLook(code) ?? [1, 2, 0, 1, 0];
  return {
    skin: SKINS[skin],
    hair: HAIR_COLORS[hairColor],
    hairStyle: HAIR_STYLES[hair].id,
    shirt: TOPS[top],
    bottom: BOTTOMS[bottom],
    capColor: TOPS[top] === "#FFFDF5" ? "#FFD25E" : "#FFFDF5",
  };
}

export function guestFigure(code: string): string {
  return person(lookOpts(code));
}

/** A guest look as a standalone picture. */
export function guestIcon(code: string): string {
  return `<svg viewBox="-36 -166 72 176" aria-hidden="true" focusable="false">${person(lookOpts(code))}</svg>`;
}

/* ---------- Pets (plus-ones) ---------- */

export const PET_KINDS = ["Dog", "Cat", "Bunny"];
export const PET_COLORS = ["#D9A066", "#FFFDF5", "#A9B0B4", "#4A4340", "#E8924A"];
const PET_SHADES = ["#B97E48", "#E6DFCB", "#868E93", "#2E2927", "#C06E2C"];

function cat(fur: string, dark: string): string {
  return (
    shadow(22, 5) +
    `<g class="pet-body">` +
    `<g transform="translate(-18,-12)"><g class="pet-tail"><path d="M0,0 C-16,-2 -18,-22 -8,-30" fill="none" stroke="${C.line}" stroke-width="9" stroke-linecap="round"/><path d="M0,0 C-16,-2 -18,-22 -8,-30" fill="none" stroke="${fur}" stroke-width="5" stroke-linecap="round"/></g></g>` +
    `<ellipse cx="0" cy="-15" rx="20" ry="15" fill="${fur}" ${OUT}/>` +
    `<path d="M4,-40 L7,-56 L17,-46 Z M30,-40 L28,-56 L18,-46 Z" fill="${dark}" ${OUT}/>` +
    `<circle cx="17" cy="-36" r="14" fill="${fur}" ${OUT}/>` +
    `<circle cx="12" cy="-38" r="1.9" fill="#2A2422"/><circle cx="23" cy="-38" r="1.9" fill="#2A2422"/>` +
    `<path d="M15.5,-33 h4 l-2,2.5 z" fill="#E08F8F"/>` +
    `<path d="M9,-32 h-9 M9,-30 l-8,3 M26,-32 h9 M26,-30 l8,3" stroke="${C.line}" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>` +
    `</g>`
  );
}

function bunny(fur: string, dark: string): string {
  return (
    shadow(20, 5) +
    `<g class="pet-body">` +
    `<circle cx="-17" cy="-10" r="6.5" fill="#FFFDF5" ${OUT}/>` +
    `<ellipse cx="0" cy="-14" rx="18" ry="14" fill="${fur}" ${OUT}/>` +
    `<g class="pet-ears"><ellipse cx="9" cy="-56" rx="4.5" ry="14" fill="${fur}" ${OUT} transform="rotate(-10 9 -44)"/><ellipse cx="19" cy="-56" rx="4.5" ry="14" fill="${fur}" ${OUT} transform="rotate(12 19 -44)"/>` +
    `<ellipse cx="19" cy="-56" rx="1.8" ry="9" fill="${dark}" transform="rotate(12 19 -44)"/></g>` +
    `<circle cx="14" cy="-32" r="12.5" fill="${fur}" ${OUT}/>` +
    `<circle cx="10" cy="-34" r="1.8" fill="#2A2422"/><circle cx="19" cy="-34" r="1.8" fill="#2A2422"/>` +
    `<circle cx="14.5" cy="-29.5" r="1.8" fill="#E08F8F"/>` +
    `</g>`
  );
}

export function petFigure(code: string): string {
  const [kind, color] = parsePet(code) ?? [0, 0];
  const fur = PET_COLORS[color];
  const dark = PET_SHADES[color];
  if (kind === 1) return cat(fur, dark);
  if (kind === 2) return bunny(fur, dark);
  return `<g transform="scale(0.62)">${dog(fur, dark)}</g>`;
}

export function petIcon(code: string): string {
  return `<svg viewBox="-34 -66 68 74" aria-hidden="true" focusable="false">${petFigure(code)}</svg>`;
}

/* ---------- Animals ---------- */

export function dog(fur = "#D9A066", dark = "#B97E48"): string {
  return (
    shadow(34) +
    `<g class="dog-body">` +
    `<g transform="translate(-30,-36)"><g class="dog-tail">` +
    `<path d="M0,0 Q-14,-10 -10,-25" fill="none" stroke="${C.line}" stroke-width="10" stroke-linecap="round"/>` +
    `<path d="M0,0 Q-14,-10 -10,-25" fill="none" stroke="${fur}" stroke-width="5.5" stroke-linecap="round"/>` +
    `</g></g>` +
    [-25, -13, 11, 22].map((x) => `<rect x="${x}" y="-22" width="9" height="22" rx="4" fill="${fur}" ${OUT}/>`).join("") +
    `<rect x="-33" y="-46" width="64" height="29" rx="14.5" fill="${fur}" ${OUT}/>` +
    `<ellipse cx="-10" cy="-38" rx="10" ry="6" fill="${dark}"/>` +
    `<g transform="translate(24,-42)"><g class="dog-head">` +
    `<circle cx="9" cy="-9" r="14.5" fill="${fur}" ${OUT}/>` +
    `<ellipse cx="21" cy="-5" rx="9.5" ry="7.5" fill="#F3D9B1" ${OUT}/>` +
    `<circle cx="28" cy="-7" r="3.2" fill="#3A2A22"/>` +
    `<circle cx="10" cy="-13" r="2.2" fill="#3A2A22"/>` +
    `<path d="M-1,-20 C-10,-18 -11,0 -4,3 C1,-4 3,-13 -1,-20 Z" fill="${dark}" ${OUT}/>` +
    `</g></g>` +
    `</g>`
  );
}

export function duck(): string {
  const white = "#FFFDF5";
  const print = (x: number, y: number, i: number) =>
    `<g class="print print-${i}" transform="translate(${x},${y})"><path d="M0,0 L-5,-8 M0,0 L0,-10 M0,0 L5,-8" fill="none" stroke="#E08F2E" stroke-width="2.4" stroke-linecap="round"/></g>`;
  return (
    `<g class="duck-prints">${print(34, 1, 1)}${print(50, -6, 2)}${print(66, 2, 3)}${print(82, -5, 4)}</g>` +
    shadow(22, 5) +
    `<g class="duck-body">` +
    `<path d="M-4,-3 l-5,4 M6,-3 l-2,5" fill="none" stroke="#E08F2E" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M22,-22 l12,-8 l-3,14 z" fill="${white}" ${OUT}/>` +
    `<ellipse cx="4" cy="-16" rx="22" ry="13.5" fill="${white}" ${OUT}/>` +
    `<path d="M-4,-20 C6,-23 15,-19 16,-12 C7,-9 -2,-12 -4,-20 Z" fill="#EFE7D0"/>` +
    `<rect x="-20" y="-34" width="11" height="16" fill="${white}"/>` +
    `<circle cx="-15" cy="-36" r="10.5" fill="${white}" ${OUT}/>` +
    `<path d="M-24,-38 l-11,3.5 l11,4.5 z" fill="#F4A340" ${OUT}/>` +
    `<circle cx="-18" cy="-39" r="1.9" fill="#3A2A22"/>` +
    `</g>`
  );
}

/* ---------- Plants and props ---------- */

export function bush(withBird = false, withGnome = false): string {
  const gnome = withGnome
    ? `<g class="bush-gnome"><circle cx="-6" cy="-52" r="11" fill="#F0C5A0" ${OUT}/><path d="M-17,-50 q11,22 22,0 z" fill="#FFFDF5" ${OUT}/><path d="M-19,-56 L-6,-92 L7,-56 Z" fill="#5E7FA8" ${OUT}/><circle cx="-10" cy="-54" r="1.5" fill="#2A2422"/><circle cx="-2" cy="-54" r="1.5" fill="#2A2422"/></g>`
    : "";
  const bird = withBird
    ? `<g class="bush-bird"><ellipse cx="8" cy="-44" rx="11" ry="9" fill="#8FCBE6" ${OUT}/><circle cx="16" cy="-52" r="7" fill="#8FCBE6" ${OUT}/><path d="M22,-53 l8,2 l-8,3 z" fill="#F4A340" ${OUT}/><circle cx="18" cy="-54" r="1.5" fill="#3A2A22"/></g>`
    : "";
  return (
    shadow(48, 7) +
    bird +
    gnome +
    `<g class="bush-leaves">` +
    blob(
      [
        [-30, -20, 21],
        [0, -32, 27],
        [30, -20, 21],
        [-12, -12, 18],
        [14, -12, 18],
      ],
      C.leaf,
    ) +
    `<circle cx="-22" cy="-26" r="3.2" fill="${C.butter}"/><circle cx="8" cy="-44" r="3.2" fill="${C.butter}"/><circle cx="26" cy="-18" r="3.2" fill="${C.butter}"/><circle cx="-4" cy="-18" r="3.2" fill="${C.butter}"/>` +
    `</g>`
  );
}

export function tree(variant: 0 | 1 = 0): string {
  const fill = variant === 0 ? C.leaf : C.leaf2;
  return (
    shadow(40, 8) +
    `<path d="M-10,0 L-6,-78 L6,-78 L10,0 Z" fill="${C.trunk}" ${OUT}/>` +
    `<g class="canopy">` +
    blob(
      [
        [-36, -108, 35],
        [32, -110, 37],
        [0, -146, 43],
        [0, -98, 31],
      ],
      fill,
    ) +
    `<circle cx="-14" cy="-150" r="9" fill="#fff" opacity=".14"/><circle cx="-34" cy="-112" r="7" fill="#fff" opacity=".12"/>` +
    `</g>`
  );
}

export function pine(): string {
  const tier = (y: number, w: number) =>
    `<path d="M0,${y - 62} L${w},${y} L${-w},${y} Z" fill="${C.leafDark}" ${OUT}/>`;
  return shadow(30, 7) + `<rect x="-6" y="-26" width="12" height="26" fill="${C.trunk}" ${OUT}/>` + tier(-22, 44) + tier(-62, 35) + tier(-100, 26);
}

export function bench(): string {
  return (
    shadow(54, 6) +
    `<path d="M-40,0 v-56 M40,0 v-56 M-40,-30 h80" fill="none" stroke="${C.line}" stroke-width="6" stroke-linecap="round"/>` +
    `<rect x="-50" y="-60" width="100" height="9" rx="3" fill="${C.wood}" ${OUT}/>` +
    `<rect x="-50" y="-47" width="100" height="9" rx="3" fill="${C.wood}" ${OUT}/>` +
    `<rect x="-54" y="-32" width="108" height="10" rx="3" fill="${C.wood}" ${OUT}/>`
  );
}

export function blanket(): string {
  return (
    `<g transform="skewX(-16)"><rect x="-122" y="-50" width="244" height="100" rx="9" fill="url(#gingham)" ${OUT}/></g>` +
    // football
    `<g transform="translate(-62,-4)"><circle r="15" fill="#FFFDF5" ${OUT}/><path d="M0,-6 l6,4 l-2.5,7 h-7 l-2.5,-7 z" fill="${C.line}"/><path d="M0,-6 v-9 M6,-2 l8,-4 M3.5,5 l5,8 M-3.5,5 l-5,8 M-6,-2 l-8,-4" stroke="${C.line}" stroke-width="1.6" fill="none"/></g>` +
    // frisbee
    `<g transform="translate(44,18)"><ellipse rx="24" ry="9" fill="#8FCBE6" ${OUT}/><ellipse rx="13" ry="4.5" fill="none" stroke="${C.line}" stroke-width="1.6" opacity=".6"/></g>` +
    // water bottle
    `<g transform="translate(6,-10)"><rect x="-7" y="-28" width="14" height="30" rx="5" fill="${C.waterLight}" ${OUT}/><rect x="-5" y="-35" width="10" height="8" rx="2" fill="#5E7FA8" ${OUT}/></g>`
  );
}

export function balloons(): string {
  const one = (x: number, y: number, fill: string, cls: string) =>
    `<g class="balloon ${cls}"><path d="M0,0 Q${x * 0.3},${y * 0.5} ${x},${y + 26}" fill="none" stroke="${C.line}" stroke-width="1.6"/>` +
    `<path d="M${x - 4},${y + 30} l4,-5 l4,5 z" fill="${fill}" ${OUT}/>` +
    `<ellipse cx="${x}" cy="${y}" rx="20" ry="25" fill="${fill}" ${OUT}/>` +
    `<ellipse cx="${x - 7}" cy="${y - 9}" rx="4" ry="7" fill="#fff" opacity=".5"/></g>`;
  return (
    `<path d="M-4,0 h8 l-2,-10 h-4 z" fill="${C.wood}" ${OUT}/>` +
    one(-26, -112, C.butter, "b1") +
    one(26, -104, "#8FCBE6", "b2") +
    one(2, -146, "#FFFDF5", "b3")
  );
}

export function pond(): string {
  return (
    `<ellipse cx="0" cy="0" rx="150" ry="52" fill="${C.water}" ${OUT}/>` +
    `<path d="M-90,-10 q20,-10 44,0 M10,14 q22,-10 48,0 M-30,26 q14,-7 30,0" fill="none" stroke="${C.waterLight}" stroke-width="4" stroke-linecap="round"/>` +
    `<g class="fish"><path d="M-14,0 q10,-10 22,0 q-12,10 -22,0 z M8,0 l10,-7 v14 z" fill="#F4A340" ${OUT}/><circle cx="-7" cy="-1" r="1.4" fill="#2A2422"/></g>` +
    `<g transform="translate(96,-30)"><ellipse rx="18" ry="8" fill="${C.leaf2}" ${OUT}/><circle cx="2" cy="-4" r="4.5" fill="#fff"/></g>` +
    `<g transform="translate(-112,22)"><path d="M0,0 v-34 M8,0 v-26 M-8,0 v-22" stroke="${C.leafDark}" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="0" cy="-36" rx="4" ry="9" fill="${C.trunk}"/><ellipse cx="8" cy="-28" rx="3.5" ry="8" fill="${C.trunk}"/></g>`
  );
}

/** Kite on a string. The string starts at the flyer's raised hand (local 0,0). */
export function kite(dx: number, dy: number): string {
  return (
    `<path d="M0,0 Q${dx * 0.6},${dy * 0.2} ${dx},${dy}" fill="none" stroke="${C.line}" stroke-width="1.4" opacity=".7"/>` +
    `<g transform="translate(${dx},${dy})"><g class="kite">` +
    `<path d="M0,-34 L24,0 L0,40 L-24,0 Z" fill="${C.butter}" ${OUT}/>` +
    `<path d="M0,-34 L24,0 L0,0 Z" fill="#8FCBE6"/><path d="M0,0 L0,40 L-24,0 Z" fill="#8FCBE6"/>` +
    `<path d="M0,-34 L24,0 L0,40 L-24,0 Z M0,-34 V40 M-24,0 H24" fill="none" ${OUT}/>` +
    `<path d="M0,40 q10,14 0,28 q-10,14 0,28" fill="none" stroke="${C.line}" stroke-width="1.6"/>` +
    `<path d="M-6,66 l12,5 l-12,5 z M6,92 l-12,5 l12,5 z" fill="${C.butterDeep}" ${OUT}/>` +
    `</g></g>`
  );
}

export function cloud(): string {
  return blob(
    [
      [-40, 0, 24],
      [-8, -14, 32],
      [30, -2, 26],
      [0, 6, 24],
    ],
    "#FFFDF5",
    false,
  );
}

export function butterfly(fill: string): string {
  const wing = (x: number, rot: number) =>
    `<ellipse cx="${x}" cy="-3" rx="6.5" ry="9" transform="rotate(${rot} ${x} -3)" fill="${fill}" stroke="${C.line}" stroke-width="1.6"/>`;
  return `<circle r="24" cy="-3" fill="transparent"/><g class="butterfly">${wing(-6, -28)}${wing(6, 28)}<path d="M0,-9 V5" stroke="${C.line}" stroke-width="2.2" stroke-linecap="round"/></g>`;
}

export function tuft(): string {
  return `<rect x="-12" y="-18" width="24" height="22" fill="transparent"/><g class="tuft-blades"><path d="M0,0 L-6,-11 M0,0 L0,-15 M0,0 L6,-11" fill="none" stroke="${C.leafDark}" stroke-width="2.6" stroke-linecap="round"/></g>`;
}

export function flower(fill: string): string {
  return `<path d="M0,0 v-10" stroke="${C.leafDark}" stroke-width="2.2" stroke-linecap="round"/><circle cx="0" cy="-13" r="5.5" fill="${fill}" stroke="${C.line}" stroke-width="1.6"/><circle cx="0" cy="-13" r="1.8" fill="${C.butterDeep}"/>`;
}

/** Paper plane pointing right, used as the 10-second clue. */
export function paperPlane(): string {
  return (
    `<g class="plane-bob"><path d="M-16,-11 L18,0 L-16,11 L-9,0 Z" fill="#FFFDF5" ${OUT}/>` +
    `<path d="M-9,0 H18" fill="none" stroke="${C.line}" stroke-width="2"/>` +
    `<path d="M-34,0 h8 M-48,0 h6" fill="none" stroke="${C.line}" stroke-width="2.5" stroke-linecap="round" opacity=".55"/></g>`
  );
}
