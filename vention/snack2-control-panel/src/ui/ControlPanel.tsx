import { useEffect, useRef } from "react";
import { JOINTS } from "../arm/jointSpecs";
import type { Simulation, Snapshot } from "../sim/Simulation";
import type { Step } from "../sim/program";
import { useSimulation } from "./useSimulation";

const SPEEDS = [0.5, 1, 2, 4];
const KIND_LABEL: Record<Step["kind"], string> = { moveJ: "MoveJ", moveL: "MoveL", gripper: "Grip", home: "MoveJ" };

/** Counts committed renders of the panel, outside React state so counting doesn't cause renders. */
let panelCommits = 0;

export function ControlPanel({ sim }: { sim: Simulation }) {
  const snap = useSimulation(sim);
  useEffect(() => {
    panelCommits++;
  });

  return (
    <aside className="panel">
      <header>
        <h1>Robot Control Panel</h1>
        <p className="sub">React · Three.js · TypeScript</p>
      </header>
      <ProgramSection sim={sim} snap={snap} />
      <JointsSection sim={sim} snap={snap} />
      <GripperSection sim={sim} />
      <TcpSection snap={snap} />
      <Stats sim={sim} />
    </aside>
  );
}

function ProgramSection({ sim, snap }: { sim: Simulation; snap: Snapshot }) {
  const playing = snap.status === "playing";
  const active = playing || snap.status === "paused";

  return (
    <section>
      <h2>Program: pick and place</h2>
      <div className="transport">
        <button type="button" className="primary" onClick={() => (playing ? sim.pause() : sim.play())}>
          {playing ? "Pause" : snap.status === "paused" ? "Resume" : snap.status === "done" ? "Run next cycle" : "Play"}
        </button>
        <button type="button" onClick={() => sim.reset()}>
          Reset
        </button>
      </div>

      <div className="options">
        <label>
          Speed{" "}
          <select value={String(snap.speed)} onChange={(e) => sim.setSpeed(Number(e.currentTarget.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={String(s)}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={snap.loop} onChange={(e) => sim.setLoop(e.currentTarget.checked)} /> Loop
        </label>
      </div>

      <p className={snap.status === "error" ? "status error" : "status"} role="status">
        {statusText(snap)}
      </p>

      <ol className="steps">
        {snap.steps.map((step, i) => {
          const current = active && i === snap.stepIndex;
          const done = active && i < snap.stepIndex;
          return (
            <li key={i} className={current ? "current" : done ? "done" : undefined}>
              <span className="label">{step.label}</span>
              <span className="kind">{KIND_LABEL[step.kind]}</span>
              {current && <span className="progress" style={{ width: `${snap.stepProgress * 100}%` }} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function statusText(snap: Snapshot): string {
  const where = `Cycle ${snap.cycle + 1}, step ${snap.stepIndex + 1} of ${snap.steps.length}`;
  switch (snap.status) {
    case "idle":
      return "Ready. Press Play to run the program.";
    case "playing":
      return where;
    case "paused":
      return `Paused at ${where.toLowerCase()}. Moving a joint pauses the program.`;
    case "done":
      return `Cycle ${snap.cycle} finished.`;
    case "error":
      return snap.error ?? "Error";
  }
}

function JointsSection({ sim, snap }: { sim: Simulation; snap: Snapshot }) {
  return (
    <section>
      <h2>Joints</h2>
      {JOINTS.map((joint, i) => (
        <label key={joint.name} className="slider">
          <span className="name">{joint.name}</span>
          <output>{snap.joints[i].toFixed(1)}°</output>
          <input
            type="range"
            min={joint.min}
            max={joint.max}
            step="any"
            value={snap.joints[i]}
            onChange={(e) => sim.setJoint(i, e.currentTarget.valueAsNumber)}
          />
        </label>
      ))}
    </section>
  );
}

function GripperSection({ sim }: { sim: Simulation }) {
  return (
    <section>
      <h2>Gripper</h2>
      <div className="transport">
        <button type="button" onClick={() => sim.setGripper(true)}>
          Open
        </button>
        <button type="button" onClick={() => sim.setGripper(false)}>
          Close
        </button>
      </div>
    </section>
  );
}

function TcpSection({ snap }: { snap: Snapshot }) {
  const { x, y, z } = snap.tcp;
  return (
    <section>
      <h2>Tool center point (m)</h2>
      <p className="tcp">
        <span>x {x.toFixed(3)}</span>
        <span>y {y.toFixed(3)}</span>
        <span>z {z.toFixed(3)}</span>
        <span>gap {(snap.gap * 1000).toFixed(0)} mm</span>
      </p>
    </section>
  );
}

/**
 * Frames rendered vs. times React rendered the panel. Updated by writing to the
 * DOM directly twice a second, so showing the numbers doesn't add renders.
 */
function Stats({ sim }: { sim: Simulation }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (ref.current) {
        ref.current.textContent =
          `3D frames: ${sim.frames.toLocaleString()} · panel renders: ${panelCommits.toLocaleString()}`;
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [sim]);
  return <p ref={ref} className="stats" />;
}
