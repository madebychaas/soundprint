import { useEffect, useRef } from 'react';
import { HISTORY_RATE, HISTORY_SECONDS } from '../sim/NodeSimulation';
import { sim } from '../sim/play';

const N = HISTORY_RATE * HISTORY_SECONDS;

/** Rolling 4-second trace of the simulated piezo transient, FSR pressure and gate. */
export function SignalScope() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const top = 4, bottom = h - 7, span = bottom - top;
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const x = (w * i) / 4; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); }
      g.beginPath(); g.moveTo(0, bottom + 0.5); g.lineTo(w, bottom + 0.5); g.stroke();
      const head = sim.histHead;
      const trace = (buf: Float32Array, stroke: string, fill: string | null) => {
        g.beginPath();
        for (let i = 0; i < N; i++) {
          const v = buf[(head + 1 + i) % N];
          const x = (i / (N - 1)) * w, y = bottom - v * span;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = stroke; g.lineWidth = 1.3; g.stroke();
        if (fill) { g.lineTo(w, bottom); g.lineTo(0, bottom); g.closePath(); g.fillStyle = fill; g.fill(); }
      };
      trace(sim.histFsr, 'rgba(143,240,255,0.95)', 'rgba(143,240,255,0.12)');
      trace(sim.histPiezo, 'rgba(201,182,242,0.95)', 'rgba(201,182,242,0.16)');
      // gate bar
      g.fillStyle = 'rgba(255,255,255,0.75)';
      let start = -1;
      for (let i = 0; i <= N; i++) {
        const on = i < N && sim.histGate[(head + 1 + i) % N] > 0.5;
        if (on && start < 0) start = i;
        if (!on && start >= 0) { g.fillRect((start / (N - 1)) * w, h - 4, Math.max(1.5, ((i - start) / (N - 1)) * w), 2.5); start = -1; }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="scope" role="img" aria-label="Simulated signal traces: piezo transient, sustained pressure and note gate over the last four seconds" />;
}
