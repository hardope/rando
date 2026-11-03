import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint, Events } = Matter;

const engine = Engine.create();
engine.gravity.y = 1;
let bodies = []; // { el, body, x0, y0, lift } — x0/y0: centre when pinned, lift: how far above home it started
let walls = [];
let running = false;
let raf = 0;

document.getElementById('drop').addEventListener('click', fall);
document.getElementById('restore').addEventListener('click', restore);

function fall() {
  if (running) return;
  running = true;
  scrollTo(0, 0);
  // skip anything hidden (the nav links collapse on narrow screens); zero-size bodies break Matter
  const els = [...document.querySelectorAll('.drop')].filter((el) => el.getClientRects().length);
  const H = innerHeight;

  // measure everything first, then pin, so pinning one element doesn't shift the next
  const rects = els.map((el) => el.getBoundingClientRect());
  bodies = els.map((el, i) => {
    const r = rects[i];
    // things below the fold rain in from above instead
    let top = r.top;
    if (top > H - 20) top = -r.height - 40 - Math.random() * (top - H);
    el.classList.add('body');
    Object.assign(el.style, { left: `${r.left}px`, top: `${top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const body = Bodies.rectangle(r.left + r.width / 2, top + r.height / 2, r.width, r.height, {
      restitution: 0.25,
      friction: 0.5,
      chamfer: { radius: Math.min(10, r.height / 2 - 1) },
    });
    // a little nudge so stacks don't fall perfectly straight
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.04);
    return { el, body, x0: r.left + r.width / 2, y0: top + r.height / 2, lift: r.top - top };
  });
  Composite.add(engine.world, bodies.map((b) => b.body));
  buildWalls();
  enableGrab();
  document.body.classList.add('fallen');
  loop();
}

function buildWalls() {
  Composite.remove(engine.world, walls);
  const W = innerWidth, H = innerHeight, t = 200;
  walls = [
    Bodies.rectangle(W / 2, H + t / 2, W * 3, t, { isStatic: true }),
    Bodies.rectangle(-t / 2, H / 2, t, H * 6, { isStatic: true }),
    Bodies.rectangle(W + t / 2, H / 2, t, H * 6, { isStatic: true }),
    Bodies.rectangle(W / 2, -H * 2.5, W * 3, t, { isStatic: true }), // high ceiling for zero-g
  ];
  Composite.add(engine.world, walls);
}
addEventListener('resize', () => running && buildWalls());

// drag + throw. Matter's mouse swallows wheel/touch scrolling, so it's only attached once the page has fallen.
let grab = null;
function enableGrab() {
  if (grab) return;
  const mouse = Mouse.create(document.body);
  grab = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
  Composite.add(engine.world, grab);
  Events.on(grab, 'startdrag', () => (document.body.style.cursor = 'grabbing'));
  Events.on(grab, 'enddrag', () => (document.body.style.cursor = ''));
}
// links inside the page shouldn't navigate while you're flinging them
document.addEventListener('click', (e) => {
  if (running && e.target.closest('.drop')) e.preventDefault();
}, true);

// gravity controls
addEventListener('keydown', (e) => {
  if (!running) return;
  const g = engine.gravity;
  const dirs = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (dirs[e.key]) {
    [g.x, g.y] = dirs[e.key];
    e.preventDefault();
  }
  if (e.key === ' ') {
    e.preventDefault();
    const floating = g.x === 0 && g.y === 0;
    [g.x, g.y] = floating ? [0, 1] : [0, 0];
    if (!floating) bodies.forEach(({ body }) => Body.setVelocity(body, { x: (Math.random() - 0.5) * 4, y: -Math.random() * 6 }));
  }
});

function loop() {
  Engine.update(engine, 1000 / 60);
  for (const { el, body, x0, y0 } of bodies) {
    el.style.transform = `translate(${body.position.x - x0}px, ${body.position.y - y0}px) rotate(${body.angle}rad)`;
  }
  raf = requestAnimationFrame(loop);
}

function restore() {
  if (!running) return;
  cancelAnimationFrame(raf);
  Composite.remove(engine.world, bodies.map((b) => b.body));
  engine.gravity.x = 0;
  engine.gravity.y = 1;
  for (const { el, lift } of bodies) {
    el.classList.add('returning');
    // elements that rained in from above glide down to where they really live
    el.style.transform = `translate(0px, ${lift}px)`;
  }
  // swap back to normal flow once the glide home is done
  setTimeout(() => {
    for (const { el } of bodies) {
      el.classList.remove('body', 'returning');
      el.removeAttribute('style');
    }
    bodies = [];
    running = false;
    document.body.classList.remove('fallen');
  }, 950);
}
