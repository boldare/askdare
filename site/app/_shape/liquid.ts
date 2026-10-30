import * as THREE from 'three';
import { type Form, solid } from './forms';
import { NOISE } from './noise';
import type { Palette } from './palette';

/** How long the shape takes to grow out of a drop and settle. Seconds. */
const ENTER = 2.6;

export interface Frame {
  /** Seconds, on the page's clock. */
  readonly now: number;
  /** The pointer over the canvas, -1 to 1, and how much it is there (eased, 0 to 1). */
  readonly pointer: THREE.Vector2;
  readonly hover: number;
}

export interface Liquid {
  readonly root: THREE.Mesh;
  /** Grow out of a drop and settle into the form. */
  enter(now: number): void;
  /** A click: the spikes flare around `toward`, the clicked side (a direction in world space). */
  poke(now: number, toward: THREE.Vector3): void;
  frame(frame: Frame): void;
  dispose(): void;
}

/** The grid the liquid is drawn on, fine enough for its spikes. */
const AROUND = 200;
const ALONG = 160;
/** Folds while it forms, and the ripple left once settled. */
const FOLDS = 0.18;
const REST = 0.015;
/** Spikes: at rest, at most while forming, towards the cursor, and on a click. */
const SPIKES = { rest: 0.025, forming: 0.38, cursor: 0.26, click: 0.18 };

const clamp = (t: number) => Math.min(Math.max(t, 0), 1);
const easeInOut = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
/** Finds its size with a soft overshoot, like a drop. */
const swell = (t: number) => {
  const x = clamp(t);
  return 1 + 2.6 * (x - 1) ** 3 + 1.6 * (x - 1) ** 2;
};

/**
 * The shape as ferrofluid: it grows out of a flowing drop, spikes rising as it forms, and
 * settles into its form with a few small spikes left, rippling like a voice. The spikes follow
 * the cursor like a magnet and flare on a click; the shape never leaves its place. Every form is
 * built on the same grid as a sphere, so the drop and the form line up point for point.
 */
export function liquid(form: Form, { palette }: { palette: Palette }): Liquid {
  const round = solid('sphere', AROUND, ALONG);
  const geometry = solid(form, AROUND, ALONG);
  geometry.setAttribute('aRound', round.getAttribute('position'));
  geometry.setAttribute('aRoundNormal', round.getAttribute('normal'));

  const uniforms = {
    uTime: { value: 0 },
    uSettle: { value: 1 },
    uWobble: { value: REST },
    uGrow: { value: 1 },
    uReach: { value: new THREE.Vector3(0, 0, 1) },
    uReachOn: { value: 0 },
    uSpikes: { value: SPIKES.rest },
    uPoke: { value: new THREE.Vector3(0, 0, 1) },
    uPokeAge: { value: 99 },
    uSheen: { value: palette.core.map((color) => new THREE.Color(color)) },
  };
  // Black and glossy: the theme shows in what it reflects and in the light at its rim.
  const material = new THREE.MeshPhysicalMaterial({
    color: '#0d0d12',
    metalness: 0.75,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.9,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
          attribute vec3 aRound;
          attribute vec3 aRoundNormal;
          uniform float uTime, uSettle, uWobble, uGrow, uReachOn, uSpikes, uPokeAge;
          uniform vec3 uReach, uPoke;
          ${NOISE}
          vec3 liquid(vec3 p, vec3 n) {
            float flow = uTime * 0.45;
            vec3 dir = normalize(p + vec3(1e-4));
            // Large, slow folds: the noise is bent by more noise, so it flows rather than bubbles.
            vec3 s = p * 0.9;
            vec3 bend = vec3(snoise(s * 0.42 + flow), snoise(s * 0.42 - flow + 4.0), snoise(s * 0.42 + 8.0)) * 0.55;
            float d = (snoise(s * 0.55 + bend + vec3(0.0, flow, flow * 0.6)) * 0.84
              + snoise(s * 1.1 - vec3(flow * 0.8, 0.0, flow)) * 0.16) * uWobble;
            // Spikes: they ripple in waves, gather towards the cursor and flare on a click.
            float facing = max(dot(dir, uReach), 0.0);
            float spike = pow(max(snoise(p * 3.6 + vec3(0.0, flow * 0.6, 0.0)), 0.0), 2.2);
            float wave = 0.65 + 0.35 * sin(uTime * 2.4 + p.y * 3.5);
            float near = exp(-pow(acos(clamp(dot(dir, uPoke), -1.0, 1.0)), 2.0) / 0.6);
            d += spike * (uSpikes * wave + ${SPIKES.cursor.toFixed(2)} * pow(facing, 3.0) * uReachOn
              + ${SPIKES.click.toFixed(2)} * (0.4 + 0.6 * near) * exp(-uPokeAge * 2.6));
            d += pow(facing, 5.0) * 0.06 * uReachOn;
            return (p + n * d) * uGrow;
          }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
          vec3 liquidBase = mix(aRound, position, uSettle);
          vec3 liquidNormal = normalize(mix(aRoundNormal, normal, uSettle));
          vec3 liquidSide = normalize(cross(liquidNormal, abs(liquidNormal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 liquidUp = cross(liquidNormal, liquidSide);
          vec3 liquidPoint = liquid(liquidBase, liquidNormal);
          // The normal of the moving surface, from two neighbours a step away.
          vec3 liquidA = liquid(liquidBase + liquidSide * 0.02, liquidNormal) - liquidPoint;
          vec3 liquidB = liquid(liquidBase + liquidUp * 0.02, liquidNormal) - liquidPoint;
          objectNormal = normalize(cross(liquidA, liquidB));
          if (dot(objectNormal, liquidNormal) < 0.0) objectNormal = -objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          transformed = liquidPoint;`,
      );
    // The theme's colours at the rim.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
          uniform vec3 uSheen[3];`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `float sheenAngle = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
          vec3 sheen = mix(uSheen[0], uSheen[1], smoothstep(0.1, 0.55, sheenAngle));
          sheen = mix(sheen, uSheen[2], smoothstep(0.55, 1.0, sheenAngle));
          outgoingLight += sheen * 0.55 * pow(sheenAngle, 1.6);
          #include <opaque_fragment>`,
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let enterAt: number | null = null;
  let pokeAt: number | null = null;
  const turn = new THREE.Quaternion();
  const local = (direction: THREE.Vector3) =>
    direction.applyQuaternion(mesh.getWorldQuaternion(turn).invert()).normalize();

  return {
    root: mesh,
    enter(now) {
      enterAt = now;
    },
    poke(now, toward) {
      pokeAt = now;
      uniforms.uPoke.value.copy(local(toward.clone()));
    },
    frame({ now, pointer, hover }) {
      uniforms.uTime.value = now;
      const entered = enterAt === null ? 1 : clamp((now - enterAt) / ENTER);
      // Grow from a drop, wobbling hard, then settle into the form with a gentle ripple left.
      const settle = easeInOut((entered - 0.3) / 0.7);
      const calm = easeInOut((entered - 0.35) / 0.65);
      const wobble = FOLDS + (REST + hover * 0.03 - FOLDS) * calm;
      const grow = swell(entered / 0.45);
      uniforms.uSettle.value = settle;
      uniforms.uWobble.value = wobble;
      uniforms.uGrow.value = Math.max(grow, 0);
      uniforms.uPokeAge.value = pokeAt === null ? 99 : now - pokeAt;
      uniforms.uSpikes.value =
        SPIKES.rest + (SPIKES.forming - SPIKES.rest) * Math.sin(Math.PI * clamp(entered));
      // Towards the cursor: in front of the shape, turned into the mesh's own space.
      uniforms.uReach.value.copy(local(new THREE.Vector3(pointer.x, pointer.y, 0.9)));
      uniforms.uReachOn.value = hover * settle;
      mesh.visible = grow > 0.001;
    },
    dispose() {
      geometry.dispose();
      round.dispose();
      material.dispose();
    },
  };
}
