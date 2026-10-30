import * as THREE from 'three';
import type { Palette } from './palette';

/**
 * What the liquid reflects: a soft gradient in the theme's colours with a few bright panels,
 * like a photo studio. Made once, as an environment map.
 */
export function studio(renderer: THREE.WebGLRenderer, palette: Palette): THREE.WebGLRenderTarget {
  const room = new THREE.Scene();
  const white = new THREE.Color('#ffffff');
  // Deeper below, paler above: a glossy liquid needs some contrast to look glossy.
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

export interface Set {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Tilted to show a little of the top. */
  readonly tilt: THREE.Group;
  /** Inside the tilt: turns, and holds the shape. */
  readonly spin: THREE.Group;
  readonly environment: THREE.WebGLRenderTarget;
}

/** The scene every view of a shape uses: the studio's reflections, two lights and the camera. */
export function set(renderer: THREE.WebGLRenderer, palette: Palette): Set {
  // Neutral tone mapping keeps the brand colours.
  renderer.toneMapping = THREE.NeutralToneMapping;
  const environment = studio(renderer, palette);
  const scene = new THREE.Scene();
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4d6', 0.6));
  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(3, 4, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 7.2);
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  tilt.rotation.x = 0.3;
  spin.rotation.y = 0.5;
  tilt.add(spin);
  scene.add(tilt);
  return { scene, camera, tilt, spin, environment };
}
