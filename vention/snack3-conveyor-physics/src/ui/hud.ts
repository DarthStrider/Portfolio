export type EngineKind = "custom" | "cannon";

export interface HudHandlers {
  onEngine(kind: EngineKind): void;
  onSpatialHash(on: boolean): void;
  onInstancing(on: boolean): void;
  onTintSleeping(on: boolean): void;
  onTarget(n: number): void;
  onRate(perSecond: number): void;
  onBeltSpeed(metersPerSecond: number): void;
  onBurst(): void;
  onClear(): void;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  physicsMs: number;
  stepsPerFrame: number;
  boxes: number;
  awake: number;
  drawCalls: number;
  pairsTested: number;
  contacts: number;
  droppedMs: number;
}

const GRAPH_MAX_MS = 50;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** The side panel: live stats with a frame-time graph, and the controls. Plain DOM, no framework. */
export function createHud(handlers: HudHandlers) {
  const engineButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-engine]")];
  for (const button of engineButtons) {
    button.addEventListener("click", () => handlers.onEngine(button.dataset.engine as EngineKind));
  }

  const checkbox = (id: string, handler: (on: boolean) => void) => {
    const el = byId<HTMLInputElement>(id);
    el.addEventListener("change", () => handler(el.checked));
    return el;
  };
  const hash = checkbox("opt-hash", handlers.onSpatialHash);
  checkbox("opt-instancing", handlers.onInstancing);
  checkbox("opt-sleeping", handlers.onTintSleeping);

  const slider = (id: string, format: (v: number) => string, handler: (v: number) => void) => {
    const input = byId<HTMLInputElement>(id);
    const output = byId(`${id}-value`);
    const show = () => setText(output, format(input.valueAsNumber));
    input.addEventListener("input", () => {
      show();
      handler(input.valueAsNumber);
    });
    show();
    return { input, show };
  };
  const target = slider("ctl-target", (v) => v.toLocaleString(), handlers.onTarget);
  slider("ctl-rate", (v) => `${v}/s`, handlers.onRate);
  slider("ctl-belt", (v) => `${v.toFixed(1)} m/s`, handlers.onBeltSpeed);

  byId("btn-burst").addEventListener("click", handlers.onBurst);
  byId("btn-clear").addEventListener("click", handlers.onClear);

  const out = {
    fps: byId("st-fps"),
    frame: byId("st-frame"),
    physics: byId("st-physics"),
    steps: byId("st-steps"),
    boxes: byId("st-boxes"),
    awake: byId("st-awake"),
    calls: byId("st-calls"),
    pairs: byId("st-pairs"),
    contacts: byId("st-contacts"),
  };
  const status = byId("status");

  // Frame-time graph: a ring buffer of the last 120 frames, drawn every frame.
  const graph = byId<HTMLCanvasElement>("graph");
  const g = graph.getContext("2d")!;
  const history = new Float32Array(120);
  let head = 0;

  return {
    /** Every frame: feeds the graph. */
    pushFrame(ms: number) {
      history[head] = ms;
      head = (head + 1) % history.length;
      const { width, height } = graph;
      g.clearRect(0, 0, width, height);
      const y = (v: number) => height - (Math.min(v, GRAPH_MAX_MS) / GRAPH_MAX_MS) * height;
      g.strokeStyle = "rgba(255,255,255,0.15)"; // 60 fps budget line
      g.beginPath();
      g.moveTo(0, y(1000 / 60));
      g.lineTo(width, y(1000 / 60));
      g.stroke();
      g.strokeStyle = "#3b82f6";
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k < history.length; k++) {
        const x = (k / (history.length - 1)) * width;
        const v = history[(head + k) % history.length];
        if (k === 0) g.moveTo(x, y(v));
        else g.lineTo(x, y(v));
      }
      g.stroke();
    },

    /** A few times a second: the numbers. */
    showStats(s: FrameStats) {
      setText(out.fps, s.fps.toFixed(0));
      setText(out.frame, `${s.frameMs.toFixed(1)} ms`);
      setText(out.physics, `${s.physicsMs.toFixed(2)} ms`);
      setText(out.steps, s.stepsPerFrame.toFixed(1));
      setText(out.boxes, s.boxes.toLocaleString());
      setText(out.awake, s.awake.toLocaleString());
      setText(out.calls, s.drawCalls.toLocaleString());
      setText(out.pairs, s.pairsTested < 0 ? "n/a" : s.pairsTested.toLocaleString());
      setText(out.contacts, s.contacts.toLocaleString());
      setText(status, s.droppedMs > 0 ? `Frames are too slow to keep up: ${(s.droppedMs / 1000).toFixed(1)} s of simulation skipped so far.` : "");
    },

    setEngine(kind: EngineKind) {
      engineButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.engine === kind)));
      hash.disabled = kind !== "custom";
    },

    setTarget(n: number) {
      target.input.value = String(n);
      target.show();
    },

    showMessage(message: string) {
      setText(status, message);
    },
  };
}
