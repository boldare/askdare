'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';

export type ShapeTheme = 'aura' | 'sage' | 'halo' | 'care' | 'bldr';

interface Built {
  /** What the visitor sees once it has assembled. */
  readonly solid: Three.Group;
  /** Surfaces the flying pieces settle on, and how much of the swarm each one gets. */
  readonly surfaces: readonly { readonly mesh: Three.Mesh; readonly share: number }[];
  /** BLDR assembles from its own blocks instead of a swarm. */
  readonly blocks?: readonly Three.Mesh[];
  readonly pieceColor: (point: Three.Vector3) => Three.Color;
  /** Per-frame life once assembled (rings orbit, the pebble breathes). */
  readonly idle?: (time: number) => void;
}

const PIECES = 900;
const ASSEMBLE = 1.7;
const DISPERSE = 0.75;

/** Each theme's shape, built from three.js primitives: no models to download. */
function build(THREE: typeof Three, addons: Addons, theme: ShapeTheme): Built {
  const solid = new THREE.Group();
  const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
  switch (theme) {
    case 'aura': {
      // A glossy, iridescent bubble in Boldare's coral, violet and teal.
      const geometry = new THREE.SphereGeometry(1.25, 96, 64);
      const colors: number[] = [];
      const position = geometry.getAttribute('position');
      for (let index = 0; index < position.count; index++) {
        const y = (position.getY(index) + 1.25) / 2.5;
        const color =
          y > 0.5 ? mix('#9b7cf2', '#ff7fb6', (y - 0.5) * 2) : mix('#3fcfc0', '#9b7cf2', y * 2);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshPhysicalMaterial({
          vertexColors: true,
          roughness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          iridescence: 0.6,
          iridescenceIOR: 1.3,
          iridescenceThicknessRange: [150, 450],
        }),
      );
      solid.add(mesh);
      return {
        solid,
        surfaces: [{ mesh, share: 1 }],
        pieceColor: (point) => {
          const y = (point.y + 1.25) / 2.5;
          return y > 0.5
            ? mix('#9b7cf2', '#ff7fb6', (y - 0.5) * 2)
            : mix('#3fcfc0', '#9b7cf2', y * 2);
        },
      };
    }
    case 'halo': {
      // A frosted sphere in rings of light.
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 96, 64),
        new THREE.MeshPhysicalMaterial({
          color: '#8fb5ff',
          roughness: 0.18,
          transmission: 0.55,
          thickness: 1.2,
          clearcoat: 1,
        }),
      );
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: '#d8e6ff',
        emissive: '#5b8ff2',
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      const inner = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.028, 16, 160), ringMaterial);
      const outer = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.018, 16, 200), ringMaterial);
      inner.rotation.set(1.2, 0.25, 0);
      outer.rotation.set(1.45, -0.35, 0.3);
      solid.add(core, inner, outer);
      return {
        solid,
        surfaces: [
          { mesh: core, share: 0.7 },
          { mesh: inner, share: 0.18 },
          { mesh: outer, share: 0.12 },
        ],
        pieceColor: (point) =>
          point.length() > 1.1 ? new THREE.Color('#9fc0ff') : new THREE.Color('#5b8ff2'),
        idle: (time) => {
          inner.rotation.z = time * 0.35;
          outer.rotation.z = -time * 0.22;
        },
      };
    }
    case 'sage': {
      // A soft pebble that breathes, like a calm companion.
      const geometry = new THREE.IcosahedronGeometry(1.2, 16);
      const base = Float32Array.from(geometry.getAttribute('position').array);
      const shape = (time: number) => {
        const position = geometry.getAttribute('position');
        for (let index = 0; index < position.count; index++) {
          const x = base[index * 3] ?? 0;
          const y = base[index * 3 + 1] ?? 0;
          const z = base[index * 3 + 2] ?? 0;
          const wave =
            1 +
            0.09 * Math.sin(x * 2.1 + time * 0.8) * Math.cos(y * 1.7 + time * 0.6) +
            0.05 * Math.sin(z * 3.2 - time * 0.5);
          position.setXYZ(index, x * wave * 1.05, y * wave * 0.88, z * wave);
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
      };
      shape(0);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshPhysicalMaterial({
          color: '#a9c29b',
          roughness: 0.5,
          sheen: 1,
          sheenColor: new THREE.Color('#eef4e8'),
          clearcoat: 0.3,
        }),
      );
      solid.add(mesh);
      return {
        solid,
        surfaces: [{ mesh, share: 1 }],
        pieceColor: () => mix('#a9c29b', '#dfe9d6', Math.random()),
        idle: shape,
      };
    }
    case 'care': {
      // A rounded cube: steady and structured.
      const mesh = new THREE.Mesh(
        new addons.RoundedBoxGeometry(1.75, 1.75, 1.75, 8, 0.38),
        new THREE.MeshPhysicalMaterial({ color: '#7b72e8', roughness: 0.3, clearcoat: 0.8 }),
      );
      mesh.rotation.set(0.5, 0.7, 0);
      solid.add(mesh);
      return {
        solid,
        surfaces: [{ mesh, share: 1 }],
        pieceColor: () => mix('#7b72e8', '#d9d4ff', Math.random() * 0.6),
      };
    }
    case 'bldr': {
      // 27 blocks in Boldare's yellow and ink: products built piece by piece.
      const geometry = new THREE.BoxGeometry(0.52, 0.52, 0.52);
      const yellow = new THREE.MeshStandardMaterial({ color: '#f2da3a', roughness: 0.55 });
      const ink = new THREE.MeshStandardMaterial({ color: '#242424', roughness: 0.6 });
      const edges = new THREE.EdgesGeometry(geometry);
      const line = new THREE.LineBasicMaterial({ color: '#242424' });
      const blocks: Three.Mesh[] = [];
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            const dark = (x + y + z + 3) % 4 === 0 || (x === 0 && y === 0);
            const block = new THREE.Mesh(geometry, dark ? ink : yellow);
            block.position.set(x * 0.56, y * 0.56, z * 0.56);
            block.add(new THREE.LineSegments(edges, line));
            block.userData['home'] = block.position.clone();
            blocks.push(block);
            solid.add(block);
          }
        }
      }
      solid.rotation.set(0.55, 0.75, 0);
      return { solid, surfaces: [], blocks, pieceColor: () => new THREE.Color('#f2da3a') };
    }
  }
}

interface Addons {
  readonly RoundedBoxGeometry: typeof import('three/addons/geometries/RoundedBoxGeometry.js').RoundedBoxGeometry;
  readonly MeshSurfaceSampler: typeof import('three/addons/math/MeshSurfaceSampler.js').MeshSurfaceSampler;
  readonly RoomEnvironment: typeof import('three/addons/environments/RoomEnvironment.js').RoomEnvironment;
}

const ease = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

/**
 * The hero's 3D shape. It assembles from pieces when it appears; clicking it scatters the pieces
 * toward the chat in the corner, opens the chat, and builds the shape again. Without WebGL, or
 * with reduced motion, it falls back to a still shape.
 */
export function HeroShape({
  theme,
  label,
}: {
  readonly theme: ShapeTheme;
  readonly label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actions = useRef<{ open: () => void }>({ open: () => {} });
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stop = (): void => {};
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const openChat = () => {
      (window as { chatdock?: (command: 'open') => void }).chatdock?.('open');
    };
    actions.current.open = openChat;

    void (async () => {
      const THREE = await import('three');
      const [{ RoundedBoxGeometry }, { MeshSurfaceSampler }, { RoomEnvironment }] =
        await Promise.all([
          import('three/addons/geometries/RoundedBoxGeometry.js'),
          import('three/addons/math/MeshSurfaceSampler.js'),
          import('three/addons/environments/RoomEnvironment.js'),
        ]);
      if (cancelled || !canvas.isConnected) return;
      let renderer: Three.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      } catch {
        setFallback(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      // Neutral tone mapping keeps the brand colors; the room only lends reflections.
      renderer.toneMapping = THREE.NeutralToneMapping;
      const scene = new THREE.Scene();
      const environment = new THREE.PMREMGenerator(renderer);
      scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;
      scene.add(new THREE.HemisphereLight('#ffffff', '#b9b4c9', 0.8));
      const key = new THREE.DirectionalLight('#ffffff', 1.6);
      key.position.set(3, 4, 5);
      scene.add(key);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0, 7.2);

      const built = build(
        THREE,
        { RoundedBoxGeometry, MeshSurfaceSampler, RoomEnvironment },
        theme,
      );
      const stage = new THREE.Group();
      stage.add(built.solid);
      scene.add(stage);

      // The swarm: small shards that settle on the shape's surface.
      const targets: Three.Vector3[] = [];
      const point = new THREE.Vector3();
      for (const { mesh, share } of built.surfaces) {
        mesh.updateMatrixWorld(true);
        const sampler = new MeshSurfaceSampler(mesh).build();
        for (let index = 0; index < Math.round(PIECES * share); index++) {
          sampler.sample(point);
          targets.push(point.clone().applyMatrix4(mesh.matrixWorld));
        }
      }
      const shards = new THREE.InstancedMesh(
        new THREE.TetrahedronGeometry(0.075),
        new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }),
        Math.max(targets.length, 1),
      );
      for (const [index, target] of targets.entries()) {
        shards.setColorAt(index, built.pieceColor(target));
      }
      shards.visible = false;
      stage.add(shards);
      const starts = targets.map(() => new THREE.Vector3());
      const delays = Array.from(
        { length: Math.max(targets.length, built.blocks?.length ?? 0) },
        () => Math.random() * 0.55,
      );
      const spins = targets.map(() => new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
      const blockStarts = (built.blocks ?? []).map(() => new THREE.Vector3());

      const materials: Three.Material[] = [];
      built.solid.traverse((child) => {
        const material = (child as Three.Mesh).material as Three.Material | undefined;
        if (material && !materials.includes(material)) materials.push(material);
      });
      const fade = (opacity: number) => {
        for (const material of materials) {
          material.transparent = opacity < 1;
          material.opacity = opacity;
        }
      };

      type Phase = 'assemble' | 'idle' | 'disperse';
      let phase: Phase = reduced ? 'idle' : 'assemble';
      let phaseStart = performance.now() / 1000;
      let corner = new THREE.Vector3(3, -2.4, 0);
      const scatter = () => {
        for (const [index, start] of starts.entries()) {
          const target = targets[index] ?? point;
          start
            .copy(target)
            .normalize()
            .multiplyScalar(3 + Math.random() * 4);
          start.add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 4,
              (Math.random() - 0.5) * 4,
              Math.random() * 3,
            ),
          );
        }
        for (const start of blockStarts) {
          start.set(
            (Math.random() - 0.5) * 9,
            (Math.random() - 0.5) * 7,
            (Math.random() - 0.5) * 6,
          );
        }
      };
      const begin = (next: Phase) => {
        phase = next;
        phaseStart = performance.now() / 1000;
        if (next === 'assemble') scatter();
      };
      if (!reduced) begin('assemble');

      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const position = new THREE.Vector3();
      const pointer = new THREE.Vector2();
      let hover = 0;
      let hovering = false;

      /** Shards along their path, `t` from 0 (scattered at `from`) to 1 (settled on the shape). */
      const placeShards = (
        t: (index: number) => number,
        from: (index: number) => Three.Vector3,
        size: number,
      ) => {
        for (const [index, target] of targets.entries()) {
          const progress = ease(t(index));
          position.lerpVectors(from(index), target, progress);
          const spin = spins[index] ?? new THREE.Euler();
          quaternion.setFromEuler(
            new THREE.Euler(spin.x * (1 - progress), spin.y * (1 - progress), 0),
          );
          scale.setScalar(size);
          shards.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        }
        shards.instanceMatrix.needsUpdate = true;
        if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
      };

      const frame = (now: number) => {
        const time = now / 1000;
        const elapsed = time - phaseStart;
        hover += ((hovering ? 1 : 0) - hover) * 0.12;
        if (!reduced) {
          stage.rotation.y = time * 0.25 + pointer.x * 0.35;
          stage.rotation.x = -pointer.y * 0.25;
          stage.position.y = Math.sin(time * 1.1) * 0.06;
        }
        stage.scale.setScalar(1 + hover * 0.06);
        built.idle?.(time);

        if (phase === 'assemble') {
          if (built.blocks) {
            built.blocks.forEach((block, index) => {
              const t = ease((elapsed - (delays[index] ?? 0)) / (ASSEMBLE - 0.4));
              block.position.lerpVectors(
                blockStarts[index] ?? point,
                block.userData['home'] as Three.Vector3,
                t,
              );
              block.rotation.set((1 - t) * 3, (1 - t) * 2, 0);
            });
          } else {
            shards.visible = true;
            const reveal = Math.min(Math.max((elapsed - ASSEMBLE + 0.35) / 0.5, 0), 1);
            built.solid.visible = reveal > 0;
            fade(reveal);
            placeShards(
              (index) => (elapsed - (delays[index] ?? 0)) / (ASSEMBLE - 0.6),
              (index) => starts[index] ?? point,
              1 - reveal,
            );
          }
          if (elapsed > ASSEMBLE + 0.2) {
            shards.visible = false;
            built.solid.visible = true;
            fade(1);
            begin('idle');
          }
        } else if (phase === 'disperse') {
          // Toward the chat in the corner, then gone. The corner is fixed on screen, while the
          // shape turns: convert it into the turning group's own coordinates.
          const t = elapsed / DISPERSE;
          stage.updateMatrixWorld(true);
          const shardCorner = stage.worldToLocal(corner.clone());
          const blockCorner = built.solid.worldToLocal(corner.clone());
          if (built.blocks) {
            built.blocks.forEach((block, index) => {
              const p = ease(t - (delays[index] ?? 0) * 0.4);
              block.position.lerpVectors(block.userData['home'] as Three.Vector3, blockCorner, p);
              block.scale.setScalar(1 - p * 0.8);
            });
          } else {
            built.solid.visible = false;
            shards.visible = true;
            placeShards(
              (index) => 1 - (t - (delays[index] ?? 0) * 0.5),
              () => shardCorner,
              Math.max(0.2, 1 - t),
            );
          }
          if (elapsed > DISPERSE + 0.3) {
            for (const block of built.blocks ?? []) block.scale.setScalar(1);
            begin('assemble');
          }
        }
        renderer.render(scene, camera);
      };

      const resize = () => {
        const { clientWidth, clientHeight } = canvas;
        if (!clientWidth || !clientHeight) return;
        renderer.setSize(clientWidth, clientHeight, false);
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
        // Where the chat's corner is, on the plane of the shape.
        corner = new THREE.Vector3(1.4, -1.2, 0.5)
          .unproject(camera)
          .sub(camera.position)
          .normalize();
        corner.multiplyScalar(camera.position.z / -corner.z).add(camera.position);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      let visible = true;
      const io = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
      });
      io.observe(canvas);
      renderer.setAnimationLoop((now) => {
        if (!visible || document.hidden) return;
        try {
          frame(now);
        } catch (error) {
          // Never a broken hero: stop, say why once, and show the still shape instead.
          renderer.setAnimationLoop(null);
          console.error('[hero-shape]', error);
          setFallback(true);
        }
      });

      const onMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
      };
      const onEnter = () => {
        hovering = true;
      };
      const onLeave = () => {
        hovering = false;
        pointer.set(0, 0);
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerenter', onEnter);
      canvas.addEventListener('pointerleave', onLeave);

      actions.current.open = () => {
        if (reduced || phase !== 'idle') {
          openChat();
          return;
        }
        begin('disperse');
        // The chat opens while the pieces are on their way to it.
        window.setTimeout(openChat, DISPERSE * 600);
      };

      stop = () => {
        stop = () => {};
        renderer.setAnimationLoop(null);
        observer.disconnect();
        io.disconnect();
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerenter', onEnter);
        canvas.removeEventListener('pointerleave', onLeave);
        scene.traverse((child) => {
          const mesh = child as Three.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material as Three.Material | Three.Material[] | undefined;
          for (const item of Array.isArray(material) ? material : material ? [material] : [])
            item.dispose();
        });
        environment.dispose();
        renderer.dispose();
      };
      // Unmounted while loading (development mounts every effect twice): clean up at once.
      if (cancelled) stop();
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error('[hero-shape]', error);
      setFallback(true);
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [theme]);

  return (
    <button
      type="button"
      className="shape"
      data-fallback={fallback || undefined}
      aria-label={label}
      onClick={() => actions.current.open()}
    >
      {fallback ? <span className="orb" /> : <canvas ref={canvasRef} />}
    </button>
  );
}
