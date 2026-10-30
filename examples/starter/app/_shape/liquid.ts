import * as THREE from 'three';
import { type Form, solid, spread } from './forms';
import { ENTER, easeInOut, LEAVE, type MakeLook, phase } from './look';

const AROUND = 160;
const ALONG = 128;
/** Seconds to melt back into a blob before taking a new form. */
const MELT = 0.9;

/** Simplex noise, by Ashima Arts and Stefan Gustavson (MIT). */
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
      i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

/**
 * Iridescent liquid, after the Dribbble voice-chat blob: the shape grows out of a flowing drop
 * and settles into its form, keeps a slight ripple, and stretches into a drop again on its way
 * to the chat. Every form is built on the same grid as the sphere, so it can melt from one form
 * into another.
 */
export const liquid: MakeLook = (form, { palette, reduced }) => {
  const round = solid('sphere', AROUND, ALONG);
  const geometry = solid(form, AROUND, ALONG);
  geometry.setAttribute('aRound', round.getAttribute('position'));
  geometry.setAttribute('aRoundNormal', round.getAttribute('normal'));

  const uniforms = {
    uTime: { value: 0 },
    uSettle: { value: 1 },
    uWobble: { value: 0.03 },
    uGrow: { value: 1 },
    uStretch: { value: 0 },
    uShift: { value: new THREE.Vector3() },
    uTo: { value: new THREE.Vector3(1, -1, 0) },
    uReach: { value: new THREE.Vector3(0, 0, 1) },
    uReachOn: { value: 0 },
    uSheen: { value: palette.core.map((color) => new THREE.Color(color)) },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff').lerp(new THREE.Color(palette.core[1]), 0.12),
    metalness: 0.92,
    roughness: 0.07,
    iridescence: 1,
    iridescenceIOR: 1.7,
    iridescenceThicknessRange: [240, 900],
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec3 aRound;
        attribute vec3 aRoundNormal;
        uniform float uTime, uSettle, uWobble, uGrow, uStretch, uReachOn;
        uniform vec3 uShift, uTo, uReach;
        ${NOISE}
        vec3 liquid(vec3 p, vec3 n) {
          float flow = uTime * 0.35;
          // Large, slow folds: the noise is bent by more noise, so it flows rather than bubbles.
          vec3 bend = vec3(snoise(p * 0.42 + flow), snoise(p * 0.42 - flow + 4.0), snoise(p * 0.42 + 8.0)) * 0.55;
          float w = snoise(p * 0.55 + bend + vec3(0.0, flow, flow * 0.6)) * 0.84
            + snoise(p * 1.1 - vec3(flow * 0.8, 0.0, flow)) * 0.16;
          vec3 q = p + n * w * uWobble;
          // It reaches out towards the cursor.
          q += n * pow(max(dot(normalize(p + vec3(1e-4)), uReach), 0.0), 5.0) * 0.22 * uReachOn;
          // On the way to the chat it leans towards it, like a drop about to fall.
          vec3 toward = normalize(uTo + vec3(1e-4));
          q += toward * pow(max(dot(normalize(p + vec3(1e-4)), toward), 0.0), 2.5) * uStretch;
          return q * uGrow + uShift;
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
    // A sheen in the theme's colours towards the rim, with a hint of rainbow: holographic, but
    // on brand.
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
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (sheenAngle * 1.3 + vec3(0.0, 0.33, 0.67)));
        outgoingLight += (sheen * 0.42 + rainbow * 0.1) * pow(sheenAngle, 1.6);
        #include <opaque_fragment>`,
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  let enterAt: number | null = null;
  let leaveAt: number | null = null;
  let corner = false;
  /** Melting into a blob to come back as `next`. */
  let melt: { at: number; next: Form } | null = null;
  let fromBlob = false;
  let surface = spread(form, 0.2, 0.5).positions;
  const to = new THREE.Vector3();
  const reach = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const swell = (t: number) => {
    const x = Math.min(Math.max(t, 0), 1);
    return 1 + 2.6 * (x - 1) ** 3 + 1.6 * (x - 1) ** 2;
  };

  return {
    root: mesh,
    get points() {
      return surface;
    },
    enter(now) {
      enterAt = now;
      leaveAt = null;
      fromBlob = false;
    },
    leave(now, where) {
      leaveAt = now;
      corner = where === 'corner';
      melt = null;
    },
    reshape(next, now) {
      melt = { at: now, next };
    },
    frame({ now, pointer, hover, corner: launcher }) {
      uniforms.uTime.value = reduced ? 0 : now;
      if (melt && now >= melt.at + MELT) {
        // A blob now, whatever the form was: swap in the next form and settle into it.
        const next = solid(melt.next, AROUND, ALONG);
        for (const name of ['position', 'normal']) {
          const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
          attribute.copyArray(next.getAttribute(name).array);
          attribute.needsUpdate = true;
        }
        next.dispose();
        surface = spread(melt.next, 0.2, 0.5).positions;
        melt = null;
        enterAt = now;
        fromBlob = true;
      }
      const entered = reduced ? 1 : phase(now, enterAt, ENTER);
      // Grow from a drop, wobbling hard, then settle into the form with a gentle ripple left.
      let settle = easeInOut((entered - 0.3) / 0.7);
      let wobble = 0.27 + (0.022 + hover * 0.03 - 0.27) * easeInOut((entered - 0.35) / 0.65);
      let grow = fromBlob ? 1 : swell(entered / 0.45);
      if (melt) {
        const melting = easeInOut((now - melt.at) / MELT);
        settle *= 1 - melting;
        wobble += (0.24 - wobble) * melting;
      }
      let stretch = 0;
      const shift = new THREE.Vector3();
      if (leaveAt !== null) {
        const left = phase(now, leaveAt, LEAVE);
        settle *= 1 - easeInOut(left / 0.35);
        wobble += (0.24 - wobble) * easeInOut(left / 0.3);
        if (corner) {
          mesh.worldToLocal(to.copy(launcher));
          stretch = easeInOut((left - 0.1) / 0.6) * 1.6;
          shift.copy(to).multiplyScalar(easeInOut((left - 0.35) / 0.65) ** 2);
          grow *= 1 - easeInOut((left - 0.4) / 0.6);
        } else {
          grow *= 1 - easeInOut(left);
        }
      }
      uniforms.uSettle.value = settle;
      uniforms.uWobble.value = reduced ? 0.03 : wobble;
      uniforms.uGrow.value = grow;
      uniforms.uStretch.value = stretch;
      uniforms.uShift.value.copy(shift);
      uniforms.uTo.value.copy(corner ? to : new THREE.Vector3(1, -1, 0));
      // Towards the cursor: in front of the shape, turned into the mesh's own space.
      mesh.getWorldQuaternion(turn).invert();
      reach.set(pointer.x, pointer.y, 0.9).normalize().applyQuaternion(turn);
      uniforms.uReach.value.copy(reach);
      uniforms.uReachOn.value = reduced ? 0 : hover * settle;
      mesh.visible = grow > 0.001;
    },
    dispose() {
      geometry.dispose();
      round.dispose();
      material.dispose();
    },
  };
};
