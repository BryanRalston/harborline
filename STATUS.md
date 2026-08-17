# Harborline

Photoreal-leaning waterfront city sim. Vite + Three.js r170, vanilla modules.

Live (phone + desktop): https://bryanralston.github.io/harborline/

Repo: https://github.com/BryanRalston/harborline

Phones and computers share the same build. Desktop keeps heavier lighting. Phones drop SSAO, use a 1.25 pixel-ratio cap, and get a bottom tool strip plus tap / long-press.

## Run

```bash
cd C:\Users\bryma\harborline
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Click **Begin.**

`public/assets` is a junction to `assets/`, so `/assets/...` is served by Vite.

## Play

- Left tools: road, park, housing, jobs, civic, pier
- LMB empty cell to build; LMB a building to inspect (camera eases over)
- RMB or Delete demolishes (50% refund; starter roads/piers refund $0)
- R rotates facing
- Sun slider + Auto; Pause; 1× / 2× / 3×
- Save / Load / New use `localStorage` key `harborline-save-v2` (also autosaves ~20s)

Starter treasury is $50,000. A first neighborhood works if you add houses + a shop + a park + a school along the existing avenues.

Ground is a continuous height mesh (not per-lot boxes). Roads and piers are merged ribbons with sidewalks and lane dashes. Pads exist only under buildings; parks sit on the field. Oak/pine magenta is keyed at runtime.

## What’s in

- 48×48 map, SW harbor, sand/concrete shoreline, starter piers + two avenues + cross street + promenade
- ACES, PCF soft shadows 2048, hemisphere + golden-hour sun, exp fog
- Scrolling water shader (real water photo + fresnel + sun spec)
- Facades tiled by height, separate roofs, night window emissive + cheap bloom after dark
- Missing textures log once and use a generated placeholder; present files in `assets/` are used
- Oak/pine PNGs still have magenta — keyed at runtime (`keyMagenta`)

## Left

- Optional: run `npm run process-props` if you install `sharp`, to bake keyed PNGs
- More waterfront props (boats, cranes) if art lands
- Bloom / exposure tuning at dusk
- Pathing / traffic is out of scope
