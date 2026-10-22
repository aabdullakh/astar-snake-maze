/* astar.js
 * The A* search itself. It knows nothing about the canvas, the snake or the page,
 * so you can read it (and test it) on its own.
 *
 * Usage:
 *   const search = AStar.create({ cols, rows, grid, start, goal, heuristic: 'astar', diagonal: true });
 *   while (search.status === 'searching') search.step();   // one cell per call
 *   search.path   // array of cell indices from start to goal, or null
 *
 * Per-cell bookkeeping (all indexed by cell index):
 *   g       best known cost from the start (a straight step costs 1, a diagonal sqrt(2))
 *   h       heuristic estimate of the cost left to the goal
 *   parent  the cell we came from on the best known route
 *   seen    discovered at least once (open or closed)
 *   closed  fully expanded
 */
const AStar = {
  // Estimated cost from (x, y) to the goal. It must never overestimate the real cost, or A*
  // can return a path that isn't the shortest.
  //   4 directions: Manhattan distance, |dx| + |dy|
  //   8 directions: octile distance. The diagonal part costs sqrt(2) instead of 2.
  heuristic(kind, x, y, gx, gy, diagonal) {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    const d = diagonal
      ? (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy)
      : dx + dy;
    if (kind === 'zero') return 0;          // Dijkstra: no guess at all
    if (kind === 'weighted') return 3 * d;  // overestimates on purpose: faster, maybe longer path
    return d;                               // classic A*
  },

  // Every cell you can step to from `cell`, with the cost of that step.
  // A diagonal step is only allowed if both cells it passes beside are free,
  // so the snake can't squeeze through the gap between two walls that only touch at a corner.
  successors(cols, rows, grid, blocked, cell, diagonal) {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    const free = (x, y) =>
      x >= 0 && y >= 0 && x < cols && y < rows && !grid[y * cols + x] && !blocked[y * cols + x];
    const out = [];
    for (const [dx, dy, cost] of (diagonal ? CONFIG.MOVES.eight : CONFIG.MOVES.four)) {
      const nx = cx + dx, ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && !(free(cx + dx, cy) && free(cx, cy + dy))) continue;
      out.push({ j: ny * cols + nx, cost });
    }
    return out;
  },

  create({ cols, rows, grid, start, goal, heuristic, blocked, diagonal }) {
    const n = cols * rows;
    const gx = goal % cols;
    const gy = (goal / cols) | 0;
    const hOf = (i) => AStar.heuristic(heuristic, i % cols, (i / cols) | 0, gx, gy, diagonal);
    const open = new MinHeap();

    const search = {
      cols, rows, start, goal,
      g: new Float64Array(n).fill(Infinity),
      h: new Float64Array(n),
      parent: new Int32Array(n).fill(-1),
      seen: new Uint8Array(n),
      closed: new Uint8Array(n),
      blocked: blocked || new Uint8Array(n),
      openCount: 1,
      expanded: 0,
      current: -1,
      status: 'searching', // 'searching' | 'found' | 'failed'
      path: null,

      // Expand one cell. Returns { cell, updated }, or null when the open list is empty (no route).
      step() {
        // 1. Take the open cell with the lowest f. Skip stale entries: cells already closed,
        //    or entries pushed before a cheaper route to that cell was found.
        let node = null;
        while (open.size) {
          const candidate = open.pop();
          if (!search.closed[candidate.i] && candidate.g === search.g[candidate.i]) {
            node = candidate;
            break;
          }
        }
        if (!node) {
          search.status = 'failed';
          return null;
        }

        // 2. Mark it closed.
        const current = node.i;
        search.closed[current] = 1;
        search.openCount--;
        search.expanded++;
        search.current = current;

        // 3. Reached the goal: follow parents back to the start.
        if (current === goal) {
          search.path = search.buildPath();
          search.status = 'found';
          return { cell: current, updated: 0 };
        }

        // 4. Look at each neighbor. Record it if this route reaches it more cheaply.
        let updated = 0;
        for (const { j, cost } of AStar.successors(cols, rows, grid, search.blocked, current, diagonal)) {
          const newG = search.g[current] + cost;
          if (newG < search.g[j]) {
            if (!search.seen[j]) {
              search.seen[j] = 1;
              search.openCount++;
            } else if (search.closed[j]) {
              search.closed[j] = 0;           // cheaper route to a closed cell: reopen it
              search.openCount++;
            }
            search.g[j] = newG;
            search.h[j] = hOf(j);
            search.parent[j] = current;
            open.push({ i: j, f: newG + search.h[j], g: newG });
            updated++;
          }
        }
        return { cell: current, updated };
      },

      buildPath() {
        const path = [];
        for (let c = goal; c !== -1; c = search.parent[c]) path.push(c);
        return path.reverse();
      }
    };

    search.g[start] = 0;
    search.h[start] = hOf(start);
    search.seen[start] = 1;
    open.push({ i: start, f: search.h[start], g: 0 });
    return search;
  },

  // The true cheapest cost from `from` to `to` (Dijkstra's algorithm, no guessing).
  // Used only to show "Shortest possible" for comparison. Returns -1 when there is no route.
  shortestCost({ cols, rows, grid, from, to, blocked, diagonal }) {
    const n = cols * rows;
    const none = blocked || new Uint8Array(n);
    const dist = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    const heap = new MinHeap();
    dist[from] = 0;
    heap.push({ i: from, f: 0, g: 0 });
    while (heap.size) {
      const { i } = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      if (i === to) return dist[i];
      for (const { j, cost } of AStar.successors(cols, rows, grid, none, i, diagonal)) {
        if (dist[i] + cost < dist[j]) {
          dist[j] = dist[i] + cost;
          heap.push({ i: j, f: dist[j], g: dist[j] });
        }
      }
    }
    return -1;
  }
};
