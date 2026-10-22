/* render.js
 * Draws the maze, the A* search state and the snake onto the canvas.
 * It only reads from Game; it never changes it.
 * Points in the game are in cell units, so every point is multiplied by `cs` (pixels per cell).
 */
const Render = (() => {
  const FONT = "'Bricolage Grotesque', 'Segoe UI', sans-serif";
  const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

  let canvas, ctx, boardEl;
  let colors = {};
  let cssW = 600;
  let dpr = 1;

  function init(canvasEl, wrapperEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    boardEl = wrapperEl;
    readColors();
  }

  // Colors come from the CSS variables so light and dark themes both work.
  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const get = (name) => style.getPropertyValue(name).trim();
    colors = {
      floor: get('--floor'), line: get('--line'), wall: get('--wall'),
      closed: get('--closed'), open: get('--open'), path: get('--path'),
      snake: get('--snake'), goal: get('--goal'), ink: get('--ink'), fog: get('--fog')
    };
  }

  // Match the canvas resolution to its on-screen size (and the display's pixel ratio).
  function fit() {
    cssW = Math.max(200, boardEl.clientWidth);
    dpr = window.devicePixelRatio || 1;
    const h = cssW * Game.rows / Game.cols;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(h * dpr);
  }

  // Which cell is under a pointer event? Returns -1 outside the maze.
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * Game.cols);
    const y = Math.floor((e.clientY - r.top) / r.height * Game.rows);
    if (x < 0 || y < 0 || x >= Game.cols || y >= Game.rows) return -1;
    return y * Game.cols + x;
  }

  function strokeLine(points, cs) {
    ctx.beginPath();
    points.forEach((p, k) => {
      if (k) ctx.lineTo(p[0] * cs, p[1] * cs); else ctx.moveTo(p[0] * cs, p[1] * cs);
    });
    ctx.stroke();
  }

  function draw() {
    if (!Game.trail.length) return;
    const { cols, rows, grid, search: a, phase } = Game;
    const cs = cssW / cols;
    const H = cs * rows;
    let i;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, H);
    ctx.fillStyle = colors.floor;
    ctx.fillRect(0, 0, cssW, H);

    const explore = Game.options.mode === 'explore' && Game.known;

    // Explored (closed, blue) and discovered (open, amber) cells. In explore mode the plan is
    // made again and again, so those colors would only be clutter.
    if (a && !explore) {
      for (i = 0; i < grid.length; i++) {
        if (grid[i]) continue;
        if (a.closed[i]) ctx.fillStyle = colors.closed;
        else if (a.seen[i]) ctx.fillStyle = colors.open;
        else continue;
        ctx.fillRect((i % cols) * cs, ((i / cols) | 0) * cs, cs, cs);
      }
    }

    // Grid lines
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) { ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, H); }
    for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(cssW, y * cs + 0.5); }
    ctx.stroke();

    // Walls
    ctx.fillStyle = colors.wall;
    for (i = 0; i < grid.length; i++) {
      if (grid[i]) ctx.fillRect((i % cols) * cs, ((i / cols) | 0) * cs, cs, cs);
    }

    // Fog: cover every cell the snake has not seen yet, so unseen walls stay hidden
    if (explore) {
      ctx.fillStyle = colors.fog;
      for (i = 0; i < grid.length; i++) {
        if (!Game.known[i]) ctx.fillRect((i % cols) * cs, ((i / cols) | 0) * cs, cs, cs);
      }
    }

    if (!explore) drawCosts(cs);
    drawRoute(cs);

    // How far the snake can see
    if (explore) {
      const hp = Game.headPoint();
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(hp[0] * cs, hp[1] * cs, (CONFIG.VISION[Game.options.vision] || CONFIG.VISION.medium) * cs, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // The cell A* just expanded
    if (phase === 'search' && a && a.current >= 0) {
      const c = a.current;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect((c % cols) * cs + 1.5, ((c / cols) | 0) * cs + 1.5, cs - 3, cs - 3);
    }

    // Start marker (a ring, so the snake can sit on top of it)
    const o = Game.centerOf(Game.origin);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(o[0] * cs, o[1] * cs, cs * 0.44, 0, 7);
    ctx.stroke();

    // Goal marker
    const gp = Game.centerOf(Game.goal);
    ctx.fillStyle = colors.goal;
    ctx.beginPath();
    ctx.arc(gp[0] * cs, gp[1] * cs, cs * 0.36, 0, 7);
    ctx.fill();
    if (cs >= 16) {
      ctx.fillStyle = colors.floor;
      ctx.font = '700 ' + Math.round(cs * 0.42) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', gp[0] * cs, gp[1] * cs + cs * 0.03);
    }

    drawSnake(cs, o);

    // Hover outline
    if (Game.hover >= 0) {
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.strokeRect((Game.hover % cols) * cs + 1, ((Game.hover / cols) | 0) * cs + 1, cs - 2, cs - 2);
      ctx.globalAlpha = 1;
    }
  }

  // Optional g / h / f numbers inside discovered cells.
  function drawCosts(cs) {
    const { cols, grid, search: a } = Game;
    if (!Game.options.showCosts || !a || cs < 22) return;
    const big = cs >= 30;
    ctx.fillStyle = colors.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] || !a.seen[i]) continue;
      const px = (i % cols) * cs, py = ((i / cols) | 0) * cs;
      ctx.globalAlpha = 0.9;
      ctx.font = '600 ' + Math.round(cs * (big ? 0.34 : 0.36)) + 'px ' + MONO;
      ctx.fillText(fmt(a.g[i] + a.h[i], 1), px + cs / 2, py + cs / 2 + (big ? cs * 0.06 : 0));
      if (big) {
        ctx.globalAlpha = 0.6;
        ctx.font = '400 ' + Math.round(cs * 0.22) + 'px ' + MONO;
        ctx.textAlign = 'left';
        ctx.fillText(fmt(a.g[i], 1), px + cs * 0.08, py + cs * 0.2);
        ctx.textAlign = 'right';
        ctx.fillText(fmt(a.h[i], 1), px + cs * 0.92, py + cs * 0.2);
        ctx.textAlign = 'center';
      }
    }
    ctx.globalAlpha = 1;
  }

  // The route the snake follows (solid), and A*'s own grid path before smoothing (dashed, faint).
  function drawRoute(cs) {
    const showing = Game.phase === 'move' || Game.phase === 'explore' ||
      Game.phase === 'arrived' || Game.phase === 'preview';
    if (!showing || !Game.route) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colors.path;
    if (Game.options.smooth && Game.rawPoints) {
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      strokeLine(Game.rawPoints, cs);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = Math.max(2, cs * 0.1);
    strokeLine(Game.route.points, cs);
  }

  function drawSnake(cs, originPoint) {
    // The body is drawn in many short pieces so it can taper toward the tail.
    const body = Path.sample(Game.bodyPoints(), 0.15);
    ctx.strokeStyle = colors.snake;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let travelled = 0;
    for (let i = 0; i < body.length - 1; i++) {
      const seg = Path.dist(body[i], body[i + 1]);
      const t = Math.min(1, (travelled + seg / 2) / CONFIG.SNAKE_LENGTH);
      ctx.lineWidth = cs * CONFIG.SNAKE_WIDTH * (1 - 0.5 * t);
      ctx.beginPath();
      ctx.moveTo(body[i][0] * cs, body[i][1] * cs);
      ctx.lineTo(body[i + 1][0] * cs, body[i + 1][1] * cs);
      ctx.stroke();
      travelled += seg;
    }

    const head = body[0];
    ctx.fillStyle = colors.snake;
    ctx.beginPath();
    ctx.arc(head[0] * cs, head[1] * cs, cs * CONFIG.HEAD_RADIUS, 0, 7);
    ctx.fill();

    // Eyes face the direction of travel
    const [fx, fy] = Game.heading();
    const qx = -fy, qy = fx;
    ctx.fillStyle = colors.floor;
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.arc(
        (head[0] + fx * 0.1 + qx * side * 0.12) * cs,
        (head[1] + fy * 0.1 + qy * side * 0.12) * cs,
        Math.max(1.5, cs * 0.055), 0, 7
      );
      ctx.fill();
    });

    // Once the snake has left A, write the letter on the start ring
    if (Game.headCell() !== Game.origin && cs >= 16) {
      ctx.fillStyle = colors.ink;
      ctx.font = '700 ' + Math.round(cs * 0.4) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', originPoint[0] * cs, originPoint[1] * cs + cs * 0.03);
    }
  }

  return { init, readColors, fit, cellAt, draw };
})();
