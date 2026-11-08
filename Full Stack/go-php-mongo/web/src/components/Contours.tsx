import { useMemo } from "react";

/**
 * A topographic map drawn from code: contour lines of a few overlapping "hills",
 * traced with marching squares. It's the one decorative element on the site.
 * Seeded, so it's the same drawing on every visit.
 */
export function Contours({ seed = 7, className }: { seed?: number; className?: string }) {
  const paths = useMemo(() => buildContours(seed), [seed]);
  return (
    <svg className={className} viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={i % 5 === 4 ? 0.32 : 0.16} />
      ))}
    </svg>
  );
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function buildContours(seed: number): string[] {
  const rand = rng(seed);
  const hills = Array.from({ length: 9 }, () => ({
    x: rand() * 120,
    y: rand() * 80,
    h: 0.6 + rand(),
    r: 12 + rand() * 20,
  }));
  const height = (x: number, y: number) =>
    hills.reduce((sum, k) => sum + k.h * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.r * k.r)), 0);

  const step = 1.5;
  const cols = Math.ceil(120 / step) + 1;
  const rows = Math.ceil(80 / step) + 1;
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid.push([]);
    for (let i = 0; i < cols; i++) grid[j].push(height(i * step, j * step));
  }

  // Spread ~32 levels from valley to peak, whatever this seed's terrain looks like.
  const peak = Math.max(...grid.flat());
  const out: string[] = [];
  for (let level = peak * 0.06; level < peak * 0.98; level += peak / 32) {
    let d = "";
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], e = grid[j + 1][i];
        const x = i * step, y = j * step;
        // Where the level crosses each cell edge, by linear interpolation.
        const pts: [number, number][] = [];
        const cross = (v1: number, v2: number, p1: [number, number], p2: [number, number]) => {
          if ((v1 < level) !== (v2 < level)) {
            const t = (level - v1) / (v2 - v1);
            pts.push([p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]);
          }
        };
        cross(a, b, [x, y], [x + step, y]);
        cross(b, c, [x + step, y], [x + step, y + step]);
        cross(e, c, [x, y + step], [x + step, y + step]);
        cross(a, e, [x, y], [x, y + step]);
        for (let k = 0; k + 1 < pts.length; k += 2) {
          d += `M${pts[k][0].toFixed(2)} ${pts[k][1].toFixed(2)}L${pts[k + 1][0].toFixed(2)} ${pts[k + 1][1].toFixed(2)}`;
        }
      }
    }
    if (d) out.push(d);
  }
  return out;
}
