// A short burst of confetti over the page (about 1.5 seconds), drawn on a canvas that lets every tap
// through. Nothing happens when the device asks for reduced motion.
const COLOURS = ['#f6c343', '#e8505b', '#4fb3e8', '#5cc46b', '#b67be6', '#ff9a3c', '#ffffff'];
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let canvas = null;
let running = 0;

// `big`: more pieces and a little longer (a new record).
export function confetti({ big = false } = {}) {
  if (reduced()) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.hidden = false;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Two bursts from the lower corners, aimed up and inwards.
  const count = big ? 160 : 90;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const left = i % 2 === 0;
    const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
    const speed = (0.55 + Math.random() * 0.55) * Math.min(1.2, h / 700) * 22;
    parts.push({
      x: left ? w * 0.1 : w * 0.9, y: h * 0.95,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6, turn: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.4,
      colour: COLOURS[i % COLOURS.length],
    });
  }
  const length = big ? 2000 : 1500;
  const my = ++running;
  const start = performance.now();
  let last = start;
  const frame = (now) => {
    if (my !== running) return;
    const dt = Math.min(2, (now - last) / 16.7);
    last = now;
    const age = (now - start) / length;
    g.clearRect(0, 0, w, h);
    g.globalAlpha = age > 0.7 ? Math.max(0, (1 - age) / 0.3) : 1;
    for (const p of parts) {
      p.vy += 0.55 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.turn += p.spin * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.turn);
      g.fillStyle = p.colour;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.turn * 2)) + 1);
      g.restore();
    }
    if (age < 1) requestAnimationFrame(frame);
    else {
      g.clearRect(0, 0, w, h);
      canvas.hidden = true;
    }
  };
  requestAnimationFrame(frame);
}
