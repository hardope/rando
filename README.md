# rando

A drawer of impractical, delightful web experiments. Plain HTML/CSS/JS with no framework, served and bundled by [Vite](https://vite.dev). Each experiment is its own page.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` writes a static site to `dist/` (relative paths, so it can be hosted from any folder), and `npm run preview` serves that build.

Libraries (`three`, `matter-js`) come from npm. The 458 model, its HDR and the Draco decoder are kept in the repo (`experiments/real-car/assets/`, `public/draco/`), so nothing loads from a CDN at runtime except Google Fonts.

## Experiments

| # | name | what it is |
|---|------|-----------|
| 001 | [Lights Out](experiments/lights-out/) | The page is dark apart from a torch beam around your cursor. Scroll to focus it, shake the mouse to recharge it, and find the light switch. Something in the dark keeps watching you. |
| 002 | [GT-0, Exploded](experiments/exploded-car/) | A 3D car built entirely in code with Three.js. Scrolling takes it apart, dragging spins it, and you can repaint it. The open cockpit is detailed: bolstered seats, a glowing dash, a gear knob. Add `?s=2.5` to the URL to pin the timeline at a stage, or `#stage-3` to jump to a section. |
| 003 | [458 Showroom](experiments/real-car/) | A real Ferrari 458 glTF model (by vicent091036, via the three.js examples) under an HDR sunset. Scroll to drive it on a moving floor and lift the shell off it, then choose paint, wheel and glass colours. The model is about 1.7 MB. |
| 004 | [Fluid Cursor](experiments/fluid-cursor/) | A stable-fluids simulation in raw WebGL2 shaders. Move to stir, click to splash, space freezes the colour, `c` clears. A giant word on top inverts the ink. |
| 005 | [Page Gravity](experiments/page-gravity/) | A generic SaaS landing page. Press the button and every element turns into a matter.js body: throw them around, tilt gravity with the arrow keys, press space for zero-g, or put it all back. |

## Adding one

1. Create `experiments/<slug>/index.html` (copy the `← rando` back link from an existing experiment). Vite picks up every `experiments/*/index.html` automatically; load scripts with `<script type="module">` and import npm packages by name.
2. Add an entry to the `experiments` array in [`hub.js`](hub.js).
3. Optional: give it a card thumbnail. Either add a `.pv-<name>` CSS preview to `hub.css` (with a matching `previews` entry in `hub.js`), or set `shots: ['thumb.jpg', 'thumb-exploded.jpg']` to use rendered images from the experiment's folder. The second image fades in on hover. The two car pages render a clean frame for this with `?thumb&s=<stage>`, which hides all the UI.

## Inspect mode (both car pages)

Click any part to isolate it: everything else fades out, the camera orbits that part, and a panel describes it. Drag to orbit, use ← → to step through parts, and press Esc or click empty space to leave. Deep link with `?inspect=<key>`, e.g. `exploded-car/?s=2&inspect=engine` or `real-car/?inspect=cabin`. The logic is shared in [`experiments/shared/inspect.js`](experiments/shared/inspect.js).

## Idea pile

- **Gravity typing**: letters you type fall and pile up at the bottom of the page.
- **Infinite zoom**: keep scrolling into a picture that holds another picture, forever.
- **The button that runs away**: a button that dodges you, gets tired, and eventually gives up.
- **Sound garden**: click to plant notes that grow into looping melodies.
- **Scroll-driven flipbook**: an image sequence animated by scroll, Apple-product-page style.
