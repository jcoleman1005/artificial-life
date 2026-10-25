import './style.css';
import { World } from './sim/world';
import { CanvasRenderer } from './render/renderer';
import { MetricsView } from './ui/metrics-view';
import { ControlsView } from './ui/controls';
import { InspectorView } from './ui/inspector';
import { HistoryView } from './ui/history-view';
import { seasonAt } from './sim/seasons';
import { DEFAULT_CONFIG } from './sim/config';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Could not find the #app element.');
}

app.innerHTML = `
  <main class="app">
    <header class="app-header">
      <div class="header-titles">
        <span class="eyebrow">ARTIFICIAL LIFE LAB</span>
        <h1>Playable Proto</h1>
        <p class="subtitle">Evolving decision policies on a 2D cellular grid</p>
      </div>
    </header>

    <div class="main-simulation-layout">
      <section class="canvas-panel" aria-label="World Viewport">
        <div class="canvas-wrapper">
          <canvas id="sim-canvas"></canvas>
        </div>
        <p class="canvas-hint">Tap any organism to inspect its senses and policy scoring</p>
      </section>

      <section class="interaction-panel">
        <div id="controls-container"></div>
        <details class="legend" open>
          <summary>What the symbols mean</summary>
          <ul class="legend-grid">
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="#60a5fa"/><path d="M15 10 L7.5 6 L7.5 14 Z" fill="#0b1016"/></svg>Moving</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 10 L15.4 6.4 A7 7 0 1 0 15.4 13.6 Z" fill="#60a5fa"/><circle cx="17.5" cy="10" r="2" fill="#4ade80"/></svg>Eating</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="11" r="7" fill="#60a5fa"/><rect x="7.5" y="8.5" width="5" height="5" fill="#0b1016"/></svg>Picking up food</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="12" r="6" fill="#60a5fa"/><circle cx="7" cy="3.5" r="2" fill="#4ade80"/><circle cx="13" cy="3.5" r="2" fill="#4ade80"/></svg>Carrying food</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="4.5" cy="10" r="4" fill="#60a5fa"/><circle cx="17.5" cy="10" r="3" fill="#60a5fa"/><circle cx="17.5" cy="10" r="4.6" fill="none" stroke="#fbbf24" stroke-width="1.4"/><path d="M7 10 H11.5" stroke="#fbbf24" stroke-width="2"/><path d="M14 10 L10.5 7.5 L10.5 12.5 Z" fill="#fbbf24"/></svg>Giving food</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="#60a5fa"/><circle cx="10" cy="10" r="2" fill="#0b1016"/></svg>Resting</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="#60a5fa"/><path d="M13 5.5 V14.5" stroke="#0b1016" stroke-width="2.4" stroke-linecap="round"/></svg>Blocked (bar = side it pushed)</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="5" cy="10" r="4" fill="#60a5fa"/><path d="M5 10 H16" stroke="rgba(255,255,255,0.7)" stroke-width="1"/><circle cx="16" cy="10" r="2.6" fill="#60a5fa"/><circle cx="16" cy="10" r="4" fill="none" stroke="#fff" stroke-width="1"/></svg>Birth (newborn ring)</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="5" fill="#60a5fa"/><circle cx="10" cy="10" r="8" fill="none" stroke="#f87171" stroke-width="1.2" stroke-dasharray="2 2"/></svg>Starving (under 25%)</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="rgba(34,197,94,0.2)"/><circle cx="10" cy="10" r="5" fill="#4ade80"/><circle cx="10" cy="10" r="1.6" fill="#14532d"/></svg>Food patch</li>
            <li><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="#17130c" stroke="#3a3020"/></svg>Lean season</li>
          </ul>
          <p class="legend-note">Body colour is the tribe tag (or family); size shows energy. Symbols show what it did last tick.</p>
        </details>
        <section id="metrics-container" class="metrics-section" aria-label="Simulation Metrics"></section>
        <div id="inspector-container"></div>
        <section id="history-container" aria-label="Trends over time"></section>
      </section>
    </div>

    <footer class="app-footer">
      <span>Artificial Life Lab · Phase 1 Mobile Prototype</span>
    </footer>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
const metricsContainer = document.querySelector<HTMLDivElement>('#metrics-container')!;
const controlsContainer = document.querySelector<HTMLDivElement>('#controls-container')!;
const inspectorContainer = document.querySelector<HTMLDivElement>('#inspector-container')!;
const historyContainer = document.querySelector<HTMLElement>('#history-container')!;

// 1. Initialize Simulation World
const initialSeed = 42;
const world = new World({ seed: initialSeed });

// 2. Initialize Renderer
const renderer = new CanvasRenderer(canvas, world);

// 3. Initialize UI Views
const metricsView = new MetricsView(metricsContainer);
let lastSelectedId: string | null = null;
let lastSelectedOrganismSnapshot: any = null;

const inspectorView = new InspectorView(inspectorContainer, () => {
  world.selectOrganism(null);
  lastSelectedId = null;
  lastSelectedOrganismSnapshot = null;
  inspectorView.render(undefined, world.config);
  renderer.render();
});

const historyView = new HistoryView(historyContainer, () => {
  const csv = world.history.toCSV();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `alife-seed-${world.config.seed}-tick-${world.tick}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// Update initial views
metricsView.render(world.getMetrics());
historyView.render(world.history.getSamples());
inspectorView.render(undefined, world.config);
renderer.render();

// 4. Playback loop state
let isRunning = false;
let speedMultiplier = 1;
const BASE_TICKS_PER_SECOND = 6;
let lastTimestamp = performance.now();
let tickAccumulator = 0;

// The text panels are rebuilt from HTML, so while running they refresh at a
// modest rate; the canvas still redraws every frame that a tick happened.
const PANEL_REFRESH_MS = 200;
let lastPanelRefresh = 0;

// Rolling window of recent tick timestamps, for the measured ticks/s readout.
const recentTickTimes: number[] = [];

function updateStatus(): void {
  const now = performance.now();
  while (recentTickTimes.length > 0 && now - recentTickTimes[0] > 1000) {
    recentTickTimes.shift();
  }
  const population = world.organisms.size;
  let state: string;
  if (isRunning) {
    const target = BASE_TICKS_PER_SECOND * speedMultiplier;
    state = `Running ${speedMultiplier}× · ${recentTickTimes.length}/${target} ticks/s`;
  } else {
    state = world.tick === 0 ? 'Paused · press Start or Step' : 'Paused';
  }
  const extinct = population === 0 ? ' · Extinct' : '';
  const season = seasonAt(world.tick, world.config);
  const seasonText = season
    ? ` · ${season.season === 'lean' ? 'Lean' : 'Plenty'} (${season.ticksLeft} left)`
    : '';
  controlsView.setStatus(`Tick ${world.tick} · ${state}${seasonText}${extinct}`);
}

function refreshPanels(): void {
  const selected = world.getSelectedOrganism();

  if (selected) {
    lastSelectedOrganismSnapshot = { ...selected };
    inspectorView.render(selected, world.config);
  } else if (lastSelectedId) {
    // Organism died this tick or recently
    if (lastSelectedOrganismSnapshot) {
      inspectorView.render(
        {
          ...lastSelectedOrganismSnapshot,
          energy: 0,
        },
        world.config
      );
    }
  }

  metricsView.render(world.getMetrics());
  historyView.render(world.history.getSamples());
  updateStatus();
  lastPanelRefresh = performance.now();
}

function stepSimulation(): void {
  world.step();
  recentTickTimes.push(performance.now());
}

const controlsView = new ControlsView(
  controlsContainer,
  initialSeed,
  {
    sharingEnabled: world.config.sharingEnabled,
    seasonsEnabled: world.config.seasonLength > 0,
    controller: world.config.controller,
  },
  {
  onPlayPause: () => {
    isRunning = !isRunning;
    controlsView.setRunning(isRunning);
    lastTimestamp = performance.now();
    tickAccumulator = 0;
    recentTickTimes.length = 0;
    refreshPanels();
  },
  onStep: () => {
    stepSimulation();
    refreshPanels();
    renderer.render();
  },
  onSpeedChange: (speed) => {
    speedMultiplier = speed;
    recentTickTimes.length = 0;
    updateStatus();
  },
  onReset: (seed) => {
    isRunning = false;
    controlsView.resetState();
    world.reset(seed);
    world.selectOrganism(null);
    lastSelectedId = null;
    lastSelectedOrganismSnapshot = null;
    recentTickTimes.length = 0;
    metricsView.render(world.getMetrics());
    inspectorView.render(undefined, world.config);
    historyView.render(world.history.getSamples());
    updateStatus();
    renderer.render();
  },
  onColorModeChange: (mode) => {
    renderer.setColorMode(mode);
    renderer.render();
  },
  onSharingChange: (enabled) => {
    // Takes effect from the next tick; use Reset to rerun a seed from the start.
    world.config.sharingEnabled = enabled;
  },
  onControllerChange: (controller) => {
    // Every organism carries both genomes, so this can switch mid-run.
    world.config.controller = controller;
    refreshPanels();
  },
  onSeasonsChange: (enabled) => {
    world.config.seasonLength = enabled ? DEFAULT_CONFIG.seasonLength : 0;
    updateStatus();
    renderer.render();
  },
  onNewSeed: () => {
    isRunning = false;
    controlsView.resetState();
    const newSeed = Math.floor(Math.random() * 900000 + 100000);
    controlsView.setSeed(newSeed);
    world.reset(newSeed);
    world.selectOrganism(null);
    lastSelectedId = null;
    lastSelectedOrganismSnapshot = null;
    recentTickTimes.length = 0;
    metricsView.render(world.getMetrics());
    inspectorView.render(undefined, world.config);
    historyView.render(world.history.getSamples());
    updateStatus();
    renderer.render();
  },
});
updateStatus();

// 5. Main animation & tick loop
function loop(timestamp: number): void {
  const elapsedMs = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  if (isRunning) {
    const targetTps = BASE_TICKS_PER_SECOND * speedMultiplier;
    const intervalMs = 1000 / targetTps;

    tickAccumulator += Math.min(elapsedMs, 250); // cap to avoid spiral on tab switch
    let stepped = false;
    while (tickAccumulator >= intervalMs) {
      stepSimulation();
      tickAccumulator -= intervalMs;
      stepped = true;
    }

    if (stepped) {
      renderer.render();
    }
    if (timestamp - lastPanelRefresh >= PANEL_REFRESH_MS) {
      refreshPanels();
    }
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// 6. User Touch / Pointer Interaction on Canvas
function handleCanvasPointer(clientX: number, clientY: number): void {
  const cell = renderer.clientToGrid(clientX, clientY);
  if (!cell) return;

  const org = world.getOrganismAt(cell.x, cell.y);
  if (org) {
    world.selectOrganism(org.id);
    lastSelectedId = org.id;
    lastSelectedOrganismSnapshot = { ...org };
    inspectorView.render(org, world.config);
  } else {
    world.selectOrganism(null);
    lastSelectedId = null;
    lastSelectedOrganismSnapshot = null;
    inspectorView.render(undefined, world.config);
  }
  renderer.render();
}

// 'click' rather than 'pointerdown' so a swipe that starts on the canvas
// scrolls the page instead of selecting an organism.
canvas.addEventListener('click', (e) => {
  handleCanvasPointer(e.clientX, e.clientY);
});

// 7. Responsive handling: the wrapper's size changes on window resize,
// phone rotation, and layout breakpoints; follow it directly.
new ResizeObserver(() => {
  renderer.resize();
  renderer.render();
}).observe(canvas.parentElement!);
