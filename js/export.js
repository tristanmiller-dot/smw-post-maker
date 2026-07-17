/* ============================================================
   EXPORT — offline render to a real MP4 via WebCodecs.
   Frames are rendered deterministically at doc.fps (never a
   screen-recording), audio is muxed in as AAC (Opus fallback).
   ============================================================ */
import { Muxer, ArrayBufferTarget } from "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm";
import { Renderer } from "./render.js";

export async function exportMP4(doc, onProgress) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("This browser has no WebCodecs — use Chrome/Edge/Arc.");
  }
  const { w, h, fps, dur } = doc;
  const totalFrames = Math.round(dur * fps);

  /* ---- audio config ---- */
  const hasAudio = !!(doc.music && doc.music.buffer);
  let audioCodec = null;
  if (hasAudio && typeof AudioEncoder !== "undefined") {
    for (const c of [{ codec: "mp4a.40.2", mux: "aac" }, { codec: "opus", mux: "opus" }]) {
      const s = await AudioEncoder.isConfigSupported({
        codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000,
      }).catch(() => null);
      if (s && s.supported) { audioCodec = c; break; }
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: w, height: h, frameRate: fps },
    audio: audioCodec ? { codec: audioCodec.mux, sampleRate: 48000, numberOfChannels: 2 } : undefined,
    fastStart: "in-memory",
  });

  /* ---- video encoder ---- */
  let videoError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { videoError = e; },
  });
  videoEncoder.configure({
    codec: "avc1.640028",
    width: w, height: h,
    bitrate: 10_000_000,
    framerate: fps,
  });

  /* ---- render frames ---- */
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const renderer = new Renderer(doc);
  const dt = 1 / fps;

  for (let f = 0; f < totalFrames; f++) {
    if (videoError) throw videoError;
    renderer.tick(dt);
    renderer.draw(ctx);
    const frame = new VideoFrame(canvas, { timestamp: (f * 1e6) / fps, duration: 1e6 / fps });
    videoEncoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    /* let the encoder breathe + update UI */
    if (videoEncoder.encodeQueueSize > 6) {
      await new Promise((r) => setTimeout(r, 12));
    }
    if (f % 5 === 0) {
      onProgress?.(f / totalFrames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await videoEncoder.flush();

  /* ---- audio ---- */
  if (audioCodec) {
    const pcm = await renderAudio(doc, dur);
    let audioError = null;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { audioError = e; },
    });
    audioEncoder.configure({
      codec: audioCodec.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000,
    });
    const CHUNK = 48000; // 1s blocks
    const n = pcm.length / 2;
    for (let off = 0; off < n; off += CHUNK) {
      if (audioError) throw audioError;
      const frames = Math.min(CHUNK, n - off);
      const slice = new Float32Array(frames * 2);
      slice.set(pcm.subarray(off * 2, (off + frames) * 2));
      const data = new AudioData({
        format: "f32", sampleRate: 48000,
        numberOfFrames: frames, numberOfChannels: 2,
        timestamp: (off / 48000) * 1e6, data: slice,
      });
      audioEncoder.encode(data);
      data.close();
    }
    await audioEncoder.flush();
  }

  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

/* offline-mix the selected track (loop if shorter than the video),
   returns interleaved stereo f32 @48k */
async function renderAudio(doc, dur) {
  const m = doc.music;
  /* stop on a whole AAC block (1024 samples), two blocks shy of the
     video's end — encoder padding otherwise makes the audio track
     outlast the video, which players show as a black final frame */
  const samples = Math.max(1024, (Math.floor((48000 * dur) / 1024) - 2) * 1024);
  const aDur = samples / 48000;
  const octx = new OfflineAudioContext(2, samples, 48000);
  const src = octx.createBufferSource();
  src.buffer = m.buffer;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = m.buffer.duration;
  const gain = octx.createGain();
  gain.gain.value = m.volume ?? 1;
  /* gentle fade-out on the last half second so loops don't clip rudely */
  gain.gain.setValueAtTime(m.volume ?? 1, Math.max(0, aDur - 0.5));
  gain.gain.linearRampToValueAtTime(0, aDur);
  src.connect(gain).connect(octx.destination);
  src.start(0, Math.min(m.offset || 0, Math.max(0, m.buffer.duration - 0.1)));
  const buf = await octx.startRendering();
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const out = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { out[i * 2] = L[i]; out[i * 2 + 1] = R[i]; }
  return out;
}

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
