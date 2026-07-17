/* ============================================================
   RENDER — everything that draws pixels.
   One Renderer per canvas; tick(dt) advances animation state,
   draw(ctx) paints the current frame. The exporter drives the
   exact same code with fixed timesteps, so what you see is
   what you export.
   ============================================================ */
import { Assets, fontByName, mulberry32, hrand, BLUE } from "./state.js";

const QUANT = 34; // the glitch grid, scaled up from the site's 26px

/* ---------- shared grain tile ---------- */
let grainTile = null;
function getGrain() {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  grainTile = c;
  return c;
}
function drawGrain(ctx, w, h, step) {
  const g = getGrain();
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.globalCompositeOperation = "overlay";
  const ox = Math.floor(hrand(step, 1) * 256), oy = Math.floor(hrand(step, 2) * 256);
  for (let y = -oy; y < h; y += 256)
    for (let x = -ox; x < w; x += 256) ctx.drawImage(g, x, y);
  ctx.restore();
}

/* ============================================================
   GLITCH STRIPS — the site engine, ported to canvas.
   Carves a rect into bands/cells that step sideways on a grid,
   jolt vertically, and occasionally snap.
   ============================================================ */
function buildStrips(rng, W, H, rows, echo) {
  const made = [];
  let y = 0;
  for (let i = 0; i < rows; i++) {
    const mega = rng() < 0.2;
    let h = Math.round((H / rows) * (mega ? 2.4 + rng() * 1.8 : 0.35 + rng() * 1.6));
    if (y + h > H) h = H - y;
    if (h <= 0) break;
    let srcY = y;
    if (made.length && rng() < echo) srcY = made[Math.floor(rng() * made.length)].srcY;
    const cols = mega ? 1 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 4);
    let x = 0;
    for (let c = 0; c < cols && x < W; c++) {
      let w = c === cols - 1 ? W - x : Math.round((W / cols) * (0.35 + rng() * 1.4));
      if (x + w > W) w = W - x;
      if (w <= 0) break;
      made.push({
        x, y, w, h, srcX: x, srcY,
        ox: (Math.floor(rng() * 3) - 1) * QUANT * 0.5, oy: 0,
        dir: rng() < 0.5 ? -1 : 1, jolt: 0,
      });
      x += w;
    }
    y += h;
  }
  return made;
}

function tickStrips(cells, rng) {
  const STEP = QUANT * 0.5, MAX = QUANT * 1.5;
  cells.forEach((s) => {
    if (rng() < 0.28) {
      s.ox += STEP * s.dir;
      if (s.ox >= MAX || s.ox <= -MAX) s.dir = -s.dir;
    }
    if (s.jolt > 0) {
      s.jolt--;
      if (s.jolt === 0) s.oy = 0;
    } else if (rng() < 0.03) {
      s.oy = (rng() < 0.5 ? -1 : 1) * (3 + rng() * 9);
      s.jolt = 1 + Math.floor(rng() * 3);
    }
  });
}

function snapStrips(cells, rng, amount) {
  cells.forEach((s) => {
    if (rng() < amount) s.ox = (Math.floor(rng() * 5) - 2) * QUANT;
  });
}

/* draw one strip-cell of `img` cover-fitted to a W×H box at (bx,by) */
function drawStripCell(ctx, img, s, bx, by, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw) return;
  const scale = Math.max(W / iw, H / ih);      // cover
  const k = 1 / scale;                          // display px -> image px
  let sx = (s.srcX - s.ox) * k, sy = (s.srcY + s.oy) * k;
  let sw = s.w * k, sh = s.h * k;
  sx = Math.max(0, Math.min(iw - sw, sx));
  sy = Math.max(0, Math.min(ih - sh, sy));
  if (sw <= 0 || sh <= 0) return;
  ctx.drawImage(img, sx, sy, sw, sh, bx + s.x, by + s.y, s.w, s.h);
}

/* ============================================================
   BACKGROUNDS
   ============================================================ */
class SolidBG {
  constructor(doc) { this.doc = doc; this.t = 0; }
  tick(dt) { this.t += dt; }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    ctx.fillStyle = bg.color1;
    ctx.fillRect(0, 0, w, h);
    if (bg.grain) drawGrain(ctx, w, h, Math.floor(this.t / 0.15));
  }
}

class GradientBG {
  constructor(doc) { this.doc = doc; this.t = 0; }
  tick(dt) { this.t += dt; }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    const wob = Math.sin(this.t * 0.4) * 0.18;
    const g = ctx.createLinearGradient(w * wob, 0, w * (0.2 + wob) , h);
    g.addColorStop(0, bg.color1);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (bg.grain) drawGrain(ctx, w, h, Math.floor(this.t / 0.15));
  }
}

class GlitchBG {
  constructor(doc) {
    this.doc = doc;
    this.t = 0; this.stepT = 0; this.snapT = 0; this.swapT = 0;
    this.rng = mulberry32(doc.seed);
    const { w, h } = doc;
    const imgs = (doc.bg.images && doc.bg.images.length ? doc.bg.images : ["ride-road"]);
    this.pool = imgs;
    /* full-bleed stack of photo bands, like the site's collage layers */
    this.blocks = [];
    let y = 0, i = 0;
    while (y < h) {
      let bh = h * (0.14 + this.rng() * 0.22);
      if (h - (y + bh) < h * 0.09) bh = h - y;
      const asset = imgs[i % imgs.length];
      this.blocks.push({
        x: 0, y, w, h: bh, asset,
        cells: buildStrips(this.rng, w, bh, 8 + Math.floor(this.rng() * 4), 0.28),
      });
      y += bh; i++;
    }
    /* a couple of floating blocks on top for depth */
    for (let k = 0; k < 2; k++) {
      const bw = w * (0.26 + this.rng() * 0.3);
      const bh2 = bw * (0.7 + this.rng() * 0.6);
      this.blocks.push({
        x: this.rng() * (w - bw), y: this.rng() * (h - bh2),
        w: bw, h: bh2, asset: imgs[(i + k) % imgs.length],
        cells: buildStrips(this.rng, bw, bh2, 7, 0.3),
      });
    }
  }
  tick(dt) {
    this.t += dt; this.stepT += dt; this.snapT += dt; this.swapT += dt;
    if (this.stepT >= 0.3) {
      this.stepT = 0;
      this.blocks.forEach((b) => tickStrips(b.cells, this.rng));
    }
    if (this.snapT >= 1.8) {
      this.snapT = 0;
      const b = this.blocks[Math.floor(this.rng() * this.blocks.length)];
      snapStrips(b.cells, this.rng, 0.14);
    }
    if (this.swapT >= 3.5) {
      this.swapT = 0;
      const b = this.blocks[Math.floor(this.rng() * this.blocks.length)];
      b.asset = this.pool[Math.floor(this.rng() * this.pool.length)];
    }
  }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    ctx.fillStyle = bg.color1;
    ctx.fillRect(0, 0, w, h);
    this.blocks.forEach((b) => {
      const rec = Assets.get(b.asset);
      if (!rec) return;
      b.cells.forEach((s) => drawStripCell(ctx, rec.img, s, b.x, b.y, b.w, b.h));
    });
  }
}

class TypewallBG {
  constructor(doc) {
    this.doc = doc; this.t = 0;
    const bg = doc.bg;
    const f = fontByName(bg.font);
    this.fontFam = f.family;
    this.italic = !!f.italic;
    const nrows = Math.max(3, Math.round(doc.h / 380));
    this.rows = [];
    const rowH = doc.h / nrows;
    for (let i = 0; i < nrows; i++) {
      this.rows.push({
        y: i * rowH, h: rowH,
        dir: i % 2 ? 1 : -1,
        speed: 26 + hrand(doc.seed, i) * 40,
        off: hrand(doc.seed, i, 7) * 999,
        mirror: (bg.mirrorRows !== false) && i % 2 === 1,
        color: i % 2 ? bg.color2 : bg.color1,
      });
    }
  }
  tick(dt) { this.t += dt; }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    ctx.fillStyle = bg.bgColor || "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const word = bg.word || "ride";
    this.rows.forEach((r, i) => {
      const size = r.h * 0.92;
      ctx.save();
      ctx.font = `${this.italic ? "italic " : ""}400 ${size}px ${this.fontFam}`;
      ctx.textBaseline = "alphabetic";
      const wordW = ctx.measureText(word).width + size * 0.22;
      let off = (r.off + this.t * r.speed * r.dir) % wordW;
      if (off > 0) off -= wordW;
      ctx.fillStyle = i % 2 ? bg.color2 : bg.color1;
      const baseY = r.y + r.h * 0.82;
      if (r.mirror) {
        ctx.translate(0, r.y + r.h / 2);
        ctx.scale(1, -1);
        ctx.translate(0, -(r.y + r.h / 2));
      }
      for (let x = off; x < w; x += wordW) ctx.fillText(word, x, baseY);
      ctx.restore();
    });
    if (bg.grain) drawGrain(ctx, w, h, Math.floor(this.t / 0.15));
  }
}

class RainBG {
  constructor(doc) {
    this.doc = doc; this.t = 0; this.spawnT = 0;
    this.rng = mulberry32(doc.seed + 9);
    this.active = []; this.rested = [];
    this.pool = ["smiley-blue"];
  }
  spawn() {
    const rng = this.rng, doc = this.doc;
    const d = doc.w * (0.1 + rng() * 0.08);
    this.active.push({
      asset: this.pool[Math.floor(rng() * this.pool.length)],
      d, r: d / 2,
      x: rng() * (doc.w - d), y: -d - rng() * 200,
      vx: (rng() - 0.5) * 3, vy: 2 + rng() * 5,
      rot: rng() * 360, vr: (rng() - 0.5) * 10,
      slow: 0,
    });
  }
  tick(dt) {
    dt *= this.doc.bg.rainSpeed ?? 1;
    this.t += dt; this.spawnT += dt;
    if (this.spawnT > 0.45 && this.active.length < 26) { this.spawnT = 0; this.spawn(); }
    const { w, h } = this.doc;
    const GRAV = 0.45 * 60 * dt, REST = 0.35;
    for (let i = 0; i < this.active.length; i++) {
      const s = this.active[i];
      const floor = h - s.d - 2;
      s.supported = false;
      s.vy += GRAV;
      if (s.vy > 14) s.vy = 14;
      s.x += s.vx * 60 * dt; s.y += s.vy * 60 * dt; s.rot += s.vr * 60 * dt;
      if (s.y >= floor) {
        s.y = floor;
        if (s.vy > 0) s.vy = -s.vy * 0.3;
        s.vx *= 0.85; s.vr *= 0.85; s.supported = true;
      }
      if (s.x < -s.r) { s.x = -s.r; s.vx = Math.abs(s.vx) * 0.5; }
      if (s.x > w - s.r) { s.x = w - s.r; s.vx = -Math.abs(s.vx) * 0.5; }
      for (const o of this.rested) this.collideStatic(s, o);
      for (let j = i + 1; j < this.active.length; j++) this.collidePair(s, this.active[j]);
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      const speed = Math.abs(s.vx) + Math.abs(s.vy);
      s.slow = s.supported && speed < 1.8 ? s.slow + 1 : 0;
      if (s.slow > 8) {
        this.rested.push(s);
        this.active.splice(i, 1);
        if (this.rested.length > 110) this.rested.shift();
      }
    }
  }
  collideStatic(w, o) {
    const minD = w.r + o.r;
    const dx = w.x + w.r - (o.x + o.r), dy = w.y + w.r - (o.y + o.r);
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    if (d >= minD) return;
    const nx = dx / d, ny = dy / d, push = (minD - d) * 0.6;
    w.x += nx * push; w.y += ny * push;
    const vn = w.vx * nx + w.vy * ny;
    if (vn < 0) {
      w.vx -= 1.35 * vn * nx; w.vy -= 1.35 * vn * ny;
      w.vx *= 0.92; w.vr *= 0.9;
    }
    if (ny < -0.35) w.supported = true;
  }
  collidePair(a, b) {
    const minD = a.r + b.r;
    const dx = a.x + a.r - (b.x + b.r), dy = a.y + a.r - (b.y + b.r);
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    if (d >= minD) return;
    const nx = dx / d, ny = dy / d, push = (minD - d) * 0.3;
    a.x += nx * push; a.y += ny * push;
    b.x -= nx * push; b.y -= ny * push;
    if (ny < -0.35) a.supported = true;
    if (ny > 0.35) b.supported = true;
    const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rvn < 0) {
      const j = -1.35 * rvn / 2;
      a.vx += j * nx; a.vy += j * ny;
      b.vx -= j * nx; b.vy -= j * ny;
    }
  }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    ctx.fillStyle = bg.color1;
    ctx.fillRect(0, 0, w, h);
    const all = this.rested.concat(this.active);
    all.forEach((s) => {
      const rec = Assets.get(s.asset);
      if (!rec) return;
      ctx.save();
      ctx.translate(s.x + s.r, s.y + s.r);
      ctx.rotate((s.rot * Math.PI) / 180);
      ctx.drawImage(rec.img, -s.r, -s.r, s.d, s.d);
      ctx.restore();
    });
  }
}

class CheckerBG {
  constructor(doc) { this.doc = doc; this.t = 0; }
  tick(dt) { this.t += dt; }
  draw(ctx) {
    const { w, h, bg, seed } = this.doc;
    const Q = Math.round(w / 10);
    const step = Math.floor(this.t / 0.35);
    for (let iy = 0; iy * Q < h; iy++) {
      for (let ix = 0; ix * Q < w; ix++) {
        const base = (ix + iy) % 2;
        const flick = hrand(seed, ix, iy, step) < 0.08 ? 1 : 0;
        ctx.fillStyle = base ^ flick ? bg.color1 : bg.color2;
        ctx.fillRect(ix * Q, iy * Q, Q + 1, Q + 1);
      }
    }
    if (bg.grain) drawGrain(ctx, w, h, step);
  }
}

/* dense animated speckle field, like a broadcast from a wet forest */
class NoiseBG {
  constructor(doc) { this.doc = doc; this.t = 0; this.tileKey = ""; this.tiles = []; }
  ensureTiles() {
    const { bg } = this.doc;
    const key = bg.color1 + bg.color2;
    if (key === this.tileKey) return;
    this.tileKey = key;
    /* a darker sibling of the speckle colour for depth */
    const c2 = bg.color2;
    const dark = "#" + [1, 3, 5].map((i) =>
      Math.round(parseInt(c2.slice(i, i + 2), 16) * 0.35).toString(16).padStart(2, "0")).join("");
    this.tiles = [0, 1, 2].map((n) => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const g = c.getContext("2d");
      const rng = mulberry32(this.doc.seed + n * 77);
      for (let i = 0; i < 6500; i++) {
        g.fillStyle = rng() < 0.55 ? c2 : dark;
        g.globalAlpha = 0.35 + rng() * 0.65;
        g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 3.5, 1 + rng() * 2);
      }
      return c;
    });
  }
  tick(dt) { this.t += dt; }
  draw(ctx) {
    const { w, h, bg } = this.doc;
    this.ensureTiles();
    ctx.fillStyle = bg.color1;
    ctx.fillRect(0, 0, w, h);
    const tile = this.tiles[Math.floor(this.t / 0.13) % 3];
    for (let y = 0; y < h; y += 512)
      for (let x = 0; x < w; x += 512) ctx.drawImage(tile, x, y);
  }
}

const BG_TYPES = {
  solid: SolidBG, gradient: GradientBG, glitch: GlitchBG,
  typewall: TypewallBG, rain: RainBG, checker: CheckerBG, noise: NoiseBG,
};
export const BG_LABELS = {
  solid: "solid", gradient: "gradient", glitch: "photo glitch",
  typewall: "type wall", rain: "sticker rain", checker: "checker", noise: "noise field",
};

/* ============================================================
   TEXT — chips + mutant glyphs, ported from the site.
   ============================================================ */
const MUTS = ["it", "flip", "skew", "skew2", "wide", "thin", "drop", "lift", "hollow", "", "", ""];

function glyphMutation(ch, r1, r2) {
  if (/[oO0]/.test(ch) && r1 < 0.4) return "o-serif";
  if (/\S/.test(ch) && r1 < 0.75) return MUTS[Math.floor(r2 * MUTS.length)];
  return "";
}

function glyphFont(mut, layer, f) {
  const size = layer.size;
  if (mut === "it") return `italic 400 ${size}px Georgia`;
  if (mut === "o-serif") return `italic 400 ${size}px "Times New Roman"`;
  const italic = f.italic ? "italic " : "";
  return `${italic}${layer.weight} ${size}px ${f.family}`;
}

/* measure + draw one line of possibly-mutated / warped glyphs.
   mode: "measure" returns width; "draw" paints at (x, baseline). */
function lineOp(ctx, layer, line, li, step, mode, x, baseY, doc, time = 0) {
  const f = fontByName(layer.font);
  const size = layer.size;
  let cx = x;
  const plainFont = glyphFont("", layer, f);
  const warped = layer.warp && layer.warp !== "none";
  if (!layer.mutate && !warped) {
    ctx.font = plainFont;
    const wdt = ctx.measureText(line).width + layer.tracking * Math.max(0, line.length - 1);
    if (mode === "measure") return wdt;
    /* unmutated: draw whole line (with manual tracking if any) */
    if (!layer.tracking) {
      strokeOrFill(ctx, layer, line, x, baseY);
    } else {
      for (const ch of line) {
        strokeOrFill(ctx, layer, ch, cx, baseY);
        cx += ctx.measureText(ch).width + layer.tracking;
      }
    }
    return wdt;
  }
  /* glyph-by-glyph: mutations and/or warp */
  let total = 0;
  const glyphs = [...line].map((ch, ci) => {
    let mut = "";
    if (layer.mutate) {
      const r1 = hrand(doc.seed, li * 131 + ci, step);
      const r2 = hrand(doc.seed, li * 131 + ci, step, 5);
      mut = glyphMutation(ch, r1, r2);
    }
    ctx.font = glyphFont(mut, layer, f);
    let w = ctx.measureText(ch).width;
    if (mut === "wide") w *= 1.42;
    if (mut === "thin") w *= 0.6;
    total += w + layer.tracking;
    return { ch, mut, w };
  });
  if (mode === "measure") return total;

  /* warp geometry, shared across the line */
  const L = Math.max(1, total);
  const amt = layer.warpAmt ?? 50;
  let span = 0, R = 0, sgn = 1;
  if (layer.warp === "arc" && amt !== 0) {
    span = Math.min(2.6, Math.abs(amt) / 100 * 2.2); // radians
    sgn = amt > 0 ? 1 : -1;
    R = L / (2 * Math.sin(span / 2));
  }
  let pos = 0;
  glyphs.forEach((g) => {
    const t01 = (pos + g.w / 2) / L;
    let dx = 0, dy = 0, drot = 0, dscale = 1;
    if (layer.warp === "arc" && span) {
      const th = span * (t01 - 0.5);
      dy = sgn * R * (1 - Math.cos(th));
      drot = sgn * th;
    } else if (layer.warp === "wave") {
      dy = Math.sin(t01 * Math.PI * 2 + time * 1.6) * (amt / 100) * size * 0.55;
      drot = Math.cos(t01 * Math.PI * 2 + time * 1.6) * (amt / 100) * 0.18;
    } else if (layer.warp === "persp") {
      dscale = Math.max(0.2, 1 + (t01 - 0.5) * amt / 80);
    }
    pos += g.w + layer.tracking;
    ctx.save();
    ctx.font = glyphFont(g.mut, layer, f);
    ctx.translate(cx + g.w / 2 + dx, baseY + dy);
    if (drot) ctx.rotate(drot);
    if (dscale !== 1) ctx.scale(dscale, dscale);
    switch (g.mut) {
      case "flip": ctx.scale(-1, 1); break;
      case "skew": ctx.transform(1, 0, Math.tan(-0.24), 1, 0, 0); break;
      case "skew2": ctx.transform(1, 0, Math.tan(0.21), 1, 0, layer.size * 0.03); break;
      case "wide": ctx.scale(1.5, 1); break;
      case "thin": ctx.scale(0.6, 1); break;
      case "drop": ctx.translate(0, layer.size * 0.09); break;
      case "lift": ctx.translate(0, -layer.size * 0.07); ctx.rotate(0.05); break;
      case "o-serif": ctx.scale(1, 0.8); ctx.rotate(-0.35); break;
    }
    if (g.mut === "hollow" || layer.hollow) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(1.5, layer.size * 0.02);
      ctx.strokeText(g.ch, -g.w / 2, 0);
    } else {
      ctx.fillStyle = layer.color;
      ctx.fillText(g.ch, -g.w / 2, 0);
    }
    ctx.restore();
    cx += g.w + layer.tracking;
  });
  return total;
}

function strokeOrFill(ctx, layer, txt, x, y) {
  if (layer.hollow) {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1.5, layer.size * 0.02);
    ctx.strokeText(txt, x, y);
  } else {
    ctx.fillStyle = layer.color;
    ctx.fillText(txt, x, y);
  }
}

function drawTextLayer(ctx, layer, time, doc, rt) {
  const lines = String(layer.text).split("\n");
  const size = layer.size;
  const lh = size * layer.lineHeight;
  const pad = layer.chip ? size * 0.18 : 0;
  const step = layer.anim === "scramble" ? Math.floor(time / 0.22) : 0;
  const jstep = Math.floor(time / 0.15);

  ctx.textBaseline = "alphabetic";
  /* measure */
  const widths = lines.map((line, li) => lineOp(ctx, layer, line, li, step, "measure", 0, 0, doc));
  const blockW = Math.max(...widths, 1);
  const blockH = lines.length * lh + pad;

  /* anchor: layer.x/y is the top-left / top-center / top-right of the block */
  let bx = layer.x;
  if (layer.align === "center") bx = layer.x - blockW / 2;
  if (layer.align === "right") bx = layer.x - blockW;

  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rot * Math.PI) / 180);
  ctx.translate(-layer.x, -layer.y);

  const paint = (mirrored) => {
    lines.forEach((line, li) => {
      let lx = bx;
      if (layer.align === "center") lx = layer.x - widths[li] / 2;
      if (layer.align === "right") lx = layer.x - widths[li];
      let jx = 0, jy = 0;
      if (layer.anim === "jitter") {
        jx = (hrand(doc.seed, li, jstep) - 0.5) * size * 0.12;
        jy = (hrand(doc.seed, li, jstep, 3) - 0.5) * size * 0.08;
      }
      const top = layer.y + li * lh + jy;
      const baseY = top + size * 0.82 + pad / 2;
      if (layer.chip) {
        ctx.fillStyle = layer.chipColor;
        ctx.fillRect(lx + jx - pad * 1.4, top, widths[li] + pad * 2.8, lh + pad * 0.4);
      }
      if (layer.glow) {
        ctx.save();
        ctx.shadowColor = layer.color;
        ctx.shadowBlur = size * 0.4;
        /* two passes: haze first, then a slightly crisper core */
        lineOp(ctx, layer, line, li, step, "draw", lx + jx, baseY, doc, time);
        ctx.shadowBlur = size * 0.12;
        lineOp(ctx, layer, line, li, step, "draw", lx + jx, baseY, doc, time);
        ctx.restore();
      } else {
        lineOp(ctx, layer, line, li, step, "draw", lx + jx, baseY, doc, time);
      }
    });
  };

  paint(false);
  if (layer.mirror) {
    ctx.save();
    const bottom = layer.y + blockH;
    ctx.translate(0, 2 * bottom + size * 0.1);
    ctx.scale(1, -1);
    ctx.globalAlpha *= 0.9;
    paint(true);
    ctx.restore();
  }
  ctx.restore();

  rt.bbox = { x: bx - pad * 1.4, y: layer.y, w: blockW + pad * 2.8, h: blockH * (layer.mirror ? 2.1 : 1) };
}

/* ============================================================
   IMAGE EFFECTS — stackable. Pixel stages (duotone, threshold,
   dither, halftone, smear-posterize) bake into a cached offscreen
   canvas in the order chosen; draw stages (rgb, smear streaks,
   strips) composite per-frame on top, in that fixed order.
   ============================================================ */
const hexRGB = (c1) => [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];

function applyPixelStage(c, g, W, H, eff, layer) {
  if (eff === "duotone" || eff === "threshold") {
    const A = hexRGB(layer.colorA), B = hexRGB(layer.colorB);
    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      if (eff === "threshold") {
        const on = l > 0.5;
        px[i] = on ? B[0] : A[0]; px[i + 1] = on ? B[1] : A[1]; px[i + 2] = on ? B[2] : A[2];
      } else {
        px[i] = A[0] + (B[0] - A[0]) * l;
        px[i + 1] = A[1] + (B[1] - A[1]) * l;
        px[i + 2] = A[2] + (B[2] - A[2]) * l;
      }
    }
    g.putImageData(d, 0, 0);
  } else if (eff === "dither") {
    /* ordered-dither screenprint: ink (A) on paper (B) */
    const A = hexRGB(layer.colorA), B = hexRGB(layer.colorB);
    const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
        const ink = l < (BAYER[y & 3][x & 3] + 0.5) / 16;
        px[i] = ink ? A[0] : B[0]; px[i + 1] = ink ? A[1] : B[1]; px[i + 2] = ink ? A[2] : B[2];
      }
    }
    g.putImageData(d, 0, 0);
  } else if (eff === "smear") {
    /* posterize hard; the streaking happens at draw time */
    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        /* stretch contrast, then quantize to 6 levels */
        let v = (px[i + ch] - 128) * 1.35 + 128;
        px[i + ch] = Math.max(0, Math.min(255, Math.round(v / 51) * 51));
      }
    }
    g.putImageData(d, 0, 0);
  } else if (eff === "halftone") {
    const cell = Math.max(8, Math.round(W / 60));
    const small = document.createElement("canvas");
    small.width = Math.ceil(W / cell); small.height = Math.ceil(H / cell);
    const sg = small.getContext("2d");
    sg.drawImage(c, 0, 0, small.width, small.height);
    const d = sg.getImageData(0, 0, small.width, small.height).data;
    g.fillStyle = layer.colorA;
    g.fillRect(0, 0, W, H);
    g.fillStyle = layer.colorB;
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const i = (y * small.width + x) * 4;
        const l = 1 - (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        const r = (l * cell) / 2 * 1.15;
        if (r > 0.4) {
          g.beginPath();
          g.arc(x * cell + cell / 2, y * cell + cell / 2, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
}

function buildChannels(c, W, H) {
  return ["#ff0000", "#00ff00", "#0000ff"].map((tint) => {
    const cc = document.createElement("canvas");
    cc.width = W; cc.height = H;
    const cg = cc.getContext("2d");
    cg.drawImage(c, 0, 0);
    cg.globalCompositeOperation = "multiply";
    cg.fillStyle = tint;
    cg.fillRect(0, 0, W, H);
    /* keep alpha of original */
    cg.globalCompositeOperation = "destination-in";
    cg.drawImage(c, 0, 0);
    return cc;
  });
}

function processedImage(layer, rt) {
  const rec = Assets.get(layer.asset);
  if (!rec) return null;
  const effects = layer.effects || [];
  const key = [layer.asset, Math.round(layer.w), Math.round(layer.h), effects.join("+"), layer.colorA, layer.colorB].join("|");
  if (rt.fx && rt.fxKey === key) return rt.fx;
  const W = Math.max(2, Math.round(layer.w)), H = Math.max(2, Math.round(layer.h));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  /* cover-fit source */
  const img = rec.img;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const scale = Math.max(W / iw, H / ih);
  const dw = iw * scale, dh = ih * scale;
  g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  for (const eff of effects) applyPixelStage(c, g, W, H, eff, layer);
  rt.channels = effects.includes("rgb") ? buildChannels(c, W, H) : null;

  rt.fx = c;
  rt.fxKey = key;
  return c;
}

/* draw the layer's image with its full effect stack, W×H centered
   at the origin. Caller sets up translate/rotate (and clip, for blobs). */
function drawImagePipeline(ctx, layer, time, doc, rt) {
  const rec = Assets.get(layer.asset);
  if (!rec) return;
  const W = layer.w, H = layer.h;
  const effects = layer.effects || [];
  let src = effects.length ? processedImage(layer, rt) : rec.img;
  if (!src) return;

  if (effects.includes("rgb") && rt.channels) {
    const cw = rt.channels[0].width, chh = rt.channels[0].height;
    if (!rt.comp || rt.comp.width !== cw || rt.comp.height !== chh) {
      rt.comp = document.createElement("canvas");
      rt.comp.width = cw; rt.comp.height = chh;
    }
    const cg = rt.comp.getContext("2d");
    cg.clearRect(0, 0, cw, chh);
    const step = layer.animate ? Math.floor(time / 0.18) : 0;
    const offs = [
      [(hrand(doc.seed, step, 1) - 0.5) * 26, (hrand(doc.seed, step, 2) - 0.5) * 10],
      [0, 0],
      [(hrand(doc.seed, step, 3) - 0.5) * 26, (hrand(doc.seed, step, 4) - 0.5) * 10],
    ];
    cg.globalCompositeOperation = "lighter";
    rt.channels.forEach((cc, i) => cg.drawImage(cc, offs[i][0], offs[i][1]));
    cg.globalCompositeOperation = "source-over";
    src = rt.comp;
  }

  if (effects.includes("smear")) {
    /* horizontal streaks: rows grabbed and dragged sideways */
    const sw0 = src.width, sh0 = src.height;
    if (!rt.smearC || rt.smearC.width !== sw0 || rt.smearC.height !== sh0) {
      rt.smearC = document.createElement("canvas");
      rt.smearC.width = sw0; rt.smearC.height = sh0;
    }
    const sg = rt.smearC.getContext("2d");
    sg.clearRect(0, 0, sw0, sh0);
    sg.drawImage(src, 0, 0);
    const step = layer.animate ? Math.floor(time / 0.16) : 0;
    const kx = sw0 / W, ky = sh0 / H;
    for (let i = 0; i < 34; i++) {
      const ry = hrand(doc.seed, step, i) * H;
      const rh = 2 + hrand(doc.seed, step, i, 2) * 11;
      const sx = hrand(doc.seed, step, i, 3) * W * 0.75;
      const sw = 24 + hrand(doc.seed, step, i, 4) * W * 0.22;
      const stretch = 2 + hrand(doc.seed, step, i, 5) * 7;
      const dx = sx - (sw * stretch - sw) * hrand(doc.seed, step, i, 6);
      sg.globalAlpha = 0.75 + hrand(doc.seed, step, i, 7) * 0.25;
      sg.drawImage(src, sx * kx, ry * ky, sw * kx, rh * ky, dx * kx, ry * ky, sw * stretch * kx, rh * ky);
    }
    sg.globalAlpha = 1;
    src = rt.smearC;
  }

  if (effects.includes("strips")) {
    /* animated glitch strips over the (already processed) image */
    if (!rt.cells || rt.cellsKey !== `${Math.round(W)}x${Math.round(H)}`) {
      rt.rng = mulberry32(doc.seed + layer.id.length * 7 + Math.round(W));
      rt.cells = buildStrips(rt.rng, W, H, 10, 0.3);
      rt.cellsKey = `${Math.round(W)}x${Math.round(H)}`;
      rt.stepT = 0; rt.snapT = 0;
    }
    if (layer.animate) {
      rt.stepT = (rt.stepT || 0) + (time - (rt.lastT ?? time));
      rt.snapT = (rt.snapT || 0) + (time - (rt.lastT ?? time));
      rt.lastT = time;
      if (rt.stepT >= 0.3) { rt.stepT = 0; tickStrips(rt.cells, rt.rng); }
      if (rt.snapT >= 1.6) { rt.snapT = 0; snapStrips(rt.cells, rt.rng, 0.15); }
    }
    rt.cells.forEach((s) => drawStripCell(ctx, src, s, -W / 2, -H / 2, W, H));
  } else if (src === rec.img) {
    const iw = src.naturalWidth, ih = src.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const sw = W / scale, sh = H / scale;
    ctx.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, -W / 2, -H / 2, W, H);
  } else {
    ctx.drawImage(src, -W / 2, -H / 2, W, H);
  }
}

function drawImageLayer(ctx, layer, time, doc, rt) {
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rot * Math.PI) / 180);
  drawImagePipeline(ctx, layer, time, doc, rt);
  ctx.restore();
  rt.bbox = { x: layer.x - layer.w / 2, y: layer.y - layer.h / 2, w: layer.w, h: layer.h };
}

/* organic silhouette: a smooth closed curve through seeded radial points */
function drawBlobLayer(ctx, layer, time, doc, rt) {
  const n = 10;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    let r = 0.55 + 0.45 * hrand(layer.shapeSeed, i);
    if (layer.morph) r *= 1 + 0.07 * Math.sin(time * 1.1 + i * 2.3);
    pts.push({ x: Math.cos(ang) * r * layer.w / 2, y: Math.sin(ang) * r * layer.h / 2 });
  }
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rot * Math.PI) / 180);
  ctx.beginPath();
  /* quadratic through midpoints = closed smooth curve */
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m.x, m.y);
  for (let i = 0; i < n; i++) {
    const next = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, next.x, next.y);
  }
  ctx.closePath();
  if (layer.asset && Assets.get(layer.asset)) {
    ctx.clip();
    drawImagePipeline(ctx, layer, time, doc, rt);
  } else {
    ctx.fillStyle = layer.color;
    ctx.fill();
  }
  ctx.restore();
  rt.bbox = { x: layer.x - layer.w / 2, y: layer.y - layer.h / 2, w: layer.w, h: layer.h };
}

function drawStickerLayer(ctx, layer, time, doc, rt) {
  const rec = Assets.get(layer.asset);
  if (!rec) return;
  const iw = rec.img.naturalWidth, ih = rec.img.naturalHeight;
  const w = layer.w, h = w * (ih / iw);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(((layer.rot + time * layer.spin) * Math.PI) / 180);
  ctx.drawImage(rec.img, -w / 2, -h / 2, w, h);
  ctx.restore();
  rt.bbox = { x: layer.x - w / 2, y: layer.y - h / 2, w, h };
}

/* ============================================================
   RENDERER
   ============================================================ */
export class Renderer {
  constructor(doc) {
    this.doc = doc;
    this.time = 0;
    this.bg = null;
    this.bgKey = "";
    this.rt = new Map(); // layer id -> runtime
  }
  bgSignature() {
    const b = this.doc.bg;
    return [b.type, this.doc.w, this.doc.h, this.doc.seed, (b.images || []).join(","), b.word, b.font, b.mirrorRows, b.bgColor].join("§");
  }
  ensureBg() {
    const sig = this.bgSignature();
    if (sig !== this.bgKey || !this.bg) {
      this.bg = new (BG_TYPES[this.doc.bg.type] || SolidBG)(this.doc);
      this.bgKey = sig;
    }
  }
  layerRT(l) {
    let r = this.rt.get(l.id);
    if (!r) { r = {}; this.rt.set(l.id, r); }
    return r;
  }
  tick(dt) {
    this.time += dt;
    this.ensureBg();
    this.bg.tick(dt);
  }
  draw(ctx) {
    const { doc } = this;
    this.ensureBg();
    ctx.clearRect(0, 0, doc.w, doc.h);
    this.bg.draw(ctx);
    for (const l of doc.layers) {
      const rt = this.layerRT(l);
      if (l.type === "text") drawTextLayer(ctx, l, this.time, doc, rt);
      else if (l.type === "image") drawImageLayer(ctx, l, this.time, doc, rt);
      else if (l.type === "sticker") drawStickerLayer(ctx, l, this.time, doc, rt);
      else if (l.type === "blob") drawBlobLayer(ctx, l, this.time, doc, rt);
    }
  }
  bboxOf(layer) {
    return (this.rt.get(layer.id) || {}).bbox;
  }
}
