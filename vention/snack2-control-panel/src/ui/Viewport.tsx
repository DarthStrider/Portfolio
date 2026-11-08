import { useEffect, useRef } from "react";
import { Viewer } from "../scene/Viewer";
import type { Simulation } from "../sim/Simulation";

/**
 * React's only contact with the 3D scene: it gives the Viewer a DOM element to
 * draw into, and disposes it on unmount. This component never re-renders for
 * simulation updates; the Viewer runs its own frame loop.
 */
export function Viewport({ sim }: { sim: Simulation }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewer = new Viewer(containerRef.current!, sim);
    return () => viewer.dispose();
  }, [sim]);

  return <div ref={containerRef} className="viewport" aria-label="3D view of the robot work cell" />;
}
