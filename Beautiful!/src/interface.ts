import { chapters } from "./content";
import { ORBIT_NAVIGATION_WORLDS } from "./orbitNavigation";

export function renderInterface(root: HTMLElement): void {
  const spatialTitleChapters = new Set(["build", "test", "protect", "finale"]);
  const chapterMarkup = chapters
    .map(
      (chapter) => `
        <section
          id="chapter-${chapter.id}"
          class="chapter chapter--${chapter.align}${spatialTitleChapters.has(chapter.id) ? " chapter--spatial" : ""}"
          data-chapter="${chapter.id}"
          aria-label="${chapter.navLabel} chapter"
        >
          <div class="chapter__meta">
            <span>${chapter.index}</span>
            <span>${chapter.navLabel}</span>
          </div>
          <h2 class="chapter__title">${chapter.title.replace("\n", "<br />")}</h2>
          ${chapter.id === "finale" ? "" : `<p class="chapter__statement">${chapter.statement}</p>`}
          ${
            chapter.id === "finale"
              ? `<div class="finale__lockup" data-finale-lockup>
                   <div class="finale__brand-lockup">
                     <span class="finale__brand-e" aria-hidden="true">e</span>
                     <span class="finale__brand-copy">
                       <strong>Gain Technologies Ltd.</strong>
                       <small>SYSTEM READY · THE NEXT BUILD STARTS HERE</small>
                     </span>
                   </div>
                   <div class="finale__actions">
                     <button class="finale__project" type="button" data-open-project>
                       <span>ENTER PROJECT ORBIT</span>
                       <ph-arrow-up-right size="1rem" weight="regular" aria-hidden="true"></ph-arrow-up-right>
                     </button>
                     <button class="finale__replay" type="button" data-replay>
                       <span>REPLAY EXPERIENCE</span>
                       <ph-arrow-counter-clockwise size="1rem" weight="regular" aria-hidden="true"></ph-arrow-counter-clockwise>
                     </button>
                   </div>
                 </div>`
              : ""
          }
        </section>
      `,
    )
    .join("");

  const railMarkup = chapters
    .map(
      (chapter) => `
        <button
          class="chapter-rail__item"
          type="button"
          data-jump="${chapter.id}"
          aria-label="Jump to ${chapter.navLabel}"
          aria-controls="chapter-${chapter.id}"
        >
          <span class="chapter-rail__index">${chapter.index}</span>
          <span class="chapter-rail__label">${chapter.navLabel}</span>
          <span class="chapter-rail__tick" aria-hidden="true"></span>
        </button>
      `,
    )
    .join("");

  const orbitPlanetLabels = ORBIT_NAVIGATION_WORLDS.map((world) => `
    <button
      class="orbit-planet-label orbit-planet-label--${world.id}"
      type="button"
      data-orbit-planet="${world.id}"
      aria-label="Explore ${world.label}: ${world.destination.label}, ${world.subtitle}"
      aria-pressed="false"
    >
      <span class="orbit-planet-label__leader" aria-hidden="true"></span>
      <span class="orbit-planet-label__index">${world.index} / NAVIGATION</span>
      <strong>${world.label}</strong>
      <small>${world.subtitle}</small>
    </button>
  `).join("");

  root.innerHTML = `
    <a class="skip-link" href="#experience-end">Skip the cinematic experience</a>
    <div class="experience" data-experience data-ready="false" data-ui="light">
      <canvas class="experience__canvas" data-webgl aria-hidden="true"></canvas>

      <div class="fallback-film" data-fallback aria-hidden="true">
        <img
          src="/assets/renders/egain-boot-poster.webp"
          alt=""
          decoding="async"
        />
      </div>

      <header class="chrome chrome--top" data-lock-while-loading inert aria-hidden="true">
        <a class="brand" href="#boot" data-jump="boot" aria-label="e Gain Technologies Ltd. — restart experience">
          <span class="brand__e">e</span>
          <span>Gain Technologies Ltd.</span>
        </a>

        <div class="chrome__actions">
          <button class="sound-control" type="button" data-sound aria-pressed="false" aria-label="Turn music on">
            <span class="sound-control__icon" data-sound-icon aria-hidden="true">
              <ph-speaker-slash size="1rem" weight="regular"></ph-speaker-slash>
            </span>
            <span data-sound-label>MUSIC OFF</span>
          </button>
          <a
            class="admin-control"
            href="/admin/"
            aria-label="Open Mission Control administration"
          >
            <span class="admin-control__signal" aria-hidden="true"></span>
            <span data-admin-label>MISSION CONTROL</span>
            <ph-lock-key size="1rem" weight="regular" aria-hidden="true"></ph-lock-key>
          </a>
          <button class="project-control" type="button" data-open-project aria-label="Initiate project — enter Project Orbit">
            <span>INITIATE PROJECT</span>
            <ph-arrow-up-right size="1rem" weight="regular" aria-hidden="true"></ph-arrow-up-right>
          </button>
        </div>
      </header>

      <aside class="chapter-rail" aria-label="Experience chapters" data-lock-while-loading inert aria-hidden="true">
        ${railMarkup}
      </aside>

      <div class="chapters" data-lock-while-loading inert aria-hidden="true">
        ${chapterMarkup}
      </div>

      <span class="sr-only" data-chapter-announcer aria-live="polite"></span>

      <div class="system-status" aria-hidden="true">
        <span class="system-status__pulse"></span>
        <span data-system-status>INITIALISING ENVIRONMENT</span>
      </div>

      <div class="scroll-cue" data-scroll-cue aria-hidden="true">
        <span data-scroll-cue-label>CLICK / TAP FOR SOUND · SCROLL TO ENTER</span>
        <span class="scroll-cue__line"></span>
      </div>

      <section class="orbit-selector" data-orbit-selector hidden aria-label="Interactive Project Orbit" aria-hidden="true">
        <div class="orbit-selector__shade" aria-hidden="true"></div>
        <header class="orbit-selector__chrome">
          <button class="orbit-selector__exit" type="button" data-exit-orbit>EXIT ORBIT</button>
          <div class="orbit-selector__telemetry" aria-hidden="true">
            <span>PROJECT ORBIT / LIVE SYSTEM</span>
            <strong>11 WORLDS</strong>
          </div>
          <button class="orbit-selector__start" type="button" data-open-mission-deck>
            <span>SCHEDULE A DEMO</span><ph-arrow-up-right size="1rem" weight="regular" aria-hidden="true"></ph-arrow-up-right>
          </button>
        </header>

        <div class="orbit-selector__overview" data-orbit-overview-copy>
          <span>INTERACTIVE SYSTEM / CLICK TO FOCUS</span>
          <h2>SELECT<br />A WORLD.</h2>
          <p>Eleven navigation worlds rest on one mission core. Choose a planet to inspect its work, systems, knowledge and ways of connecting.</p>
        </div>

        <div class="orbit-label-layer" data-orbit-label-layer aria-label="Project Orbit destinations">
          ${orbitPlanetLabels}
        </div>

        <article class="orbit-dossier" data-orbit-dossier hidden aria-live="polite">
          <div class="orbit-dossier__rail" aria-hidden="true"><i></i><i></i><i></i></div>
          <header class="orbit-dossier__header">
            <div>
              <span data-orbit-dossier-index>00 / SYSTEM</span>
              <small data-orbit-dossier-service>PROJECT ORBIT</small>
            </div>
            <button type="button" data-orbit-system-view aria-label="Return to Project Orbit system view">SYSTEM VIEW <span aria-hidden="true">↙</span></button>
          </header>
          <div class="orbit-dossier__body">
            <p class="orbit-dossier__eyebrow" data-orbit-dossier-eyebrow>ENGINEERED DESTINATION</p>
            <h2 data-orbit-dossier-title>SELECT A WORLD</h2>
            <p class="orbit-dossier__summary" data-orbit-dossier-summary></p>
            <div class="orbit-dossier__sequence" data-orbit-dossier-sequence hidden></div>
            <div class="orbit-dossier__items" data-orbit-dossier-items></div>
            <p class="orbit-dossier__note" data-orbit-dossier-note hidden></p>
          </div>
          <footer class="orbit-dossier__footer">
            <button class="orbit-dossier__read" type="button" data-orbit-dossier-read hidden>
              <span>READ FULL PAGE</span>
              <ph-arrow-up-right size="1rem" weight="regular" aria-hidden="true"></ph-arrow-up-right>
            </button>
            <button class="orbit-dossier__cta" type="button" data-orbit-dossier-cta>
              <span data-orbit-dossier-cta-label>ADD TO PROJECT BRIEF</span>
              <ph-arrow-up-right size="1rem" weight="regular" aria-hidden="true"></ph-arrow-up-right>
            </button>
          </footer>
        </article>

        <dialog class="orbit-reading-dialog" data-orbit-reading-dialog aria-labelledby="orbit-reading-title">
          <article class="orbit-reading-dialog__shell">
            <header class="orbit-reading-dialog__header">
              <div>
                <span data-orbit-reading-world>PROJECT ORBIT / READING ARCHIVE</span>
                <p data-orbit-reading-source>LOCAL AXSAI SOURCE SNAPSHOT</p>
              </div>
              <button type="button" data-orbit-reading-close aria-label="Close reading window">
                <span>CLOSE</span><span aria-hidden="true">×</span>
              </button>
            </header>
            <div class="orbit-reading-dialog__body" data-orbit-reading-body>
              <div class="orbit-reading-dialog__title-block">
                <span data-orbit-reading-index>00 / READING</span>
                <h2 id="orbit-reading-title" data-orbit-reading-title>READING ARCHIVE</h2>
              </div>
              <div class="orbit-reading-dialog__content" data-orbit-reading-content></div>
            </div>
          </article>
        </dialog>

        <div class="orbit-selector__cue" aria-hidden="true">
          <span>PLANET + LABEL / CLICK TO INSPECT</span><i></i>
        </div>
        <span class="sr-only" data-orbit-live aria-live="polite"></span>
      </section>

      <div class="orbit-calibration" data-orbit-calibration aria-live="polite" aria-hidden="true">
        <div class="orbit-calibration__core" aria-hidden="true"><span>e</span></div>
        <div class="orbit-calibration__copy">
          <span>CALIBRATING ORBITS</span>
          <strong data-orbit-calibration-count>0 / 8</strong>
        </div>
        <span class="orbit-calibration__track" aria-hidden="true"><i data-orbit-calibration-bar></i></span>
      </div>

      <div class="orbit-reveal" data-orbit-reveal aria-live="polite" aria-hidden="true">
        <span class="orbit-reveal__eyebrow">PROJECT ORBIT / SYSTEM REVEAL</span>
        <strong>ELEVEN WORLDS.<br />ONE MISSION CORE.</strong>
        <span class="orbit-reveal__sequence" aria-hidden="true">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </span>
      </div>

      <div class="loading" data-loading role="status" aria-live="polite">
        <img
          class="loading__poster"
          src="/assets/renders/egain-boot-poster.webp"
          alt=""
          decoding="async"
        />
        <div class="loading__shade"></div>
        <div class="loading__content">
          <p class="loading__brand">e Gain Technologies Ltd.</p>
          <div class="loading__readout">
            <span data-loading-stage>INITIALISING ENVIRONMENT</span>
            <strong data-loading-progress>00</strong>
          </div>
          <div class="loading__track" aria-hidden="true">
            <span data-loading-bar></span>
          </div>
        </div>
      </div>
    </div>

    <div class="journey" data-journey aria-hidden="true"></div>
    <div id="experience-end" class="experience-end" tabindex="-1">
      <span>e Gain Technologies Ltd.</span>
    </div>
  `;
}
