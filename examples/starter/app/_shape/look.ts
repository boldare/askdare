import type * as THREE from 'three';
import type { Form } from './forms';
import type { LookName } from './names';
import type { Palette } from './palette';

/** How long the pieces take to come together, and to fly to the chat. Seconds. */
export const ENTER = 2.6;
export const LEAVE = 1.1;

export interface Setting {
  readonly palette: Palette;
  readonly reduced: boolean;
}

export interface Frame {
  /** Seconds, on the page's clock. */
  readonly now: number;
  /** The pointer over the canvas, -1 to 1, and how much it is there (eased, 0 to 1). */
  readonly pointer: THREE.Vector2;
  readonly hover: number;
  /** Device pixels per world unit, one unit away from the camera. */
  readonly pixels: number;
  /** The chat's launcher, in world space. */
  readonly corner: THREE.Vector3;
}

/** Where a look goes: to the chat's launcher, out in all directions, or into its own centre. */
export type Destination = 'corner' | 'scatter' | 'centre';

/** One way of drawing the shape: liquid or a network. */
export interface Look {
  readonly root: THREE.Object3D;
  /** Come together: from scattered pieces, or from `from`, the previous look's points. */
  enter(now: number, from?: Float32Array): void;
  leave(now: number, to: Destination): void;
  /** Points on the surface, for a look that gathers to start from. */
  readonly points?: Float32Array;
  /** Whether it can start from another look's points instead of scattered pieces. */
  readonly gathers?: boolean;
  /** Change form in place, when the look can do better than leaving and entering again. */
  reshape?(form: Form, now: number): void;
  frame(frame: Frame): void;
  dispose(): void;
}

export type MakeLook = (form: Form, setting: Setting) => Look;
export type Looks = Record<LookName, MakeLook>;

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

/** How far a phase that started `at` and lasts `length` has come, 0 to 1. */
export const phase = (now: number, at: number | null, length: number): number =>
  at === null ? 0 : clamp((now - at) / length);

export const easeOut = (t: number): number => 1 - (1 - clamp(t)) ** 4;
export const easeInOut = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

/**
 * Each piece's timing: a delay (lower pieces first, so the shape builds upward), a curl for its
 * arc and a random seed. Packed as one vec3 attribute.
 */
export function pieces(heights: Float32Array): Float32Array {
  const out = new Float32Array(heights.length * 3);
  heights.forEach((height, index) => {
    out[index * 3] = 0.6 * (0.6 * Math.random() + 0.4 * height);
    out[index * 3 + 1] = Math.random() * 2 - 1;
    out[index * 3 + 2] = Math.random();
  });
  return out;
}

/** Where pieces start: thrown out around the shape, some past the canvas edges. */
export function scatter(points: Float32Array): Float32Array {
  const out = new Float32Array(points.length);
  for (let index = 0; index < points.length; index += 3) {
    const x = points[index] ?? 0;
    const y = points[index + 1] ?? 0;
    const z = points[index + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    const reach = 2 + Math.random() * 2.6;
    out[index] = (x / length) * reach + (Math.random() - 0.5) * 3;
    out[index + 1] = (y / length) * reach + (Math.random() - 0.5) * 3;
    out[index + 2] = (z / length) * reach * 0.6 + (Math.random() - 0.5) * 2;
  }
  return out;
}

/** `count` points taken evenly from another look's points, as starting places. */
export function handover(from: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const available = Math.floor(from.length / 3);
  for (let index = 0; index < count; index++) {
    const source = Math.floor((index * available) / count) * 3;
    out[index * 3] = from[source] ?? 0;
    out[index * 3 + 1] = from[source + 1] ?? 0;
    out[index * 3 + 2] = from[source + 2] ?? 0;
  }
  return out;
}

/**
 * GLSL shared by the looks. A piece's own progress starts on its delay and ends as the whole
 * phase ends; it flies on a gentle arc, like the dots of the sebastianmusial.pl portrait.
 */
export const FLIGHT = /* glsl */ `
  float pieceIn(float progress, float delay) { return clamp(progress * 1.6 - delay, 0.0, 1.0); }
  float pieceOut(float progress, float delay) { return clamp(progress * 1.5 - delay * 0.8, 0.0, 1.0); }
  float easeOut(float t) { return 1.0 - pow(1.0 - t, 4.0); }
  float easeInOut(float t) { return t * t * (3.0 - 2.0 * t); }
  vec3 flight(vec3 from, vec3 to, float e, float curl) {
    vec3 path = to - from;
    vec3 side = cross(path, vec3(0.0, 0.0, 1.0));
    float reach = length(side);
    side = reach > 1e-4 ? side / reach : vec3(1.0, 0.0, 0.0);
    return mix(from, to, e) + side * sin(e * 3.14159265) * curl * length(path) * 0.22;
  }
  // A slow swell over the whole surface once it has settled.
  vec3 breathe(vec3 p, float time) {
    return p * (1.0 + 0.016 * sin(time * 1.3 + p.y * 3.0 + p.x * 1.7));
  }
`;
