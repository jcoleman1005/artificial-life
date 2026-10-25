// The simulation's Web Worker: runs the World off the page's main thread so
// drawing and touch stay smooth at any speed. All logic is in SimulationHost.
import { SimulationHost } from './host';
import type { FromWorker, ToWorker } from './protocol';

// The app's TypeScript config uses the DOM library, so the worker scope is
// typed by hand (only what is used here).
const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const host = new SimulationHost({
  post: (message: FromWorker) => scope.postMessage(message),
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

scope.onmessage = (event: MessageEvent<ToWorker>) => host.handle(event.data);
