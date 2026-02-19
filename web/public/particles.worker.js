// Particle emitter worker — runs entirely off the main thread via OffscreenCanvas.
// Messages in:  { type: "init", canvas, dpr, cardW, cardH, overflow }
//               { type: "resize", dpr, cardW, cardH }
//               { type: "active", value: boolean }
//               { type: "stop" }

const COLORS = [
  "rgba(215, 153, 33, 0.7)",
  "rgba(215, 153, 33, 0.5)",
  "rgba(215, 153, 33, 0.35)",
  "rgba(184, 187, 38, 0.45)",
  "rgba(250, 189, 47, 0.5)",
  "rgba(131, 165, 152, 0.35)",
];

let /** @type {OffscreenCanvas | null} */ canvas = null;
let /** @type {OffscreenCanvasRenderingContext2D | null} */ ctx = null;
let dpr = 1;
let cardW = 0;
let cardH = 0;
let overflow = 200;
let active = false;
let raf = 0;
let lastSpawn = 0;
let running = false;

/** @type {Array<{x:number,y:number,vx:number,vy:number,size:number,opacity:number,rotation:number,rotationSpeed:number,life:number,maxLife:number,color:string}>} */
let particles = [];

function spawn() {
  const perim = 2 * (cardW + cardH);
  const p = Math.random() * perim;
  let sx, sy, angle;

  if (p < cardW) {
    sx = p; sy = 0;
    angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
  } else if (p < cardW + cardH) {
    sx = cardW; sy = p - cardW;
    angle = (Math.random() - 0.5) * 1.2;
  } else if (p < 2 * cardW + cardH) {
    sx = p - cardW - cardH; sy = cardH;
    angle = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
  } else {
    sx = 0; sy = p - 2 * cardW - cardH;
    angle = Math.PI + (Math.random() - 0.5) * 1.2;
  }

  const speed = 1.0 + Math.random() * 2.5;
  const size = 4 + Math.random() * 12;
  const maxLife = 80 + Math.random() * 80;

  particles.push({
    x: overflow + sx,
    y: overflow + sy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    opacity: 0.4 + Math.random() * 0.5,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.08,
    life: 0,
    maxLife,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  });
}

function tick() {
  if (!canvas || !ctx) return;
  const w = cardW + overflow * 2;
  const h = cardH + overflow * 2;
  ctx.clearRect(0, 0, w, h);

  const now = performance.now();
  if (active && now - lastSpawn > 60) {
    lastSpawn = now;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) spawn();
  }

  const alive = [];
  for (const p of particles) {
    p.life++;
    if (p.life > p.maxLife) continue;

    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.rotationSpeed;

    const progress = p.life / p.maxLife;
    const alpha = p.opacity * (1 - progress * progress);
    if (alpha < 0.01) continue;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    const half = p.size / 2;
    const r = p.size * 0.2;
    ctx.beginPath();
    ctx.moveTo(-half + r, -half);
    ctx.lineTo(half - r, -half);
    ctx.quadraticCurveTo(half, -half, half, -half + r);
    ctx.lineTo(half, half - r);
    ctx.quadraticCurveTo(half, half, half - r, half);
    ctx.lineTo(-half + r, half);
    ctx.quadraticCurveTo(-half, half, -half, half - r);
    ctx.lineTo(-half, -half + r);
    ctx.quadraticCurveTo(-half, -half, -half + r, -half);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    alive.push(p);
  }
  particles = alive;

  // Keep ticking as long as there are particles or we're active
  if (active || particles.length > 0) {
    raf = requestAnimationFrame(tick);
  } else {
    running = false;
  }
}

function ensureRunning() {
  if (!running && canvas) {
    running = true;
    raf = requestAnimationFrame(tick);
  }
}

function applySize() {
  if (!canvas || !ctx) return;
  const w = cardW + overflow * 2;
  const h = cardH + overflow * 2;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      dpr = msg.dpr;
      cardW = msg.cardW;
      cardH = msg.cardH;
      overflow = msg.overflow;
      applySize();
      break;

    case "resize":
      dpr = msg.dpr;
      cardW = msg.cardW;
      cardH = msg.cardH;
      applySize();
      break;

    case "active":
      active = msg.value;
      if (active) ensureRunning();
      break;

    case "stop":
      cancelAnimationFrame(raf);
      running = false;
      active = false;
      particles = [];
      break;
  }
};
