/* game.js
 * The state of the demo and the rules for moving through it: maze, snake, goals,
 * and which phase we are in. No DOM and no drawing here.
 *
 * Phases:
 *   preview  a finished solution is shown at rest
 *   search   A* is expanding cells one at a time
 *   move     the snake is gliding along the route A* found
 *   arrived  the snake reached the goal
 *   fail     the open list ran out: no route
 *
 * The snake is no longer a list of cells. It is a trail: the points the head has passed
 * through. The head sits at the end of the trail, and the body is the last few cells of it.
 */
const Game = {
  cols: 21,
  rows: 15,
  grid: new Uint8Array(0),   // 1 = wall, 0 = floor

  homeA: 0,                  // start and goal markers the user places
  homeB: 0,
  origin: 0,                 // where the current search starts and ends
  goal: 0,

  options: {
    mode: 'plan',            // 'plan' (knows the maze) | 'explore' (sees only nearby cells)
    vision: 'medium',        // 'short' | 'medium' | 'long' (explore mode)
    heuristic: 'astar',      // 'astar' | 'zero' | 'weighted'
    moves: 'eight',          // 'eight' | 'four'
    smooth: true,            // cut straight lines across open floor
    speed: 5,                // index into CONFIG.SEARCH_RATES / MOVE_RATES
    autoNext: true,          // pick a new goal after arriving
    bodyBlocks: false,       // snake body counts as walls during search
    showCosts: false         // draw g, h, f inside cells
  },

  phase: 'preview',
  running: false,
  trail: [],                 // [x, y] points, oldest first, ending at the head
  route: null,               // the route the head follows: { points, cum, length }
  rawPoints: null,           // A*'s cells as points, before smoothing (for drawing)
  headDist: 0,               // how far along the route the head has travelled
  search: null,              // the current AStar search object
  optimal: -1,               // true cheapest cost from Dijkstra, for comparison
  log: '',
  eaten: 0,
  failStreak: 0,
  hover: -1,

  // Explore mode only
  known: null,               // 1 for every cell the snake has seen
  belief: null,              // the snake's map: walls it has seen are 1, everything else is 0
  replans: 0,                // how many times it had to plan again
  travelled: 0,              // distance covered since the current goal was set

  /* ---------- where things are ---------- */

  centerOf(i) {
    return [(i % Game.cols) + 0.5, ((i / Game.cols) | 0) + 0.5];
  },

  headPoint() {
    return Game.trail[Game.trail.length - 1];
  },

  headCell() {
    const p = Game.headPoint();
    return Math.floor(p[1]) * Game.cols + Math.floor(p[0]);
  },

  // The body as a list of points, head first.
  bodyPoints() {
    return Path.bodyPolyline(Game.trail, CONFIG.SNAKE_LENGTH);
  },

  // Which way the head is facing, as a unit vector.
  heading() {
    const t = Game.trail;
    const h = t[t.length - 1];
    for (let i = t.length - 2; i >= 0; i--) {
      const dx = h[0] - t[i][0], dy = h[1] - t[i][1];
      const d = Math.hypot(dx, dy);
      if (d > 0.05) return [dx / d, dy / d];
    }
    if (Game.route) return Path.tangentAt(Game.route, Game.headDist);
    return [1, 0];
  },

  diagonal() {
    return Game.options.moves === 'eight';
  },

  world(blocked) {
    return { cols: Game.cols, rows: Game.rows, grid: Game.grid, blocked };
  },

  /* ---------- setup ---------- */

  newMaze(sizeKey) {
    const [cols, rows] = CONFIG.SIZES[sizeKey];
    Game.cols = cols;
    Game.rows = rows;
    Game.grid = Maze.generate(cols, rows);
    Game.homeA = 1 * cols + 1;
    Game.homeB = (rows - 2) * cols + (cols - 2);
    Game.resetAll();
  },

  resetAll() {
    Game.running = false;
    Game.origin = Game.homeA;
    Game.goal = Game.homeB;
    Game.trail = [Game.centerOf(Game.origin)];
    Game.route = null;
    Game.rawPoints = null;
    Game.headDist = 0;
    Game.eaten = 0;
    Game.failStreak = 0;
    Game.solveInstant();
  },

  /* ---------- editing the maze ---------- */

  setWall(i, value) {
    Game.grid[i] = value;
    Game.resetAll();
  },

  moveMarkerA(i) {
    if (Game.grid[i] || i === Game.homeA || i === Game.homeB) return false;
    Game.homeA = i;
    Game.resetAll();
    return true;
  },

  moveMarkerB(i) {
    if (Game.grid[i] || i === Game.homeA || i === Game.homeB) return false;
    Game.homeB = i;
    Game.resetAll();
    return true;
  },

  /* ---------- searching ---------- */

  beginSearch() {
    const n = Game.cols * Game.rows;
    const blocked = new Uint8Array(n);
    if (Game.options.bodyBlocks && Game.options.mode === 'plan') {
      // every cell the body passes through is a wall for this search, except the head's own cell
      const head = Game.headCell();
      for (const [x, y] of Path.sample(Game.bodyPoints(), 0.2)) {
        const c = Math.floor(y) * Game.cols + Math.floor(x);
        if (c !== head) blocked[c] = 1;
      }
    }
    const common = {
      cols: Game.cols, rows: Game.rows, grid: Game.grid, blocked, diagonal: Game.diagonal()
    };
    Game.search = AStar.create({
      ...common, start: Game.origin, goal: Game.goal, heuristic: Game.options.heuristic
    });
    Game.optimal = AStar.shortestCost({ ...common, from: Game.origin, to: Game.goal });
    Game.log = 'Start: the only open cell is A. Press Run or Step.';
  },

  // Turn A*'s cells into the route the snake will follow: cell centers, then (optionally)
  // straightened, then with rounded corners.
  makeRoute() {
    const s = Game.search;
    const raw = s.path.map((c) => Game.centerOf(c));
    const waypoints = Game.options.smooth ? Path.smooth(raw, Game.world(s.blocked)) : raw;
    Game.rawPoints = raw;
    Game.route = Path.makeRoute(waypoints, Game.world(s.blocked));
    Game.headDist = 0;
  },

  // Expand one cell and update the phase and log line.
  advanceSearch(silent) {
    const s = Game.search;
    const result = s.step();

    if (!result) {
      Game.phase = 'fail';
      Game.log = 'The open list is empty, so there is no route from A to B.';
      if (!silent) {
        if (Game.running && Game.options.autoNext && Game.options.bodyBlocks && Game.failStreak < 5) {
          Game.failStreak++;
          Game.nextGoal();
          return;
        }
        if (Game.options.bodyBlocks && Game.running) Game.log = 'The snake is boxed in by its own body.';
        Game.running = false;
      }
      return;
    }

    if (s.status === 'found') {
      Game.makeRoute();
      Game.phase = 'move';
      Game.failStreak = 0;
      Game.log = 'Found B after expanding ' + s.expanded + ' cells. The grid path costs ' +
        fmt(s.g[s.goal]) + ' and the smoothed route is ' + fmt(Game.route.length) +
        ' long. The snake glides along it now.';
      return;
    }

    const c = result.cell;
    Game.log = 'Expanded (' + (c % Game.cols) + ', ' + ((c / Game.cols) | 0) + '): g = ' + fmt(s.g[c]) +
      ', h = ' + fmt(s.h[c]) + ', f = ' + fmt(s.g[c] + s.h[c]) + '. ' + result.updated +
      (result.updated === 1 ? ' neighbor' : ' neighbors') + ' added or improved.';
  },

  // Run the whole search at once so the board always shows a finished solution at rest.
  solveInstant() {
    if (Game.options.mode === 'explore') { Game.explorePreview(); return; }
    Game.beginSearch();
    Game.phase = 'search';
    let guard = Game.cols * Game.rows * 20;
    while (Game.phase === 'search' && guard--) Game.advanceSearch(true);

    if (Game.phase === 'move') {
      Game.phase = 'preview';
      const who = Game.options.heuristic === 'zero' ? 'Dijkstra' : 'The search';
      Game.log = who + ' expanded ' + Game.search.expanded + ' cells. The grid path costs ' +
        fmt(Game.search.g[Game.goal]) + ' and the route is ' + fmt(Game.route.length) +
        ' long. Press Run to watch it.';
    } else if (Game.phase === 'fail') {
      Game.log = 'No route from A to B. Remove a wall or move A or B, then try again.';
    }
  },

  /* ---------- running ---------- */

  startRun() {
    Game.trail = [Game.centerOf(Game.origin)];
    Game.headDist = 0;
    if (Game.options.mode === 'explore') { Game.startExplore(); return; }
    Game.beginSearch();
    Game.phase = 'search';
  },

  nextGoal() {
    const head = Game.headCell();
    const hx = head % Game.cols, hy = (head / Game.cols) | 0;
    const far = [], any = [];
    for (let i = 0; i < Game.grid.length; i++) {
      if (Game.grid[i] || i === head) continue;
      any.push(i);
      const d = Math.abs((i % Game.cols) - hx) + Math.abs(((i / Game.cols) | 0) - hy);
      if (d >= Math.min(Game.cols, Game.rows) / 2) far.push(i);
    }
    const pool = far.length ? far : any;
    if (!pool.length) { Game.running = false; return; }
    Game.origin = head;
    Game.goal = pool[Math.floor(Math.random() * pool.length)];
    if (Game.options.mode === 'explore') {
      // The snake keeps everything it has already seen. Only the goal changes.
      Game.travelled = 0;
      Game.computeOptimal();
      if (Game.plan(false)) {
        Game.phase = 'explore';
        Game.log = 'New goal. The snake plans through what it knows and treats unseen cells as open.';
      } else {
        Game.noRoute();
      }
      return;
    }
    Game.beginSearch();
    Game.phase = 'search';
  },

  // Move the head `distance` cells along the route. The body follows the trail it leaves.
  stepMove(distance) {
    const r = Game.route;
    if (!r || Game.phase !== 'move') return;
    const to = Math.min(r.length, Game.headDist + distance);
    Path.extendTrail(Game.trail, r, Game.headDist, to);
    Path.trimTrail(Game.trail, CONFIG.SNAKE_LENGTH + 1);
    Game.headDist = to;
    if (to >= r.length) Game.arrive();
  },

  arrive() {
    Game.phase = 'arrived';
    Game.eaten++;
    if (Game.options.mode === 'explore') {
      Game.log = 'The snake reached B after travelling ' + fmt(Game.travelled) +
        ' cells. A* on the full map would have planned a grid path of ' + fmt(Game.optimal) +
        '. Replans so far: ' + Game.replans + '. Goals eaten: ' + Game.eaten + '.';
    } else {
      Game.log = 'The snake reached B. Goals eaten: ' + Game.eaten + '.';
    }
    if (!Game.options.autoNext) Game.running = false;
  },

  /* ---------- explore mode: the snake only knows what it has seen ---------- */

  // Start with an empty map. Only the outer border is known, and everything else is unseen.
  initKnowledge() {
    const { cols, rows, grid } = Game;
    Game.known = new Uint8Array(cols * rows);
    Game.belief = new Uint8Array(cols * rows);
    for (let i = 0; i < grid.length; i++) {
      const x = i % cols, y = (i / cols) | 0;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        Game.known[i] = 1;
        Game.belief[i] = grid[i];
      }
    }
    Game.replans = 0;
    Game.travelled = 0;
    Game.reveal();
  },

  // Can a straight line from (hx, hy) reach the middle of cell (cx, cy) without crossing a wall?
  canSee(hx, hy, cx, cy) {
    const tx = cx + 0.5, ty = cy + 0.5;
    const target = cy * Game.cols + cx;
    const n = Math.ceil(Math.hypot(tx - hx, ty - hy) / 0.1);
    for (let k = 1; k < n; k++) {
      const x = hx + (tx - hx) * k / n, y = hy + (ty - hy) * k / n;
      const c = Math.floor(y) * Game.cols + Math.floor(x);
      if (c === target) return true;
      if (Game.grid[c]) return false;
    }
    return true;
  },

  // Look around from the head. Every cell within the vision radius that has a clear line of sight
  // becomes known. Returns how many newly seen cells are walls.
  reveal() {
    const { cols, rows, grid, known, belief } = Game;
    const [hx, hy] = Game.headPoint();
    const R = CONFIG.VISION[Game.options.vision] || CONFIG.VISION.medium;
    const hcx = Math.floor(hx), hcy = Math.floor(hy);
    let newWalls = 0;
    for (let cy = Math.max(0, Math.floor(hy - R)); cy <= Math.min(rows - 1, Math.floor(hy + R)); cy++) {
      for (let cx = Math.max(0, Math.floor(hx - R)); cx <= Math.min(cols - 1, Math.floor(hx + R)); cx++) {
        const i = cy * cols + cx;
        if (known[i]) continue;
        // the 8 cells touching the head are always seen
        const adjacent = Math.abs(cx - hcx) <= 1 && Math.abs(cy - hcy) <= 1;
        if (!adjacent) {
          if (Math.hypot(cx + 0.5 - hx, cy + 0.5 - hy) > R) continue;
          if (!Game.canSee(hx, hy, cx, cy)) continue;
        }
        known[i] = 1;
        belief[i] = grid[i];
        if (grid[i]) newWalls++;
      }
    }
    return newWalls;
  },

  // The cheapest grid path with the whole map known. Only used for comparison.
  computeOptimal() {
    Game.optimal = AStar.shortestCost({
      cols: Game.cols, rows: Game.rows, grid: Game.grid, from: Game.headCell(), to: Game.goal,
      blocked: new Uint8Array(Game.cols * Game.rows), diagonal: Game.diagonal()
    });
  },

  // Plan from where the head is now to the goal, using the snake's map (unseen cells count as open).
  // The search runs to completion at once. Returns false when no route exists on that map.
  plan(isReplan) {
    const { cols, rows } = Game;
    const s = AStar.create({
      cols, rows, grid: Game.belief, start: Game.headCell(), goal: Game.goal,
      heuristic: Game.options.heuristic, blocked: new Uint8Array(cols * rows), diagonal: Game.diagonal()
    });
    let guard = cols * rows * 20;
    while (s.status === 'searching' && guard--) s.step();
    Game.search = s;
    if (isReplan) Game.replans++;
    if (s.status !== 'found') return false;

    // The route starts at the head's exact position, not at the middle of its cell.
    const raw = s.path.map((c) => Game.centerOf(c));
    if (raw.length === 1) raw.push(Game.centerOf(Game.goal));
    raw[0] = Game.headPoint().slice();
    const world = { cols, rows, grid: Game.belief, blocked: null };
    const waypoints = Game.options.smooth ? Path.smooth(raw, world) : raw;
    Game.rawPoints = raw;
    Game.route = Path.makeRoute(waypoints, world);
    Game.headDist = 0;
    return true;
  },

  // Is any part of the route ahead now too close to a wall the snake knows about?
  routeBlocked() {
    const r = Game.route;
    if (!r) return false;
    const world = { cols: Game.cols, rows: Game.rows, grid: Game.belief, blocked: null };
    for (let s = Game.headDist + 0.2; s < r.length; s += 0.1) {
      const p = Path.pointAt(r, s);
      if (Path.clearance(world, p[0], p[1]) < 0.25) return true;
    }
    return false;
  },

  noRoute() {
    Game.phase = 'fail';
    Game.running = false;
    Game.log = 'No route from A to B on the snake\'s map. Remove a wall or move A or B, then try again.';
  },

  // Show the fogged board at rest: the snake knows only what is next to it, and has a first plan.
  explorePreview() {
    Game.initKnowledge();
    Game.computeOptimal();
    if (Game.plan(false)) {
      Game.phase = 'preview';
      Game.log = 'Fog hides the maze. The snake plans straight toward B as if the unseen cells were open. Press Run to watch it find out.';
    } else {
      Game.phase = 'fail';
      Game.log = 'No route from A to B. Remove a wall or move A or B, then try again.';
    }
  },

  startExplore() {
    Game.initKnowledge();
    Game.computeOptimal();
    if (!Game.plan(false)) { Game.noRoute(); return; }
    Game.phase = 'explore';
    Game.log = 'The snake sees only nearby cells. It walks its plan and plans again whenever a wall blocks the way.';
  },

  // Move the head `distance` cells along the plan, but only a short chunk at a time:
  // look around after each chunk, and plan again if a newly seen wall is in the way.
  stepExplore(distance) {
    let left = distance;
    while (left > 1e-9 && Game.phase === 'explore') {
      const d = Math.min(CONFIG.EXPLORE_CHUNK, left);
      left -= d;
      const r = Game.route;
      const to = Math.min(r.length, Game.headDist + d);
      Game.travelled += to - Game.headDist;
      Path.extendTrail(Game.trail, r, Game.headDist, to);
      Path.trimTrail(Game.trail, CONFIG.SNAKE_LENGTH + 1);
      Game.headDist = to;
      const newWalls = Game.reveal();
      if (to >= r.length - 1e-9) { Game.arrive(); return; }
      if (newWalls && Game.routeBlocked()) {
        if (!Game.plan(true)) { Game.noRoute(); return; }
        Game.log = 'A wall blocks the plan. Replan #' + Game.replans + ': A* expanded ' +
          Game.search.expanded + ' cells and found a new route of length ' + fmt(Game.route.length) + '.';
      }
    }
  },

  // One unit of work for whatever phase we are in (used by Step, and by the tests).
  tick() {
    if (Game.phase === 'explore') Game.stepExplore(1);
    else if (Game.phase === 'search') Game.advanceSearch(false);
    else if (Game.phase === 'move') Game.stepMove(1);
    else if (Game.phase === 'arrived') Game.nextGoal();
  },

  // Called by Run and Step before the first tick, to leave the resting states.
  prepareRun() {
    if (Game.phase === 'preview' || Game.phase === 'fail') Game.startRun();
    else if (Game.phase === 'arrived') Game.nextGoal();
  }
};
