import * as THREE from 'three';
import { liquid } from './liquid';
import { FORM_OF, PALETTES, type ShapeTheme } from './palette';
import { set } from './studio';

export interface Stage {
  /** A click: the shape reacts where it was clicked, in its place, and the chat opens. */
  open(chat: () => void): void;
  dispose(): void;
}

export function createStage(
  canvas: HTMLCanvasElement,
  options: {
    readonly theme: ShapeTheme;
    readonly reduced: boolean;
    readonly onError: (error: unknown) => void;
  },
): Stage {
  const { theme, reduced, onError } = options;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const palette = PALETTES[theme];
  const { scene, camera, tilt, spin, environment } = set(renderer, palette);
  const clock = () => performance.now() / 1000;
  const shape = liquid(FORM_OF[theme], { palette, reduced });
  spin.add(shape.root);
  shape.enter(clock());

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(canvas);
  resize();

  let visible = true;
  const watcher = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  });
  watcher.observe(canvas);

  const pointer = new THREE.Vector2();
  const cursor = new THREE.Vector2(9, 9);
  const lean = new THREE.Vector2();
  let hovering = false;
  let hover = 0;
  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!hovering) cursor.copy(pointer);
    hovering = true;
  };
  const onLeave = () => {
    hovering = false;
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  /** The clicked side of the shape, as a direction from its centre (front left with a key). */
  const clicked = () => {
    const at = hovering ? pointer : new THREE.Vector2(-0.3, 0.3);
    const ray = new THREE.Vector3(at.x, at.y, 0.5).unproject(camera).sub(camera.position);
    ray.normalize();
    // Where the ray meets a sphere round the shape, or passes closest to it.
    const along = -camera.position.dot(ray);
    const closest = camera.position.clone().addScaledVector(ray, along);
    const inside = 1.2 ** 2 - closest.lengthSq();
    return (inside > 0 ? closest.addScaledVector(ray, -Math.sqrt(inside)) : closest).normalize();
  };

  let last = clock();
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) return;
    try {
      const now = clock();
      const dt = Math.min(now - last, 0.05);
      last = now;
      hover += ((hovering ? 1 : 0) - hover) * (1 - Math.exp(-dt * 3.5));
      cursor.lerp(pointer, 1 - Math.exp(-dt * 12));
      lean.lerp(hovering ? pointer : new THREE.Vector2(), 1 - Math.exp(-dt * 3));
      if (!reduced) {
        spin.rotation.y = now * 0.22 + lean.x * 0.45;
        tilt.rotation.x = 0.3 - lean.y * 0.22;
        tilt.position.y = Math.sin(now * 1.1) * 0.05;
      }
      tilt.scale.setScalar(1 + hover * 0.04);
      scene.updateMatrixWorld();
      shape.frame({ now, pointer: cursor, hover });
      renderer.render(scene, camera);
    } catch (error) {
      // Never a broken hero: stop and let the page show the still shape instead.
      renderer.setAnimationLoop(null);
      onError(error);
    }
  });

  return {
    open(chat) {
      if (reduced) {
        chat();
        return;
      }
      shape.poke(clock(), clicked());
      // Long enough to see the shape answer, short enough to feel immediate.
      window.setTimeout(chat, 180);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resizer.disconnect();
      watcher.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      spin.remove(shape.root);
      shape.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
