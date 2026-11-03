// A small stable-fluids solver (Jos Stam style) on the GPU: velocity is advected, made
// divergence-free with a Jacobi pressure solve, and spun up with vorticity confinement.
// Ink ("dye") rides along on the velocity field.

const config = {
  simRes: 128,
  dyeRes: 1024,
  densityDissipation: 0.45,
  velocityDissipation: 0.25,
  pressure: 0.8,
  pressureIterations: 20,
  curl: 28,
  splatRadius: 0.22, // percent of the screen
  splatForce: 6000,
};

const canvas = document.getElementById('fluid');
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
  document.getElementById('msg').style.display = 'grid';
  throw new Error('WebGL2 float render targets unavailable');
}

// ---------- shaders ----------

const vertexSrc = `#version 300 es
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0);
  vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y);
  vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const frag = (body) => `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
${body}`;

const shaders = {
  splat: frag(`
    uniform sampler2D uTarget;
    uniform float aspect, radius;
    uniform vec3 color;
    uniform vec2 point;
    void main() {
      vec2 p = vUv - point;
      p.x *= aspect;
      vec3 s = exp(-dot(p, p) / radius) * color;
      o = vec4(texture(uTarget, vUv).xyz + s, 1.0);
    }`),
  advect: frag(`
    uniform sampler2D uVelocity, uSource;
    uniform vec2 velTexel;
    uniform float dt, dissipation;
    void main() {
      vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velTexel;
      o = texture(uSource, coord) / (1.0 + dissipation * dt);
      o.a = 1.0;
    }`),
  divergence: frag(`
    uniform sampler2D uVelocity;
    void main() {
      float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
      float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
      vec2 C = texture(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x;
      if (vR.x > 1.0) R = -C.x;
      if (vT.y > 1.0) T = -C.y;
      if (vB.y < 0.0) B = -C.y;
      o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`),
  curl: frag(`
    uniform sampler2D uVelocity;
    void main() {
      float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
      float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
      o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`),
  vorticity: frag(`
    uniform sampler2D uVelocity, uCurl;
    uniform float curl, dt;
    void main() {
      float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
      float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
      float C = texture(uCurl, vUv).x;
      vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      f /= length(f) + 0.0001;
      f *= curl * C;
      f.y *= -1.0;
      vec2 v = texture(uVelocity, vUv).xy + f * dt;
      o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
    }`),
  pressure: frag(`
    uniform sampler2D uPressure, uDivergence;
    void main() {
      float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      float d = texture(uDivergence, vUv).x;
      o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
    }`),
  gradient: frag(`
    uniform sampler2D uPressure, uVelocity;
    void main() {
      float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
      float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
      vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
      o = vec4(v, 0.0, 1.0);
    }`),
  scale: frag(`
    uniform sampler2D uTexture;
    uniform float value;
    void main() { o = value * texture(uTexture, vUv); }`),
  display: frag(`
    uniform sampler2D uTexture;
    void main() {
      vec3 c = texture(uTexture, vUv).rgb;
      // fake lighting from the ink's own gradient gives it a glossy, 3D look
      float dx = length(texture(uTexture, vR).rgb) - length(texture(uTexture, vL).rgb);
      float dy = length(texture(uTexture, vT).rgb) - length(texture(uTexture, vB).rgb);
      vec3 n = normalize(vec3(dx, dy, 0.02));
      float light = clamp(dot(n, normalize(vec3(-0.4, 0.6, 1.0))) + 0.25, 0.55, 1.15);
      c = pow(c * light, vec3(0.85));
      o = vec4(c, 1.0);
    }`),
};

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const vs = compile(gl.VERTEX_SHADER, vertexSrc);
const programs = {};
for (const [name, src] of Object.entries(shaders)) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const u = gl.getActiveUniform(p, i).name;
    uniforms[u] = gl.getUniformLocation(p, u);
  }
  programs[name] = { p, u: uniforms };
}

// full-screen quad
gl.bindVertexArray(gl.createVertexArray());
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

// ---------- framebuffers ----------

function target(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h, texel: [1 / w, 1 / h] };
}

function doubleTarget(w, h) {
  const t = { read: target(w, h), write: target(w, h) };
  t.swap = () => ([t.read, t.write] = [t.write, t.read]);
  return t;
}

function resolution(res) {
  const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
  const min = Math.round(res);
  const max = Math.round(res * Math.max(aspect, 1 / aspect));
  return aspect > 1 ? [max, min] : [min, max];
}

let velocity, dye, pressure, divergence, curl;
function initTargets() {
  const [sw, sh] = resolution(config.simRes);
  const [dw, dh] = resolution(config.dyeRes);
  velocity = doubleTarget(sw, sh);
  pressure = doubleTarget(sw, sh);
  divergence = target(sw, sh);
  curl = target(sw, sh);
  dye = doubleTarget(dw, dh);
}

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
resize();
initTargets();
addEventListener('resize', () => resize() && initTargets());

// ---------- passes ----------

let unit = 0;
function use(name, texel) {
  const prog = programs[name];
  gl.useProgram(prog.p);
  unit = 0;
  if (prog.u.texel) gl.uniform2f(prog.u.texel, texel[0], texel[1]);
  return prog.u;
}
function bind(loc, t) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.uniform1i(loc, unit++);
}
function draw(dest) {
  if (dest) {
    gl.viewport(0, 0, dest.w, dest.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
  } else {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function splat(x, y, dx, dy, color) {
  const aspect = canvas.width / canvas.height;
  let u = use('splat', velocity.read.texel);
  bind(u.uTarget, velocity.read);
  gl.uniform1f(u.aspect, aspect);
  gl.uniform2f(u.point, x, y);
  gl.uniform3f(u.color, dx, dy, 0);
  gl.uniform1f(u.radius, (config.splatRadius / 100) * (aspect > 1 ? aspect : 1));
  draw(velocity.write);
  velocity.swap();

  u = use('splat', dye.read.texel);
  bind(u.uTarget, dye.read);
  gl.uniform1f(u.aspect, aspect);
  gl.uniform2f(u.point, x, y);
  gl.uniform3f(u.color, ...color);
  gl.uniform1f(u.radius, (config.splatRadius / 100) * (aspect > 1 ? aspect : 1));
  draw(dye.write);
  dye.swap();
}

function step(dt) {
  const t = velocity.read.texel;

  let u = use('curl', t);
  bind(u.uVelocity, velocity.read);
  draw(curl);

  u = use('vorticity', t);
  bind(u.uVelocity, velocity.read);
  bind(u.uCurl, curl);
  gl.uniform1f(u.curl, config.curl);
  gl.uniform1f(u.dt, dt);
  draw(velocity.write);
  velocity.swap();

  u = use('divergence', t);
  bind(u.uVelocity, velocity.read);
  draw(divergence);

  u = use('scale', t);
  bind(u.uTexture, pressure.read);
  gl.uniform1f(u.value, config.pressure);
  draw(pressure.write);
  pressure.swap();

  u = use('pressure', t);
  bind(u.uDivergence, divergence);
  const pressureLoc = u.uPressure;
  const pressureUnit = unit;
  for (let i = 0; i < config.pressureIterations; i++) {
    gl.activeTexture(gl.TEXTURE0 + pressureUnit);
    gl.bindTexture(gl.TEXTURE_2D, pressure.read.tex);
    gl.uniform1i(pressureLoc, pressureUnit);
    draw(pressure.write);
    pressure.swap();
  }

  u = use('gradient', t);
  bind(u.uPressure, pressure.read);
  bind(u.uVelocity, velocity.read);
  draw(velocity.write);
  velocity.swap();

  u = use('advect', t);
  bind(u.uVelocity, velocity.read);
  bind(u.uSource, velocity.read);
  gl.uniform2f(u.velTexel, ...t);
  gl.uniform1f(u.dt, dt);
  gl.uniform1f(u.dissipation, config.velocityDissipation);
  draw(velocity.write);
  velocity.swap();

  u = use('advect', dye.read.texel);
  bind(u.uVelocity, velocity.read);
  bind(u.uSource, dye.read);
  gl.uniform2f(u.velTexel, ...t);
  gl.uniform1f(u.dt, dt);
  gl.uniform1f(u.dissipation, config.densityDissipation);
  draw(dye.write);
  dye.swap();
}

function render() {
  const u = use('display', dye.read.texel);
  bind(u.uTexture, dye.read);
  draw(null);
}

function clearDye() {
  const u = use('scale', dye.read.texel);
  bind(u.uTexture, dye.read);
  gl.uniform1f(u.value, 0);
  draw(dye.write);
  dye.swap();
}

// ---------- colour ----------

let hue = Math.random();
let freezeHue = false;
function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}
const ink = (strength = 0.28) => hsv(hue % 1, 1, 1).map((c) => c * strength);

// ---------- input ----------

const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, down: false };
let lastInput = performance.now();

addEventListener('pointermove', (e) => {
  const x = e.clientX / innerWidth;
  const y = 1 - e.clientY / innerHeight;
  if (pointer.x || pointer.y) {
    pointer.dx += x - pointer.x;
    pointer.dy += y - pointer.y;
    pointer.moved = true;
  }
  pointer.x = x;
  pointer.y = y;
  lastInput = performance.now();
});

addEventListener('pointerdown', (e) => {
  if (e.target.closest('a')) return;
  const x = e.clientX / innerWidth;
  const y = 1 - e.clientY / innerHeight;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    splat(x, y, Math.cos(a) * 900, Math.sin(a) * 900, ink(0.6));
  }
  hue += 0.13;
  lastInput = performance.now();
});

addEventListener('keydown', (e) => {
  if (e.key === ' ') freezeHue = !freezeHue;
  if (e.key === 'c') clearDye();
});

function randomSplats(n) {
  for (let i = 0; i < n; i++) {
    hue += 0.17;
    splat(Math.random(), Math.random(), (Math.random() - 0.5) * 2000, (Math.random() - 0.5) * 2000, ink(1.2));
  }
}
randomSplats(6);

// ---------- loop ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  if (!freezeHue) hue += dt * 0.08;

  if (pointer.moved) {
    const aspect = canvas.width / canvas.height;
    splat(pointer.x, pointer.y, pointer.dx * config.splatForce * (aspect < 1 ? aspect : 1), pointer.dy * config.splatForce, ink());
    pointer.dx = pointer.dy = 0;
    pointer.moved = false;
  }
  // nobody stirring? stir it ourselves now and then
  if (now - lastInput > 4000 && Math.random() < 0.015) randomSplats(1);

  step(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
