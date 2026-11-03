import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createInspector } from '../shared/inspect.js';

const params = new URLSearchParams(location.search);
if (params.has('thumb')) document.body.classList.add('thumb');

// Model + textures are the same files as the three.js car example, kept in ./assets.
// The Draco decoder lives in /public/draco (copied from the three package), two levels up from this page.
const MODEL = new URL('./assets/ferrari.glb', import.meta.url).href;
const AO = new URL('./assets/ferrari_ao.png', import.meta.url).href;
const HDR = new URL('./assets/venice_sunset_1k.hdr', import.meta.url).href;
const DRACO = new URL('../../draco/', location.href).href;
const BG = 0x0c0c0f;

// ---------- renderer / scene ----------

const canvas = document.getElementById('scene');
const loaderEl = document.getElementById('loader');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (err) {
  loaderEl.textContent = 'this one needs WebGL, and your browser said no.';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 9, 16);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);

new RGBELoader().load(HDR, (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = tex;
});

// floor grid: scrolling it is what makes the car "drive"
const grid = new THREE.GridHelper(40, 80, 0xffffff, 0xffffff);
grid.material.opacity = 0.12;
grid.material.depthWrite = false;
grid.material.transparent = true;
scene.add(grid);

// ---------- materials (swappable from the configurator) ----------

const M = {
  body: new THREE.MeshPhysicalMaterial({ color: 0xc8102e, metalness: 1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 }),
  rims: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1 }),
};

// ---------- the car ----------

const car = new THREE.Group();
scene.add(car);
const parts = []; // { node, base, offset (in node's parent space), delay, label }
const wheelNodes = [];
let front = 1; // +1 if the nose points down +z

const gltf = new GLTFLoader();
gltf.setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO));
gltf.load(
  MODEL,
  (g) => {
    const model = g.scene.children[0];
    car.add(model);

    const byName = (n) => model.getObjectByName(n);
    byName('body').material = M.body;
    byName('glass').material = M.glass;
    for (const n of ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim']) byName(n).material = M.rims;

    // baked contact shadow from the same example
    const ao = new THREE.TextureLoader().load(AO);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({ map: ao, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    model.add(shadow);

    car.updateMatrixWorld(true);
    const world = (o) => o.getWorldPosition(new THREE.Vector3());
    front = Math.sign(world(byName('wheel_fl')).z - world(byName('wheel_rl')).z) || 1;

    // offsets are given in world space and converted into each node's parent space
    const addPart = (node, worldOffset, delay, label) => {
      const p = node.parent;
      const from = p.worldToLocal(world(node));
      const to = p.worldToLocal(world(node).add(worldOffset));
      parts.push({ node, base: node.position.clone(), offset: to.sub(from), delay, label, labelAt: new THREE.Vector3() });
    };

    addPart(byName('body'), new THREE.Vector3(0, 1.3, 0), 0.05, ['Body', 'aluminium spaceframe, painted']);
    addPart(byName('trim'), new THREE.Vector3(0, 1.3, 0), 0.05, null);
    addPart(byName('glass'), new THREE.Vector3(0, 2.2, 0), 0.12, ['Glass', 'windscreen + engine cover']);
    for (const c of ['fl', 'fr', 'rl', 'rr']) {
      const w = byName(`wheel_${c}`);
      const side = Math.sign(world(w).x);
      const out = new THREE.Vector3(side * 1.1, 0, 0);
      addPart(w, out, 0, c === 'fl' ? ['Wheel', '20" forged, Pirelli P Zero'] : null);
      wheelNodes.push(w);
      // rims are sometimes separate from their tyre; keep them together
      const rim = byName(`rim_${c}`);
      if (rim && !w.getObjectById(rim.id)) addPart(rim, out, 0, null);
    }

    // anything we didn't move (interior, chassis, brakes…) stays put and gets revealed
    buildInspector(model);
    buildLabels();
    loaderEl.classList.add('done');
  },
  (e) => {
    // compressed responses can report a smaller total than what arrives, so cap it
    if (e.total) document.getElementById('pct').textContent = `${Math.min(99, Math.round((e.loaded / e.total) * 100))}%`;
  },
  (err) => {
    loaderEl.textContent = 'couldn’t load the car model. check your connection?';
    console.error(err);
  }
);

// ---------- inspect mode ----------
// The model's meshes are named after their material, so group them into things worth looking at.

const groups = {
  body: { names: ['body', 'yellow_trim'], info: { title: 'Body', sub: 'aluminium, painted', text: 'The painted shell: doors, bonnet, wings and the rear deck in one piece. Pick a colour at the end of the page and it repaints here too.' } },
  glass: { names: ['glass'], info: { title: 'Glass', sub: 'windscreen + side windows', text: 'Fully physical, light-transmitting glass. Tint it from the configurator.' } },
  lights: { names: ['lights', 'leds', 'lights_red'], info: { title: 'Lights', sub: 'LED clusters', text: 'Headlight housings with their LED strips, and the round tail lights.' } },
  cabin: { names: ['leather', 'carpet', 'interior_dark'], prefix: 'steering', info: { title: 'Cabin', sub: 'leather, carpet, a steering wheel full of buttons', text: 'Seats, dash, door cards and the carbon steering wheel, where the indicators, wipers and manettino all live.' } },
  carbon: { names: ['carbon_fibre', 'carbon_fibre_trim'], info: { title: 'Carbon fibre', sub: 'trim + aero', text: 'Diffuser, side sills and the other bits that are carbon mostly so they can say they are carbon.' } },
  trim: { names: ['trim', 'chrome', 'grills', 'wipers'], info: { title: 'Trim & chrome', sub: 'grilles, surrounds, wipers', text: 'The bright work: window surrounds, grilles, wipers and badges.' } },
  chassis: { names: ['interior_light', 'blue', 'metal', 'plastic_gray', 'brakes'], info: { title: 'Underpinnings', sub: 'chassis, suspension, brakes', text: 'Everything left once the pretty parts are gone: the floor, suspension, brake lines and engine bay hardware.' } },
};
const wheelInfo = { title: 'Wheel', sub: '20" forged, Pirelli P Zero', text: 'Tyre, rim, centre lock and the carbon-ceramic brake disc with its caliper, all hiding behind those spokes.' };

let inspector = null;
function buildInspector(model) {
  const byKey = {};
  const wheels = {};
  const partFor = (key, info, id = key) => (byKey[id] ??= { key, info, meshes: [] });
  model.traverse((o) => {
    if (!o.isMesh || o.material === undefined || o.parent === model && o.geometry.type === 'PlaneGeometry') return;
    // wheels: anything under wheel_xx, plus the rim_xx meshes
    let corner = null;
    for (let a = o; a && a !== model; a = a.parent) {
      const m = /^(?:wheel|rim)_(fl|fr|rl|rr)$/.exec(a.name);
      if (m) corner = m[1];
    }
    if (corner) return (wheels[corner] ??= partFor('wheel', wheelInfo, `wheel_${corner}`)).meshes.push(o);
    const base = o.name.replace(/_\d+$/, '');
    const key = Object.keys(groups).find((k) => groups[k].names.includes(base) || (groups[k].prefix && base.startsWith(groups[k].prefix))) || 'chassis';
    partFor(key, groups[key].info).meshes.push(o);
  });
  const order = ['body', 'glass', 'lights', 'cabin', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'carbon', 'trim', 'chassis'];
  inspector = createInspector({ camera, canvas, parts: order.map((k) => byKey[k]).filter(Boolean) });
  // re-apply the configurator's current choices to the cloned materials
  applyRims(rimChoice);
  applyGlass(glassChoice);
  if (params.has('inspect')) inspector.enter(params.get('inspect')); // e.g. ?inspect=cabin
}
const mats = (m) => (inspector ? inspector.variants(m) : [m]);

// ---------- labels ----------

const labelsEl = document.getElementById('labels');
function buildLabels() {
  for (const p of parts) {
    if (!p.label) continue;
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `<span><b>${p.label[0]}</b> <i>${p.label[1]}</i></span>`;
    labelsEl.appendChild(el);
    p.el = el;
  }
}

// ---------- scroll timeline ----------
// Camera keys are written as if the nose points at +z; `front` flips them if the model disagrees.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const keys = [
  { pos: V(4.4, 1.1, 4.8), target: V(0, 0.45, 0.3), explode: 0, drive: 0 },
  { pos: V(6.8, 0.9, 0.4), target: V(0, 0.5, 0), explode: 0, drive: 1 },
  { pos: V(5.4, 4.4, 5.8), target: V(0, 1.2, 0), explode: 1, drive: 0 },
  { pos: V(-2.6, 0.8, -5.2), target: V(0, 0.55, -0.6), explode: 0, drive: 0 },
  { pos: V(-4.8, 1.9, 4.6), target: V(0.4, 0.45, 0), explode: 0, drive: 0 },
];

const sections = [...document.querySelectorAll('main section')];
const dotsEl = document.getElementById('dots');
const dots = sections.map((sec, i) => {
  sec.id = `stage-${i}`;
  const b = document.createElement('button');
  b.setAttribute('aria-label', `section ${i + 1}`);
  b.addEventListener('click', () => sec.scrollIntoView({ behavior: 'smooth' }));
  dotsEl.appendChild(b);
  return b;
});

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function sample(s) {
  const i = Math.min(Math.floor(s), keys.length - 2);
  const t = smooth(clamp01((s - i - 0.15) / 0.7));
  const a = keys[i];
  const b = keys[i + 1];
  const flip = (v) => v.clone().setZ(v.z * front);
  return {
    pos: flip(a.pos).lerp(flip(b.pos), t),
    target: flip(a.target).lerp(flip(b.target), t),
    explode: a.explode + (b.explode - a.explode) * t,
    drive: a.drive + (b.drive - a.drive) * t,
  };
}

// ---------- drag to spin ----------

let yaw = 0;
let yawVel = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let lastDrag = -Infinity;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.classList.add('dragging');
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (inspector?.active) return inspector.drag(dx, dy);
  yaw -= dx * 0.006;
  yawVel = -dx * 0.006;
  lastDrag = performance.now();
});
const endDrag = () => {
  dragging = false;
  canvas.classList.remove('dragging');
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);

// ---------- configurator ----------

function swatches(id, options, apply) {
  const el = document.getElementById(id);
  options.forEach(([name, css, value], i) => {
    const b = document.createElement('button');
    b.title = name;
    b.style.background = css;
    if (i === 0) b.classList.add('active');
    b.addEventListener('click', () => {
      apply(value);
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    });
    el.appendChild(b);
  });
}

const paintTarget = M.body.color.clone();
let rimChoice = [0xffffff, 0.5];
let glassChoice = 0xffffff;
function applyRims([hex, rough]) {
  for (const m of mats(M.rims)) {
    m.color.setHex(hex);
    m.roughness = rough;
  }
}
function applyGlass(hex) {
  for (const m of mats(M.glass)) m.color.setHex(hex);
}
swatches(
  'paint',
  [
    ['Rosso Corsa', '#c8102e', 0xc8102e],
    ['Giallo Modena', '#ffd400', 0xffc800],
    ['Blu Pozzi', '#1e3f8a', 0x1e3f8a],
    ['Verde', '#0d5c3a', 0x0d5c3a],
    ['Bianco', '#eeeeea', 0xeeeeea],
    ['Nero', '#151517', 0x151517],
  ],
  (hex) => paintTarget.setHex(hex)
);
swatches(
  'rims',
  [
    ['Silver', '#d9d9d9', [0xffffff, 0.5]],
    ['Gloss black', '#1a1a1a', [0x111111, 0.2]],
    ['Gold', '#c9a14a', [0xc9a14a, 0.35]],
  ],
  (choice) => applyRims((rimChoice = choice))
);
swatches(
  'glass',
  [
    ['Clear', 'linear-gradient(135deg,#fff,#bcd)', 0xffffff],
    ['Tinted', 'linear-gradient(135deg,#556,#112)', 0x555566],
    ['Bronze', 'linear-gradient(135deg,#c96,#530)', 0xcc9966],
  ],
  (hex) => applyGlass((glassChoice = hex))
);

// ---------- loop ----------

const forcedStage = params.has('s') ? Number(params.get('s')) : null;
let cur = null;
let driven = 0;
const Y = V(0, 1, 0);
const tmp = new THREE.Vector3();
const bar = document.getElementById('bar');
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  const maxScroll = document.documentElement.scrollHeight - innerHeight;
  const s = forcedStage ?? (maxScroll > 0 ? (scrollY / maxScroll) * (keys.length - 1) : 0);
  bar.style.width = `${(s / (keys.length - 1)) * 100}%`;
  dots.forEach((d, i) => d.classList.toggle('active', i === Math.round(s)));

  const goal = sample(s);
  cur ??= { pos: goal.pos.clone(), target: goal.target.clone(), explode: goal.explode, drive: goal.drive };
  const k = 1 - Math.exp(-dt * 4);
  cur.pos.lerp(goal.pos, k);
  cur.target.lerp(goal.target, k);
  cur.explode += (goal.explode - cur.explode) * k;
  cur.drive += (goal.drive - cur.drive) * k;

  if (!dragging) {
    yaw += yawVel;
    yawVel *= 0.94;
    const idle = now - lastDrag > 2500;
    if (s < 0.4 && idle) yaw += dt * 0.12;
    else if (idle) {
      const home = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
      yaw += (home - yaw) * (1 - Math.exp(-dt * 1.5));
    }
  }

  camera.position.copy(cur.pos).applyAxisAngle(Y, yaw);
  tmp.copy(cur.target).applyAxisAngle(Y, yaw);
  // inspecting a part: glide from the story camera to an orbit around that part
  const insp = inspector?.update(dt);
  if (insp) {
    camera.position.lerp(insp.pos, insp.blend);
    tmp.lerp(insp.target, insp.blend);
  }
  camera.lookAt(tmp);

  // drive: spin the wheels, slide the floor backwards
  const speed = cur.drive * 9; // metres per second
  driven += speed * dt;
  grid.position.z = -front * (driven % 0.5);
  for (const w of wheelNodes) w.rotation.x = (driven / 0.34) * front;

  for (const p of parts) {
    const e = smooth(clamp01(cur.explode * 1.25 - p.delay));
    p.node.position.copy(p.base).addScaledVector(p.offset, e);
  }

  for (const m of mats(M.body)) m.color.lerp(paintTarget, 0.08);

  renderer.render(scene, camera);

  const show = clamp01((cur.explode - 0.7) / 0.3);
  for (const p of parts) {
    if (!p.el) continue;
    p.node.getWorldPosition(tmp);
    tmp.y += 0.6;
    tmp.project(camera);
    const x = (tmp.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * innerHeight;
    p.el.style.opacity = tmp.z > 1 ? 0 : show;
    p.el.style.transform = `translate(${x - 3.5}px, ${y - 12}px)`;
  }

  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: 'instant' });
frame();
