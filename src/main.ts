import './style.css';
import type { FoodPatch, Organism } from './sim/types';
import type { OrganismView } from './sim/protocol';
import { SimulationClient } from './ui/simulation-client';
import { CanvasRenderer } from './render/renderer';
import { MetricsView } from './ui/metrics-view';
import { PlaybackPill, SettingsView } from './ui/controls';
import { InspectorView } from './ui/inspector';
import { HistoryView } from './ui/history-view';
import { BottomSheet } from './ui/sheet';
import { OrganismCard } from './ui/organism-card';
import { PeekView, groupsTableHTML, seasonSummary } from './ui/peek-view';
import { colourGroups } from './sim/groups';
import { givenName } from './ui/names';
import { LEGEND_HTML } from './ui/legend';
import { eventListHTML, latestEventHTML } from './ui/events-view';
import type { OverlayMode } from './render/renderer';
import { HEATMAP_KINDS, type HeatmapKind } from './sim/activity';
import { isSavedWorld, type SavedWorld } from './sim/protocol';
import type { SimulationConfig } from './sim/types';
import type { ExperimentToggles } from './ui/controls';
import { AUTOSAVE_KEY, deleteWorld, getWorld, infoFor, listBranches, putWorld } from './ui/saved-worlds';
import { DEFAULT_CONFIG, FOOD_LAYOUTS, WORLD_SIZES } from './sim/config';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Could not find the #app element.');
}

const GEAR_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';

const LAYERS_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3 2 8.5l10 5.5 10-5.5L12 3zm-7.6 9.2L2 13.5 12 19l10-5.5-2.4-1.3L12 16.4l-7.6-4.2z"/></svg>';

/** The world overlays, one at a time: [mode, label, hint]. */
const OVERLAYS: readonly (readonly [OverlayMode, string, string])[] = [
  ['none', 'No layer', ''],
  ['family', 'Family', 'parent, children, lineage'],
  ['senses', 'Senses & signals', 'sight, signal reach, ripples'],
  ['trails', 'Trails', 'where they just went'],
  ['crowding', 'Crowding', 'blocked moves'],
  ['deaths', 'Deaths', 'where they die'],
  ['feeding', 'Feeding', 'where they eat'],
];

app.innerHTML = `
  <main class="app">
    <section class="stage" aria-label="World">
      <canvas id="sim-canvas" aria-label="The world. Tap an organism to follow it."></canvas>
      <div id="org-card" class="org-card" role="button" tabindex="0" aria-label="Selected organism: open details" hidden></div>
      <div class="zoom-controls" role="group" aria-label="Layers and zoom">
        <button type="button" class="round-btn btn-layers" aria-label="Layers" aria-haspopup="true" aria-expanded="false">${LAYERS_ICON}</button>
        <div class="layer-menu" role="menu" hidden>
          ${OVERLAYS.map(([mode, label, hint]) => `<button type="button" role="menuitemradio" aria-checked="false" data-overlay="${mode}"><span>${label}</span><small>${hint}</small></button>`).join('')}
        </div>
        <button type="button" class="round-btn" data-zoom="in" aria-label="Zoom in">+</button>
        <span id="zoom-level" class="zoom-level">1×</span>
        <button type="button" class="round-btn" data-zoom="out" aria-label="Zoom out">−</button>
      </div>
      <div id="playback" class="playback-pill" role="group" aria-label="Playback"></div>
      <div class="notice" role="status" hidden>
        <span class="notice-text"></span>
        <button type="button" class="notice-action" hidden></button>
        <button type="button" class="notice-close" aria-label="Dismiss">✕</button>
      </div>
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
          <div class="peek-event" aria-live="polite"></div>
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
          <h3 class="panel-heading">Recent events</h3>
          <div id="events-container"></div>
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

// 1. The simulation runs in a Web Worker (src/sim/worker.ts); `sim` mirrors
// what the page draws and sends it commands.
const initialSeed = 42;
const sim = new SimulationClient({
  beforeFrame: () => renderer.rememberPositions(),
  frame: (fromStep) => onFrame(fromStep),
  reset: () => {
    // A fresh or loaded world: its settings may differ from the controls.
    isRunning = false;
    pill.setRunning(false);
    settingsView.setToggles(togglesFor(sim.config));
    settingsView.setSeed(sim.config.seed);
    historyView.setController(sim.config.controller);
    renderer.resize();
    renderer.clearMotion();
    layout();
    refreshPanels();
    scheduleAutosave();
  },
  events: () => {
    // Shown by the next panel refresh (straight away while paused).
  },
  error: (message) => showNotice(message),
});
const renderer = new CanvasRenderer(canvas, sim);

// 2. Views
const metricsView = new MetricsView($('#metrics-container'));
const groupsContainer = $('#groups-container');
const eventsContainer = $('#events-container');
const peekEvent = $('.peek-event');
const statsStatus = $('#stats-status');
const peekView = new PeekView($('.sheet-peek'));
let lastSelectedId: string | null = null;
// Last known state of the selected organism, kept to show it after it dies.
let lastSelectedSnapshot: OrganismView | null = null;
let lastSelectedDetail: Organism | null = null;
// A selected plant (with plants on): shown in the inspector, kept after it dies.
let selectedPlantId: string | null = null;
let lastPlantPatch: FoodPatch | null = null;

function findPlant(id: string): FoodPatch | undefined {
  for (const patch of sim.foodPatches.values()) if (patch.plant?.id === id) return patch;
  return undefined;
}

const nameOf = (id: string): string | null => (sim.organisms.has(id) ? givenName(id) : null);

const inspectorView = new InspectorView($('#inspector-container'), () => deselect());
const historyView = new HistoryView($('#history-container'), () => {
  const name = `alife-seed-${sim.config.seed}-tick-${sim.tick}.csv`;
  void sim.requestCSV().then((csv) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  });
});
historyView.setController(sim.config.controller);

const card = new OrganismCard(
  $('#org-card'),
  () => sheet.show('organism'),
  () => deselect()
);

const sheet = new BottomSheet(sheetEl, () => {
  layout();
  updateHistoryWanted();
  refreshPanels();
});

/** History samples are only sent while the Trends tab is showing. */
let historyWanted = false;
function updateHistoryWanted(): void {
  const wanted = sheet.isContentVisible() && sheet.getTab() === 'trends';
  if (wanted !== historyWanted) {
    historyWanted = wanted;
    sim.setWantsHistory(wanted);
  }
}

// 3. Playback state. The worker keeps time and runs the ticks; the page only
// draws each frame it sends, gliding organisms over the time until the next.
let isRunning = false;
let speedMultiplier = 1;
const BASE_TICKS_PER_SECOND = 6;

// Glide from the previous frame's positions over this long.
const STEP_ANIMATION_MS = 250;
let frameAt = 0;
let glideMs = 0;

// The text panels are rebuilt from HTML, so while running they refresh at a
// modest rate; the canvas still redraws every frame.
const PANEL_REFRESH_MS = 200;
let lastPanelRefresh = 0;
let needsRender = true;

function onFrame(fromStep: boolean): void {
  if (HEATMAP_KINDS.includes(overlay as HeatmapKind)) {
    const heat = sim.getHeatmap();
    if (heat && heat.kind === overlay) renderer.setHeatmap(heat.cells);
  }
  frameAt = performance.now();
  glideMs = fromStep ? STEP_ANIMATION_MS : isRunning ? Math.max(1000 / (BASE_TICKS_PER_SECOND * speedMultiplier), 16) : 0;
  needsRender = true;
  if (!isRunning) refreshPanels();
}

function statusText(): string {
  let state: string;
  if (isRunning) {
    const target = BASE_TICKS_PER_SECOND * speedMultiplier;
    state = `Running ${speedMultiplier}× · ${sim.ticksPerSecond}/${target} ticks/s`;
  } else {
    state = sim.tick === 0 ? 'Paused · press play or step' : 'Paused';
  }
  return `Tick ${sim.tick} · ${state} · seed ${sim.config.seed}`;
}

/** Selected organism (light record for the card, full record for the inspector), or its last state if it just died. */
function selectedForDisplay(): { org: OrganismView; detail: Organism | null; alive: boolean } | null {
  const selected = sim.getSelectedOrganism();
  if (selected) {
    lastSelectedSnapshot = selected;
    lastSelectedDetail = sim.getSelectedDetail() ?? lastSelectedDetail;
    return { org: selected, detail: lastSelectedDetail, alive: true };
  }
  if (lastSelectedId && lastSelectedSnapshot) return { org: lastSelectedSnapshot, detail: lastSelectedDetail, alive: false };
  return null;
}

function refreshPanels(): void {
  const groups = colourGroups(sim.organisms.values());
  const population = sim.organisms.size;
  peekView.render(population, seasonSummary(sim.tick, sim.foodRegions, sim.config), groups);
  const latest = latestEventHTML(sim.worldEvents, sim.foodRegions, sim.config);
  if (peekEvent.innerHTML !== latest) peekEvent.innerHTML = latest;
  pill.setTick(sim.tick);
  const status = statusText();
  settingsView.setStatus(status);

  const shown = selectedForDisplay();
  if (shown) card.render(shown.org, renderer.hueOf(shown.org), sim.config, nameOf, shown.alive);
  else card.hide();

  // Only the visible tab is rebuilt.
  if (sheet.isContentVisible()) {
    const tab = sheet.getTab();
    if (tab === 'stats') {
      if (statsStatus.textContent !== status) statsStatus.textContent = status;
      const metrics = sim.getMetrics();
      if (metrics) metricsView.render(metrics);
      groupsContainer.innerHTML = groupsTableHTML(groups, population);
      eventsContainer.innerHTML = eventListHTML(sim.worldEvents, sim.foodRegions, sim.config);
    } else if (tab === 'trends') {
      historyView.render(sim.getHistorySamples());
    } else {
      const plantPatch = selectedPlantId ? findPlant(selectedPlantId) : undefined;
      if (plantPatch) lastPlantPatch = plantPatch;
      if (selectedPlantId && lastPlantPatch) {
        inspectorView.renderPlant(lastPlantPatch, sim.tick, plantPatch !== undefined);
        lastPanelRefresh = performance.now();
        return;
      }
      const detail = shown?.detail;
      inspectorView.render(detail ? (shown.alive ? detail : { ...detail, energy: 0 }) : undefined, sim.config, nameOf);
    }
  }
  lastPanelRefresh = performance.now();
}

const pill = new PlaybackPill($('#playback'), {
  onPlayPause: () => {
    isRunning = !isRunning;
    pill.setRunning(isRunning);
    if (isRunning) sim.play();
    else {
      sim.pause(); // the worker answers with a frame that settles mid-glide positions
      void autosave();
    }
    refreshPanels();
  },
  onStep: () => sim.step(), // the frame it sends back glides over STEP_ANIMATION_MS
  onSpeedChange: (speed) => {
    speedMultiplier = speed;
    sim.setSpeed(BASE_TICKS_PER_SECOND * speed);
    refreshPanels();
  },
});

const settingsView = new SettingsView(
  $('#settings-container'),
  initialSeed,
  {
    sharingEnabled: sim.config.sharingEnabled,
    signalsEnabled: sim.config.signalsEnabled,
    dispersalEnabled: sim.config.dispersalEnabled,
    windfallsEnabled: sim.config.windfallsEnabled,
    plantsEnabled: sim.config.plantsEnabled,
    memoryEnabled: sim.config.memoryEnabled,
    seasonsEnabled: sim.config.seasonLength > 0,
    controller: sim.config.controller,
    worldSize: 'large',
    foodLayout: 'shifting',
  },
  {
    onReset: (seed) => restart(seed),
    // These need a fresh world; the renderer resizes when the new terrain arrives.
    onWorldSizeChange: (size) => restart(sim.config.seed, WORLD_SIZES[size]),
    onFoodLayoutChange: (layout) => restart(sim.config.seed, FOOD_LAYOUTS[layout]),
    onColorModeChange: (mode) => {
      renderer.setColorMode(mode);
      refreshPanels();
      needsRender = true;
    },
    // Live switches take effect from the next tick; use Reset to rerun a seed from the start.
    onSharingChange: (enabled) => sim.setConfig({ sharingEnabled: enabled }),
    onSignalsChange: (enabled) => sim.setConfig({ signalsEnabled: enabled }),
    onDispersalChange: (enabled) => sim.setConfig({ dispersalEnabled: enabled }),
    onWindfallsChange: (enabled) => sim.setConfig({ windfallsEnabled: enabled }),
    onPlantsChange: (enabled) => restart(sim.config.seed, { plantsEnabled: enabled }),
    onMemoryChange: (enabled) => sim.setConfig({ memoryEnabled: enabled }),
    onControllerChange: (controller) => {
      // Every organism carries both genomes, so this can switch mid-run.
      sim.setConfig({ controller });
      historyView.setController(controller);
    },
    onSeasonsChange: (enabled) => sim.setConfig({ seasonLength: enabled ? DEFAULT_CONFIG.seasonLength : 0 }),
    onNewSeed: () => {
      const newSeed = Math.floor(Math.random() * 900000 + 100000);
      settingsView.setSeed(newSeed);
      restart(newSeed);
    },
    onBranch: () => void branchHere(),
    onGoToBranch: (key) => void goToBranch(key),
    onDeleteBranch: (key) => void removeBranch(key),
    onSaveFile: () => void saveToFile(),
    onLoadFile: (file) => void loadFromFile(file),
  }
);

/** Stops and restarts the world from tick 0 with the given seed (and settings needing a fresh world). */
function restart(seed: string | number, config?: Partial<typeof sim.config>): void {
  isRunning = false;
  pill.setRunning(false);
  sim.reset(seed, config);
  lastSelectedId = null;
  lastSelectedSnapshot = null;
  lastSelectedDetail = null;
  clearPlant();
}

function clearPlant(): void {
  selectedPlantId = null;
  lastPlantPatch = null;
  renderer.setSelectedPlant(null);
}

function selectPlant(patch: FoodPatch): void {
  if (lastSelectedId) {
    sim.select(null);
    lastSelectedId = null;
    lastSelectedSnapshot = null;
    lastSelectedDetail = null;
  }
  selectedPlantId = patch.plant?.id ?? null;
  lastPlantPatch = patch;
  renderer.setSelectedPlant(selectedPlantId);
  sheet.show('organism');
  refreshPanels();
  needsRender = true;
}

function select(org: OrganismView): void {
  clearPlant();
  sim.select(org.id);
  lastSelectedId = org.id;
  lastSelectedSnapshot = org;
  lastSelectedDetail = null;
  if (renderer.getZoom() < 3) setZoom(3);
  renderer.follow();
  refreshPanels();
  needsRender = true;
}

function deselect(): void {
  clearPlant();
  sim.select(null);
  lastSelectedId = null;
  lastSelectedSnapshot = null;
  lastSelectedDetail = null;
  refreshPanels();
  needsRender = true;
}

// 4. Drawing loop: one canvas frame per display frame while anything moves.
function loop(timestamp: number): void {
  const glide = glideMs > 0 ? Math.min(1, (timestamp - frameAt) / glideMs) : 1;
  if (isRunning || glide < 1 || needsRender || renderer.isAnimating()) {
    renderer.render(glide);
  }
  if (isRunning && timestamp - lastPanelRefresh >= PANEL_REFRESH_MS) refreshPanels();
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
  let best: OrganismView | null = null;
  let bestDist = TAP_REACH_PX;
  for (const org of sim.organisms.values()) {
    const p = renderer.screenPositionOf(org);
    const d = Math.hypot(p.x - (clientX - rect.left), p.y - (clientY - rect.top));
    if (d < bestDist) {
      best = org;
      bestDist = d;
    }
  }
  if (best) {
    select(best);
    return;
  }
  // No organism within reach: a plant in the tapped cell, if any.
  const cell = renderer.clientToGrid(clientX, clientY);
  const patch = cell ? sim.foodPatches.get(`${cell.x},${cell.y}`) : undefined;
  if (patch?.plant) selectPlant(patch);
  else if (lastSelectedId || selectedPlantId) deselect();
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

// Layers: one overlay at a time, picked from a small menu over the world.
// Heatmaps are only sent by the worker while one is showing. The choice is
// remembered on this device.
const OVERLAY_KEY = 'alife.overlay';
let overlay: OverlayMode = 'none';
const layersButton = $<HTMLButtonElement>('.btn-layers');
const layerMenu = $('.layer-menu');
function setOverlay(mode: OverlayMode): void {
  overlay = mode;
  renderer.setOverlay(mode);
  sim.setWantsHeatmap(HEATMAP_KINDS.includes(mode as HeatmapKind) ? (mode as HeatmapKind) : null);
  layersButton.classList.toggle('active', mode !== 'none');
  layersButton.setAttribute('aria-label', `Layers: ${OVERLAYS.find(([m]) => m === mode)?.[1] ?? 'none'}`);
  layerMenu.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.overlay === mode));
  });
  try {
    localStorage.setItem(OVERLAY_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't remembered.
  }
  needsRender = true;
}
function setLayerMenuOpen(open: boolean): void {
  layerMenu.hidden = !open;
  layersButton.setAttribute('aria-expanded', String(open));
}
layersButton.addEventListener('click', () => setLayerMenuOpen(layerMenu.hidden));
layerMenu.addEventListener('click', (e) => {
  const item = (e.target as Element).closest<HTMLButtonElement>('[data-overlay]');
  if (!item) return;
  setOverlay(item.dataset.overlay as OverlayMode);
  setLayerMenuOpen(false);
});
document.addEventListener('pointerdown', (e) => {
  if (!layerMenu.hidden && !(e.target as Element).closest('.layer-menu, .btn-layers')) setLayerMenuOpen(false);
});
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(OVERLAY_KEY);
  } catch {
    saved = null;
  }
  setOverlay(OVERLAYS.some(([m]) => m === saved) ? (saved as OverlayMode) : 'none');
}

// 6. Settings sheet
const settingsOverlay = $('.settings-overlay');
const settingsButton = $('.btn-settings');
function setSettingsOpen(open: boolean): void {
  settingsOverlay.hidden = !open;
  if (open) $('.settings-close').focus();
  else settingsButton.focus();
}
settingsButton.addEventListener('click', () => {
  setSettingsOpen(true);
  void refreshBranches();
});
$('.settings-close').addEventListener('click', () => setSettingsOpen(false));
$('.settings-backdrop').addEventListener('click', () => setSettingsOpen(false));

// Keyboard: Escape closes, space plays/pauses, "." steps, "[" / "]" (or - / +) slow down / speed up (desktop).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !layerMenu.hidden) {
    setLayerMenuOpen(false);
    return;
  }
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
  } else if (e.key === '[' || e.key === '-') {
    pill.changeSpeed(-1);
  } else if (e.key === ']' || e.key === '=' || e.key === '+') {
    pill.changeSpeed(1);
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

const layoutObserver = new ResizeObserver(() => layout());
layoutObserver.observe(stage);
// The peek strip grows when the first event line appears.
layoutObserver.observe($('.sheet-peek'));
window.addEventListener('orientationchange', () => layout());

// 8. Notices: short messages over the top of the world, with an optional action.
const notice = $('.notice');
const noticeText = $('.notice-text');
const noticeAction = $<HTMLButtonElement>('.notice-action');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let noticeRun: (() => void) | null = null;
function showNotice(text: string, action?: { label: string; run: () => void }, ms = 8000): void {
  noticeText.textContent = text;
  noticeRun = action?.run ?? null;
  noticeAction.hidden = !action;
  noticeAction.textContent = action?.label ?? '';
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), ms);
}
noticeAction.addEventListener('click', () => {
  notice.hidden = true;
  noticeRun?.();
});
$('.notice-close').addEventListener('click', () => (notice.hidden = true));

// 9. Saved worlds. The browser keeps one auto-save, resumed when the app
// opens, plus branch points to jump back to; files move worlds between
// devices. Auto-saves run every few minutes while playing, on pause, and
// when the page is hidden. Nothing is auto-saved until the resume check is
// done, so the starting world never overwrites the save it would resume.
const AUTOSAVE_EVERY_MS = 2 * 60 * 1000;
let autosaveReady = false;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

function togglesFor(config: SimulationConfig): ExperimentToggles {
  return {
    sharingEnabled: config.sharingEnabled,
    signalsEnabled: config.signalsEnabled,
    dispersalEnabled: config.dispersalEnabled,
    windfallsEnabled: config.windfallsEnabled,
    plantsEnabled: config.plantsEnabled,
    memoryEnabled: config.memoryEnabled,
    seasonsEnabled: config.seasonLength > 0,
    controller: config.controller,
    worldSize: config.gridWidth <= WORLD_SIZES.small.gridWidth ? 'small' : 'large',
    foodLayout: config.foodRegionCount === 0 ? 'anywhere' : config.staggeredSeasons ? 'shifting' : 'regions',
  };
}

async function autosave(): Promise<void> {
  if (!autosaveReady) return;
  const saved = await sim.save();
  await putWorld(infoFor(AUTOSAVE_KEY, 'auto', 'Auto-save', saved), saved);
}

/** Saves soon (after a reset or load settles). */
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => void autosave(), 1000);
}

setInterval(() => {
  if (isRunning) void autosave();
}, AUTOSAVE_EVERY_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void autosave();
});

/** Replaces the world with a saved one (paused). */
function loadSaved(saved: SavedWorld): void {
  isRunning = false;
  pill.setRunning(false);
  lastSelectedId = null;
  lastSelectedSnapshot = null;
  lastSelectedDetail = null;
  sim.load(saved);
}

async function refreshBranches(): Promise<void> {
  settingsView.setBranches(await listBranches());
}

async function branchHere(): Promise<void> {
  const saved = await sim.save();
  const key = `branch-${Date.now()}`;
  const label = `Tick ${saved.world.tick} · seed ${String(saved.world.config.seed)}`;
  const ok = await putWorld(infoFor(key, 'branch', label, saved), saved);
  showNotice(ok ? `Branch point saved: ${label}` : 'Could not save in this browser (storage unavailable or full).');
  await refreshBranches();
}

async function goToBranch(key: string): Promise<void> {
  const saved = await getWorld(key);
  if (!saved) {
    showNotice('That branch point could not be read.');
    return;
  }
  const ok = window.confirm(
    `Go back to tick ${saved.world.tick}? The current world (tick ${sim.tick}) will be replaced. Branch it first if you want to come back to it.`
  );
  if (!ok) return;
  loadSaved(saved);
  setSettingsOpen(false);
  showNotice(`Back at the branch point: tick ${saved.world.tick}`);
}

async function removeBranch(key: string): Promise<void> {
  if (!window.confirm('Delete this branch point? This cannot be undone.')) return;
  await deleteWorld(key);
  await refreshBranches();
}

async function saveToFile(): Promise<void> {
  const saved = await sim.save();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(saved)], { type: 'application/json' }));
  link.download = `alife-world-seed-${String(saved.world.config.seed)}-tick-${saved.world.tick}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadFromFile(file: File): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showNotice('That file is not a saved world (it could not be read as JSON).');
    return;
  }
  if (!isSavedWorld(parsed)) {
    showNotice('That file is not a saved world from this app.');
    return;
  }
  loadSaved(parsed);
  setSettingsOpen(false);
  showNotice(`Loaded tick ${parsed.world.tick} from ${file.name}`);
}

/** On open: resume the auto-saved world, if there is one. */
async function resumeOnOpen(): Promise<void> {
  const saved = await getWorld(AUTOSAVE_KEY);
  if (saved && isSavedWorld(saved) && saved.world.tick > 0) {
    loadSaved(saved);
    const when = new Date(saved.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    showNotice(`Resumed at tick ${saved.world.tick} (saved ${when})`, {
      label: 'Start fresh',
      run: () => restart(saved.world.config.seed),
    });
  }
  autosaveReady = true;
}

layout();
refreshPanels();
renderer.render();
requestAnimationFrame(loop);
void resumeOnOpen();
