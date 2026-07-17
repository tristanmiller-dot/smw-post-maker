/* ============================================================
   STATE — document model, fonts, assets, layout presets.
   ============================================================ */

export const BLUE = "#0034f7";

export const SWATCHES = [
  "#0034f7", "#000000", "#ffffff", "#f2ede3",
  "#00a05a", "#ffe600", "#c724b1", "#7a4a1f",
  "#ff4d00", "#9db9ff", "#0d0d0d", "#d7ff3e",
];

export const FONTS = [
  { name: "Sligoil",        family: "Sligoil",              weights: [400, 700] },
  { name: "Anton",          family: "Anton",                weights: [400] },
  { name: "Archivo Black",  family: "'Archivo Black'",      weights: [400] },
  { name: "DM Serif",       family: "'DM Serif Display'",   weights: [400] },
  { name: "DM Serif Italic",family: "'DM Serif Display'",   weights: [400], italic: true },
  { name: "Marker",         family: "'Permanent Marker'",   weights: [400] },
  { name: "Space Mono",     family: "'Space Mono'",         weights: [400, 700] },
  { name: "Georgia Italic", family: "Georgia",              weights: [400], italic: true },
  { name: "Helvetica",      family: "'Helvetica Neue', Helvetica, Arial", weights: [400, 700] },
];
export const fontByName = (n) => FONTS.find((f) => f.name === n) || FONTS[0];

export const FORMATS = {
  "3:4":  { w: 1080, h: 1440 },
  "9:16": { w: 1080, h: 1920 },
};

export const POOL = [
  "ride-road", "ride-street", "ride-garden", "ride-snack", "ride-cafe",
  "ride-beers", "ride-coffee", "ride-signbox", "ride-party", "ride-taproom",
  "ride-terrace", "ride-ferns", "ride-ditchling", "ride-graffiti", "ride-blur", "ride-blur2",
];

export const STICKERS = [
  "smiley-blue", "logo-smiley-blue", "logo-smiley-white", "logo-black", "logo-white",
];

/* ---------- seeded rng ---------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* one-shot hash → [0,1) — for per-glyph/per-step decisions */
export function hrand(...ns) {
  let h = 2166136261;
  for (const n of ns) { h ^= Math.floor(n * 1013); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

let idc = 1;
export const uid = () => "L" + idc++;

/* ---------- assets ---------- */
export const Assets = {
  images: new Map(), // id -> {img, name}
  async load(id, url, name) {
    if (this.images.has(id)) return this.images.get(id);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    const rec = { img, name: name || id };
    this.images.set(id, rec);
    return rec;
  },
  get(id) { return this.images.get(id); },
  async ensureBuiltins() {
    await Promise.all([
      ...POOL.map((n) => this.load(n, "assets/" + n + ".jpg", n)),
      ...STICKERS.map((n) => this.load(n, "assets/" + n + ".png", n)),
    ]);
  },
  addUpload(file) {
    const id = "U" + idc++;
    const url = URL.createObjectURL(file);
    return this.load(id, url, file.name).then(() => id);
  },
  uploads() {
    return [...this.images.keys()].filter((k) => k.startsWith("U"));
  },
};

/* ---------- layer factories ---------- */
export function textLayer(p = {}) {
  return Object.assign({
    id: uid(), type: "text", name: "text",
    text: "So Many Wheels",
    x: 540, y: 400, size: 90, rot: 0,
    font: "Sligoil", weight: 700, align: "left",
    color: "#000000", chip: true, chipColor: "#ffffff",
    tracking: 0, lineHeight: 1.3,
    mutate: false,               // per-glyph mutations (site disease)
    anim: "none",                // none | scramble | jitter
    mirror: false,               // upside-down reflection
    hollow: false,
    glow: false,                 // spray-paint halation
    warp: "none",                // none | arc | wave | persp
    warpAmt: 50,                 // -100..100
  }, p);
}

export function imageLayer(p = {}) {
  const l = Object.assign({
    id: uid(), type: "image", name: "image",
    asset: POOL[0],
    x: 540, y: 700, w: 900, h: 700, rot: 0,
    effects: [],                 // stackable: strips|smear|duotone|threshold|halftone|dither|rgb
    colorA: "#000000", colorB: BLUE,
    animate: true,
  }, p);
  if (l.effect) {                // legacy single-effect form
    if (l.effect !== "none") l.effects = [l.effect];
    delete l.effect;
  }
  return l;
}

export function blobLayer(p = {}) {
  return Object.assign({
    id: uid(), type: "blob", name: "blob",
    color: "#9b9b9b",
    asset: null,                 // optional image clipped inside the blob
    effects: [],                 // same stackable effects as image layers
    colorA: "#000000", colorB: BLUE,
    animate: true,
    x: 540, y: 720, w: 700, h: 700, rot: 0,
    morph: true,                 // breathe slowly
    shapeSeed: Math.floor(Math.random() * 9999),
  }, p);
}

export function stickerLayer(p = {}) {
  return Object.assign({
    id: uid(), type: "sticker", name: "sticker",
    asset: "smiley-blue",
    x: 540, y: 700, w: 260, rot: 0,
    spin: 0,                     // deg/sec
  }, p);
}

/* ---------- default doc ---------- */
export function defaultDoc() {
  return {
    format: "3:4", w: 1080, h: 1440,
    dur: 8, fps: 30, seed: 1337,
    bg: {
      type: "glitch",            // solid|gradient|glitch|typewall|rain|checker
      color1: "#ffffff", color2: BLUE,
      grain: true,
      rainSpeed: 1,
      word: "RIDE", font: "Sligoil",
      images: POOL.slice(0, 8),
    },
    layers: [],
    music: null,                 // {title, artist, art, offset, volume, buffer?}
  };
}

/* ---------- layout presets ----------
   Starting points, not cages. Tristan's tweaked layouts, dumped from
   the app (2026-07-17) and baked in as data. Designed at 1080×1440;
   y positions scale to the current format on build. */
const DEFAULT_LAYOUTS = [
  {
    name: "Collage", seed: 1337,
    bg: { type: "glitch", color1: "#ffffff", color2: BLUE, grain: false, word: "RIDE", font: "Sligoil", images: POOL.slice(0, 8) },
    layers: [
      { type: "text", name: "text", text: "So Many Wheels", x: 70, y: 90, size: 54, rot: 0, font: "Sligoil", weight: 700, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "text", name: "text", text: "a bicycle society", x: 70, y: 168, size: 44, rot: 0, font: "Sligoil", weight: 400, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "sticker", name: "sticker", asset: "logo-smiley-blue", x: 345.6, y: 662.4, w: 300, rot: 0, spin: 10 },
      { type: "text", name: "event details", text: "Upcoming Ride\nTUE 28 JUL — The Inaugural Wheeler\n6:15pm — meet at the fountain\n20km, analog pace", x: 70, y: 1110, size: 46, rot: 0, font: "Sligoil", weight: 400, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
    ],
  },
  {
    name: "Big Stack", seed: 1337,
    bg: { type: "gradient", color1: BLUE, color2: "#ffffff", grain: true, word: "RIDE", font: "Sligoil", images: [] },
    layers: [
      { type: "sticker", name: "sticker", asset: "smiley-blue", x: 880, y: 1260, w: 686, rot: 0, spin: -6 },
      { type: "text", name: "text", text: "ride", x: 320, y: 580, size: 300, rot: 0, font: "Anton", weight: 700, align: "left", color: "#ffffff", chip: false, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "text", name: "details", text: "Tuesday 28 July @ 6:15pm\n20km road ride — analog bikes", x: 100, y: 940, size: 48, rot: 0, font: "Sligoil", weight: 700, align: "left", color: BLUE, chip: true, chipColor: "#ffffff", tracking: -8, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "image", name: "image", asset: "ride-snack", x: 1040, y: 297, w: 358, h: 594, rot: 0, effects: ["strips", "duotone", "threshold"], colorA: BLUE, colorB: "#ffffff", animate: true },
      { type: "text", name: "text", text: "group", x: 60, y: 220, size: 300, rot: 0, font: "Anton", weight: 700, align: "left", color: "#ffffff", chip: false, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
    ],
  },
  {
    name: "Type Wall", seed: 1337,
    bg: { type: "typewall", color1: "#00a05a", color2: "#c724b1", grain: true, word: "wheels", font: "Helvetica", images: [], bgColor: "#f2ede3", mirrorRows: true },
    layers: [
      { type: "text", name: "text", text: "So Many Wheels", x: 540, y: 560, size: 77, rot: 0, font: "Sligoil", weight: 700, align: "center", color: "#000000", chip: true, chipColor: "#ffffff", tracking: -7, lineHeight: 1.3, mutate: false, anim: "jitter", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "text", name: "text", text: "Sunday Social\n40km — cafe stop included\n09:00 from the bandstand", x: 540, y: 700, size: 48, rot: 0, font: "Sligoil", weight: 700, align: "center", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
    ],
  },
  {
    name: "Full Photo", seed: 1337,
    bg: { type: "solid", color1: "#0d0d0d", color2: "#000000", grain: true, word: "", font: "Sligoil", images: [] },
    layers: [
      { type: "image", name: "image", asset: "ride-blur2", x: 540, y: 720, w: 1080, h: 1440, rot: 0, effects: ["strips", "smear", "threshold"], colorA: "#ffffff", colorB: BLUE, animate: true },
      { type: "text", name: "text", text: "the inaugural\nwheeler", x: 84.2, y: 80, size: 121, rot: 0, font: "Sligoil", weight: 700, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "text", name: "details", text: "TUE 28 JUL — 6:15PM\n20KM — ANALOG PACE\nMEET AT THE FOUNTAIN", x: 60, y: 1140, size: 44, rot: 0, font: "Sligoil", weight: 700, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "persp", warpAmt: 50 },
      { type: "sticker", name: "sticker", asset: "logo-smiley-white", x: 420, y: 720, w: 378, rot: 0, spin: 12 },
    ],
  },
  {
    name: "Screenprint", seed: 1337,
    bg: { type: "solid", color1: "#f2ede3", color2: "#000000", grain: true, word: "", font: "Sligoil", images: [] },
    layers: [
      { type: "text", name: "text", text: "Sunday Social", x: 73, y: 60, size: 116, rot: 0, font: "Sligoil", weight: 700, align: "left", color: "#f2ede3", chip: true, chipColor: BLUE, tracking: 0, lineHeight: 1.3, mutate: true, anim: "scramble", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "text", name: "text", text: "40km — coffee stop halfway\nanalog bikes, all welcome", x: 60, y: 260, size: 40, rot: 0, font: "Sligoil", weight: 700, align: "left", color: "#f2ede3", chip: true, chipColor: BLUE, tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "none", warpAmt: 50 },
      { type: "image", name: "image", asset: "ride-garden", x: 540, y: 800, w: 950.4, h: 792, rot: -2, effects: ["dither", "strips"], colorA: BLUE, colorB: "#f2ede3", animate: true },
      { type: "text", name: "text", text: "see you there", x: 680, y: 1220, size: 92, rot: -5, font: "Georgia Italic", weight: 700, align: "center", color: BLUE, chip: false, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "jitter", mirror: false, hollow: false, glow: true, warp: "arc", warpAmt: 35 },
    ],
  },
  {
    name: "Blob", seed: 1337,
    bg: { type: "solid", color1: "#ffffff", color2: "#000000", grain: false, word: "", font: "Sligoil", images: [] },
    layers: [
      { type: "blob", name: "blob", color: "#a8a8a8", asset: "ride-garden", effects: ["halftone"], colorA: "#c724b1", colorB: "#00a05a", animate: true, x: 500, y: 800, w: 1456, h: 2014, rot: 0, morph: true, shapeSeed: 8686 },
      { type: "text", name: "text", text: "So Many Wheels presents", x: 580, y: 60, size: 66, rot: 0, font: "Sligoil", weight: 700, align: "center", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "persp", warpAmt: 60 },
      { type: "text", name: "text", text: "the sculpture\ntour ride", x: 680, y: 260, size: 92, rot: 4, font: "Sligoil", weight: 700, align: "center", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "arc", warpAmt: -40 },
      { type: "text", name: "text", text: "Saturday 11th July\nmeet at the gallery\ngather 13:00 — ride 15:00", x: 60, y: 1100, size: 54, rot: -7, font: "Sligoil", weight: 700, align: "left", color: "#000000", chip: true, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: false, warp: "wave", warpAmt: 30 },
    ],
  },
  {
    name: "Sticker Rain", seed: 10164,
    bg: { type: "rain", color1: "#7a4a1f", color2: BLUE, grain: false, word: "", font: "Sligoil", images: [], rainSpeed: 1 },
    layers: [
      { type: "text", name: "text", text: "So Many Wheels", x: 540, y: 580, size: 60, rot: 0, font: "Sligoil", weight: 700, align: "center", color: "#ffffff", chip: false, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "none", mirror: false, hollow: false, glow: true, warp: "none", warpAmt: 50 },
      { type: "text", name: "text", text: "the inaugural wheeler\ntue 28 jul — 6:15pm", x: 540, y: 700, size: 52, rot: 0, font: "Sligoil", weight: 700, align: "center", color: "#ffffff", chip: false, chipColor: "#ffffff", tracking: 0, lineHeight: 1.3, mutate: false, anim: "scramble", mirror: false, hollow: false, glow: true, warp: "none", warpAmt: 50 },
    ],
  },
];

export const PRESETS = DEFAULT_LAYOUTS.map((snap) => ({
  name: snap.name,
  build(doc) {
    doc.seed = snap.seed;
    doc.bg = JSON.parse(JSON.stringify(snap.bg));
    const sy = doc.h / 1440;
    doc.layers = snap.layers.map((l) => {
      const c = JSON.parse(JSON.stringify(l));
      c.id = uid();
      c.y *= sy;
      return c;
    });
  },
}));
