(() => {
  const canvases = [...document.querySelectorAll('.lattice-canvas, .page-geometry-canvas')];
  if (!canvases.length) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const edge = (a, b) => [a, b];

  const shapes = {
    cube() {
      const points = [];
      const edges = [];
      const size = 5;
      const gap = 42;
      for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) {
        const index = points.push({ x: (x - 2) * gap, y: (y - 2) * gap, z: (z - 2) * gap, band: z }) - 1;
        if (x) edges.push(edge(index - size * size, index));
        if (y) edges.push(edge(index - size, index));
        if (z) edges.push(edge(index - 1, index));
      }
      return { points, edges };
    },
    prism() {
      const points = [];
      const edges = [];
      const rings = 7;
      const sides = 6;
      for (let r = 0; r < rings; r++) {
        const z = (r - 3) * 42;
        for (let s = 0; s < sides; s++) {
          const angle = s / sides * Math.PI * 2;
          const index = points.push({ x: Math.cos(angle) * 92, y: Math.sin(angle) * 92, z, band: r }) - 1;
          edges.push(edge(index, r * sides + (s + 1) % sides));
          if (r) edges.push(edge(index - sides, index));
        }
      }
      return { points, edges };
    },
    pages() {
      const points = [];
      const edges = [];
      for (let layer = 0; layer < 5; layer++) {
        const z = (layer - 2) * 38;
        const shift = layer * 9;
        const corners = [[-110 + shift, -76], [110 + shift, -76], [110 + shift, 76], [-110 + shift, 76]];
        const start = points.length;
        corners.forEach(([x, y]) => points.push({ x, y, z, band: layer }));
        for (let i = 0; i < 4; i++) edges.push(edge(start + i, start + (i + 1) % 4));
        if (layer) for (let i = 0; i < 4; i++) edges.push(edge(start + i - 4, start + i));
      }
      return { points, edges };
    },
    pyramid() {
      const points = [];
      const edges = [];
      const levels = 6;
      for (let level = 0; level < levels; level++) {
        const side = 190 * (1 - level / levels);
        const y = 105 - level * 40;
        const start = points.length;
        [[-side / 2, -side / 2], [side / 2, -side / 2], [side / 2, side / 2], [-side / 2, side / 2]].forEach(([x, z]) => points.push({ x, y, z, band: level }));
        for (let i = 0; i < 4; i++) edges.push(edge(start + i, start + (i + 1) % 4));
        if (level) for (let i = 0; i < 4; i++) edges.push(edge(start + i - 4, start + i));
      }
      const apex = points.push({ x: 0, y: -135, z: 0, band: levels }) - 1;
      for (let i = points.length - 5; i < points.length - 1; i++) edges.push(edge(i, apex));
      return { points, edges };
    },
    sphere() {
      const points = [];
      const edges = [];
      const latitudes = 7;
      const longitudes = 12;
      for (let lat = 0; lat < latitudes; lat++) {
        const phi = -Math.PI / 2 + lat / (latitudes - 1) * Math.PI;
        const radius = Math.cos(phi) * 112;
        for (let lon = 0; lon < longitudes; lon++) {
          const theta = lon / longitudes * Math.PI * 2;
          const index = points.push({ x: Math.cos(theta) * radius, y: Math.sin(phi) * 112, z: Math.sin(theta) * radius, band: lon }) - 1;
          edges.push(edge(index, lat * longitudes + (lon + 1) % longitudes));
          if (lat) edges.push(edge(index - longitudes, index));
        }
      }
      return { points, edges };
    },
    shield() {
      const points = [
        { x: 0, y: -130, z: 0 }, { x: 112, y: -42, z: 0 }, { x: 76, y: 82, z: 0 },
        { x: 0, y: 138, z: 0 }, { x: -76, y: 82, z: 0 }, { x: -112, y: -42, z: 0 },
        { x: 0, y: -76, z: 72 }, { x: 64, y: 0, z: 72 }, { x: 0, y: 86, z: 72 }, { x: -64, y: 0, z: 72 }
      ].map((point, band) => ({ ...point, band }));
      const edges = [edge(0,1),edge(1,2),edge(2,3),edge(3,4),edge(4,5),edge(5,0),edge(6,7),edge(7,8),edge(8,9),edge(9,6),edge(0,6),edge(1,7),edge(2,7),edge(2,8),edge(3,8),edge(4,8),edge(4,9),edge(5,9)];
      return { points, edges };
    },
    orbit() {
      const points = [{ x: 0, y: 0, z: 0, band: 0 }];
      const edges = [];
      for (let ring = 0; ring < 4; ring++) {
        const count = 14;
        const radius = 50 + ring * 28;
        const start = points.length;
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2;
          const index = points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .55, z: Math.sin(angle + ring) * 60, band: i }) - 1;
          edges.push(edge(index, start + (i + 1) % count));
          if (i % 4 === 0) edges.push(edge(0, index));
        }
      }
      return { points, edges };
    }
  };

  const shapeFor = name => {
    if (name === 'product') return shapes.prism();
    if (name === 'docs' || name === 'integrations') return shapes.pages();
    if (name === 'pricing' || name === 'pilot') return shapes.pyramid();
    if (name === 'about' || name === 'benchmark') return shapes.sphere();
    if (name === 'security') return shapes.shield();
    if (name === 'blog' || name === 'status') return shapes.orbit();
    return shapes.cube();
  };

  canvases.forEach(canvas => {
    const wrap = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const model = shapeFor(wrap.dataset.shape || 'cube');
    const bands = model.points.map(point => Number(point.band) || 0);
    const minBand = Math.min(...bands);
    const maxBand = Math.max(...bands);
    const bandSpan = Math.max(1, maxBand - minBand);
    let yaw = Number(wrap.dataset.shape === 'pages' ? -.35 : .58);
    let tilt = .34;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let width = 520;
    let height = 420;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = Math.max(250, wrap.clientWidth);
      height = Math.round(width * (canvas.classList.contains('page-geometry-canvas') ? .72 : .78));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = point => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const rx = point.x * cy - point.z * sy;
      const rz = point.x * sy + point.z * cy;
      const ry = point.y * ct - rz * st;
      const depth = point.y * st + rz * ct;
      const perspective = 560 / (560 + depth);
      const scale = width / 470;
      return { x: width / 2 + rx * perspective * scale, y: height / 2 + ry * perspective * scale, depth, perspective, point };
    };

    wrap.addEventListener('pointerdown', event => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      wrap.setPointerCapture?.(event.pointerId);
    });
    wrap.addEventListener('pointermove', event => {
      if (!dragging) return;
      yaw += (event.clientX - lastX) * .007;
      tilt = Math.max(.08, Math.min(1, tilt + (event.clientY - lastY) * .004));
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const endDrag = event => {
      dragging = false;
      try { wrap.releasePointerCapture?.(event.pointerId); } catch {}
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    const render = time => {
      resize();
      ctx.clearRect(0, 0, width, height);
      if (!dragging && !reduced) yaw += .00105;
      const projected = model.points.map(project);
      const sweep = reduced ? .55 : (Math.sin(time * .0004) + 1) / 2;
      model.edges.forEach(([from, to]) => {
        const a = projected[from];
        const b = projected[to];
        const edgeBand = (((bands[from] + bands[to]) / 2) - minBand) / bandSpan;
        const light = Math.max(0, 1 - Math.abs(edgeBand - sweep) * 4.5);
        ctx.strokeStyle = `rgba(92,140,255,${.1 + light * .25})`;
        ctx.lineWidth = .72 + light * .32;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
      projected
        .sort((a, b) => b.depth - a.depth)
        .forEach((item, index) => {
          const pointBand = ((Number(item.point.band) || 0) - minBand) / bandSpan;
          const light = Math.max(0, 1 - Math.abs(pointBand - sweep) * 5);
          const pulse = reduced ? 0 : (Math.sin(time * .0011 + index * .62) + 1) * .08;
          const radius = (1.85 + light * .72 + pulse) * item.perspective * width / 520;
          if (light > .12) {
            const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, radius * 4.8);
            glow.addColorStop(0, `rgba(84,137,255,${light * .22})`);
            glow.addColorStop(1, 'rgba(84,137,255,0)');
            ctx.beginPath();
            ctx.arc(item.x, item.y, radius * 4.8, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(118,161,255,${.34 + light * .52})`;
          ctx.fill();
        });
      requestAnimationFrame(render);
    };

    resize();
    requestAnimationFrame(render);
  });
})();
