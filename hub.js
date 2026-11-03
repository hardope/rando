// The registry. To add an experiment: make experiments/<slug>/index.html, then add a row here.
// `preview` picks a CSS thumbnail from hub.css (pv-<name>); omit it for the default swirl.
// `shots` uses rendered images from the experiment's folder instead: the second one shows on hover.
// Thumbnails are pulled in through Vite so they get copied into the build.
const shotUrls = import.meta.glob('./experiments/*/*.jpg', { eager: true, query: '?url', import: 'default' });

const experiments = [
  {
    slug: 'lights-out',
    title: 'Lights Out',
    blurb: 'The power is out. You have a hand-crank torch, and something in the dark is watching you.',
    tags: ['css masks', 'cursor', 'canvas'],
    preview: 'torch',
  },
  {
    slug: 'exploded-car',
    title: 'GT-0, Exploded',
    blurb: 'A procedurally built 3D supercar. Scroll to take it apart piece by piece, peek into the cockpit, repaint it.',
    tags: ['three.js', 'scroll-driven', 'webgl'],
    shots: ['thumb.jpg', 'thumb-exploded.jpg'],
  },
  {
    slug: 'real-car',
    title: '458 Showroom',
    blurb: 'A real Ferrari 458 model under a Venice sunset. Take it for a drive, lift the shell off, spec your own.',
    tags: ['three.js', 'gltf', 'hdr lighting'],
    shots: ['thumb.jpg', 'thumb-exploded.jpg'],
  },
  {
    slug: 'fluid-cursor',
    title: 'Fluid Cursor',
    blurb: 'A GPU fluid simulation you stir with your mouse. Glossy ink, vortices, and a word that inverts it all.',
    tags: ['webgl2', 'shaders', 'simulation'],
    preview: 'fluid',
  },
  {
    slug: 'page-gravity',
    title: 'Page Gravity',
    blurb: 'A painfully generic landing page with one button you should not press. Then throw the wreckage around.',
    tags: ['matter.js', 'physics', 'dom'],
    preview: 'gravity',
  },
];

const previews = {
  torch: () => '<div class="eyes"><i></i><i></i></div>',
  fluid: () => '<i></i><i></i><i></i><b>stir.</b>',
  gravity: () => ['Synergy', 'Pricing', 'Book a demo', '✨ AI', 'Pivot'].map((w) => `<span>${w}</span>`).join(''),
};

const grid = document.getElementById('grid');

experiments.forEach((exp, i) => {
  const card = document.createElement('a');
  card.className = 'card';
  card.href = `experiments/${exp.slug}/`;
  const pv = exp.preview && previews[exp.preview];
  const shots = (exp.shots || []).map((f) => `<img src="${shotUrls[`./experiments/${exp.slug}/${f}`]}" alt="" loading="lazy" />`).join('');
  const kind = exp.shots ? 'pv-shot' : pv ? 'pv-' + exp.preview : 'pv-default';
  card.innerHTML = `
    <div class="preview ${kind}">${shots || (pv ? pv() : '')}</div>
    <div class="meta">
      <span class="num">${String(i + 1).padStart(3, '0')}</span>
      <h2>${exp.title}</h2>
      <p>${exp.blurb}</p>
      <div class="tags">${exp.tags.map((t) => `<span>${t}</span>`).join('')}</div>
    </div>`;
  grid.appendChild(card);

  // subtle tilt + feed the mouse position to the preview (the torch card uses it)
  const preview = card.querySelector('.preview');
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--ry', `${x * 6}deg`);
    card.style.setProperty('--rx', `${-y * 6}deg`);
    const pr = preview.getBoundingClientRect();
    preview.style.setProperty('--px', `${e.clientX - pr.left}px`);
    preview.style.setProperty('--py', `${e.clientY - pr.top}px`);
  });
  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--rx', '0deg');
  });
});

document.getElementById('count').textContent = `${experiments.length} experiments and counting`;

// scramble the title on load and on hover
const title = document.getElementById('title');
const glyphs = '!<>-_\\/[]{}=+*^?#%&@$';
function scramble() {
  const final = title.dataset.text;
  let frame = 0;
  const id = setInterval(() => {
    title.textContent = final
      .split('')
      .map((ch, i) => (frame / 3 > i ? ch : glyphs[(Math.random() * glyphs.length) | 0]))
      .join('');
    if (++frame > final.length * 3 + 2) clearInterval(id);
  }, 40);
}
scramble();
title.addEventListener('pointerenter', scramble);
