/* ============================================================
   APP — panels, canvas interaction, preview loop.
   ============================================================ */
import {
  defaultDoc, PRESETS, FORMATS, FONTS, SWATCHES, POOL, STICKERS,
  Assets, textLayer, imageLayer, stickerLayer, blobLayer, BLUE,
} from "./state.js";
import { Renderer, BG_LABELS } from "./render.js";
import { exportMP4, downloadBlob } from "./export.js";
import { setupMusic, renderSelected } from "./music.js";

const $ = (s) => document.querySelector(s);

let doc = defaultDoc();
let renderer = new Renderer(doc);
let selected = null;
/* each layout keeps its own working document; switching never destroys work */
const presetDocs = new Map();
let currentPreset = PRESETS[0].name;
/* console access for poking around */
window.__smw = {
  get doc() { return doc; },
  get renderer() { return renderer; },
  /* dump every layout's working doc — for baking tweaks back into PRESETS */
  dumpLayouts: () => JSON.stringify(
    [...presetDocs.entries()].map(([name, d]) => ({ name, doc: { ...d, music: null } })), null, 2),
};

const preview = $("#preview"), pctx = preview.getContext("2d");
const overlay = $("#overlay"), octx = overlay.getContext("2d");

/* ---------------- boot ---------------- */
(async function boot() {
  await Assets.ensureBuiltins();
  /* make sure canvas can see every font before first paint */
  const loads = [];
  for (const f of FONTS) {
    for (const w of f.weights) loads.push(document.fonts.load(`${f.italic ? "italic " : ""}${w} 20px ${f.family}`, "wheels"));
  }
  await Promise.allSettled(loads);
  await document.fonts.ready;

  if (restoreSaved()) {
    resetRenderer();
    $("#format").value = doc.format;
    $("#duration").value = String(doc.dur);
  } else {
    PRESETS[0].build(doc);
    presetDocs.set(currentPreset, doc);
  }
  buildLayoutButtons();
  buildBgPanel();
  buildLayerList();
  buildProps();
  setupMusic(() => doc, () => {});
  fitCanvas();
  undoStack.push(snapshot());
  requestAnimationFrame(loop);
})();

/* ---------------- history (undo / redo) ----------------
   No central dispatch — panels, drags and nudges all mutate `doc`
   directly. So the preview loop polls a serialized snapshot; once a
   change stops moving for a tick it commits one undo step, which
   coalesces drags and slider scrubs. Music is kept out (AudioBuffer
   isn't serializable) and survives by reference per preset. */
/* ---------------- persistence ----------------
   Every layout's working doc autosaves to localStorage (music
   excluded — AudioBuffers don't survive a reload anyway). */
const SAVE_KEY = "smw-post-maker";
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      current: currentPreset,
      layouts: [...presetDocs.entries()].map(([name, d]) => ({ name, doc: { ...d, music: null } })),
    }));
  } catch {}
}
function restoreSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s || !s.layouts?.length) return false;
    s.layouts.forEach(({ name, doc: d }) => presetDocs.set(name, d));
    currentPreset = presetDocs.has(s.current) ? s.current : s.layouts[0].name;
    doc = presetDocs.get(currentPreset);
    return true;
  } catch { return false; }
}
addEventListener("beforeunload", persist);

const HIST_MAX = 100;
const undoStack = [], redoStack = [];
let histSeen = "", histT = 0;

const snapshot = () => JSON.stringify({ preset: currentPreset, doc: { ...doc, music: null } });

function checkHistory() {
  const s = snapshot();
  if (s === undoStack[undoStack.length - 1]) { histSeen = s; return; }
  if (s === histSeen) {          // settled → commit
    undoStack.push(s);
    if (undoStack.length > HIST_MAX) undoStack.shift();
    redoStack.length = 0;
    histButtons();
    persist();
  } else histSeen = s;           // still mid-change; wait
}

function applySnapshot(s) {
  const parsed = JSON.parse(s);
  currentPreset = parsed.preset;
  const existing = presetDocs.get(parsed.preset);
  doc = parsed.doc;
  doc.music = existing ? existing.music : null;
  presetDocs.set(parsed.preset, doc);
  histSeen = s;
  buildLayoutButtons();
  refreshAll();
  persist();
}

function undo() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  applySnapshot(undoStack[undoStack.length - 1]);
  histButtons();
}
function redo() {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(s);
  applySnapshot(s);
  histButtons();
}
function histButtons() {
  $("#undo").disabled = undoStack.length < 2;
  $("#redo").disabled = !redoStack.length;
}
$("#undo").onclick = undo;
$("#redo").onclick = redo;

/* ---------------- preview loop ---------------- */
let lastT = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
  lastT = now;
  renderer.tick(dt);
  renderer.draw(pctx);
  drawOverlay();
  histT += dt;
  if (histT >= 0.25 && !drag) { histT = 0; checkHistory(); }
  requestAnimationFrame(loop);
}

function drawOverlay() {
  octx.clearRect(0, 0, doc.w, doc.h);
  if (!selected) return;
  const b = renderer.bboxOf(selected);
  if (!b) return;
  octx.save();
  if (selected.rot) {
    const cx = selected.type === "text" ? selected.x : b.x + b.w / 2;
    const cy = selected.type === "text" ? selected.y : b.y + b.h / 2;
    octx.translate(cx, cy);
    octx.rotate((selected.rot * Math.PI) / 180);
    octx.translate(-cx, -cy);
  }
  octx.strokeStyle = BLUE;
  octx.lineWidth = 3;
  octx.setLineDash([12, 8]);
  octx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
  octx.restore();
  if (drag && snapGuides) {
    octx.save();
    octx.strokeStyle = "#c724b1";
    octx.lineWidth = 2;
    octx.setLineDash([8, 8]);
    snapGuides.v.forEach((x) => { octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, doc.h); octx.stroke(); });
    snapGuides.h.forEach((y) => { octx.beginPath(); octx.moveTo(0, y); octx.lineTo(doc.w, y); octx.stroke(); });
    octx.restore();
  }
}

function fitCanvas() {
  preview.width = overlay.width = doc.w;
  preview.height = overlay.height = doc.h;
  const stage = $("#stage");
  const maxW = stage.clientWidth - 40, maxH = stage.clientHeight - 40;
  const s = Math.min(maxW / doc.w, maxH / doc.h);
  preview.style.width = overlay.style.width = doc.w * s + "px";
  preview.style.height = overlay.style.height = doc.h * s + "px";
}
addEventListener("resize", fitCanvas);
new ResizeObserver(fitCanvas).observe($("#stage"));

function resetRenderer() {
  renderer = new Renderer(doc);
}

/* ---------------- topbar ---------------- */
$("#format").onchange = (e) => {
  doc.format = e.target.value;
  const f = FORMATS[doc.format];
  const sy = f.h / doc.h;
  doc.h = f.h; doc.w = f.w;
  doc.layers.forEach((l) => { l.y *= sy; });
  resetRenderer();
  fitCanvas();
};
$("#duration").onchange = (e) => { doc.dur = +e.target.value; };

$("#export").onclick = async () => {
  const btn = $("#export"), status = $("#exportStatus");
  btn.disabled = true;
  status.hidden = false;
  const sel = selected; selected = null; // no selection box in the file!
  try {
    status.textContent = "rendering… 0%";
    const blob = await exportMP4(doc, (p) => {
      status.textContent = "rendering… " + Math.round(p * 100) + "%";
    });
    downloadBlob(blob, "smw-post-" + doc.format.replace(":", "x") + ".mp4");
    status.textContent = "done — check downloads";
    setTimeout(() => (status.hidden = true), 4000);
  } catch (err) {
    console.error(err);
    status.textContent = "export failed: " + err.message;
  }
  selected = sel;
  btn.disabled = false;
};

$("#exportPng").onclick = () => {
  const c = document.createElement("canvas");
  c.width = doc.w; c.height = doc.h;
  const r = new Renderer(doc);
  r.tick(1 / 30);
  r.draw(c.getContext("2d"));
  c.toBlob((b) => downloadBlob(b, "smw-post.png"), "image/png");
};

/* ---------------- layouts ---------------- */
function refreshAll() {
  selected = null;
  resetRenderer();
  fitCanvas();
  $("#format").value = doc.format;
  $("#duration").value = String(doc.dur);
  buildBgPanel();
  buildLayerList();
  buildProps();
  renderSelected(() => doc, () => {});
}

function buildLayoutButtons() {
  const box = $("#layouts");
  box.innerHTML = "";
  PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.className = "chip" + (p.name === currentPreset ? " active" : "");
    b.textContent = p.name;
    b.onclick = () => {
      currentPreset = p.name;
      /* switch to this layout's working doc — or start it fresh */
      if (presetDocs.has(p.name)) {
        doc = presetDocs.get(p.name);
      } else {
        doc = defaultDoc();
        p.build(doc);
        presetDocs.set(p.name, doc);
      }
      buildLayoutButtons();
      refreshAll();
    };
    box.appendChild(b);
  });
  const reset = document.createElement("button");
  reset.className = "chip";
  reset.textContent = "reset layout ↺";
  reset.onclick = () => {
    const p = PRESETS.find((x) => x.name === currentPreset);
    if (!p) return;
    p.build(doc); // keeps format, length and music; rebuilds bg + layers
    refreshAll();
  };
  box.appendChild(reset);
}

/* ---------------- small field helpers ---------------- */
function field(label, ...els) {
  const d = document.createElement("div");
  d.className = "field";
  if (label) {
    const l = document.createElement("span");
    l.className = "lab";
    l.textContent = label;
    d.appendChild(l);
  }
  els.forEach((e) => d.appendChild(e));
  return d;
}
function colorField(label, obj, key, onchange) {
  const wrap = document.createElement("div");
  wrap.className = "swatches";
  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = obj[key];
  inp.oninput = () => { obj[key] = inp.value; onchange?.(); };
  SWATCHES.forEach((c) => {
    const s = document.createElement("button");
    s.className = "swatch" + (obj[key] === c ? " sel" : "");
    s.style.background = c;
    s.onclick = () => {
      obj[key] = c; inp.value = c;
      wrap.querySelectorAll(".swatch").forEach((x) => x.classList.remove("sel"));
      s.classList.add("sel");
      onchange?.();
    };
    wrap.appendChild(s);
  });
  wrap.appendChild(inp);
  return field(label, wrap);
}
function rangeField(label, obj, key, min, max, step, onchange) {
  const inp = document.createElement("input");
  inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = obj[key];
  inp.oninput = () => { obj[key] = +inp.value; onchange?.(); };
  return field(label, inp);
}
function selectField(label, obj, key, options, onchange) {
  const sel = document.createElement("select");
  options.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (String(obj[key]) === String(v)) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { obj[key] = isNaN(+sel.value) || sel.value === "" ? sel.value : (typeof obj[key] === "number" ? +sel.value : sel.value); onchange?.(); };
  return field(label, sel);
}
function checkField(label, obj, key, onchange) {
  const l = document.createElement("label");
  l.className = "chip";
  const c = document.createElement("input");
  c.type = "checkbox"; c.checked = !!obj[key];
  c.onchange = () => { obj[key] = c.checked; onchange?.(); };
  l.appendChild(c);
  l.appendChild(document.createTextNode(" " + label));
  return l;
}
function textInputField(label, obj, key, onchange) {
  const inp = document.createElement("input");
  inp.type = "text"; inp.className = "chip"; inp.value = obj[key];
  inp.oninput = () => { obj[key] = inp.value; onchange?.(); };
  return field(label, inp);
}

/* ---------------- background panel ---------------- */
function buildBgPanel() {
  const box = $("#bgPanel");
  box.innerHTML = "";
  const bg = doc.bg;

  box.appendChild(selectField("type", bg, "type",
    Object.entries(BG_LABELS), () => { resetRenderer(); buildBgPanel(); }));

  if (bg.type === "typewall") {
    box.appendChild(textInputField("word", bg, "word"));
    box.appendChild(selectField("font", bg, "font", FONTS.map((f) => [f.name, f.name])));
    bg.bgColor = bg.bgColor || "#f2ede3";
    box.appendChild(colorField("paper", bg, "bgColor"));
    box.appendChild(colorField("word colour A", bg, "color1"));
    box.appendChild(colorField("word colour B", bg, "color2"));
    const mirrorWrap = document.createElement("div");
    mirrorWrap.className = "row";
    if (bg.mirrorRows === undefined) bg.mirrorRows = true;
    mirrorWrap.appendChild(checkField("mirror alternate rows", bg, "mirrorRows", resetRenderer));
    box.appendChild(mirrorWrap);
  } else if (bg.type === "glitch") {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "the site engine: photo strips on a grid, stepping sideways, snapping, swapping.";
    box.appendChild(hint);
    box.appendChild(colorField("base colour", bg, "color1"));
    const row = document.createElement("div");
    row.className = "row";
    const addBtn = document.createElement("button");
    addBtn.className = "chip";
    addBtn.textContent = "choose photos (" + (bg.images?.length || 0) + ")";
    addBtn.onclick = () => openPicker("image", true, (ids) => {
      bg.images = ids;
      resetRenderer();
      buildBgPanel();
    }, bg.images);
    row.appendChild(addBtn);
    box.appendChild(row);
  } else if (bg.type === "rain") {
    box.appendChild(colorField("sky colour", bg, "color1"));
    if (bg.rainSpeed === undefined) bg.rainSpeed = 1;
    box.appendChild(rangeField("rain speed", bg, "rainSpeed", 0.2, 4, 0.1));
  } else {
    box.appendChild(colorField("colour 1", bg, "color1"));
    if (bg.type !== "solid") box.appendChild(colorField("colour 2", bg, "color2"));
    if (bg.type === "checker") box.appendChild(colorField("colour 2", bg, "color2"));
  }
  const row2 = document.createElement("div");
  row2.className = "row";
  row2.appendChild(checkField("grain", bg, "grain"));
  const re = document.createElement("button");
  re.className = "chip";
  re.textContent = "reroll ✦";
  re.onclick = () => { doc.seed = Math.floor(Math.random() * 99999); resetRenderer(); };
  row2.appendChild(re);
  box.appendChild(row2);
}

/* ---------------- layer list ---------------- */
function buildLayerList() {
  const box = $("#layerList");
  box.innerHTML = "";
  [...doc.layers].reverse().forEach((l) => {
    const item = document.createElement("div");
    item.className = "layer-item" + (l === selected ? " sel" : "");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = l.type === "text" ? "T " + l.text.split("\n")[0].slice(0, 22)
      : l.asset ? l.type + " · " + l.asset : l.type;
    name.onclick = () => { selected = l; buildLayerList(); buildProps(); };
    item.appendChild(name);
    const mk = (t, fn) => {
      const b = document.createElement("button");
      b.textContent = t; b.onclick = fn;
      item.appendChild(b);
    };
    const i = doc.layers.indexOf(l);
    mk("↑", () => { if (i < doc.layers.length - 1) { doc.layers.splice(i, 1); doc.layers.splice(i + 1, 0, l); buildLayerList(); } });
    mk("↓", () => { if (i > 0) { doc.layers.splice(i, 1); doc.layers.splice(i - 1, 0, l); buildLayerList(); } });
    mk("⧉", () => {
      const copy = JSON.parse(JSON.stringify(l));
      copy.id = l.id + "c" + Math.floor(Math.random() * 999);
      copy.x += 40; copy.y += 40;
      doc.layers.push(copy);
      selected = copy;
      buildLayerList(); buildProps();
    });
    mk("×", () => {
      doc.layers.splice(i, 1);
      if (selected === l) { selected = null; buildProps(); }
      buildLayerList();
    });
    box.appendChild(item);
  });
}

$("#addText").onclick = () => {
  const l = textLayer({ x: doc.w * 0.1, y: doc.h * 0.45, text: "new words" });
  doc.layers.push(l);
  selected = l;
  buildLayerList(); buildProps();
};
$("#addImage").onclick = () => openPicker("image", false, (id) => {
  const l = imageLayer({ asset: id, x: doc.w / 2, y: doc.h / 2, w: doc.w * 0.7, h: doc.w * 0.55 });
  doc.layers.push(l);
  selected = l;
  buildLayerList(); buildProps();
});
$("#addBlob").onclick = () => {
  const l = blobLayer({ x: doc.w / 2, y: doc.h / 2, w: doc.w * 0.6, h: doc.w * 0.6 });
  doc.layers.push(l);
  selected = l;
  buildLayerList(); buildProps();
};
$("#addSticker").onclick = () => openPicker("sticker", false, (id) => {
  const l = stickerLayer({ asset: id, x: doc.w / 2, y: doc.h / 2 });
  doc.layers.push(l);
  selected = l;
  buildLayerList(); buildProps();
});

/* ---------------- effect stack (image + blob layers) ---------------- */
const FX_OPTIONS = [
  ["strips", "glitch strips (site style)"], ["smear", "pixel smear"],
  ["duotone", "duotone"], ["threshold", "threshold"], ["halftone", "halftone"],
  ["dither", "screenprint dither"], ["rgb", "rgb split"],
];
function effectStack(box, l) {
  if (!l.effects) l.effects = [];
  const invalidate = () => { renderer.rt.delete(l.id); buildProps(); };
  if (l.effects.length) {
    const row = document.createElement("div");
    row.className = "row";
    l.effects.forEach((e, i) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = e + " ×";
      b.title = "remove " + e;
      b.onclick = () => { l.effects.splice(i, 1); invalidate(); };
      row.appendChild(b);
    });
    box.appendChild(field("effects (click to remove)", row));
  }
  const sel = document.createElement("select");
  const first = document.createElement("option");
  first.value = ""; first.textContent = "+ add effect";
  sel.appendChild(first);
  FX_OPTIONS.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  });
  sel.onchange = () => { if (sel.value) { l.effects.push(sel.value); invalidate(); } };
  box.appendChild(field(l.effects.length ? "" : "effects", sel));
  if (l.effects.some((e) => ["duotone", "threshold", "halftone", "dither"].includes(e))) {
    box.appendChild(colorField("dark / ink", l, "colorA"));
    box.appendChild(colorField("light / paper", l, "colorB"));
  }
  if (l.effects.some((e) => ["strips", "rgb", "smear"].includes(e))) {
    box.appendChild(checkField("animate", l, "animate"));
  }
}

/* ---------------- properties ---------------- */
function buildProps() {
  const box = $("#props");
  box.innerHTML = "";
  if (!selected) {
    box.innerHTML = '<div class="hint">nothing selected — click the canvas</div>';
    return;
  }
  const l = selected;
  if (l.type === "text") {
    const ta = document.createElement("textarea");
    ta.value = l.text;
    ta.oninput = () => { l.text = ta.value; };
    ta.onchange = () => buildLayerList();
    box.appendChild(field("words", ta));
    box.appendChild(selectField("font", l, "font", FONTS.map((f) => [f.name, f.name])));
    box.appendChild(selectField("weight", l, "weight", [[400, "regular"], [700, "bold"]]));
    box.appendChild(rangeField("size", l, "size", 18, 460, 1));
    box.appendChild(rangeField("line height", l, "lineHeight", 0.8, 2, 0.05));
    box.appendChild(rangeField("tracking", l, "tracking", -20, 60, 1));
    box.appendChild(selectField("align", l, "align", [["left", "left"], ["center", "center"], ["right", "right"]]));
    box.appendChild(rangeField("rotate", l, "rot", -45, 45, 0.5));
    box.appendChild(colorField("text colour", l, "color"));
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(checkField("chip", l, "chip"));
    row.appendChild(checkField("hollow", l, "hollow"));
    row.appendChild(checkField("mutant glyphs", l, "mutate"));
    row.appendChild(checkField("mirror", l, "mirror"));
    row.appendChild(checkField("glow", l, "glow"));
    box.appendChild(row);
    if (l.chip) box.appendChild(colorField("chip colour", l, "chipColor", buildProps));
    box.appendChild(selectField("warp", l, "warp",
      [["none", "none"], ["arc", "arc"], ["wave", "wave (animated)"], ["persp", "perspective"]]));
    box.appendChild(rangeField("warp amount", l, "warpAmt", -100, 100, 1));
    box.appendChild(selectField("animation", l, "anim",
      [["none", "none"], ["scramble", "scramble (site style)"], ["jitter", "jitter"]]));
  } else if (l.type === "image") {
    const pick = document.createElement("button");
    pick.className = "chip";
    pick.textContent = "swap image";
    pick.onclick = () => openPicker("image", false, (id) => { l.asset = id; renderer.rt.delete(l.id); buildLayerList(); });
    box.appendChild(field("", pick));
    effectStack(box, l);
    box.appendChild(rangeField("width", l, "w", 80, doc.w * 1.4, 2));
    box.appendChild(rangeField("height", l, "h", 80, doc.h * 1.4, 2));
    box.appendChild(rangeField("rotate", l, "rot", -45, 45, 0.5));
    const full = document.createElement("button");
    full.className = "chip";
    full.textContent = "full bleed";
    full.onclick = () => { l.x = doc.w / 2; l.y = doc.h / 2; l.w = doc.w; l.h = doc.h; l.rot = 0; buildProps(); };
    box.appendChild(field("", full));
  } else if (l.type === "blob") {
    const row0 = document.createElement("div");
    row0.className = "row";
    const pick = document.createElement("button");
    pick.className = "chip";
    pick.textContent = l.asset ? "swap image" : "put image inside";
    pick.onclick = () => openPicker("image", false, (id) => {
      l.asset = id; renderer.rt.delete(l.id); buildProps(); buildLayerList();
    });
    row0.appendChild(pick);
    if (l.asset) {
      const rm = document.createElement("button");
      rm.className = "chip";
      rm.textContent = "remove image";
      rm.onclick = () => { l.asset = null; renderer.rt.delete(l.id); buildProps(); buildLayerList(); };
      row0.appendChild(rm);
    }
    box.appendChild(field("", row0));
    if (l.asset) effectStack(box, l);
    else box.appendChild(colorField("colour", l, "color"));
    box.appendChild(rangeField("width", l, "w", 80, doc.w * 1.4, 2));
    box.appendChild(rangeField("height", l, "h", 80, doc.h * 1.4, 2));
    box.appendChild(rangeField("rotate", l, "rot", -180, 180, 1));
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(checkField("morph", l, "morph"));
    const re = document.createElement("button");
    re.className = "chip";
    re.textContent = "new shape ✦";
    re.onclick = () => { l.shapeSeed = Math.floor(Math.random() * 9999); };
    row.appendChild(re);
    box.appendChild(row);
  } else if (l.type === "sticker") {
    const pick = document.createElement("button");
    pick.className = "chip";
    pick.textContent = "swap sticker";
    pick.onclick = () => openPicker("sticker", false, (id) => { l.asset = id; buildLayerList(); });
    box.appendChild(field("", pick));
    box.appendChild(rangeField("size", l, "w", 40, doc.w, 2));
    box.appendChild(rangeField("rotate", l, "rot", -180, 180, 1));
    box.appendChild(rangeField("spin (deg/s)", l, "spin", -180, 180, 1));
  }
}

/* ---------------- asset picker ---------------- */
function openPicker(kind, multi, cb, preselected = []) {
  const modal = $("#picker"), grid = $("#pickerGrid");
  $("#pickerTitle").textContent = multi ? "Pick photos (click to toggle, then done)" : kind === "sticker" ? "Pick a sticker" : "Pick an image";
  modal.hidden = false;
  grid.innerHTML = "";
  const chosen = new Set(preselected);
  const ids = kind === "sticker" ? STICKERS : [...POOL, ...Assets.uploads()];
  const done = () => { modal.hidden = true; };

  ids.forEach((id) => {
    const rec = Assets.get(id);
    if (!rec) return;
    const img = document.createElement("img");
    img.src = rec.img.src;
    img.title = rec.name;
    if (kind === "sticker") img.className = "stick";
    if (chosen.has(id)) img.style.outline = "3px solid " + BLUE;
    img.onclick = () => {
      if (!multi) { done(); cb(id); return; }
      if (chosen.has(id)) { chosen.delete(id); img.style.outline = ""; }
      else { chosen.add(id); img.style.outline = "3px solid " + BLUE; }
    };
    grid.appendChild(img);
  });

  if (multi) {
    const ok = document.createElement("button");
    ok.className = "chip b";
    ok.textContent = "done";
    ok.onclick = () => { done(); cb([...chosen]); };
    grid.appendChild(ok);
  }

  $("#pickerClose").onclick = done;
  $("#pickerUpload").onchange = async (e) => {
    for (const f of e.target.files) await Assets.addUpload(f);
    openPicker(kind, multi, cb, [...chosen]); // rebuild grid with new uploads
  };
}

/* ---------------- canvas interaction ---------------- */
function canvasPoint(e) {
  const r = preview.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * doc.w,
    y: ((e.clientY - r.top) / r.height) * doc.h,
  };
}
let drag = null;

overlay.style.pointerEvents = "none";
preview.addEventListener("pointerdown", (e) => {
  const p = canvasPoint(e);
  selected = null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const b = renderer.bboxOf(doc.layers[i]);
    if (b && p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) {
      selected = doc.layers[i];
      drag = { layer: selected, sx: p.x, sy: p.y, ox: selected.x, oy: selected.y };
      break;
    }
  }
  buildLayerList(); buildProps();
  preview.setPointerCapture(e.pointerId);
});
/* snapping: bbox center → canvas center lines, bbox edges → canvas
   edges (strong, with guides); otherwise a quiet position grid.
   Hold alt to drag free. */
const SNAP = 14, GRID = 20;
let snapGuides = null;

preview.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = canvasPoint(e);
  let nx = drag.ox + (p.x - drag.sx);
  let ny = drag.oy + (p.y - drag.sy);
  snapGuides = { v: [], h: [] };
  const b = renderer.bboxOf(drag.layer);
  if (b && !e.altKey) {
    const edx = b.x - drag.layer.x, edy = b.y - drag.layer.y; // bbox offset from anchor
    const vT = [
      [doc.w / 2 - edx - b.w / 2, doc.w / 2],
      [-edx, 0],
      [doc.w - edx - b.w, doc.w],
    ];
    const hT = [
      [doc.h / 2 - edy - b.h / 2, doc.h / 2],
      [-edy, 0],
      [doc.h - edy - b.h, doc.h],
    ];
    let sv = false, sh = false;
    for (const [tx, line] of vT) if (Math.abs(nx - tx) < SNAP) { nx = tx; snapGuides.v.push(line); sv = true; break; }
    for (const [ty, line] of hT) if (Math.abs(ny - ty) < SNAP) { ny = ty; snapGuides.h.push(line); sh = true; break; }
    if (!sv) nx = Math.round(nx / GRID) * GRID;
    if (!sh) ny = Math.round(ny / GRID) * GRID;
  }
  drag.layer.x = nx;
  drag.layer.y = ny;
});
preview.addEventListener("pointerup", () => { drag = null; snapGuides = null; });

preview.addEventListener("wheel", (e) => {
  if (!selected) return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.04 : 0.96;
  if (selected.type === "text") selected.size = Math.max(10, Math.min(600, selected.size * k));
  else if (selected.type === "image" || selected.type === "blob") { selected.w *= k; selected.h *= k; }
  else selected.w *= k;
}, { passive: false });

addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (!selected) return;
  const nudge = e.shiftKey ? 20 : 4;
  if (e.key === "Backspace" || e.key === "Delete") {
    doc.layers.splice(doc.layers.indexOf(selected), 1);
    selected = null;
    buildLayerList(); buildProps();
  }
  if (e.key === "ArrowLeft") selected && (selected.x -= nudge);
  if (e.key === "ArrowRight") selected && (selected.x += nudge);
  if (e.key === "ArrowUp") selected && (selected.y -= nudge);
  if (e.key === "ArrowDown") selected && (selected.y += nudge);
});
