import * as THREE from 'three';

export type Form = 'sphere' | 'cone' | 'cylinder' | 'cube';
export const FORMS: readonly Form[] = ['sphere', 'cone', 'cylinder', 'cube'];

type Point = readonly [number, number];

/** A polyline measured by length, so it can be sampled evenly. */
class Curve {
  readonly length: number;
  private readonly lengths: number[];

  constructor(private readonly points: readonly Point[]) {
    let total = 0;
    this.lengths = points.map((point, index) => {
      const previous = points[index - 1];
      if (previous) total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      return total;
    });
    this.length = total;
  }

  /** The point and unit tangent at a fraction of the length. */
  at(fraction: number): { x: number; y: number; tx: number; ty: number } {
    const target = Math.min(Math.max(fraction, 0), 1) * this.length;
    let low = 1;
    let high = this.points.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.lengths[middle] ?? 0) < target) low = middle + 1;
      else high = middle;
    }
    const [ax, ay] = this.points[low - 1] ?? [0, 0];
    const [bx, by] = this.points[low] ?? [0, 0];
    const from = this.lengths[low - 1] ?? 0;
    const span = (this.lengths[low] ?? 0) - from;
    const t = span > 0 ? (target - from) / span : 0;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      tx: (bx - ax) / length,
      ty: (by - ay) / length,
    };
  }
}

const arc = (radius: number, from: number, to: number, steps: number): Point[] =>
  Array.from({ length: steps + 1 }, (_, step) => {
    const angle = from + ((to - from) * step) / steps;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  });

/** A polygon with its corners rounded; an open one keeps its two ends sharp. */
function rounded(corners: readonly Point[], radius: number, closed: boolean): Point[] {
  const out: Point[] = [];
  const count = corners.length;
  corners.forEach((corner, index) => {
    const previous = corners[(index - 1 + count) % count];
    const next = corners[(index + 1) % count];
    if ((!closed && (index === 0 || index === count - 1)) || !previous || !next) {
      out.push(corner);
      return;
    }
    const ul = Math.hypot(previous[0] - corner[0], previous[1] - corner[1]);
    const wl = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const ux = (previous[0] - corner[0]) / ul;
    const uy = (previous[1] - corner[1]) / ul;
    const wx = (next[0] - corner[0]) / wl;
    const wy = (next[1] - corner[1]) / wl;
    const angle = Math.acos(Math.min(Math.max(ux * wx + uy * wy, -1), 1));
    const bisector = Math.hypot(ux + wx, uy + wy);
    const away = radius / Math.sin(angle / 2);
    const cx = corner[0] + ((ux + wx) / bisector) * away;
    const cy = corner[1] + ((uy + wy) / bisector) * away;
    const reach = radius / Math.tan(angle / 2);
    const from = Math.atan2(corner[1] + uy * reach - cy, corner[0] + ux * reach - cx);
    let sweep = Math.atan2(corner[1] + wy * reach - cy, corner[0] + wx * reach - cx) - from;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    for (let step = 0; step <= 24; step++) {
      const at = from + (sweep * step) / 24;
      out.push([cx + Math.cos(at) * radius, cy + Math.sin(at) * radius]);
    }
  });
  const first = out[0];
  if (closed && first) out.push(first);
  return out;
}

/**
 * Every form is a profile (radius against height, from the bottom pole to the top one) swept
 * around a section (a circle, or a rounded square for the cube). One description serves the
 * liquid and the network alike.
 */
interface Shape {
  readonly profile: Curve;
  readonly section: Curve;
}

const CIRCLE = new Curve(arc(1, 0, Math.PI * 2, 256));
const SQUARE = new Curve(
  rounded(
    [
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ],
    0.3,
    true,
  ),
);

const SHAPES: Record<Form, Shape> = {
  sphere: { profile: new Curve(arc(1.2, -Math.PI / 2, Math.PI / 2, 256)), section: CIRCLE },
  cone: {
    profile: new Curve(
      rounded(
        [
          [0, -1.12],
          [1.18, -1.12],
          [0, 1.18],
        ],
        0.14,
        false,
      ),
    ),
    section: CIRCLE,
  },
  cylinder: {
    profile: new Curve(
      rounded(
        [
          [0, -1],
          [1.02, -1],
          [1.02, 1],
          [0, 1],
        ],
        0.16,
        false,
      ),
    ),
    section: CIRCLE,
  },
  cube: {
    profile: new Curve(
      rounded(
        [
          [0, -0.94],
          [0.94, -0.94],
          [0.94, 0.94],
          [0, 0.94],
        ],
        0.16,
        false,
      ),
    ),
    section: SQUARE,
  },
};

/**
 * The surface point `along` the profile (0 at the bottom, 1 at the top) and `around` the section,
 * with its outward normal.
 */
function surface(
  shape: Shape,
  along: number,
  around: number,
  position: THREE.Vector3,
  normal: THREE.Vector3,
): void {
  const p = shape.profile.at(along);
  const s = shape.section.at(around);
  position.set(p.x * s.x, p.y, p.x * s.y);
  // The section's outward normal, tilted by the profile's slope.
  const nx = s.ty;
  const nz = -s.tx;
  normal.set(p.ty * nx, -p.tx * (nx * s.x + nz * s.y), p.ty * nz);
  if (normal.lengthSq() < 1e-10) normal.set(0, p.y < 0 ? -1 : 1, 0);
  normal.normalize();
}

/** The form as a smooth mesh. */
export function solid(form: Form, around = 160, along = 128): THREE.BufferGeometry {
  const shape = SHAPES[form];
  const columns = around + 1;
  const positions = new Float32Array((along + 1) * columns * 3);
  const normals = new Float32Array(positions.length);
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let row = 0; row <= along; row++) {
    for (let column = 0; column <= around; column++) {
      surface(shape, row / along, column / around, position, normal);
      position.toArray(positions, (row * columns + column) * 3);
      normal.toArray(normals, (row * columns + column) * 3);
    }
  }
  // Wind the triangles so they face outward, whichever way the section runs.
  const at = (index: number) => new THREE.Vector3().fromArray(positions, index * 3);
  const probe = (along >> 1) * columns;
  const facing = at(probe + columns)
    .sub(at(probe))
    .cross(at(probe + 1).sub(at(probe)))
    .dot(new THREE.Vector3().fromArray(normals, probe * 3));
  const indices: number[] = [];
  for (let row = 0; row < along; row++) {
    for (let column = 0; column < around; column++) {
      const a = row * columns + column;
      const b = a + columns;
      if (facing > 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface Spread {
  readonly count: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** How far up the profile each point is, 0 to 1: lets the shape build from the bottom. */
  readonly heights: Float32Array;
}

/**
 * Points spread evenly over the surface, about `spacing` apart: rings up the profile, each with
 * as many points as fit around it, every other ring offset by half a step like a halftone screen.
 */
export function spread(form: Form, spacing: number, jitter: number): Spread {
  const shape = SHAPES[form];
  const rings = Math.max(2, Math.round(shape.profile.length / spacing));
  const positions: number[] = [];
  const normals: number[] = [];
  const heights: number[] = [];
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let ring = 0; ring < rings; ring++) {
    const along = (ring + 0.5) / rings;
    const radius = shape.profile.at(along).x;
    const count = Math.max(1, Math.round((shape.section.length * radius) / spacing));
    for (let index = 0; index < count; index++) {
      const shift = (ring % 2) * 0.5 + (Math.random() - 0.5) * jitter;
      const lift = ((Math.random() - 0.5) * jitter) / rings;
      surface(shape, along + lift, (index + shift) / count, position, normal);
      positions.push(position.x, position.y, position.z);
      normals.push(normal.x, normal.y, normal.z);
      heights.push(along);
    }
  }
  return {
    count: heights.length,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    heights: Float32Array.from(heights),
  };
}
