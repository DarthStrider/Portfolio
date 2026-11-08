import { useSyncExternalStore } from "react";
import type { Simulation, Snapshot } from "../sim/Simulation";

/**
 * Subscribes a component to the simulation. React re-renders it only when the
 * simulation publishes a new snapshot, not on every animation frame.
 */
export function useSimulation(sim: Simulation): Snapshot {
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot);
}
