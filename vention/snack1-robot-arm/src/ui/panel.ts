import type { JointSpec } from "../arm/jointSpecs";
import type { Vec3 } from "../arm/kinematics";

export type JogDirection = -1 | 0 | 1;

export interface PanelHandlers {
  onSelect(index: number): void;
  onJog(direction: JogDirection): void;
  onToggleDemo(): void;
  onToggleGripper(): void;
  onToggleTrail(): void;
  onReset(): void;
  onStopProgram(): void;
}

/** What the pick-and-place program is doing, for the panel. */
export interface ProgramView {
  label: string;
  /** 0-based step number, and how many steps there are. */
  index: number;
  count: number;
  /** 0..1 through the current step. */
  progress: number;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/** Writes only when the text changed, to avoid needless DOM work every frame. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function formatDeg(value: number) {
  return `${(Math.abs(value) < 0.05 ? 0 : value).toFixed(1)}°`;
}

function formatMeters(value: number) {
  return (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3);
}

/** The side panel: joint list, jog buttons, TCP readout and toggles. */
export function createPanel(specs: readonly JointSpec[], handlers: PanelHandlers) {
  const list = byId("joints");
  const rows = specs.map((spec, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "joint";
    button.innerHTML = `
      <span class="key">${i + 1}</span>
      <span class="name">${spec.name}</span>
      <span class="value"></span>
      <span class="bar" title="${spec.min}° to ${spec.max}°"><span class="marker"></span></span>`;
    button.addEventListener("click", () => handlers.onSelect(i));
    const item = document.createElement("li");
    item.append(button);
    list.append(item);
    return {
      button,
      value: button.querySelector<HTMLElement>(".value")!,
      marker: button.querySelector<HTMLElement>(".marker")!,
    };
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-jog]")) {
    const direction = Number(button.dataset.jog) as JogDirection;
    button.addEventListener("pointerdown", (e) => {
      button.setPointerCapture(e.pointerId);
      handlers.onJog(direction);
    });
    const stop = () => handlers.onJog(0);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
  }

  const demo = byId<HTMLButtonElement>("btn-demo");
  const gripper = byId<HTMLButtonElement>("btn-gripper");
  const trail = byId<HTMLButtonElement>("btn-trail");
  demo.addEventListener("click", handlers.onToggleDemo);
  gripper.addEventListener("click", handlers.onToggleGripper);
  trail.addEventListener("click", handlers.onToggleTrail);
  byId("btn-reset").addEventListener("click", handlers.onReset);
  byId("btn-stop-program").addEventListener("click", handlers.onStopProgram);

  const selectedName = byId("selected-name");
  const status = byId("status");
  const scene = [byId("scene-x"), byId("scene-y"), byId("scene-z")];
  const fk = [byId("fk-x"), byId("fk-y"), byId("fk-z")];
  const diff = byId("fk-diff");
  const program = byId("program");
  const programLabel = byId("program-label");
  const programCount = byId("program-count");
  const programProgress = byId("program-progress");

  return {
    update(anglesDeg: readonly number[], scenePos: Vec3, fkPos: Vec3) {
      rows.forEach((row, i) => {
        const spec = specs[i];
        setText(row.value, formatDeg(anglesDeg[i]));
        row.marker.style.left = `${((anglesDeg[i] - spec.min) / (spec.max - spec.min)) * 100}%`;
      });
      const s = [scenePos.x, scenePos.y, scenePos.z];
      const f = [fkPos.x, fkPos.y, fkPos.z];
      for (let k = 0; k < 3; k++) {
        setText(scene[k], formatMeters(s[k]));
        setText(fk[k], formatMeters(f[k]));
      }
      const error = Math.hypot(s[0] - f[0], s[1] - f[1], s[2] - f[2]);
      setText(diff, `${error.toExponential(1)} m`);
    },

    setSelected(index: number) {
      rows.forEach((row, i) => row.button.classList.toggle("selected", i === index));
      setText(selectedName, specs[index].name);
    },

    setDemo(on: boolean) {
      demo.setAttribute("aria-pressed", String(on));
    },

    setGripperOpen(open: boolean) {
      gripper.setAttribute("aria-pressed", String(open));
      setText(gripper, open ? "Gripper open" : "Gripper closed");
    },

    setTrail(on: boolean) {
      trail.setAttribute("aria-pressed", String(on));
    },

    /** Shows the running program's step, or hides the section (null). */
    setProgram(view: ProgramView | null) {
      program.hidden = !view;
      if (!view) return;
      setText(programLabel, view.label);
      setText(programCount, `${view.index + 1} of ${view.count}`);
      programProgress.style.width = `${((view.index + view.progress) / view.count) * 100}%`;
    },

    showStatus(message: string) {
      status.textContent = message;
      status.hidden = false;
    },
  };
}
