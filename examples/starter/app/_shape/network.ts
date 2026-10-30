import * as THREE from 'three';
import { spread } from './forms';
import { ENTER, FLIGHT, handover, LEAVE, type MakeLook, phase, pieces, scatter } from './look';

const SPACING = 0.26;
const NEIGHBOURS = 3;
const PULSES = 40;
/** Each pulse draws a short comet tail of this many points. */
const TAIL = 4;

interface Pulse {
  from: number;
  to: number;
  /** Along the current link, 0 to 1. */
  t: number;
  hops: number;
  age: number;
  readonly speed: number;
  readonly color: THREE.Color;
}

/**
 * The shape as a network, after the sebastianmusial.pl "automation network": nodes on the
 * surface, links to their nearest neighbours, and light pulses running along them. The nodes fly
 * in, then the links wire up from the bottom; a node flashes when a pulse reaches it, and the
 * network lights up under the cursor.
 */
export const network: MakeLook = (form, { palette, reduced }) => {
  const { count, positions, heights } = spread(form, SPACING, 0.55);
  const node = (index: number) => new THREE.Vector3().fromArray(positions, index * 3);

  // Each node links to its nearest neighbours; the graph also carries the pulses.
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  const links: [number, number][] = [];
  for (let index = 0; index < count; index++) {
    const here = node(index);
    const nearest = Array.from({ length: count }, (_, other) => other)
      .filter((other) => other !== index)
      .map((other) => ({ other, distance: here.distanceToSquared(node(other)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEIGHBOURS);
    for (const { other } of nearest) {
      if (neighbours[index]?.includes(other)) continue;
      neighbours[index]?.push(other);
      neighbours[other]?.push(index);
      links.push([index, other]);
    }
  }

  const scattered = scatter(positions);
  const start = new THREE.BufferAttribute(scattered.slice(), 3);
  const hubs = Float32Array.from({ length: count }, () => (Math.random() < 0.09 ? 1 : 0));
  const flashes = new THREE.BufferAttribute(new Float32Array(count), 1);
  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeometry.setAttribute('aStart', start);
  nodeGeometry.setAttribute('aPiece', new THREE.BufferAttribute(pieces(heights), 3));
  nodeGeometry.setAttribute('aHub', new THREE.BufferAttribute(hubs, 1));
  nodeGeometry.setAttribute('aFlash', flashes);

  const ends = new Float32Array(links.length * 6);
  const others = new Float32Array(links.length * 6);
  const sides = new Float32Array(links.length * 2);
  const linkDelays = new Float32Array(links.length * 2);
  links.forEach(([a, b], index) => {
    node(a).toArray(ends, index * 6);
    node(b).toArray(ends, index * 6 + 3);
    node(b).toArray(others, index * 6);
    node(a).toArray(others, index * 6 + 3);
    sides[index * 2 + 1] = 1;
    // Lower links first: the network wires up from the bottom.
    const height = ((heights[a] ?? 0) + (heights[b] ?? 0)) / 2;
    const delay = 0.75 * height + 0.25 * Math.random();
    linkDelays[index * 2] = delay;
    linkDelays[index * 2 + 1] = delay;
  });
  const linkGeometry = new THREE.BufferGeometry();
  linkGeometry.setAttribute('position', new THREE.BufferAttribute(ends, 3));
  linkGeometry.setAttribute('aOther', new THREE.BufferAttribute(others, 3));
  linkGeometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  linkGeometry.setAttribute('aDelay', new THREE.BufferAttribute(linkDelays, 1));

  const pulsePositions = new Float32Array(PULSES * TAIL * 3);
  const pulseColors = new Float32Array(PULSES * TAIL * 3);
  const pulseLife = new Float32Array(PULSES * TAIL);
  const pulseGeometry = new THREE.BufferGeometry();
  pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
  pulseGeometry.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));
  pulseGeometry.setAttribute('aLife', new THREE.BufferAttribute(pulseLife, 1));

  const [ink, accent, light] = palette.ramp.map((color) => new THREE.Color(color));
  const uniforms = {
    uEnter: { value: 1 },
    uLeave: { value: 0 },
    uHandover: { value: 0 },
    uScatter: { value: 0 },
    uTo: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uPixels: { value: 1 },
    uMouse: { value: new THREE.Vector2(9, 9) },
    uMouseOn: { value: 0 },
    uInk: { value: ink },
    uAccent: { value: accent },
    uLight: { value: light },
  };
  const SHARED = /* glsl */ `
    uniform vec2 uMouse;
    uniform float uMouseOn;
    ${FLIGHT}
    // Nearer is darker and bigger, as through a light mist.
    float depthOf(vec4 view) { return smoothstep(8.6, 6.0, -view.z); }
    // How close to the cursor, on screen: 1 under it, 0 away from it.
    float nearCursor(vec4 view) {
      vec4 clip = projectionMatrix * view;
      return smoothstep(0.36, 0.0, length(clip.xy / clip.w - uMouse)) * uMouseOn;
    }
  `;

  const nodes = new THREE.Points(
    nodeGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aStart;
        attribute vec3 aPiece;
        attribute float aHub;
        attribute float aFlash;
        uniform float uEnter, uLeave, uHandover, uScatter, uTime, uPixels;
        uniform vec3 uTo;
        varying float vAlpha;
        varying float vHub;
        varying float vDepth;
        varying float vGlow;
        ${SHARED}
        void main() {
          float t = pieceIn(uEnter, aPiece.x);
          vec3 p = flight(aStart, breathe(position, uTime), easeOut(t), aPiece.y);
          float l = easeInOut(pieceOut(uLeave, aPiece.x));
          p = flight(p, mix(uTo, aStart, uScatter), l, aPiece.y * 0.6);
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * view;
          float depth = depthOf(view);
          float near = nearCursor(view) * depth;
          float arrive = mix(smoothstep(0.0, 0.25, t) * (0.3 + 0.7 * smoothstep(0.35, 1.0, t)), 1.0, uHandover);
          float size = mix(0.05, 0.11, aHub) * (1.0 + aFlash * 0.9 + near * 0.8);
          gl_PointSize = size * uPixels / -view.z * mix(0.6, 1.0, depth) * (1.0 - l * 0.5);
          vAlpha = arrive * mix(0.25, 1.0, max(depth, near)) * (1.0 - smoothstep(0.75, 1.0, l));
          vHub = aHub;
          vDepth = depth;
          vGlow = max(aFlash, near);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uInk, uAccent, uLight;
        varying float vAlpha;
        varying float vHub;
        varying float vDepth;
        varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // Hubs: an accent dot in a soft ring. Nodes: a plain ink dot, accent while lit.
          float disc = smoothstep(0.5, 0.36, d / mix(1.0, 0.5, vHub));
          float ring = vHub * smoothstep(0.5, 0.42, d) * smoothstep(0.3, 0.38, d) * 0.45;
          float a = max(disc, ring) * vAlpha;
          if (a < 0.01) discard;
          vec3 color = mix(mix(uLight, uInk, vDepth), uAccent, max(vHub, vGlow));
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }
      `,
    }),
  );

  const lines = new THREE.LineSegments(
    linkGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aOther;
        attribute float aSide;
        attribute float aDelay;
        uniform float uEnter, uLeave, uTime;
        varying float vAlpha;
        varying float vNear;
        ${SHARED}
        void main() {
          // Once the nodes have landed, each link grows from one end to the other.
          float grow = smoothstep(0.0, 1.0, clamp((uEnter - 0.5 - aDelay * 0.3) / 0.2, 0.0, 1.0));
          grow *= 1.0 - clamp(uLeave * 4.0, 0.0, 1.0);
          vec3 self = breathe(position, uTime);
          vec3 p = aSide > 0.5 ? mix(breathe(aOther, uTime), self, grow) : self;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * view;
          float depth = depthOf(view);
          vNear = nearCursor(view) * depth;
          vAlpha = step(0.001, grow) * mix(0.1, 0.42, depth) * (1.0 + vNear * 1.2);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uInk, uAccent;
        varying float vAlpha;
        varying float vNear;
        void main() {
          gl_FragColor = vec4(mix(uInk, uAccent, 0.3 + vNear * 0.7), vAlpha);
          #include <colorspace_fragment>
        }
      `,
    }),
  );

  const glow = new THREE.Points(
    pulseGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aLife;
        uniform float uTime, uPixels;
        varying vec3 vColor;
        varying float vAlpha;
        ${SHARED}
        void main() {
          vec4 view = modelViewMatrix * vec4(breathe(position, uTime), 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = 0.2 * aLife * uPixels / -view.z;
          vColor = color;
          vAlpha = min(aLife * 1.6, 1.0) * mix(0.35, 1.0, depthOf(view));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (smoothstep(0.2, 0.0, d) + smoothstep(0.5, 0.0, d) * 0.35) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }
      `,
    }),
  );

  const root = new THREE.Group();
  root.add(lines, nodes, glow);
  for (const child of root.children) child.frustumCulled = false;

  const colors = palette.pulses.map((color) => new THREE.Color(color));
  const pulses: Pulse[] = [];
  const spawn = () => {
    const from = Math.floor(Math.random() * count);
    const to = neighbours[from]?.[0];
    if (to === undefined || pulses.length >= PULSES) return;
    pulses.push({
      from,
      to,
      t: 0,
      hops: 3 + Math.floor(Math.random() * 5),
      age: 0,
      speed: 2 + Math.random() * 1.5,
      color: colors[Math.floor(Math.random() * colors.length)] ?? new THREE.Color(),
    });
  };
  /** Pulses walk the graph: at each node they flash it and take a link they didn't come along. */
  const walk = (dt: number) => {
    for (let index = pulses.length - 1; index >= 0; index--) {
      const pulse = pulses[index];
      if (!pulse) continue;
      pulse.t += dt * pulse.speed;
      pulse.age += dt * pulse.speed;
      if (pulse.t < 1) continue;
      flashes.setX(pulse.to, 1);
      const choices = (neighbours[pulse.to] ?? []).filter((next) => next !== pulse.from);
      const next = choices[Math.floor(Math.random() * choices.length)];
      if (pulse.age >= pulse.hops || next === undefined) {
        pulses.splice(index, 1);
        continue;
      }
      pulse.from = pulse.to;
      pulse.to = next;
      pulse.t -= 1;
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    pulses.forEach((pulse, index) => {
      a.fromArray(positions, pulse.from * 3);
      b.fromArray(positions, pulse.to * 3);
      const life = Math.sin(Math.PI * Math.min(pulse.age / pulse.hops, 1));
      for (let point = 0; point < TAIL; point++) {
        const slot = index * TAIL + point;
        new THREE.Vector3()
          .lerpVectors(a, b, Math.max(pulse.t - point * 0.1, 0))
          .toArray(pulsePositions, slot * 3);
        pulse.color.toArray(pulseColors, slot * 3);
        pulseLife[slot] = life * (1 - point / TAIL);
      }
    });
    pulseGeometry.setDrawRange(0, pulses.length * TAIL);
    for (const name of ['position', 'color', 'aLife']) {
      pulseGeometry.getAttribute(name).needsUpdate = true;
    }
    // Flashes fade out.
    const fade = Math.exp(-dt * 4);
    for (let index = 0; index < count; index++) flashes.setX(index, flashes.getX(index) * fade);
    flashes.needsUpdate = true;
  };

  let enterAt: number | null = null;
  let leaveAt: number | null = null;
  let toCorner = false;
  let last = 0;
  let clock = 0;
  return {
    root,
    points: positions,
    gathers: true,
    enter(now, from) {
      enterAt = now;
      leaveAt = null;
      start.copyArray(from ? handover(from, count) : scattered);
      start.needsUpdate = true;
      uniforms.uHandover.value = from ? 1 : 0;
    },
    leave(now, to) {
      leaveAt = now;
      toCorner = to === 'corner';
      uniforms.uScatter.value = to === 'scatter' ? 1 : 0;
      uniforms.uTo.value.set(0, 0, 0);
      pulses.length = 0;
    },
    frame({ now, pointer, hover, pixels, corner }) {
      const dt = Math.min(now - last, 0.05);
      last = now;
      uniforms.uTime.value = now;
      uniforms.uEnter.value = reduced ? 1 : phase(now, enterAt, ENTER);
      uniforms.uLeave.value = phase(now, leaveAt, LEAVE);
      uniforms.uPixels.value = pixels;
      uniforms.uMouse.value.copy(pointer);
      uniforms.uMouseOn.value = hover;
      if (leaveAt !== null && toCorner) root.worldToLocal(uniforms.uTo.value.copy(corner));
      // Pulses run once the links are drawn; faster while the pointer is over the shape.
      if (!reduced && uniforms.uEnter.value >= 1 && leaveAt === null) {
        clock += dt;
        const every = 0.16 - hover * 0.1;
        while (clock > every) {
          clock -= every;
          spawn();
        }
      }
      walk(dt);
    },
    dispose() {
      for (const child of root.children) {
        const item = child as THREE.Points;
        item.geometry.dispose();
        (item.material as THREE.Material).dispose();
      }
    },
  };
};
