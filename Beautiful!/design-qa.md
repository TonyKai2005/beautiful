# e Gain current design QA

visual result: passed

release-device 55fps capture: pending on Apple M1 / Intel Iris Xe hardware

## Current directed experience

- The public site remains one reversible `950svh` seven-act Three.js film.
- Finale opens a separate 4.8-second automatic `PROJECT ORBIT` reveal.
- After reveal, Orbit is click-selectable; it has no mandatory second scroll tour and never opens the Mission Deck automatically.
- Seven planets revolve on the exact visible low-inclination horizontal tracks used to calculate their positions. Self-rotation remains independent.
- Planet and anchored label use one focus path. `SYSTEM VIEW`, empty background and `Esc` restore the saved orbital phase without a jump.
- A focused planet switches to its resident Ultra / `WEB_LOD0` asset; overview uses the lighter authored system LOD.
- The public Mission Deck has three steps: `VECTOR`, `ENVELOPE`, `TRANSMIT`.

## 18 July Orbit lighting regression

- Root cause 1: the DOM selector mounted after reveal with a full-frame black scrim, so the unchanged WebGL scene appeared to lose exposure. Overview now keeps the reveal photometry; focused shading is localised behind the dossier.
- Root cause 2: the performance governor called the corridor's post-Protect lighting grade after its first stable FPS window. This reduced Orbit environment intensity from `0.82` to the film's dark grade and changed exposure.
- Project Orbit now owns and reasserts its photometric grade while active: overview exposure `0.94`, overview environment intensity `0.82`, with a restrained close-up lift to `0.98 / 0.90`.
- Performance degradation may still reduce DPR, bloom, particles and realtime shadows, but cannot alter Orbit exposure, environment reflection, camera, tracks or planet assets.
- A ten-second post-reveal hold was checked after the governor reached performance level 5; scene brightness remained stable.

## Current browser evidence

| Viewport | Checked states | Result |
| --- | --- | --- |
| 1440x900 | automatic reveal, interactive overview, 10s stable hold, BUILD Ultra, PROTECT Ultra, direct planet switch | passed |
| 390x844 | interactive overview, horizontal label rail, BUILD Ultra, viewport overflow | passed |

- [1440x900 Orbit overview](qa/screenshots/orbit-desktop-overview-2026-07-18.jpg)
- [1440x900 BUILD Ultra](qa/screenshots/orbit-desktop-build-2026-07-18.jpg)
- [1440x900 PROTECT Ultra](qa/screenshots/orbit-desktop-protect-2026-07-18.jpg)
- [390x844 Orbit overview](qa/screenshots/orbit-mobile-overview-2026-07-18.jpg)
- [390x844 BUILD Ultra](qa/screenshots/orbit-mobile-build-2026-07-18.jpg)

Browser assertions:

- Correct page identity: `e Gain Technologies Ltd. — We engineer what's next.`
- Orbit assets: `ready`; Ultra planets resident: `7`.
- BUILD focus: `data-orbit-focused-lod=ultra`.
- PROTECT focus: `data-orbit-focused-lod=ultra`.
- Mobile document width: `390px`; horizontal page overflow: `false`.
- Browser console errors/warnings: none.

## Current Blender and asset gate

- Master export: 2,742 objects, 2,586 meshes, 143,728 base triangles, 16 materials and 46 actions.
- System Ultra: 1,909 meshes, 288,224 triangles, 15.35 MiB.
- System Balanced: 625 meshes, 104,784 triangles, 5.68 MiB.
- BUILD is an asymmetric foundry world with a shrinking forge tunnel, district-specific machinery and causal signal points.
- PROTECT is a continuous pressure-hull fortress with bastions, inset armour, vents, hinges, load ribs and a deep decagonal lock tunnel.
- TRANSFORM, TEST and DEPLOY have distinct conversion, metrology and release-channel structures rather than reskinned sphere/ring kits.
- Nine 4096x2560 Eevee Next / AgX hero and system frames are present.
- `node tools/validate_project_orbit.mjs`: `Blender asset approval: passed`.

## Engineering checks

- `npm run typecheck`: passed.
- `npm test`: passed, 8/8.
- `npm run build`: passed, 151 modules transformed.
- Vite reports two non-blocking chunk-size warnings above 500kB; they are not build failures.

## Performance note

The in-app automated browser is not used as the release FPS authority because capture and background scheduling produced variable readings while the visual state remained stable. The runtime governor and its telemetry remain enabled. A sustained foreground capture on the target Apple M1 / Intel Iris Xe class device is still required before claiming the release-device `>=55fps` benchmark.
