import './style.css';
import { World } from './sim/world';
import type { Organism } from './sim/types';
import { CanvasRenderer } from './render/renderer';
import { MetricsView } from './ui/metrics-view';
import { PlaybackPill, SettingsView } from './ui/controls';
import { InspectorView } from './ui/inspector';
import { HistoryView } from './ui/history-view';
import { BottomSheet } from './ui/sheet';
import { OrganismCard } from './ui/organism-card';
import { PeekView, groupsTableHTML, seasonSummary } from './ui/peek-view';
import { colourGroups } from './ui/groups';
import { givenName } from './ui/names';
import { LEGEND_HTML } from './ui/legend';
import { DEFAULT_CONFIG, FOOD_LAYOUTS, WORLD_SIZES } from './sim/config';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Could not find the #app element.');
}

const GEAR_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';

app.innerHTML = `
  <main class="app">
    <section class="stage" aria-label="World">
      <canvas id="sim-canvas" aria-label="The world. Tap an organism to follow it."></canvas>
      <div id="org-card" class="org-card" role="button" tabindex="0" aria-label="Selected organism: open details" hidden></div>
      <div class="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" class="round-btn" data-zoom="in" aria-label="Zoom in">+</button>
        <span id="zoom-level" class="zoom-level">1×</span>
        <button type="button" class="round-btn" data-zoom="out" aria-label="Zoom out">−</button>
      </div>
      <div id="playback" class="playback-pill" role="group" aria-label="Playback"></div>
    </section>

    <aside class="sheet" data-tab="stats" aria-label="Details">
      <div class="sheet-header">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-peek" role="button" tabindex="0" aria-expanded="false" aria-label="Show details">
          <div class="peek-row">
            <span class="peek-pop">0 alive</span>
            <span class="peek-season">Plenty</span>
            <button type="button" class="round-btn btn-settings" aria-label="Settings">${GEAR_ICON}</button>
          </div>
          <div class="group-strip" role="img" aria-label="Colour groups"></div>
        </div>
        <nav class="sheet-tabs" role="tablist">
          <button type="button" role="tab" data-tab="stats" class="active" aria-selected="true">Stats</button>
          <button type="button" role="tab" data-tab="trends" aria-selected="false">Trends</button>
          <button type="button" role="tab" data-tab="organism" aria-selected="false">Organism</button>
        </nav>
      </div>
      <div class="sheet-body">
        <section class="tab-panel" data-panel="stats">
          <p id="stats-status" class="sim-status"></p>
          <section id="metrics-container" class="metrics-section" aria-label="Simulation metrics"></section>
          <h3 class="panel-heading">Colour groups <small>by tag hue; not species</small></h3>
          <div id="groups-container"></div>
          ${LEGEND_HTML}
        </section>
        <section class="tab-panel" data-panel="trends" id="history-container" aria-label="Trends over time"></section>
        <section class="tab-panel" data-panel="organism" id="inspector-container"></section>
      </div>
    </aside>

    <div class="settings-overlay" hidden>
      <div class="settings-backdrop"></div>
      <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" class="round-btn settings-close" aria-label="Close settings">✕</button>
        </header>
        <div id="settings-container" class="settings-body"></div>
      </div>
    </div>
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#sim-canvas');
const stage = $('.stage');
const sheetEl = $('.sheet');

// 1. World and renderer
const initialSeed = 42;
const world = new World({ seed: initialSeed });
const renderer = new CanvasRenderer(canvas, world);

// 2. Views
const metricsView = new MetricsView($('#metrics-container'));
const groupsContainer = $('#groups-container');
const statsStatus = $('#stats-status');
const peekView = new PeekView($('.sheet-peek'));
let lastSelectedId: string | null = null;
let lastSelectedSnapshot: Organism | null = null;

const nameOf = (id: string): string | null => (world.getOrganism(id) ? givenName(id) : null);

const inspectorView = new InspectorView($('#inspector-container'), () => deselect());
const historyView = new HistoryView($('#history-container'), () => {
  const csv = world.history.toCSV();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `alife-seed-${world.config.seed}-tick-${world.tick}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

const card = new OrganismCard(
  $('#org-card'),
  () => sheet.show('organism'),
  () => deselect()
);

const sheet = new BottomSheet(sheetEl, () => {
  layout();
  refreshPanels();
});

// 3. Playback loop state
let isRunning = false;
let speedMultiplier = 1;
const BASE_TICKS_PER_SECOND = 6;
let lastTimestamp = performance.now();
let tickAccumulator = 0;

// Smooth movement for single steps while paused.
const STEP_ANIMATION_MS = 250;
let stepAnimationStart: number | null = null;

// The text panels are rebuilt from HTML, so while running they refresh at a
// modest rate; the canvas still redraws every frame.
const PANEL_REFRESH_MS = 200;
let lastPanelRefresh = 0;
let needsRender = true;

// Rolling window of recent tick timestamps, for the measured ticks/s readout.
const recentTickTimes: number[] = [];

function statusText(): string {
  const now = performance.now();
  while (recentTickTimes.length > 0 && now - recentTickTimes[0] > 1000) {
    recentTickTimes.shift();
  }
  let state: string;
  if (isRunning) {
    const target = BASE_TICKS_PER_SECOND * speedMultiplier;
    state = `Running ${speedMultiplier}× · ${recentTickTimes.length}/${target} ticks/s`;
  } else {
    state = world.tick === 0 ? 'Paused · press play or step' : 'Paused';
  }
  return `Tick ${world.tick} · ${state} · seed ${world.config.seed}`;
}

/** Selected organism, or its last snapshot if it has just died. */
function selectedForDisplay(): { org: Organism; alive: boolean } | null {
  const selected = world.getSelectedOrganism();
  if (selected) {
    lastSelectedSnapshot = selected;
    return { org: selected, alive: true };
  }
  if (lastSelectedId && lastSelectedSnapshot) return { org: lastSelectedSnapshot, alive: false };
  return null;
}

function refreshPanels(): void {
  const groups = colourGroups(world.organisms.values());
  const population = world.organisms.size;
  peekView.render(population, seasonSummary(world.tick, world.foodRegions, world.config), groups);
  pill.setTick(world.tick);
  const status = statusText();
  settingsView.setStatus(status);

  const shown = selectedForDisplay();
  if (shown) card.render(shown.org, renderer.hueOf(shown.org), world.config, nameOf, shown.alive);
  else card.hide();

  // Only the visible tab is rebuilt.
  if (sheet.isContentVisible()) {
    const tab = sheet.getTab();
    if (tab === 'stats') {
      if (statsStatus.textContent !== status) statsStatus.textContent = status;
      metricsView.render(world.getMetrics());
      groupsContainer.innerHTML = groupsTableHTML(groups, population);
    } else if (tab === 'trends') {
      historyView.render(world.history.getSamples());
    } else {
      inspectorView.render(
        shown ? (shown.alive ? shown.org : { ...shown.org, energy: 0 }) : undefined,
        world.config,
        nameOf
      );
    }
  }
  lastPanelRefresh = performance.now();
}

function stepSimulation(): void {
  renderer.rememberPositions();
  world.step();
  recentTickTimes.push(performance.now());
}

const pill = new PlaybackPill($('#playback'), {
  onPlayPause: () => {
    isRunning = !isRunning;
    pill.setRunning(isRunning);
    lastTimestamp = performance.now();
    tickAccumulator = 0;
    recentTickTimes.length = 0;
    refreshPanels();
    needsRender = true; // settle mid-glide positions when pausing
  },
  onStep: () => {
    stepSimulation();
    refreshPanels();
    stepAnimationStart = performance.now(); // the loop draws the glide
  },
  onSpeedChange: (speed) => {
    speedMultiplier = speed;
    recentTickTimes.length = 0;
    refreshPanels();
  },
});

const settingsView = new SettingsView(
  $('#settings-container'),
  initialSeed,
  {
    sharingEnabled: world.config.sharingEnabled,
    signalsEnabled: world.config.signalsEnabled,
    seasonsEnabled: world.config.seasonLength > 0,
    controller: world.config.controller,
    worldSize: 'large',
    foodLayout: 'shifting',
  },
  {
    onReset: (seed) => restart(seed),
    onWorldSizeChange: (size) => {
      Object.assign(world.config, WORLD_SIZES[size]);
      renderer.resize();
      restart(world.config.seed);
    },
    onFoodLayoutChange: (layout) => {
      Object.assign(world.config, FOOD_LAYOUTS[layout]);
      restart(world.config.seed);
    },
    onColorModeChange: (mode) => {
      renderer.setColorMode(mode);
      refreshPanels();
      needsRender = true;
    },
    onSharingChange: (enabled) => {
      // Takes effect from the next tick; use Reset to rerun a seed from the start.
      world.config.sharingEnabled = enabled;
    },
    onSignalsChange: (enabled) => {
      world.config.signalsEnabled = enabled;
    },
    onControllerChange: (controller) => {
      // Every organism carries both genomes, so this can switch mid-run.
      world.config.controller = controller;
      refreshPanels();
    },
    onSeasonsChange: (enabled) => {
      world.config.seasonLength = enabled ? DEFAULT_CONFIG.seasonLength : 0;
      refreshPanels();
      needsRender = true;
    },
    onNewSeed: () => {
      const newSeed = Math.floor(Math.random() * 900000 + 100000);
      settingsView.setSeed(newSeed);
      restart(newSeed);
    },
  }
);

/** Stops and restarts the world from tick 0 with the given seed. */
function restart(seed: string | number): void {
  isRunning = false;
  pill.setRunning(false);
  world.reset(seed);
  renderer.clearMotion();
  world.selectOrganism(null);
  lastSelectedId = null;
  lastSelectedSnapshot = null;
  recentTickTimes.length = 0;
  refreshPanels();
  needsRender = true;
}

function select(org: Organism): void {
  world.selectOrganism(org.id);
  lastSelectedId = org.id;
  lastSelectedSnapshot = org;
  if (renderer.getZoom() < 3) setZoom(3);
  renderer.follow();
  refreshPanels();
  needsRender = true;
}

function deselect(): void {
  world.selectOrganism(null);
  lastSelectedId = null;
  lastSelectedSnapshot = null;
  refreshPanels();
  needsRender = true;
}

// 4. Main animation & tick loop
function loop(timestamp: number): void {
  const elapsedMs = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  if (isRunning) {
    const targetTps = BASE_TICKS_PER_SECOND * speedMultiplier;
    const intervalMs = 1000 / targetTps;

    tickAccumulator += Math.min(elapsedMs, 250); // cap to avoid spiral on tab switch
    while (tickAccumulator >= intervalMs) {
      stepSimulation();
      tickAccumulator -= intervalMs;
    }

    // Draw every frame, part-way through the current tick, so moves glide.
    renderer.render(tickAccumulator / intervalMs);
    if (timestamp - lastPanelRefresh >= PANEL_REFRESH_MS) {
      refreshPanels();
    }
  } else if (stepAnimationStart !== null) {
    // A single Step glides over STEP_ANIMATION_MS.
    const progress = (timestamp - stepAnimationStart) / STEP_ANIMATION_MS;
    renderer.render(progress);
    if (progress >= 1) stepAnimationStart = null;
  } else if (needsRender || renderer.isAnimating()) {
    renderer.render();
  }
  needsRender = false;

  requestAnimationFrame(loop);
}

// 5. Taps, drags and zoom on the world.
// A tap picks the nearest organism within reach of a finger (cells can be
// only a few pixels wide); a tap on empty space deselects. A drag pans the
// view whenever the world is larger than the screen; the click that ends a
// drag is ignored.
const TAP_REACH_PX = 22;
function handleTap(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  let best: Organism | null = null;
  let bestDist = TAP_REACH_PX;
  for (const org of world.organisms.values()) {
    const p = renderer.screenPositionOf(org);
    const d = Math.hypot(p.x - (clientX - rect.left), p.y - (clientY - rect.top));
    if (d < bestDist) {
      best = org;
      bestDist = d;
    }
  }
  if (best) select(best);
  else if (lastSelectedId) deselect();
}

let dragFrom: { x: number; y: number } | null = null;
let dragged = false;
canvas.addEventListener('pointerdown', (e) => {
  dragged = false;
  if (!renderer.canPan()) return;
  dragFrom = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragFrom) return;
  const [dx, dy] = [e.clientX - dragFrom.x, e.clientY - dragFrom.y];
  if (!dragged && Math.hypot(dx, dy) < 8) return;
  dragged = true;
  renderer.panBy(dx, dy);
  dragFrom = { x: e.clientX, y: e.clientY };
  needsRender = true;
});
const endDrag = () => {
  dragFrom = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('click', (e) => {
  if (dragged) {
    dragged = false;
    return;
  }
  handleTap(e.clientX, e.clientY);
});

const ZOOM_LEVELS = [1, 2, 3, 4, 6];
const zoomLabel = $('#zoom-level');
function setZoom(zoom: number): void {
  renderer.setZoom(zoom);
  zoomLabel.textContent = `${zoom}×`;
  needsRender = true;
}
function stepZoom(direction: 1 | -1): void {
  const current = renderer.getZoom();
  const next =
    direction > 0
      ? (ZOOM_LEVELS.find((z) => z > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1])
      : ([...ZOOM_LEVELS].reverse().find((z) => z < current) ?? ZOOM_LEVELS[0]);
  setZoom(next);
}
document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
  btn.addEventListener('click', () => stepZoom(btn.dataset.zoom === 'in' ? 1 : -1));
});
// Mouse wheel zooms on desktop.
let lastWheel = 0;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.timeStamp - lastWheel < 180 || e.deltaY === 0) return;
    lastWheel = e.timeStamp;
    stepZoom(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);

// 6. Settings sheet
const settingsOverlay = $('.settings-overlay');
const settingsButton = $('.btn-settings');
function setSettingsOpen(open: boolean): void {
  settingsOverlay.hidden = !open;
  if (open) $('.settings-close').focus();
  else settingsButton.focus();
}
settingsButton.addEventListener('click', () => setSettingsOpen(true));
$('.settings-close').addEventListener('click', () => setSettingsOpen(false));
$('.settings-backdrop').addEventListener('click', () => setSettingsOpen(false));

// Keyboard: Escape closes, space plays/pauses, "." steps (desktop).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsOverlay.hidden) {
    setSettingsOpen(false);
    return;
  }
  const target = e.target as HTMLElement;
  if (target.closest('input, button, [role="button"], textarea, select') || !settingsOverlay.hidden) return;
  if (e.key === ' ') {
    e.preventDefault();
    $<HTMLButtonElement>('.pill-play').click();
  } else if (e.key === '.' && !isRunning) {
    $<HTMLButtonElement>('.pill-step').click();
  }
});

// 7. Layout: the renderer keeps the world clear of the overlays (the sheet's
// peek strip and the playback pill) at zoom 1. Recomputed on resize,
// rotation and when the sheet changes.
function layout(): void {
  const side = sheet.isSidePanel();
  const peek = side ? 0 : sheet.peekHeight();
  const safe = getComputedStyle(document.documentElement);
  const px = (name: string) => parseFloat(safe.getPropertyValue(name)) || 0;
  const safeTop = px('--safe-top');
  const safeBottom = side ? px('--safe-bottom') : 0;
  document.documentElement.style.setProperty('--peek-h', `${peek}px`);
  sheetEl.style.setProperty('--closed-offset', `${side ? 0 : sheetEl.offsetHeight - peek - px('--safe-bottom')}px`);
  const pillSpace = 56 + 12 + 10;
  renderer.setInsets({
    top: safeTop + 8,
    bottom: (side ? safeBottom : peek + px('--safe-bottom')) + pillSpace,
    left: px('--safe-left'),
    right: side ? 0 : px('--safe-right'),
  });
  needsRender = true;
}

new ResizeObserver(() => layout()).observe(stage);
window.addEventListener('orientationchange', () => layout());

layout();
refreshPanels();
renderer.render();
requestAnimationFrame(loop);
