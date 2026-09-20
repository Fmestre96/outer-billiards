# Outer Billiards

Interactive visualizer for **outer billiards** (dual billiards) in two geometries,
rendered per-pixel on the GPU with WebGL2.

Live: http://outerbilliards.filipmeister.xyz/

## What it does

Given a convex polygon (the *table*), the outer billiard map sends a point `p`
outside it to the point reflection of `p` through the tangent vertex `v`:

- **Euclidean plane** — `T(p) = 2v - p`
- **Poincaré disk** — rotation by π about `v`:
  `T(z) = (2v - (1+|v|²)z) / ((1+|v|²) - 2 v̄ z)`

Every pixel is coloured by the fate of its orbit, so the partition of the plane
into cells of constant symbolic itinerary becomes visible.

Tangency and convexity tests are done in the **Klein model**, where geodesics are
straight chords — the same cross-product code then serves both geometries.

## Colourings

| Mode | Meaning |
| --- | --- |
| Itinerary (smooth) | the sequence of tangent vertices read as a base-`n` expansion |
| Itinerary (hashed cells) | one flat colour per distinct itinerary |
| Period of orbit | colour by the return time, dark if the orbit never returns |
| First tangent vertex | the fan partition around the table |
| Vertex at step k | the `k`-th symbol alone |
| Max orbit radius | how far the orbit wanders |
| Net displacement | distance between the first and last point |

## Controls

- Drag the white handles to deform the table; sliders set sides, circumradius, twist.
- Scroll to zoom, drag the background to pan.
- Click outside the table to trace a single orbit (period and symbols show in the HUD).
- Progressive rendering: each frame adds a jittered sample per pixel until the chosen
  samples/pixel target is reached, so sub-pixel cell structure resolves instead of aliasing.
- Singularity glow: highlights orbits that pass close to the singular set, where the tangent
  line contains a whole edge and the support vertex is ambiguous. This outlines every cell.
- Hue/saturation/brightness, PNG export.

## Running locally

No build step — it is plain HTML, CSS and ES5 JavaScript.

```sh
python -m http.server 8777
```

then open http://localhost:8777/.

## Layout

```
index.html        canvas stage + control panel
css/style.css
js/hyperbolic.js  geometry models, the outer billiard map, orbit tracing
js/shaders.js     WebGL2 shader that iterates the map per pixel
js/app.js         rendering, overlay, interaction, controls
```
