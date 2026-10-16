import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---- geometry constants, same as gen_board.js (SVG px -> world units, 1 unit = 100 px) ----
const S = 0.01;
const RR = 330 * S;          // radius of the main road
const STEP = 36 * S;         // distance between goal lane / stash cells
const STASH_X = 430 * S;     // stash distance from the center
const ARROW_R = 380 * S;
const BOARD = 9.8;           // side of the square base
const BASE_H = 0.14;         // thickness of the base
const camps = [
  { name: 'joueur 1', color: '#e8344a' },
  { name: 'joueur 2', color: '#2f6bff' },
  { name: 'joueur 3', color: '#18b56a' },
  { name: 'joueur 4', color: '#ffb81c' },
];

const rad = (deg) => (deg * Math.PI) / 180;
// angle (degrees) of the n-th cell (1..18) of camp k, same convention as the SVG
const cellAngle = (k, n) => -90 + k * 90 + (n - 1) * 5;
const polar = (angle, r) => [r * Math.cos(rad(angle)), r * Math.sin(rad(angle))];

// ---- renderer / scene ----
const PIXEL_RATIO = Math.min(devicePixelRatio, 2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(PIXEL_RATIO);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap; // soft, blurred shadows
// no tone mapping: the soft background gradient goes through the post-processing chain untouched
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// soft studio gradient behind the board
const BACKGROUND = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 190, 20, 256, 256, 400);
  g.addColorStop(0, '#fafbfe');
  g.addColorStop(0.55, '#e8edfa');
  g.addColorStop(1, '#cdd8f1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
scene.background = BACKGROUND;

// cool sky / warm key / cool fill: the color shift between them gives the smooth gradients on the plastic
scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x8d9fd6, 0.4));
const sun = new THREE.DirectionalLight(0xfff1e0, 0.8);
sun.position.set(-5, 11, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 5;
sun.shadow.blurSamples = 16;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xb9ccff, 0.3);
fill.position.set(7, 5, -6);
scene.add(fill);

// classic perspective camera, starting from a 3/4 view
const ELEVATION = rad(40);
const AZIMUTH = Math.PI / 4;
const DISTANCE = 19 * Math.max(1, 1.2 / (innerWidth / innerHeight));
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
camera.position.set(
  DISTANCE * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
  DISTANCE * Math.sin(ELEVATION),
  DISTANCE * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
);

// full orbit: free rotation around the board (no polar clamp, no flip at the poles)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;
controls.minDistance = 6;
controls.maxDistance = 50;
controls.target.set(0, 0, 0);
controls.update();
controls.saveState();
renderer.domElement.addEventListener('dblclick', () => controls.reset());

// ---- post-processing: ambient occlusion + selective bloom (only the colored lines glow) ----
const makeTarget = () => new THREE.WebGLRenderTarget(innerWidth * PIXEL_RATIO, innerHeight * PIXEL_RATIO, {
  type: THREE.HalfFloatType, samples: 4,
});

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.05, 0);
bloomComposer.addPass(bloomPass);

const finalComposer = new EffectComposer(renderer, makeTarget());
finalComposer.setPixelRatio(PIXEL_RATIO); // a custom target defaults to ratio 1, which made the whole render half-resolution
finalComposer.addPass(new RenderPass(scene, camera));
const aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
aoPass.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1.5, scale: 1.8, samples: 16 });
aoPass.blendIntensity = 1;
// the AO pass re-renders the scene with an override material, which turns the background quad into a
// real black plane at the origin: hide the background while it runs (it is already in the buffer)
const aoRender = aoPass.render.bind(aoPass);
aoPass.render = (...args) => {
  scene.background = null;
  aoRender(...args);
  scene.background = BACKGROUND;
};
finalComposer.addPass(aoPass);
const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture }, bloomAmount: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform float bloomAmount; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(bloomTexture, vUv).rgb * bloomAmount, 0.0); }',
}), 'baseTexture');
mixPass.needsSwap = true;
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

// bloom pass: everything that does not glow is painted black (it still hides what is behind it)
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const stash = new Map();
function renderBloom() {
  scene.background = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.hideInBloom) { stash.set(o, o.visible); o.visible = false; }
    // lines that are not lit yet do not bloom
    else if (!o.material.userData.glow || o.material.emissiveIntensity <= 0) { stash.set(o, o.material); o.material = darkMaterial; }
  });
  bloomComposer.render();
  stash.forEach((v, o) => { if (typeof v === 'boolean') o.visible = v; else o.material = v; });
  stash.clear();
  scene.background = BACKGROUND;
}

function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  finalComposer.setSize(w, h);
}
addEventListener('resize', resize);
resize();

// ---- materials ----
// soft, slightly satin plastic: wider highlights and gentler reflections read as smoother gradients
const PLASTIC = { roughness: 0.5, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35, envMapIntensity: 0.35 };
const plastic = new THREE.MeshPhysicalMaterial({ color: 0xf7f8fc, ...PLASTIC });
const beige = new THREE.MeshPhysicalMaterial({ color: 0x4a4e5a, ...PLASTIC });
const matCache = new Map();
// every colored line gets its own material so it can light up on its own, when its piece lands
const UNLIT = new THREE.Color(0xdadde6);
const litMats = [];
const glow = (color) => {
  const target = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({
    color: UNLIT.clone().lerp(target, 0.12), emissive: target, emissiveIntensity: 0, roughness: 0.4, metalness: 0,
  });
  m.userData.glow = true;
  m.userData.lit = { target, t0: null };
  litMats.push(m);
  return m;
};
const tinted = (color, amount) => {
  const key = color + ':' + amount;
  if (!matCache.has(key)) {
    const c = new THREE.Color(0xf7f8fc).lerp(new THREE.Color(color), amount);
    matCache.set(key, new THREE.MeshPhysicalMaterial({ color: c, ...PLASTIC }));
  }
  return matCache.get(key);
};

// ---- helpers ----
// rounded box: w (x) by d (z) footprint, h tall, sitting on y = 0
const geoCache = new Map();
function rbox(w, d, h, r, bs = 0.015) {
  const key = [w, d, h, r, bs].join(',');
  if (geoCache.has(key)) return geoCache.get(key);
  const ww = w - 2 * bs, dd = d - 2 * bs;
  const rr = Math.max(0.001, Math.min(r - bs, ww / 2, dd / 2));
  const s = new THREE.Shape();
  s.moveTo(-ww / 2 + rr, -dd / 2);
  s.lineTo(ww / 2 - rr, -dd / 2);
  s.quadraticCurveTo(ww / 2, -dd / 2, ww / 2, -dd / 2 + rr);
  s.lineTo(ww / 2, dd / 2 - rr);
  s.quadraticCurveTo(ww / 2, dd / 2, ww / 2 - rr, dd / 2);
  s.lineTo(-ww / 2 + rr, dd / 2);
  s.quadraticCurveTo(-ww / 2, dd / 2, -ww / 2, dd / 2 - rr);
  s.lineTo(-ww / 2, -dd / 2 + rr);
  s.quadraticCurveTo(-ww / 2, -dd / 2, -ww / 2 + rr, -dd / 2);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * bs), bevelEnabled: true,
    bevelThickness: bs, bevelSize: bs, bevelSegments: 2, curveSegments: 6,
  });
  g.translate(0, 0, bs);
  g.rotateX(-Math.PI / 2);
  geoCache.set(key, g);
  return g;
}
function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

const world = new THREE.Group(); // floats gently
scene.add(world);

// ---- intro timeline: pieces fall one by one, then all the colored lines light up together ----
const FALL = 0.5;       // fall duration (s)
const STEP_T = 0.035;   // delay between two pieces (s)
const drops = [];       // { obj, delay, y0, height, light }
const lights = [];      // { obj, delay }: lines that light up at a given time without falling
function drop(obj, delay, { height = 1.1, light = false, squash = true } = {}) {
  obj.visible = false;
  drops.push({ obj, delay, y0: obj.position.y, height, light, squash, state: 0 });
}
const lightUp = (obj, delay) => lights.push({ obj, delay, done: false });
function startLight(obj, T) {
  obj.traverse((o) => {
    const lit = o.isMesh && o.material.userData.lit;
    if (lit && lit.t0 === null) lit.t0 = T;
  });
}
let t = 0.2;

// ---- base: thin white square slab with a colored line on each side ----
const slab = mesh(rbox(BOARD, BOARD, BASE_H, 0.45, 0.03), beige, world);
drop(slab, 0, { height: 0.7 });
const sides = camps.map((camp, k) => {
  const side = new THREE.Group();
  side.rotation.y = -k * Math.PI / 2; // camp k sits on side k (camp 0 on +x)
  world.add(side);
  // stripe on the vertical face of the slab
  mesh(rbox(0.05, 5.2, 0.035, 0.02, 0.008), glow(camp.color), side, BOARD / 2 + 0.005, BASE_H / 2 - 0.0175, 0);
  // inset line on the top face, near the edge
  mesh(rbox(0.07, 6.2, 0.012, 0.035, 0.004), glow(camp.color), side, BOARD / 2 - 0.2, BASE_H, 0);
  return side;
});

// ---- cells ----
const TOP_Y = BASE_H;
function cell(parent, x, z, angle, color, { size = 0.25, thick = 0.032, goal = false } = {}) {
  const g = new THREE.Group();
  g.position.set(x, TOP_Y, z);
  g.rotation.y = -rad(angle);
  parent.add(g);
  mesh(rbox(size + 2 * thick, size + 2 * thick, 0.045, 0.06), glow(color), g);
  mesh(rbox(size, size, 0.07, 0.04), goal ? tinted(color, 0.28) : plastic, g);
  drop(g, t, { light: true });
  t += STEP_T;
  return g;
}

// colored line connecting the cells of a quarter of the road
function arc(parent, a0, a1, r, color, width = 0.045) {
  const g = new THREE.RingGeometry(r - width / 2, r + width / 2, 64, 1, -rad(a1), rad(a1 - a0));
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, glow(color));
  m.position.y = TOP_Y + 0.003;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const goalA = (k) => cellAngle(k, 19 - 3); // cell labeled 3
const landed = () => t - STEP_T + FALL; // moment the last placed piece touches the board

camps.forEach((camp, k) => {
  // main road
  for (let n = 1; n <= 18; n++) {
    const a = cellAngle(k, n);
    const [x, z] = polar(a, RR);
    const label = 19 - n;
    cell(world, x, z, a, camp.color, label === 1 ? { thick: 0.06 } : {});
  }
  lightUp(arc(world, cellAngle(k, 1), cellAngle(k, 18), RR, camp.color), landed());

  // goal lane: 4 cells inward from cell 3
  const ag = goalA(k);
  const laneLen = 4 * STEP;
  const lane = new THREE.Group();
  lane.rotation.y = -rad(ag);
  lane.position.y = TOP_Y + 0.003;
  world.add(lane);
  mesh(rbox(laneLen, 0.045, 0.004, 0.02, 0.001), glow(camp.color), lane, RR - laneLen / 2, 0, 0);
  for (let j = 1; j <= 4; j++) {
    const [x, z] = polar(ag, RR - j * STEP);
    cell(world, x, z, ag, camp.color, { goal: true });
  }
  lightUp(lane, landed());

  // stash: built for camp 0 (+x side), then turned by k quarter turns
  const stash = new THREE.Group();
  stash.rotation.y = -k * Math.PI / 2;
  world.add(stash);
  const sz0 = RR * Math.sin(rad(cellAngle(0, 18)));
  const tray = new THREE.Group();
  tray.position.set(STASH_X, TOP_Y, sz0);
  stash.add(tray);
  mesh(rbox(0.62, 4 * STEP + 0.26, 0.02, 0.31, 0.006), glow(camp.color), tray);
  mesh(rbox(0.54, 4 * STEP + 0.18, 0.04, 0.27, 0.01), plastic, tray);
  drop(tray, t, { light: true });
  t += STEP_T;
  for (let j = 0; j < 4; j++) {
    cell(stash, STASH_X, sz0 + (j - 1.5) * STEP, 0, camp.color);
  }
  for (let j = 0; j < 4; j++) {
    const p = pawn(camp.color, STASH_X, TOP_Y + 0.07, sz0 + (j - 1.5) * STEP);
    stash.add(p);
    drop(p, t, { height: 1.4, light: true });
    t += STEP_T * 1.5;
  }
});

// cute pawn: white body and head, colored band
function pawn(color, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.16, 24), plastic, g, 0, 0.08, 0);
  mesh(new THREE.SphereGeometry(0.075, 24, 16), plastic, g, 0, 0.22, 0);
  const band = mesh(new THREE.TorusGeometry(0.066, 0.016, 10, 28), glow(color), g, 0, 0.1, 0);
  band.rotation.x = Math.PI / 2;
  return g;
}

// ---- direction arrow along the road, outside it (clockwise, like the SVG) ----
{
  const a0 = cellAngle(0, 18) + 5, a1 = a0 + 40;
  const col = '#9aa7cf';
  const line = arc(world, a0, a1 - 3, ARROW_R, col, 0.06);
  const head = new THREE.Shape();
  head.moveTo(0.16, 0); head.lineTo(-0.1, 0.13); head.lineTo(-0.1, -0.13); head.closePath();
  const hg = new THREE.ShapeGeometry(head);
  hg.rotateX(-Math.PI / 2);
  const hm = new THREE.Mesh(hg, glow(col));
  const [hx, hz] = polar(a1, ARROW_R);
  hm.position.set(hx, TOP_Y + 0.004, hz);
  hm.rotation.y = -rad(a1 + 90);
  world.add(hm);
  lightUp(line, landed());
  lightUp(hm, landed());
}

// ---- pile of cards in the center ----
let pileRoot;
const cardDrops = []; // the drops of the cards, replayed when the pile is clicked
{
  const CARD_W = 1.05, CARD_D = 1.5, CARD_H = 0.014, COUNT = 10;
  const pile = new THREE.Group();
  pile.position.y = TOP_Y;
  world.add(pile);
  pileRoot = pile;
  const cardsStart = t + 0.1;
  const jitter = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1; // deterministic pseudo-random in (-1, 1)
  for (let i = 0; i < COUNT; i++) {
    const c = mesh(rbox(CARD_W, CARD_D, CARD_H, 0.06, 0.003), plastic, pile, jitter(i) * 0.03, i * CARD_H, jitter(i + 50) * 0.03);
    c.rotation.y = rad(-25) + jitter(i + 100) * 0.12;
    // accordion: the cards come down one after another, the upper ones from higher up, and collapse into the pile
    drop(c, cardsStart + i * 0.03, { height: 0.5 + i * 0.075, squash: false });
    cardDrops.push(drops[drops.length - 1]);
  }
  // card back on top: colored frame, tinted face, one dot per camp
  const top = new THREE.Group();
  top.position.y = COUNT * CARD_H;
  top.rotation.y = rad(-25);
  pile.add(top);
  mesh(rbox(CARD_W - 0.08, CARD_D - 0.08, 0.004, 0.05, 0.001), glow('#8a9bd8'), top);
  mesh(rbox(CARD_W - 0.14, CARD_D - 0.14, 0.008, 0.04, 0.001), tinted('#8a9bd8', 0.18), top);
  // card back: "TOCK" over "Prestige", with a small bar in each camp color
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 640;
  const cx = cv.getContext('2d');
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillStyle = '#3b4670';
  cx.font = '800 250px "Trebuchet MS", Arial, sans-serif';
  if ('letterSpacing' in cx) cx.letterSpacing = '24px';
  cx.fillText('TOCK', 512 + 12, 200);
  if ('letterSpacing' in cx) cx.letterSpacing = '2px';
  cx.fillStyle = '#5a6aa3';
  cx.font = 'italic 900 185px "Trebuchet MS", Arial, sans-serif';
  cx.fillText('PRESTIGE', 512, 415);
  camps.forEach((camp, k) => {
    cx.fillStyle = camp.color;
    cx.beginPath();
    cx.roundRect(512 - 164 + k * 86, 540, 76, 22, 11);
    cx.fill();
  });
  const label = new THREE.CanvasTexture(cv);
  label.colorSpace = THREE.SRGBColorSpace;
  label.anisotropy = 8;
  const labelGeo = new THREE.PlaneGeometry(1.2, 0.75);
  labelGeo.rotateX(-Math.PI / 2);
  const text = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({
    map: label, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  text.position.y = 0.0095;
  text.rotation.y = Math.PI / 2; // reads along the long side of the card
  top.add(text);
  drop(top, cardsStart + COUNT * 0.03, { height: 0.5 + COUNT * 0.075, light: true, squash: false });
  cardDrops.push(drops[drops.length - 1]);
  cardDrops.forEach((d) => { d.rel = d.delay - cardsStart; });
  t += 0.1 + COUNT * 0.03 + STEP_T;
}
sides.forEach((side) => lightUp(side, 0));
// nothing lights up until the very last piece has landed, then every colored line switches on together
const LIGHT_AT = landed() + 0.1;
// the standalone lines (side stripes, road arcs, lane lines, arrow) stay hidden until the board has landed
const lines = lights.map((l) => l.obj);
lines.forEach((o) => { o.visible = false; });
const lineMats = new Set();
lines.forEach((o) => o.traverse((m) => { if (m.isMesh) lineMats.add(m.material); }));
const LINES_FADE = 1.4; // seconds to fade the lines in once the board has landed
let linesShown = false;
let linesDone = false;
drops.forEach((d) => { if (d.light) lightUp(d.obj, 0); });
lights.forEach((l) => { l.delay = LIGHT_AT; });

// ---- soft shadow on the ground ----
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.3 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
ground.receiveShadow = true;
ground.userData.hideInBloom = true;
scene.add(ground);

// ---- loop ----
const clamp01 = (v) => Math.min(1, Math.max(0, v));
let T0 = Infinity; // time the intro starts, set once the preloader is gone
const clock = new THREE.Clock();

function animateIntro(T) {
  if (!linesDone && T >= FALL) {
    if (!linesShown) {
      linesShown = true;
      lineMats.forEach((m) => { m.transparent = true; m.opacity = 0; });
      lines.forEach((o) => { o.visible = true; });
    }
    const k = clamp01((T - FALL) / LINES_FADE);
    lineMats.forEach((m) => { m.opacity = k * k * (3 - 2 * k); }); // smoothstep fade-in
    if (k >= 1) { linesDone = true; lineMats.forEach((m) => { m.transparent = false; m.opacity = 1; }); }
  }
  for (const d of drops) {
    if (d.backDelay !== undefined) {                          // click replay, part 1: the cards rise into an accordion (they stay visible)
      if (T < d.backDelay) continue;
      const v = clamp01((T - d.backDelay) / FALL);
      d.obj.position.y = d.y0 + d.height * (1 - (1 - v) * (1 - v));
      if (v < 1) continue;
      d.backDelay = undefined;
      d.keep = true;                                          // part 2 (the fall) starts from this raised position, without the intro's pop-in
      d.state = 0;
    }
    if (d.state === 3 || T < d.delay) continue;
    const u = (T - d.delay) / FALL;
    if (d.state === 0) { d.obj.visible = true; d.state = 1; }
    if (u < 1) {
      d.obj.position.y = d.y0 + d.height * (1 - u * u);       // gravity: accelerates down
      d.obj.scale.setScalar(d.keep ? 1 : 0.55 + 0.45 * clamp01(u * 4)); // pops in while falling (intro only)
    } else {
      if (d.state === 1) d.state = 2;
      const b = (T - d.delay - FALL) / 0.18;                  // small squash when landing
      d.obj.position.y = d.y0;
      d.obj.scale.set(1, 1 - (d.squash ? 0.14 : 0) * Math.sin(Math.PI * clamp01(b)), 1);
      if (b >= 1) { d.obj.scale.setScalar(1); d.state = 3; d.keep = false; }
    }
  }
  for (const l of lights) {
    if (!l.done && T >= l.delay) { startLight(l.obj, T); l.done = true; }
  }
  for (const m of litMats) {
    const lit = m.userData.lit;
    if (lit.t0 === null || lit.done) continue;
    const k = clamp01((T - lit.t0) / 0.6);
    m.emissiveIntensity = 0.8 * k + 0.9 * Math.sin(Math.PI * k); // switches on with a little flash
    m.color.copy(UNLIT).lerp(lit.target, 0.12 + 0.88 * k);
    if (k >= 1) lit.done = true;
  }
}

// slow auto-rotation, paused while the user is dragging and resumed after a short idle
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;
let resumeTimer;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener('end', () => { resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2500); });

// "Light" button: turns the glow on and off (fades, and skips the bloom render while it is off)
const lightButton = document.getElementById('light');
lightButton.classList.add('off');
lightButton.setAttribute('aria-pressed', 'false');
let glowOn = false;
lightButton.addEventListener('click', () => {
  glowOn = !glowOn;
  lightButton.classList.toggle('off', !glowOn);
  lightButton.setAttribute('aria-pressed', String(glowOn));
});

// click on the deck: replay the cards' fall (only the cards, the board stays as it is)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const overPile = (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(pileRoot, true).length > 0;
};
const introDone = () => lastT > LIGHT_AT;
const cardsIdle = () => cardDrops.every((d) => d.state === 3 && d.backDelay === undefined);
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // it was a drag
  downAt = null;
  if (!introDone() || !cardsIdle() || !overPile(e)) return;
  // the cards rise (top card first) into an accordion, then fall back (bottom card first)
  const start = lastT + 0.05;
  const span = Math.max(...cardDrops.map((d) => d.rel));
  cardDrops.forEach((d) => {
    d.backDelay = start + (span - d.rel);
    d.delay = start + span + FALL + d.rel;
  });
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons === 0) renderer.domElement.style.cursor = introDone() && cardsIdle() && overPile(e) ? 'pointer' : '';
});

let lastT = -Infinity;
renderer.setAnimationLoop(() => {
  const now = clock.getElapsedTime();
  lastT = now - T0;
  const amount = mixPass.uniforms.bloomAmount;
  amount.value += ((glowOn ? 1 : 0) - amount.value) * 0.15;
  if (!glowOn && amount.value < 0.005) amount.value = 0;
  animateIntro(now - T0);
  world.position.y = Math.sin(now * 1.2) * 0.06;
  controls.update();
  if (amount.value > 0) renderBloom();
  finalComposer.render();
});

// ---- preloader: compile every shader once with all pieces visible, then fade the loader out ----
drops.forEach((d) => { d.obj.visible = true; });
lines.forEach((o) => { o.visible = true; });
renderBloom();
finalComposer.render();
drops.forEach((d) => { d.obj.visible = false; });
lines.forEach((o) => { o.visible = false; });
setTimeout(() => {
  document.getElementById('loader').classList.add('done');
  T0 = clock.getElapsedTime() + 0.5;
}, 600);
