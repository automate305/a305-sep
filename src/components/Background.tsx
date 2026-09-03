import { useEffect, useRef } from "react";

/** Slow gold particle field behind the dark views. */
export function Background() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let t = 0;
    const resize = () => {
      const p = canvas.parentElement;
      if (!p) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = p.clientWidth * dpr;
      canvas.height = p.clientHeight * dpr;
      canvas.style.width = `${p.clientWidth}px`;
      canvas.style.height = `${p.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    resize();
    const draw = () => {
      t += 0.012;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const spacing = 34;
      for (let i = 0; i < Math.ceil(w / spacing); i++) {
        for (let j = 0; j < Math.ceil(h / spacing); j++) {
          const x = i * spacing + spacing / 2, y = j * spacing + spacing / 2;
          const phase = i * 0.35 + j * 0.22 + t;
          const a = Math.max(0.03, Math.min(0.28, 0.06 + (j / (h / spacing)) * 0.12 + Math.sin(phase) * 0.12));
          ctx.beginPath();
          ctx.arc(x, y, 1.1 + Math.cos(phase * 0.7) * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(235,180,59,${a})`;
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 pointer-events-none z-0" aria-hidden="true" />;
}
