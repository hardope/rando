import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createInspector } from '../shared/inspect.js';

const params = new URLSearchParams(location.search);
if (params.has('thumb')) document.body.classList.add('thumb');

// ---------- renderer / scene ----------

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  document.getElementById('loader').textContent = 'this one needs WebGL, and your browser said no.';
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 9, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const rim = new THREE.DirectionalLight(0x88aaff, 1.4);
rim.position.set(-6, 3, -5);
scene.add(rim);

// showroom floor: shadow catcher + soft glow + a thin ring
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.5 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const glow = new THREE.Mesh(
  new THREE.CircleGeometry(5.5, 64),
  new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false })
);
glow.rotation.x = -Math.PI / 2;
glow.position.y = 0.002;
scene.add(glow);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(4.6, 4.63, 128),
  new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.35 })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.003;
scene.add(ring);

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- materials ----------

const M = {
  paint: new THREE.MeshPhysicalMaterial({ color: 0xc8102e, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x2a3a4c, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.5, clearcoat: 1, depthWrite: false }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.12 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x2c2d31, metalness: 0.8, roughness: 0.4 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x111113, metalness: 0.4, roughness: 0.35 }),
  caliper: new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.3, roughness: 0.35 }),
  engine: new THREE.MeshStandardMaterial({ color: 0xb3121f, metalness: 0.5, roughness: 0.3 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x3d2418, roughness: 0.65 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 2.5 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x001018, emissive: 0x3fb6ff, emissiveIntensity: 1.6 }),
  carpet: new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 1 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 3 }),
};

// ---------- geometry helpers ----------

function mesh(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function rbox(w, h, d, r = 0.03) {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2 - 0.001));
}

const cyl = (r, h, seg = 32, r2 = r) => new THREE.CylinderGeometry(r, r2, h, seg);

// ---------- the car ----------
// Every part has a resting position and an "exploded" offset. Scroll blends between them.

const car = new THREE.Group();
scene.add(car);
const parts = [];

function addPart(obj, { offset, rot = [0, 0, 0], delay = 0, spin = null, label = null, labelAt = [0, 0, 0], key = null }) {
  car.add(obj);
  parts.push({
    obj,
    key,
    base: obj.position.clone(),
    offset: new THREE.Vector3(...offset),
    baseRot: obj.rotation.clone(),
    rot: new THREE.Vector3(...rot),
    delay,
    spin,
    label,
    labelAt: new THREE.Vector3(...labelAt),
  });
}

// body: one side profile, cut into a nose, a tail and two doors so the cockpit stays open from above
const extrude = (shape, depth, bevelThickness = 0.08, bevelSize = 0.06) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness, bevelSize, bevelSegments: 5, curveSegments: 32 });

{
  const nose = new THREE.Shape();
  nose.moveTo(0.62, 0.32);
  nose.lineTo(0.83, 0.32);
  nose.absarc(1.3, 0.36, 0.47, Math.PI, 0, true);
  nose.lineTo(2.15, 0.32);
  nose.quadraticCurveTo(2.34, 0.4, 2.3, 0.56);
  nose.quadraticCurveTo(2.24, 0.74, 1.95, 0.79);
  nose.lineTo(0.85, 0.98);
  nose.lineTo(0.62, 0.985);
  nose.lineTo(0.62, 0.32);

  const tail = new THREE.Shape();
  tail.moveTo(-2.15, 0.32);
  tail.lineTo(-1.77, 0.32);
  tail.absarc(-1.3, 0.36, 0.47, Math.PI, 0, true);
  tail.lineTo(-0.77, 0.32);
  tail.lineTo(-0.77, 0.99);
  tail.lineTo(-1.1, 0.99);
  tail.lineTo(-1.95, 0.95);
  tail.quadraticCurveTo(-2.27, 0.92, -2.27, 0.7);
  tail.quadraticCurveTo(-2.27, 0.4, -2.15, 0.32);

  const body = new THREE.Group();
  for (const shape of [nose, tail]) {
    const geo = extrude(shape, 1.7);
    geo.translate(0, 0, -0.85);
    body.add(mesh(geo, M.paint));
  }
  for (const z of [-0.58, 0.58]) {
    body.add(mesh(rbox(0.24, 0.06, 0.4, 0.025), M.headlight, [2.13, 0.79, z], [0, 0, -0.3]));
    body.add(mesh(rbox(0.5, 0.012, 0.03, 0.005), M.carbon, [1.45, 0.94, z * 0.4], [0, 0, -0.17])); // hood vents
  }
  body.add(mesh(rbox(0.05, 0.05, 1.5, 0.02), M.taillight, [-2.33, 0.8, 0]));
  body.add(mesh(rbox(0.06, 0.16, 1.1, 0.03), M.carbon, [2.3, 0.48, 0]));
  body.add(mesh(rbox(0.1, 0.08, 1.7, 0.03), M.carbon, [-2.25, 0.36, 0])); // diffuser
  addPart(body, { key: 'body', offset: [0, 1.5, 0], delay: 0.05, label: ['Body shell', 'carbon monocoque'], labelAt: [1.5, 0.95, 0.9] });

  // doors: thin panels that fill the gap, with a shut line either side
  const doorShape = new THREE.Shape();
  doorShape.moveTo(-0.66, 0.34);
  doorShape.lineTo(0.5, 0.34);
  doorShape.lineTo(0.5, 0.97);
  doorShape.lineTo(-0.66, 0.97);
  doorShape.lineTo(-0.66, 0.34);
  const doorGeo = extrude(doorShape, 0.06, 0.04, 0.04);
  doorGeo.translate(0, 0, -0.1); // outer skin at local z = 0

  for (const side of [1, -1]) {
    const door = new THREE.Group();
    door.position.z = side * 0.93;
    door.scale.z = side; // mirror the left door
    door.add(mesh(doorGeo, M.paint));
    door.add(mesh(rbox(0.32, 0.13, 0.03, 0.01), M.carbon, [-0.42, 0.6, 0.0])); // side intake
    door.add(mesh(rbox(0.14, 0.025, 0.025, 0.01), M.chrome, [-0.05, 0.86, 0.01])); // handle
    door.add(mesh(rbox(0.16, 0.09, 0.16, 0.03), M.paint, [0.4, 1.06, 0.06])); // mirror
    addPart(door, {
      key: side > 0 ? 'door' : null,
      offset: [0, 0.45, side * 1.0],
      rot: [side * 0.35, 0, 0],
      delay: 0.02,
      label: side > 0 ? ['Doors', 'dihedral, carbon skin'] : null,
      labelAt: [-0.1, 0.95, 0],
    });
  }
}

// glasshouse
{
  const s = new THREE.Shape();
  s.moveTo(0.9, 0.97);
  s.lineTo(0.0, 1.4);
  s.quadraticCurveTo(-0.3, 1.44, -0.8, 1.42);
  s.quadraticCurveTo(-1.25, 1.38, -1.5, 0.97);
  s.lineTo(0.9, 0.97);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.36, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 4, curveSegments: 24 });
  geo.translate(0, 0, -0.68);
  const cabin = mesh(geo, M.glass);
  cabin.castShadow = false;
  addPart(cabin, { key: 'cabin', offset: [0, 2.5, 0], delay: 0.12, label: ['Glasshouse', 'tinted polycarbonate'], labelAt: [-0.4, 1.5, 0.7] });
}

// rear wing
{
  const wing = new THREE.Group();
  wing.add(mesh(rbox(0.38, 0.04, 1.75, 0.02), M.carbon, [-1.98, 1.28, 0], [0, 0, 0.08]));
  for (const z of [-0.88, 0.88]) wing.add(mesh(rbox(0.42, 0.18, 0.02, 0.01), M.carbon, [-1.98, 1.25, z]));
  for (const z of [-0.45, 0.45]) wing.add(mesh(rbox(0.08, 0.32, 0.03, 0.01), M.carbon, [-1.9, 1.1, z]));
  addPart(wing, { key: 'wing', offset: [-0.5, 2.3, 0], delay: 0.18, label: ['Rear wing', 'active aero'], labelAt: [-1.98, 1.32, 0.88] });
}

// wheels + brakes
function makeWheel() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  spin.add(mesh(cyl(0.36, 0.26, 48), M.rubber, [0, 0, 0], [Math.PI / 2, 0, 0]));
  for (const z of [-0.12, 0.12]) spin.add(mesh(new THREE.TorusGeometry(0.3, 0.075, 16, 48), M.rubber, [0, 0, z]));
  spin.add(mesh(cyl(0.27, 0.22, 40), M.metal, [0, 0, 0], [Math.PI / 2, 0, 0]));
  spin.add(mesh(new THREE.TorusGeometry(0.27, 0.016, 8, 48), M.chrome, [0, 0, 0.11]));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2) * 0.12; // spokes in V pairs
    spin.add(mesh(rbox(0.032, 0.23, 0.03, 0.012), M.chrome, [Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0.125], [0, 0, -a]));
  }
  spin.add(mesh(cyl(0.06, 0.04, 6), M.chrome, [0, 0, 0.13], [Math.PI / 2, 0, 0]));
  return { g, spin };
}

const corners = [
  [1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8],
];
corners.forEach(([x, z], i) => {
  const sz = Math.sign(z);
  const sx = Math.sign(x);

  const brake = new THREE.Group();
  brake.position.set(x, 0.37, sz * 0.66);
  brake.add(mesh(cyl(0.21, 0.025, 40), M.metal, [0, 0, 0], [Math.PI / 2, 0, 0]));
  brake.add(mesh(rbox(0.16, 0.09, 0.08, 0.03), M.caliper, [0.08 * sx, 0.17, 0]));
  addPart(brake, {
    key: 'brake',
    offset: [sx * 0.15, 0, sz * 0.5],
    delay: 0.08,
    label: i === 0 ? ['Brake', 'carbon-ceramic, 6-pot'] : null,
    labelAt: [0.08, 0.22, 0],
  });

  const { g, spin } = makeWheel();
  g.position.set(x, 0.37, z);
  if (sz < 0) g.rotation.y = Math.PI;
  addPart(g, {
    key: 'wheel',
    offset: [sx * 0.25, 0, sz * 1.5],
    delay: 0,
    spin,
    label: i === 0 ? ['Wheel', '21" forged, 10-spoke'] : null,
    labelAt: [0, 0.38, 0],
  });
});

// engine
{
  const e = new THREE.Group();
  e.position.set(1.45, 0.5, 0);
  e.add(mesh(rbox(0.75, 0.3, 0.5, 0.04), M.metal));
  for (const side of [-1, 1]) {
    e.add(mesh(rbox(0.72, 0.09, 0.24, 0.03), M.engine, [0, 0.19, side * 0.2], [side * 0.5, 0, 0]));
    for (let k = 0; k < 4; k++) {
      e.add(mesh(cyl(0.022, 0.17, 12), M.chrome, [-0.27 + k * 0.18, 0.25, side * 0.1], [side * 1.1, 0, 0]));
    }
  }
  e.add(mesh(cyl(0.06, 0.72, 24), M.chrome, [0, 0.29, 0], [0, 0, Math.PI / 2]));
  e.add(mesh(cyl(0.09, 0.05, 24), M.metal, [0.4, 0, 0.12], [0, 0, Math.PI / 2]));
  e.add(mesh(cyl(0.06, 0.05, 24), M.metal, [0.4, 0.05, -0.15], [0, 0, Math.PI / 2]));
  addPart(e, { key: 'engine', offset: [1.0, 0.75, 0], delay: 0.15, label: ['Engine', '4.0L flat-plane V8'], labelAt: [0, 0.35, 0] });
}

// cockpit: open to the sky now, so it gets some detail
{
  const c = new THREE.Group();
  c.add(mesh(rbox(1.3, 0.02, 1.4, 0.01), M.carpet, [-0.05, 0.335, 0]));
  for (const side of [-1, 1]) {
    const seat = new THREE.Group();
    seat.position.set(-0.3, 0.42, side * 0.36);
    seat.add(mesh(rbox(0.46, 0.1, 0.4, 0.04), M.leather));
    for (const b of [-1, 1]) seat.add(mesh(rbox(0.42, 0.12, 0.06, 0.03), M.leather, [0, 0.07, b * 0.2]));
    const back = new THREE.Group();
    back.position.set(-0.22, 0.05, 0);
    back.rotation.z = 0.22;
    back.add(mesh(rbox(0.1, 0.62, 0.4, 0.04), M.leather, [0, 0.31, 0]));
    for (const b of [-1, 1]) back.add(mesh(rbox(0.14, 0.5, 0.06, 0.03), M.leather, [0.04, 0.28, b * 0.2])); // bolsters
    back.add(mesh(rbox(0.11, 0.17, 0.26, 0.04), M.leather, [0, 0.7, 0])); // headrest
    back.add(mesh(rbox(0.012, 0.6, 0.05, 0.005), M.engine, [0.056, 0.36, 0])); // racing stripe
    seat.add(back);
    c.add(seat);
  }
  c.add(mesh(rbox(0.32, 0.16, 1.3, 0.04), M.carbon, [0.5, 0.86, 0])); // dash
  c.add(mesh(rbox(0.02, 0.14, 0.3, 0.008), M.screen, [0.34, 0.92, -0.05], [0, 0, 0.35])); // centre screen
  c.add(mesh(rbox(0.12, 0.08, 0.3, 0.03), M.carbon, [0.38, 0.97, 0.36])); // binnacle
  c.add(mesh(rbox(0.02, 0.05, 0.22, 0.006), M.screen, [0.32, 0.97, 0.36], [0, 0, 0.3])); // gauges
  c.add(mesh(rbox(0.85, 0.2, 0.18, 0.04), M.carbon, [0.05, 0.44, 0])); // console
  c.add(mesh(cyl(0.012, 0.12, 8), M.chrome, [0.1, 0.6, 0]));
  c.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), M.chrome, [0.1, 0.67, 0])); // gear knob
  const wheel = new THREE.Group();
  wheel.position.set(0.24, 0.88, 0.36);
  wheel.rotation.set(0, Math.PI / 2, 0.0);
  wheel.add(mesh(new THREE.TorusGeometry(0.13, 0.02, 12, 32), M.leather));
  wheel.add(mesh(rbox(0.24, 0.03, 0.02, 0.01), M.metal));
  wheel.add(mesh(cyl(0.02, 0.25, 8), M.metal, [0, 0, -0.12], [Math.PI / 2, 0, 0])); // column
  c.add(wheel);
  addPart(c, { key: 'cockpit', offset: [0, 0.35, 0], delay: 0.1, label: ['Cockpit', 'two buckets, no cupholder'], labelAt: [-0.5, 1.3, 0.36] });
}

// exhaust
{
  const x = new THREE.Group();
  x.add(mesh(rbox(0.6, 0.14, 0.9, 0.05), M.metal, [-1.85, 0.32, 0]));
  for (const z of [-0.32, 0.32]) x.add(mesh(cyl(0.055, 0.32, 24, 0.065), M.chrome, [-2.25, 0.36, z], [0, 0, Math.PI / 2]));
  addPart(x, { key: 'exhaust', offset: [-0.9, 0, 0], delay: 0.1, label: ['Exhaust', 'titanium, quad-tip'], labelAt: [-2.4, 0.36, 0.32] });
}

// chassis stays put — everything else leaves it
{
  const ch = new THREE.Group();
  ch.add(mesh(rbox(3.7, 0.06, 1.45, 0.03), M.metal, [0, 0.29, 0]));
  for (const x of [-1.3, 1.3]) ch.add(mesh(cyl(0.035, 1.3, 12), M.metal, [x, 0.37, 0], [Math.PI / 2, 0, 0]));
  ch.add(mesh(cyl(0.04, 2.4, 12), M.metal, [0, 0.36, 0], [0, 0, Math.PI / 2]));
  addPart(ch, { key: 'chassis', offset: [0, 0, 0], label: ['Chassis', 'bonded aluminium tub'], labelAt: [-0.9, 0.32, -0.72] });
}

// ---------- inspect mode ----------

const info = {
  body: { title: 'Body shell', sub: 'nose + tail, one extruded profile', text: 'A single side profile (a few curves and two wheel arches) is extruded across the car and bevelled. It is cut into a nose and a tail so the cockpit stays open.' },
  door: { title: 'Doors', sub: 'dihedral, carbon skin', text: 'Thin panels that fill the gap between nose and tail, with a side intake, a chrome handle and a mirror. Shut lines included at no extra cost.' },
  cabin: { title: 'Glasshouse', sub: 'tinted polycarbonate', text: 'A second extruded profile, tinted just enough that you can still see the seats through it.' },
  wing: { title: 'Rear wing', sub: 'active aero', text: 'A carbon blade on two struts with end plates. Adds downforce, and also attitude.' },
  wheel: { title: 'Wheel', sub: '21" forged, 10-spoke', text: 'A tyre with two rounded sidewalls, a dark barrel, a chrome lip and ten spokes in V pairs. It spins as it slides off the hub.' },
  brake: { title: 'Brake', sub: 'carbon-ceramic, 6-pot', text: 'A disc and a yellow caliper. They hide behind the wheel until it comes off.' },
  engine: { title: 'Engine', sub: '4.0L flat-plane V8', text: 'A block, two tilted red heads, a chrome plenum and eight intake runners. It has never run, and never will.' },
  cockpit: { title: 'Cockpit', sub: 'two buckets, no cupholder', text: 'Bolstered bucket seats with racing stripes, a carbon dash with a glowing screen and gauges, a gear knob and a wheel on its column.' },
  exhaust: { title: 'Exhaust', sub: 'titanium, quad-tip', text: 'A silencer box feeding two chrome tips. Quieter than it looks.' },
  chassis: { title: 'Chassis', sub: 'bonded aluminium tub', text: 'The floor, both axles and a driveshaft. The only part that never moves.' },
};
for (const p of parts) {
  p.meshes = [];
  p.obj.traverse((o) => o.isMesh && p.meshes.push(o));
  p.info = info[p.key] || null;
}
const inspector = createInspector({ camera, canvas, parts });

// ---------- labels ----------

const labelsEl = document.getElementById('labels');
for (const p of parts) {
  if (!p.label) continue;
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<span><b>${p.label[0]}</b> <i>${p.label[1]}</i></span>`;
  labelsEl.appendChild(el);
  p.el = el;
}

// ---------- scroll timeline ----------
// One keyframe per <section>. Camera position, look-at target, how exploded, which labels to emphasise.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const keys = [
  { pos: V(6.5, 2.2, 7.5), target: V(0, 0.7, 0), explode: 0 },
  { pos: V(-1.5, 0.9, 9), target: V(0, 0.65, 0), explode: 0 },
  { pos: V(8, 5.5, 9), target: V(0, 1.6, 0), explode: 1 },
  { pos: V(3.8, 1.0, 5.3), target: V(1.5, 0.45, 1.9), explode: 1, focus: ['wheel', 'brake'] },
  { pos: V(7, 3.2, 3.8), target: V(2.2, 1.1, 0.3), explode: 1, focus: ['engine'] },
  { pos: V(-0.3, 4.6, 5.4), target: V(-0.1, 0.8, 0), explode: 1, focus: ['cockpit'] },
  { pos: V(5.6, 1.0, -5.6), target: V(0, 0.6, 0), explode: 0 },
];

const sections = [...document.querySelectorAll('main section')];
const dotsEl = document.getElementById('dots');
const dots = sections.map((sec, i) => {
  sec.id = `stage-${i}`; // deep-linkable: #stage-3 jumps to the wheels
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
  // hold each view for a bit around its section, then glide to the next
  const t = smooth(clamp01((s - i - 0.15) / 0.7));
  const a = keys[i];
  const b = keys[i + 1];
  const focusOf = (k) => k.focus || null;
  return {
    pos: a.pos.clone().lerp(b.pos, t),
    target: a.target.clone().lerp(b.target, t),
    explode: a.explode + (b.explode - a.explode) * t,
    focus: t < 0.5 ? focusOf(a) : focusOf(b),
  };
}

// ---------- drag to spin (rotates the camera around the car) ----------

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
  if (inspector.active) return inspector.drag(dx, dy);
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

// ---------- paint ----------

const paints = [
  ['Rosso', 0xc8102e],
  ['Papaya', 0xff7a00],
  ['Acid', 0xa6e300],
  ['Midnight', 0x1b2a4a],
  ['Pearl', 0xe8e6df],
  ['Graphite', 0x2b2d30],
];
const paintTarget = M.paint.color.clone();
const swatchesEl = document.getElementById('swatches');
paints.forEach(([name, hex], i) => {
  const b = document.createElement('button');
  b.title = name;
  b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
  if (i === 0) b.classList.add('active');
  b.addEventListener('click', () => {
    paintTarget.setHex(hex);
    swatchesEl.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  });
  swatchesEl.appendChild(b);
});

// ---------- loop ----------

// ?s=2.5 pins the timeline to a stage (handy for screenshots)
const forcedStage = params.has('s') ? Number(params.get('s')) : null;
let cur = null; // set from the scroll position on the first frame, so deep links don't animate in
const Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const bar = document.getElementById('bar');
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  const maxScroll = document.documentElement.scrollHeight - innerHeight;
  const s = forcedStage ?? (maxScroll > 0 ? (scrollY / maxScroll) * (keys.length - 1) : 0);
  bar.style.width = `${(s / (keys.length - 1)) * 100}%`;
  const active = Math.round(s);
  dots.forEach((d, i) => d.classList.toggle('active', i === active));

  const goal = sample(s);
  cur ??= { pos: goal.pos.clone(), target: goal.target.clone(), explode: goal.explode };
  const k = 1 - Math.exp(-dt * 4);
  cur.pos.lerp(goal.pos, k);
  cur.target.lerp(goal.target, k);
  cur.explode += (goal.explode - cur.explode) * k;

  // spin: inertia, gentle idle rotation on the hero, and drift home once the story moves on
  if (!dragging) {
    yaw += yawVel;
    yawVel *= 0.94;
    const idle = now - lastDrag > 2500;
    if (s < 0.4 && idle) yaw += dt * 0.15;
    else if (idle) {
      const home = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
      yaw += (home - yaw) * (1 - Math.exp(-dt * 1.5));
    }
  }

  camera.position.copy(cur.pos).applyAxisAngle(Y, yaw);
  tmp.copy(cur.target).applyAxisAngle(Y, yaw);
  // inspecting a part: glide from the story camera to an orbit around that part
  const insp = inspector.update(dt);
  if (insp) {
    camera.position.lerp(insp.pos, insp.blend);
    tmp.lerp(insp.target, insp.blend);
  }
  camera.lookAt(tmp);

  // move parts
  for (const p of parts) {
    const e = smooth(clamp01(cur.explode * 1.25 - p.delay));
    p.obj.position.copy(p.base).addScaledVector(p.offset, e);
    p.obj.rotation.set(p.baseRot.x + p.rot.x * e, p.baseRot.y + p.rot.y * e, p.baseRot.z + p.rot.z * e);
    if (p.spin) p.spin.rotation.z = e * Math.PI * 2;
  }

  for (const m of inspector.variants(M.paint)) m.color.lerp(paintTarget, 0.08);

  renderer.render(scene, camera);

  // labels follow their parts in screen space
  const show = clamp01((cur.explode - 0.7) / 0.3);
  for (const p of parts) {
    if (!p.el) continue;
    tmp.copy(p.labelAt).add(p.obj.position).project(camera);
    const behind = tmp.z > 1;
    const x = (tmp.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * innerHeight;
    const emph = !goal.focus || goal.focus.includes(p.key) ? 1 : 0.2;
    p.el.style.opacity = behind ? 0 : show * emph;
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
document.getElementById('loader').classList.add('done');
if (params.has('inspect')) inspector.enter(params.get('inspect')); // e.g. ?s=2&inspect=engine
