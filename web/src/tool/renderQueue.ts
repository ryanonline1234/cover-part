// One Verovio toolkit is shared by every score on the page, and each render blocks the main thread
// for tens to hundreds of milliseconds. Renders are queued and run one per task, preview sheets
// before print sheets, so a folder of eight parts doesn't freeze the page.
import { getToolkit, renderScore, type RenderOptions, type Rendered } from "../verovio";

type Job = { run: () => void; cancelled: boolean };
const queues: Record<"high" | "low", Job[]> = { high: [], low: [] };
let pumping = false;

function step() {
  const job = queues.high.shift() ?? queues.low.shift();
  if (!job) {
    pumping = false;
    return;
  }
  if (!job.cancelled) job.run();
  window.setTimeout(step, 0);
}

function pump() {
  if (pumping) return;
  pumping = true;
  window.setTimeout(step, 0);
}

export interface QueuedRender {
  promise: Promise<Rendered>;
  cancel: () => void;
}

export function queueRender(xml: string, widthPx: number, opts: RenderOptions, priority: "high" | "low" = "high"): QueuedRender {
  let job: Job | null = null;
  let cancelled = false;
  const promise = getToolkit().then(
    (tk) =>
      new Promise<Rendered>((resolve, reject) => {
        if (cancelled) return reject(new Error("cancelled"));
        job = {
          cancelled: false,
          run: () => {
            try {
              resolve(renderScore(tk, xml, widthPx, opts));
            } catch (e) {
              reject(e);
            }
          },
        };
        queues[priority].push(job);
        pump();
      }),
  );
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (job) job.cancelled = true;
    },
  };
}
