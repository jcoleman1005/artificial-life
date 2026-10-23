import './style.css';
import { World } from './sim/world';
import { CanvasRenderer } from './render/renderer';
import { MetricsView } from './ui/metrics-view';
import { ControlsView } from './ui/controls';
import { InspectorView } from './ui/inspector';
import { HistoryView } from './ui/history-view';

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
  controlsView.setStatus(`Tick ${world.tick} · ${state}${extinct}`);
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

const controlsView = new ControlsView(controlsContainer, initialSeed, {
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
