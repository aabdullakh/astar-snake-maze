/* path.js
 * Geometry that turns A*'s list of grid cells into a route a snake can glide along.
 * It has no drawing and no game state, so you can read and test it on its own.
 *
 * Everything works in "cell units": cell (x, y) covers x..x+1 and y..y+1, so its center
 * is (x + 0.5, y + 0.5). A point is an [x, y] array.
 *
 * Most functions take a "world": { cols, rows, grid, blocked }. Walls, cells outside the
 * grid and blocked cells (the snake's own body, when that option is on) count as solid.
 *
 * The pipeline after A* finds its cells:
 *   cells -> points -> smooth() -> round() -> makeRoute() -> the snake glides along it
 */
const Path = {
  dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  },

  /* ---------- how close is a point to a wall? ---------- */

  isSolid(world, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= world.cols || cy >= world.rows) return true;
    const i = cy * world.cols + cx;
    return world.grid[i] === 1 || !!(world.blocked && world.blocked[i]);
  },

  // Distance from (x, y) to the nearest solid cell. Only the 3x3 cells around the point can be
  // closer than 1, so anything farther returns 1.
  clearance(world, x, y) {
    const fx = Math.floor(x), fy = Math.floor(y);
    let best = 1;
    for (let cy = fy - 1; cy <= fy + 1; cy++) {
      for (let cx = fx - 1; cx <= fx + 1; cx++) {
        if (!Path.isSolid(world, cx, cy)) continue;
        const dx = Math.max(cx - x, 0, x - (cx + 1));
        const dy = Math.max(cy - y, 0, y - (cy + 1));
        best = Math.min(best, Math.hypot(dx, dy));
      }
    }
    return best;
  },

  // Is the straight line from a to b at least minClear away from every wall?
  hasLineOfSight(world, a, b, minClear) {
    const n = Math.max(1, Math.ceil(Path.dist(a, b) / 0.05));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (Path.clearance(world, x, y) < minClear) return false;
    }
    return true;
  },

  /* ---------- shaping the path ---------- */

  // Drop every waypoint that isn't needed. From each kept point, jump to the farthest later
  // point that still has a clear straight line to it. The result cuts across open floor instead
  // of following the grid.
  smooth(points, world) {
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !Path.hasLineOfSight(world, points[i], points[j], CONFIG.CLEARANCE + 0.05)) j--;
      out.push(points[j]);
      i = j;
    }
    return out;
  },

  // A rounded corner: a quadratic curve that starts d before the corner, ends d after it,
  // and is pulled toward the corner point p.
  curve(p, u1, u2, d) {
    const e1 = [p[0] - u1[0] * d, p[1] - u1[1] * d];
    const e2 = [p[0] + u2[0] * d, p[1] + u2[1] * d];
    const out = [];
    const n = CONFIG.CURVE_STEPS;
    for (let k = 0; k <= n; k++) {
      const t = k / n, m = 1 - t;
      out.push([
        m * m * e1[0] + 2 * m * t * p[0] + t * t * e2[0],
        m * m * e1[1] + 2 * m * t * p[1] + t * t * e2[1]
      ]);
    }
    return out;
  },

  // Round every corner, but only as far as the snake still stays CLEARANCE away from the walls.
  // If a rounded corner would clip a wall, try a tighter one, and finally keep the sharp corner.
  round(points, world) {
    if (points.length < 3) return points.map((p) => p.slice());
    const out = [points[0].slice()];
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], p = points[i], b = points[i + 1];
      const l1 = Path.dist(a, p), l2 = Path.dist(p, b);
      const u1 = [(p[0] - a[0]) / l1, (p[1] - a[1]) / l1]; // direction we arrive in
      const u2 = [(b[0] - p[0]) / l2, (b[1] - p[1]) / l2]; // direction we leave in
      const cross = u1[0] * u2[1] - u1[1] * u2[0];
      const dot = u1[0] * u2[0] + u1[1] * u2[1];
      if ((Math.abs(cross) < 1e-6 && dot > 0) || dot < -0.999) { // straight on, or a full reversal
        out.push(p.slice());
        continue;
      }
      // Never use more than half of either leg, so neighboring corners can't overlap.
      let d = Math.min(CONFIG.CORNER_RADIUS, l1 / 2, l2 / 2);
      let curve = null;
      for (let tries = 0; tries < 4 && !curve; tries++, d /= 2) {
        const candidate = Path.curve(p, u1, u2, d);
        if (candidate.every((q) => Path.clearance(world, q[0], q[1]) >= CONFIG.CLEARANCE)) curve = candidate;
      }
      if (curve) out.push(...curve); else out.push(p.slice());
    }
    out.push(points[points.length - 1].slice());
    return out;
  },

  // Turn waypoints into a route: rounded corners, plus the running length at each point
  // so we can ask "where is the snake after travelling this far?".
  makeRoute(waypoints, world) {
    const rounded = Path.round(waypoints, world);
    const points = [rounded[0]];
    for (let i = 1; i < rounded.length; i++) {
      if (Path.dist(points[points.length - 1], rounded[i]) > 1e-9) points.push(rounded[i]);
    }
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Path.dist(points[i - 1], points[i]));
    return { points, cum, length: cum[cum.length - 1] };
  },

  /* ---------- moving along a route ---------- */

  // The point reached after travelling distance s along the route.
  pointAt(route, s) {
    const { points, cum, length } = route;
    if (s <= 0 || points.length === 1) return points[0].slice();
    if (s >= length) return points[points.length - 1].slice();
    let i = 1;
    while (cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return [
      points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
      points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t
    ];
  },

  // The direction of travel (a unit vector) after travelling distance s.
  tangentAt(route, s) {
    const { points, cum } = route;
    if (points.length < 2) return [1, 0];
    let i = 1;
    while (i < points.length - 1 && cum[i] < s) i++;
    const a = points[i - 1], b = points[i];
    const d = Path.dist(a, b);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  },

  /* ---------- the snake's trail ---------- */

  // The trail is the list of points the head has passed through, oldest first, ending at the head.
  // Moving the head from distance `from` to `to` adds every route corner in between, then the
  // new head point.
  extendTrail(trail, route, from, to) {
    if (to <= from) return;
    for (let i = 0; i < route.points.length; i++) {
      if (route.cum[i] > from + 1e-9 && route.cum[i] < to - 1e-9) trail.push(route.points[i].slice());
    }
    trail.push(Path.pointAt(route, to));
  },

  // Forget trail that is further behind the head than the body can reach.
  trimTrail(trail, keepLength) {
    let acc = 0;
    for (let i = trail.length - 1; i > 0; i--) {
      acc += Path.dist(trail[i], trail[i - 1]);
      if (acc > keepLength) {
        trail.splice(0, i - 1);
        return;
      }
    }
  },

  // The snake's body: the last `length` cells of trail, head first.
  bodyPolyline(trail, length) {
    const out = [trail[trail.length - 1].slice()];
    let remaining = length;
    for (let i = trail.length - 1; i > 0; i--) {
      const seg = Path.dist(trail[i], trail[i - 1]);
      if (seg >= remaining) {
        const t = remaining / seg;
        out.push([
          trail[i][0] + (trail[i - 1][0] - trail[i][0]) * t,
          trail[i][1] + (trail[i - 1][1] - trail[i][1]) * t
        ]);
        return out;
      }
      out.push(trail[i - 1].slice());
      remaining -= seg;
    }
    return out;
  },

  // Re-sample a polyline so no two neighboring points are more than `step` apart.
  sample(points, step) {
    const out = [points[0].slice()];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const n = Math.max(1, Math.ceil(Path.dist(a, b) / step));
      for (let k = 1; k <= n; k++) {
        out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
    }
    return out;
  }
};
