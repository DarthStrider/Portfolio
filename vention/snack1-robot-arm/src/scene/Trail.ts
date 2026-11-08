import * as THREE from "three";

/**
 * A line tracing the recent path of a point. The vertex buffer is allocated once
 * and reused, so adding points never allocates or creates new GPU buffers.
 */
export class Trail {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly capacity: number;
  private count = 0;
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity);

  constructor(capacity = 800) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.attribute);
    geometry.setDrawRange(0, 0);

    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85 }),
    );
    // The bounding sphere would be computed once from the empty buffer and then
    // cull the line wrongly, so skip frustum culling for this one object.
    this.line.frustumCulled = false;
  }

  push(point: THREE.Vector3): void {
    if (this.last.distanceToSquared(point) < 1e-6) return; // moved less than 1 mm
    this.last.copy(point);

    if (this.count === this.capacity) {
      this.positions.copyWithin(0, 3); // drop the oldest point
      this.count--;
    }
    point.toArray(this.positions, this.count * 3);
    this.count++;

    this.attribute.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  clear(): void {
    this.count = 0;
    this.last.set(Infinity, Infinity, Infinity);
    this.line.geometry.setDrawRange(0, 0);
  }

  set visible(on: boolean) {
    this.line.visible = on;
  }
}
