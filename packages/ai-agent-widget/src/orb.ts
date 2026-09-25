// Canvas replica of the dashboard's VosoOrb (three.js wireframe
// icosahedron, simplex-noise vertex morphing, slow Y rotation —
// frontend/src/components/visualizers/voso-orb.tsx). The embed bundle is
// dependency-free, so this re-creates the same look with 2D canvas: the
// SAME geometry family — a subdivided icosahedron ("icosphere") drawn as
// a triangular wireframe — rotated at VosoOrb's 0.005 rad/frame with its
// exact per-state morph amplitudes, stroked in the configured primary
// color over a soft glow of the secondary color. Subdivision detail
// scales with canvas size so a 26px launcher stays crisp while the 64px
// intro orb shows the dense mesh the "Test your agent" preview renders.

export type OrbState = "idle" | "connecting" | "listening" | "speaking";

export interface OrbHandle {
  el: HTMLCanvasElement;
  setState(state: OrbState): void;
  destroy(): void;
}

/** Cheap deterministic 3D value noise (hash + trilinear smoothstep). */
function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1024) / 1024;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  let v = 0;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const w =
          (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        v += w * hash3(xi + dx, yi + dy, zi + dz);
      }
    }
  }
  return v * 2 - 1; // -1..1
}

// ── Icosphere geometry (VosoOrb's IcosahedronGeometry, canvas-sized) ──

type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Unit icosahedron subdivided `detail` times with midpoint-normalize —
 *  the same construction three.js's IcosahedronGeometry uses. Returns
 *  unit-sphere vertices and the unique wireframe edges. */
function icosphere(detail: number): { verts: Vec3[]; edges: Array<[number, number]> } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: Vec3[] = (
    [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] as Vec3[]
  ).map(normalize);
  let faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let d = 0; d < detail; d += 1) {
    const midCache = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      const hit = midCache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a]!;
      const vb = verts[b]!;
      const idx = verts.length;
      verts.push(
        normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]),
      );
      midCache.set(key, idx);
      return idx;
    };
    const next: Array<[number, number, number]> = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const edgeSet = new Set<number>();
  const edges: Array<[number, number]> = [];
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([a, b]);
  };
  for (const [a, b, c] of faces) {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return { verts, edges };
}

/** Create an animated orb canvas of `size` CSS pixels. */
export function createOrb(
  size: number,
  color1: string,
  color2: string,
): OrbHandle {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");

  let state: OrbState = "idle";
  let raf = 0;
  let running = true;

  const half = (size * dpr) / 2;
  // Fill the canvas like the solid-gradient avatar this orb replaced —
  // idle morph amplitude leaves ~6% headroom; speaking may graze the
  // edge, which reads as energy rather than clipping.
  const baseRadius = half * 0.86;

  // VosoOrb uses IcosahedronGeometry(10, 8) on the GPU; a 2D canvas gets
  // the same visual density with far fewer lines — detail 3 (1,920 edges)
  // reads identically at ≥56px, detail 2 (480 edges) below that.
  const { verts, edges } = icosphere(size >= 56 ? 3 : 2);
  const projected: Array<[number, number, number]> = verts.map(() => [0, 0, 0]);

  function amplitude(now: number): number {
    // Mirrors VosoOrb's morphAmount per state (voso-orb.tsx render loop).
    switch (state) {
      case "idle":
        return 0.03 + Math.sin(now * 0.002) * 0.02;
      case "connecting":
        return 0.08 + Math.sin(now * 0.004) * 0.06;
      case "speaking":
        return 0.22 + Math.sin(now * 0.006) * 0.12;
      case "listening":
      default:
        return 0.06 + Math.sin(now * 0.003) * 0.03;
    }
  }

  function render(now: number) {
    if (!running || !ctx) return;
    const amp = amplitude(now);
    // group.rotation.y += 0.005/frame ≈ 0.3 rad/s at 60fps.
    const rot = now * 0.0003;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    ctx.clearRect(0, 0, size * dpr, size * dpr);

    // Soft secondary-color glow behind the wireframe.
    const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, `${color2}55`);
    glow.addColorStop(0.75, `${color2}18`);
    glow.addColorStop(1, `${color2}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size * dpr, size * dpr);

    // Morph + rotate + project every vertex once, then stroke the edges.
    for (let i = 0; i < verts.length; i += 1) {
      const [nx0, ny, nz0] = verts[i]!;
      const n = noise3(
        nx0 * 1.4 + now * 0.00035,
        ny * 1.4 + now * 0.0004,
        nz0 * 1.4 + now * 0.00045,
      );
      const r = 1 + n * amp * 1.4 + amp * 0.35;
      const nx = nx0 * cosR + nz0 * sinR;
      const nz = -nx0 * sinR + nz0 * cosR;
      // Mild perspective mirroring VosoOrb's 20° fov camera.
      const persp = 1 / (1.6 - 0.6 * nz);
      projected[i] = [
        half + nx * r * baseRadius * persp,
        half + ny * r * baseRadius * persp,
        nz,
      ];
    }

    ctx.lineWidth = Math.max(0.6, size * dpr * 0.006);
    ctx.strokeStyle = color1;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const [a, b] of edges) {
      const pa = projected[a]!;
      const pb = projected[b]!;
      // Skip the farthest back-face edges so the front mesh reads
      // crisply, like the lit three.js wireframe.
      if (pa[2] < -0.55 && pb[2] < -0.55) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(render);
  }
  raf = requestAnimationFrame(render);

  return {
    el: canvas,
    setState(next: OrbState) {
      state = next;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
