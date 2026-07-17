/* ============================================================
   MUSIC — track search (30s previews) + own-file upload.
   Search/decoding goes through the local server proxy, so it
   needs `node server.js` (playback alone would work anyway).
   ============================================================ */
const $ = (s) => document.querySelector(s);

let previewAudio = null;
let acx = null;

function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  document.querySelectorAll(".track .playing").forEach((b) => (b.textContent = "▶"));
}

export function setupMusic(getDoc, onChange) {
  const q = $("#musicQ"), results = $("#musicResults");

  async function search() {
    if (!q.value.trim()) return;
    results.innerHTML = '<div class="hint">searching…</div>';
    try {
      const r = await fetch("/api/music?q=" + encodeURIComponent(q.value));
      if (!r.ok) throw new Error("server said " + r.status);
      const list = await r.json();
      results.innerHTML = "";
      if (!list.length) results.innerHTML = '<div class="hint">nothing found</div>';
      list.forEach((t) => {
        const el = document.createElement("div");
        el.className = "track";
        el.innerHTML = `<img src="${t.art}" alt="">
          <div class="meta"><div class="t"></div><div class="a"></div></div>
          <button class="chip play">▶</button><button class="chip use">use</button>`;
        el.querySelector(".t").textContent = t.title;
        el.querySelector(".a").textContent = t.artist;
        el.querySelector(".play").onclick = (e) => {
          const b = e.target;
          if (previewAudio && b.classList.contains("playing")) return stopPreview();
          stopPreview();
          previewAudio = new Audio(t.preview);
          previewAudio.play();
          previewAudio.onended = stopPreview;
          b.textContent = "■"; b.classList.add("playing");
        };
        el.querySelector(".use").onclick = async (e) => {
          e.target.textContent = "…";
          try {
            const buf = await fetch("/api/preview?url=" + encodeURIComponent(t.preview)).then((r) => r.arrayBuffer());
            acx = acx || new AudioContext();
            const audio = await acx.decodeAudioData(buf);
            getDoc().music = { title: t.title, artist: t.artist, art: t.art, buffer: audio, offset: 0, volume: 1 };
            stopPreview();
            e.target.textContent = "✓";
            renderSelected(getDoc, onChange);
            onChange();
          } catch (err) {
            alert("Couldn't grab that preview: " + err.message);
            e.target.textContent = "use";
          }
        };
        results.appendChild(el);
      });
    } catch (err) {
      results.innerHTML = `<div class="hint">search failed — is the app running via <b>node server.js</b>? (${err.message})</div>`;
    }
  }

  $("#musicGo").onclick = search;
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });

  $("#musicFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    acx = acx || new AudioContext();
    const audio = await acx.decodeAudioData(await file.arrayBuffer());
    getDoc().music = { title: file.name, artist: "your file", art: "", buffer: audio, offset: 0, volume: 1 };
    renderSelected(getDoc, onChange);
    onChange();
  });

  renderSelected(getDoc, onChange);
}

export function renderSelected(getDoc, onChange) {
  const box = document.querySelector("#musicSelected");
  const m = getDoc().music;
  if (!m) { box.hidden = true; return; }
  box.hidden = false;
  const maxOff = Math.max(0, m.buffer.duration - 2);
  box.innerHTML = `
    <div class="t"></div><div class="a"></div>
    <div class="field"><span class="lab">start at ${(m.offset || 0).toFixed(1)}s of ${m.buffer.duration.toFixed(0)}s (loops if short)</span>
      <input type="range" id="mOff" min="0" max="${maxOff}" step="0.1" value="${m.offset || 0}"></div>
    <div class="field"><span class="lab">volume</span>
      <input type="range" id="mVol" min="0" max="1" step="0.05" value="${m.volume ?? 1}"></div>
    <button class="chip" id="mClear">remove track</button>`;
  box.querySelector(".t").textContent = m.title;
  box.querySelector(".a").textContent = m.artist;
  box.querySelector("#mOff").oninput = (e) => { m.offset = +e.target.value; renderSelected(getDoc, onChange); };
  box.querySelector("#mVol").oninput = (e) => { m.volume = +e.target.value; };
  box.querySelector("#mClear").onclick = () => { getDoc().music = null; renderSelected(getDoc, onChange); onChange(); };
}
