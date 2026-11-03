// Click a part of a 3D model to inspect it: everything else fades away, the camera orbits
// the part, and a panel describes it. Shared by the GT-0 and 458 pages.
//
// parts: [{ key, meshes: Mesh[], info: { title, sub, text } }]
// Each part's meshes get their own material clones so they can fade independently;
// use `variants(original)` to restyle every clone of a shared material.

import * as THREE from 'three';

const css = `
.inspect-panel {
  position: fixed; z-index: 6; left: 50%; bottom: 24px;
  width: min(440px, calc(100vw - 32px));
  padding: 18px 22px;
  border-radius: 16px;
  background: rgba(14, 14, 18, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  color: var(--fg, #eee);
  transform: translate(-50%, 140%);
  transition: transform 0.45s cubic-bezier(.2,.8,.2,1);
}
.inspect-panel.open { transform: translate(-50%, 0); }
.inspect-panel .k { margin: 0; font: 11px var(--mono, monospace); letter-spacing: .08em; text-transform: uppercase; color: var(--accent, #f43); }
.inspect-panel h3 { margin: 4px 0 2px; font-size: 24px; letter-spacing: -.02em; }
.inspect-panel .sub { margin: 0 0 8px; font: 12px var(--mono, monospace); color: var(--dim, #999); }
.inspect-panel .txt { margin: 0; line-height: 1.5; color: #c4c3bd; }
.inspect-panel .row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font: 11px var(--mono, monospace); color: var(--dim, #999); }
.inspect-panel button { padding: 6px 12px; border: 0; border-radius: 999px; background: #fff; color: #111; font: inherit; cursor: pointer; }
.inspect-panel .nav button { background: rgba(255,255,255,.12); color: #fff; margin-left: 6px; }
body.inspecting main, body.inspecting #labels, body.inspecting .dots, body.inspecting .credit { opacity: 0; pointer-events: none !important; }
body.inspecting main * { pointer-events: none !important; }
main, #labels, .dots { transition: opacity .4s; }
body.inspecting { overflow: hidden; }
`;

export function createInspector({ camera, canvas, parts, onEnter, onExit }) {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  // ---- per-part material clones ----
  const clones = new Map(); // original material -> [clones]
  const meshToPart = new Map();
  const pickable = [];
  for (const p of parts) {
    p.fade = 1;
    p.mats = [];
    for (const m of p.meshes) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map((orig) => {
        const c = orig.clone();
        c.userData.base = { opacity: c.opacity, transparent: c.transparent, depthWrite: c.depthWrite };
        if (!clones.has(orig)) clones.set(orig, []);
        clones.get(orig).push(c);
        p.mats.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
      meshToPart.set(m, p);
      pickable.push(m);
    }
  }
  const variants = (orig) => clones.get(orig) || [];

  function applyFade(p) {
    for (const c of p.mats) {
      const b = c.userData.base;
      const solid = p.fade > 0.995;
      c.transparent = solid ? b.transparent : true;
      c.opacity = b.opacity * p.fade;
      c.depthWrite = solid ? b.depthWrite : false;
    }
    for (const m of p.meshes) m.visible = p.fade > 0.01;
  }

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickable.filter((m) => m.visible), false);
    if (!hits.length) return null;
    // see-through things (glass) lose to whatever is behind them
    const solid = hits.find((h) => !(meshToPart.get(h.object).mats[0]?.userData.base.transparent));
    return meshToPart.get((solid || hits[0]).object);
  }

  // ---- panel ----
  const panel = document.createElement('div');
  panel.className = 'inspect-panel';
  panel.innerHTML = `<p class="k">inspecting</p><h3></h3><p class="sub"></p><p class="txt"></p>
    <div class="row"><span>drag to orbit · esc to exit</span><span class="nav"><button data-d="-1">←</button><button data-d="1">→</button><button class="close">done</button></span></div>`;
  document.body.appendChild(panel);
  panel.querySelector('.close').addEventListener('click', () => exit());
  panel.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.d))));

  // one stop per key for the ← → buttons (four wheels are one stop)
  const stops = parts.filter((p, i) => p.info && parts.findIndex((q) => q.key === p.key) === i);
  function step(d) {
    if (!active) return;
    const i = stops.findIndex((p) => p.key === active.key);
    enter(stops[(i + d + stops.length) % stops.length], false);
  }

  // ---- state ----
  let active = null;
  let blend = 0;
  const orbit = { az: 0, el: 0.4, dist: 3, vel: 0 };
  let lastDrag = -Infinity;
  const center = new THREE.Vector3();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();

  function bounds(p) {
    box.makeEmpty();
    for (const m of p.meshes) box.union(tmp.setFromObject(m));
    return box;
  }

  function enter(p, fromCamera = true) {
    active = p;
    const b = bounds(p);
    b.getCenter(center);
    const radius = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.15);
    orbit.dist = Math.max((radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05, 0.9);
    if (fromCamera) {
      const off = camera.position.clone().sub(center);
      orbit.az = Math.atan2(off.x, off.z);
      orbit.el = THREE.MathUtils.clamp(Math.asin(off.y / off.length()), 0.08, 1.2);
    }
    panel.querySelector('h3').textContent = p.info.title;
    panel.querySelector('.sub').textContent = p.info.sub || '';
    panel.querySelector('.txt').textContent = p.info.text || '';
    panel.classList.add('open');
    document.body.classList.add('inspecting');
    lastDrag = performance.now();
    onEnter?.(p);
  }

  function exit() {
    if (!active) return;
    active = null;
    panel.classList.remove('open');
    document.body.classList.remove('inspecting');
    canvas.style.cursor = '';
    onExit?.();
  }

  // click (not drag) picks; clicking empty space exits
  let down = null;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const p = pick(e.clientX, e.clientY);
    if (p && p.info && p !== active) enter(p);
    else if (!p) exit();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exit();
    if (active && e.key === 'ArrowRight') step(1);
    if (active && e.key === 'ArrowLeft') step(-1);
  });

  // hover: pointer cursor over anything inspectable (throttled raycast)
  let lastHover = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons || performance.now() - lastHover < 60) return;
    lastHover = performance.now();
    const p = pick(e.clientX, e.clientY);
    canvas.style.cursor = p && p.info && p !== active ? 'pointer' : '';
  });

  return {
    variants,
    get active() {
      return active;
    },
    enter: (key) => {
      const p = parts.find((q) => q.key === key && q.info);
      if (p) enter(p);
    },
    drag(dx, dy) {
      orbit.az -= dx * 0.008;
      orbit.vel = -dx * 0.008;
      orbit.el = THREE.MathUtils.clamp(orbit.el + dy * 0.006, -0.2, 1.4);
      lastDrag = performance.now();
    },
    // call every frame; returns the camera to blend in (or null when fully inactive)
    update(dt) {
      blend += ((active ? 1 : 0) - blend) * (1 - Math.exp(-dt * 5));
      for (const p of parts) {
        const goal = !active || p === active ? 1 : 0;
        const next = p.fade + (goal - p.fade) * (1 - Math.exp(-dt * 8));
        p.fade = Math.abs(next - goal) < 0.002 ? goal : next;
        applyFade(p);
      }
      if (blend < 0.001 && !active) return null;
      if (active) {
        bounds(active).getCenter(center); // parts can move while exploded
        orbit.az += orbit.vel;
        orbit.vel *= 0.93;
        if (performance.now() - lastDrag > 2000) orbit.az += dt * 0.25;
      }
      const ce = Math.cos(orbit.el);
      const pos = new THREE.Vector3(Math.sin(orbit.az) * ce, Math.sin(orbit.el), Math.cos(orbit.az) * ce)
        .multiplyScalar(orbit.dist)
        .add(center);
      // aim a little below centre so the part sits above the info panel
      const target = center.clone();
      target.y -= orbit.dist * 0.12;
      pos.y -= orbit.dist * 0.12;
      return { pos, target, blend: blend * blend * (3 - 2 * blend) };
    },
  };
}
