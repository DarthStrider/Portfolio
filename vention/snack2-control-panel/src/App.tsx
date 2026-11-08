import { useState } from "react";
import { Simulation } from "./sim/Simulation";
import { ControlPanel } from "./ui/ControlPanel";
import { Viewport } from "./ui/Viewport";

export default function App() {
  // One simulation for the app's lifetime, shared by the panel and the 3D view.
  const [sim] = useState(() => new Simulation());

  return (
    <div className="app">
      <ControlPanel sim={sim} />
      <Viewport sim={sim} />
    </div>
  );
}
