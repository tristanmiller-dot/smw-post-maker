# SMW Post Maker

A local poster machine for So Many Wheels Instagram posts. Animated backgrounds,
mutant type, glitchy imagery, music — exported as real MP4s (1080×1440 or 1080×1920).

## Run it

```
node server.js
```

then open **http://localhost:8787** in Chrome (or any Chromium browser — export
uses WebCodecs, so Safari/Firefox won't export).

The server is only there to serve files and proxy the music search — nothing is
uploaded anywhere.

## How it works

- **Layouts** are starting points, not templates — apply one, then move/resize/
  restyle everything.
- **Backgrounds**: photo glitch (the site engine, ported to canvas), type wall
  (drifting mirrored word rows), sticker rain (falling smiley physics), noise
  field (animated speckle), checker, gradient, solid — most with optional grain.
- **Layers**: text (chips, mutant glyphs, scramble/jitter animation, mirror,
  hollow, spray glow, arc/wave/perspective warp), images (glitch strips / pixel
  smear / duotone / threshold / halftone / screenprint dither / RGB split),
  stickers (with spin), morphing blob silhouettes.
- **Canvas**: drag to move, scroll to resize, arrow keys to nudge,
  backspace to delete.
- **Soundtrack**: search pulls 30s preview clips (iTunes Search API — no keys
  needed; Spotify/SoundCloud no longer allow this), or upload your own audio
  file. Audio loops + fades to fit the video length.
- **Export MP4** renders every frame offline at full resolution with WebCodecs —
  what you see looping in the preview is exactly what you get, plus AAC audio.

## Rights note

Preview clips are fine for mucking about; for public posts, mainstream music is
safest added via Instagram's own music picker (or use audio you have rights to).
