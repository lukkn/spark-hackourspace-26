// Tiny dependency-free confetti burst on a full-screen canvas.
const COLORS = ['#22b8a7', '#8b5cf6', '#ffd34d', '#ff5e8a', '#4dabf7', '#ff9f43'];

export function confetti({ count = 180, duration = 3500, origin } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999 });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const ox = origin?.x ?? innerWidth / 2;
  const oy = origin?.y ?? innerHeight / 2;
  const bits = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return {
      x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: COLORS[(Math.random() * COLORS.length) | 0],
    };
  });

  const start = performance.now();
  (function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
    for (const b of bits) {
      b.vy += 0.25; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.cos(b.r * 2));
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}
