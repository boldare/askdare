import * as THREE from 'three';
import { FORMS } from './forms';
import { liquid } from './liquid';
import { ENTER, type Frame, LEAVE, type Look, type Looks } from './look';
import type { LookName, ShapeTheme } from './names';
import { network } from './network';
import { FORM_OF, PALETTES, type Palette } from './palette';

const LOOKS: Looks = { liquid, network };
/** Seconds BLDR keeps each form before it moves on to the next. */
const HOLD = 4;

export interface Stage {
  /** Switch to another look: one turns into the other, no blank moment in between. */
  show(look: LookName): void;
  /** Send the shape to the chat's launcher, open the chat on the way, then build it again. */
  open(chat: () => void): void;
  dispose(): void;
}

/**
 * What the liquid reflects: a soft gradient in the theme's colours with a few bright panels,
 * like a photo studio. Made once, as an environment map.
 */
function studio(renderer: THREE.WebGLRenderer, palette: Palette): THREE.WebGLRenderTarget {
  const room = new THREE.Scene();
  const white = new THREE.Color('#ffffff');
  // Deeper below, paler above: chrome needs some contrast to look like chrome.
  const [bottom, middle, top] = palette.core.map((color, index) =>
    new THREE.Color(color).lerp(white, [0.05, 0.3, 0.45][index] ?? 0),
  );
  room.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(5, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uBottom: { value: bottom }, uMiddle: { value: middle }, uTop: { value: top } },
        vertexShader: /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uBottom, uMiddle, uTop;
          varying vec3 vDirection;
          void main() {
            float h = vDirection.y * 0.5 + 0.5;
            vec3 color = mix(uBottom, uMiddle, smoothstep(0.0, 0.5, h));
            gl_FragColor = vec4(mix(color, uTop, smoothstep(0.5, 1.0, h)), 1.0);
          }
        `,
      }),
    ),
  );
  const panel = (width: number, height: number, at: THREE.Vector3, power: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(power, power, power),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(at);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(3.2, 1.4, new THREE.Vector3(0.5, 4, 1.5), 5);
  panel(0.7, 3.2, new THREE.Vector3(-4, 0.6, 2), 3);
  panel(0.7, 3, new THREE.Vector3(4, 1, -1.5), 2.2);
  panel(2.4, 1.2, new THREE.Vector3(0, -3.5, 3), 0.9);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0.03);
  generator.dispose();
  room.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    (mesh.material as THREE.Material | undefined)?.dispose();
  });
  return target;
}

export function createStage(
  canvas: HTMLCanvasElement,
  options: {
    readonly theme: ShapeTheme;
    readonly look: LookName;
    readonly reduced: boolean;
    readonly onError: (error: unknown) => void;
  },
): Stage {
  const { theme, reduced, onError } = options;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Neutral tone mapping keeps the brand colours.
  renderer.toneMapping = THREE.NeutralToneMapping;
  const palette = PALETTES[theme];
  const environment = studio(renderer, palette);
  const scene = new THREE.Scene();
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4d6', 0.6));
  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(3, 4, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 7.2);

  // Tilted to show a little of the top; the inner group turns.
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  tilt.add(spin);
  scene.add(tilt);

  const setting = { palette, reduced };
  const preset = FORM_OF[theme];
  const forms = preset ? [preset] : FORMS;
  let form = 0;
  let name = options.look;
  const clock = () => performance.now() / 1000;
  let current = LOOKS[name](forms[0] ?? 'sphere', setting);
  spin.add(current.root);
  current.enter(clock());
  let settledAt = clock() + ENTER;
  /** Looks on their way out, removed once they have gone. */
  const leaving: { look: Look; until: number }[] = [];
  /** When the shape comes back after flying to the chat. */
  let returnAt: number | null = null;

  const retire = (look: Look) => {
    spin.remove(look.root);
    look.dispose();
  };
  const replace = (next: Look, now: number) => {
    const previous = current;
    current = next;
    spin.add(next.root);
    settledAt = now + ENTER;
    if (reduced) {
      retire(previous);
      next.enter(now);
    } else if (previous.points && next.gathers) {
      // The network gathers from where the previous look was: another network's nodes, or the
      // liquid's surface while the liquid shrinks away.
      next.enter(now, previous.points);
      if (previous.gathers) retire(previous);
      else {
        previous.leave(now, 'scatter');
        leaving.push({ look: previous, until: now + LEAVE });
      }
    } else {
      // Into its centre, where the next one grows from.
      previous.leave(now, 'centre');
      leaving.push({ look: previous, until: now + LEAVE });
      next.enter(now + 0.3);
    }
  };

  const corner = new THREE.Vector3(3, -3, 0);
  /** The chat's launcher (bottom right of the window), on the plane through the shape. */
  const aim = () => {
    const rect = canvas.getBoundingClientRect();
    const x = ((window.innerWidth - 56 - rect.left) / rect.width) * 2 - 1;
    const y = -(((window.innerHeight - 56 - rect.top) / rect.height) * 2 - 1);
    const ray = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    corner.copy(camera.position).addScaledVector(ray, -camera.position.z / ray.z);
  };

  let pixels = 1;
  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    pixels =
      (renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2) *
      (camera.projectionMatrix.elements[5] ?? 1);
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
      } else {
        spin.rotation.y = 0.5;
        tilt.rotation.x = 0.3;
      }
      tilt.scale.setScalar(1 + hover * 0.04);
      scene.updateMatrixWorld();

      if (returnAt !== null && now >= returnAt) {
        returnAt = null;
        current.enter(now);
        settledAt = now + ENTER;
      }
      // BLDR, the custom theme, takes each form in turn.
      if (forms.length > 1 && returnAt === null && now > settledAt + HOLD) {
        form = (form + 1) % forms.length;
        const next = forms[form] ?? 'sphere';
        if (current.reshape && !reduced) {
          current.reshape(next, now);
          settledAt = now + 0.9 + ENTER;
        } else {
          replace(LOOKS[name](next, setting), now);
        }
      }

      const frame: Frame = { now, pointer: cursor, hover, pixels, corner };
      current.frame(frame);
      for (let index = leaving.length - 1; index >= 0; index--) {
        const item = leaving[index];
        if (!item) continue;
        if (now > item.until) {
          retire(item.look);
          leaving.splice(index, 1);
        } else {
          item.look.frame(frame);
        }
      }
      renderer.render(scene, camera);
    } catch (error) {
      // Never a broken hero: stop and let the page show the still shape instead.
      renderer.setAnimationLoop(null);
      onError(error);
    }
  });

  return {
    show(look) {
      if (look === name) return;
      name = look;
      replace(LOOKS[name](forms[form] ?? 'sphere', setting), clock());
    },
    open(chat) {
      if (reduced || returnAt !== null) {
        chat();
        return;
      }
      const now = clock();
      aim();
      current.leave(now, 'corner');
      // The chat opens while the shape is on its way to it.
      window.setTimeout(chat, LEAVE * 550);
      returnAt = now + LEAVE + 0.4;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resizer.disconnect();
      watcher.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      for (const item of leaving) retire(item.look);
      retire(current);
      environment.dispose();
      renderer.dispose();
    },
  };
}
