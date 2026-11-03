const root = document.documentElement;
const body = document.body;
const chargeEl = document.getElementById('charge');
const batteryEl = chargeEl.parentElement;
const hint = document.getElementById('hint');
const toastEl = document.getElementById('toast');
const eyesLayer = document.getElementById('eyes');
const dust = document.getElementById('dust');
const ctx = dust.getContext('2d');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- state ----------

const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
const light = { x: mouse.x, y: mouse.y };
let focus = 190; // beam radius the user picked (scroll wheel)
let radius = 0; // current animated radius
let torchOn = true;
let lightsOn = false;
let battery = 1; // 0..1, drains over time, shaking recharges
let flicker = 1;
let flickerUntil = 0;

// ---------- input ----------

addEventListener('pointermove', (e) => {
  const dx = e.clientX - mouse.x;
  const dy = e.clientY - mouse.y;
  // hand-crank: fast movement charges the battery
  battery = clamp(battery + Math.hypot(dx, dy) * 0.000035, 0, 1);
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    focus = clamp(focus - e.deltaY * 0.3, 70, 460);
  },
  { passive: false }
);

addEventListener('click', (e) => {
  if (e.target.closest('#switch, .back')) return;
  torchOn = !torchOn;
});

addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === ' ') torchOn = !torchOn;
});

setTimeout(() => hint.classList.add('hidden'), 7000);

// ---------- the light switch ----------

const switchEl = document.getElementById('switch');
let switchBusy = false;
switchEl.addEventListener('click', () => {
  if (switchBusy) return;
  switchBusy = true;
  lightsOn = true;
  body.classList.add('lights-on');
  toast('oh. it was just a room.');
  setTimeout(() => {
    body.classList.add('flicker-out');
    setTimeout(() => {
      lightsOn = false;
      body.classList.remove('lights-on', 'flicker-out');
      toast('…the bulb blew. obviously.');
      eyes.forEach((e) => respawn(e, 200));
      switchBusy = false;
    }, 900);
  }, 2600);
});

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------- clock ----------

function tick() {
  const d = new Date();
  document.getElementById('clock').textContent =
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
tick();
setInterval(tick, 10000);

// ---------- eyes in the dark ----------

const eyes = [];
for (let i = 0; i < 8; i++) {
  const el = document.createElement('div');
  el.className = 'eyes' + (i % 4 === 3 ? ' red' : '');
  el.innerHTML = '<i></i><i></i>';
  el.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
  el.style.setProperty('--gap', `${8 + Math.random() * 10}px`);
  el.querySelectorAll('i').forEach((i) => {
    i.style.setProperty('--blink', `${3 + Math.random() * 5}s`);
    i.style.setProperty('--delay', `${-Math.random() * 5}s`);
  });
  eyesLayer.appendChild(el);
  const eye = { el, x: 0, y: 0, hidden: false };
  eyes.push(eye);
  place(eye);
}

function place(eye) {
  // pick a spot well outside the beam
  for (let tries = 0; tries < 30; tries++) {
    eye.x = 30 + Math.random() * (innerWidth - 60);
    eye.y = 60 + Math.random() * (innerHeight - 100);
    if (Math.hypot(eye.x - light.x, eye.y - light.y) > Math.max(radius, 120) * 1.8) break;
  }
  eye.el.style.left = `${eye.x}px`;
  eye.el.style.top = `${eye.y}px`;
}

function respawn(eye, delay) {
  eye.hidden = true;
  eye.el.classList.add('gone');
  eye.el.classList.remove('arriving');
  setTimeout(() => {
    place(eye);
    eye.hidden = false;
    eye.el.classList.remove('gone');
    void eye.el.offsetWidth; // restart the fade-in animation
    eye.el.classList.add('arriving');
  }, delay);
}

// ---------- dust motes ----------

let W, H;
function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  W = innerWidth;
  H = innerHeight;
  dust.width = W * dpr;
  dust.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
addEventListener('resize', resize);

const motes = Array.from({ length: 160 }, () => ({
  x: Math.random() * innerWidth,
  y: Math.random() * innerHeight,
  vx: (Math.random() - 0.5) * 0.15,
  vy: (Math.random() - 0.5) * 0.15,
  s: Math.random() * 1.6 + 0.3,
}));

function drawDust(r) {
  ctx.clearRect(0, 0, W, H);
  if (r < 5) return;
  for (const m of motes) {
    m.x = (m.x + m.vx + W) % W;
    m.y = (m.y + m.vy + H) % H;
    const d = Math.hypot(m.x - light.x, m.y - light.y);
    if (d > r) continue;
    const a = (1 - d / r) * 0.55;
    ctx.fillStyle = `rgba(255, 236, 200, ${a})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- main loop ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  // torch drains; less charge = smaller, flickerier beam
  if (torchOn && !lightsOn) battery = clamp(battery - dt / 70, 0, 1);
  chargeEl.style.width = `${battery * 100}%`;
  batteryEl.classList.toggle('low', battery < 0.25);

  if (now > flickerUntil) {
    flicker = 1;
    const chance = battery < 0.25 ? 0.03 : 0.002;
    if (Math.random() < chance) flickerUntil = now + 80 + Math.random() * 300;
  } else {
    flicker = Math.random() < 0.5 ? 0.25 + Math.random() * 0.4 : 1;
  }

  const strength = battery <= 0 ? 0 : 0.35 + 0.65 * Math.sqrt(battery);
  const target = torchOn ? focus * strength * flicker : 0;
  radius += (target - radius) * (1 - Math.exp(-dt * 14));

  // the beam lags slightly behind the hand
  const k = 1 - Math.exp(-dt * 18);
  light.x += (mouse.x - light.x) * k;
  light.y += (mouse.y - light.y) * k;

  root.style.setProperty('--x', `${light.x}px`);
  root.style.setProperty('--y', `${light.y}px`);
  root.style.setProperty('--r', `${radius}px`);

  // eyes vanish when the beam touches them
  if (!lightsOn) {
    for (const e of eyes) {
      if (!e.hidden && Math.hypot(e.x - light.x, e.y - light.y) < radius * 0.9 + 10) {
        respawn(e, 1500 + Math.random() * 3500);
      }
    }
  }

  drawDust(radius);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
