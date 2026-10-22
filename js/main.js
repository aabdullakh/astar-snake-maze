/* main.js
 * Connects the page to the game: buttons, settings, pointer editing,
 * the stats panel, the animation loop, and startup.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('board');       // the flat 2D view
  const canvas3d = $('board3d');   // the Three.js view
  const boardEl = $('boardwrap');
  let view = Render;               // whichever view is showing: Render (2D) or Render3D

  /* ---------- Stats panel ---------- */

  function hoverText() {
    const h = Game.hover;
    if (h < 0) return '-';
    const label = '(' + (h % Game.cols) + ', ' + ((h / Game.cols) | 0) + ')';
    if (Game.options.mode === 'explore' && Game.known && !Game.known[h]) return label + ' not seen yet';
    if (Game.grid[h]) return label + ' wall';
    const s = Game.search;
    if (!s || !s.seen[h]) return label + ' not reached';
    return label + ' g' + fmt(s.g[h], 1) + ' h' + fmt(s.h[h], 1) + ' f' + fmt(s.g[h] + s.h[h], 1);
  }

  function updateUI() {
    const s = Game.search;
    const speed = Game.options.speed;
    const found = s && s.path;
    $('st-status').textContent = CONFIG.PHASE_LABEL[Game.phase];
    $('st-expanded').textContent = s ? s.expanded : 0;
    $('st-open').textContent = s ? s.openCount : 0;
    $('st-path').textContent = found ? fmt(s.g[s.goal]) : '-';
    $('st-route').textContent = found && Game.route ? fmt(Game.route.length) : '-';
    $('st-opt').textContent = Game.optimal < 0 ? '-' : fmt(Game.optimal);
    $('st-eaten').textContent = Game.eaten;
    const explore = Game.options.mode === 'explore' && Game.known;
    if (explore) {
      let seen = 0, total = 0;
      for (let i = 0; i < Game.grid.length; i++) {
        if (Game.grid[i]) continue;
        total++;
        if (Game.known[i]) seen++;
      }
      $('st-replans').textContent = Game.replans;
      $('st-seen').textContent = Math.round(100 * seen / total) + '% of floor';
      $('st-travel').textContent = fmt(Game.travelled);
    } else {
      $('st-replans').textContent = '-';
      $('st-seen').textContent = '-';
      $('st-travel').textContent = '-';
    }
    $('st-hover').textContent = hoverText();
    $('log').textContent = Game.log;
    $('run').textContent = Game.running ? 'Pause' : 'Run';
    $('run').setAttribute('aria-pressed', Game.running ? 'true' : 'false');
    $('speedval').textContent = CONFIG.SEARCH_RATES[speed] + ' cells/sec searching, ' +
      CONFIG.MOVE_RATES[speed] + ' cells/sec gliding';
  }

  function refresh() {
    updateUI();
    view.draw();
  }

  function loadMaze(sizeKey) {
    Game.newMaze(sizeKey);
    view.fit();
    refresh();
  }

  // Switch between the flat view and the two 3D camera modes.
  function setView(name) {
    const want3d = name !== '2d' && Render3D.isAvailable();
    view = want3d ? Render3D : Render;
    canvas.hidden = want3d;
    canvas3d.hidden = !want3d;
    if (want3d) Render3D.setMode(name);
    view.fit();
    refresh();
  }

  /* ---------- Editing the maze with the pointer ---------- */

  let drag = null; // { t: 'A' | 'B' | 'paint', val }

  // The same handlers work on both canvases. `view.cellAt` turns the pointer into a cell,
  // by simple division in 2D and by a ray through the scene in 3D.
  function attachPointer(el) {
    el.addEventListener('pointerdown', (e) => {
      const i = view.cellAt(e);
      if (i < 0) return;
      if (Game.phase !== 'preview' && Game.phase !== 'fail') Game.resetAll();
      el.setPointerCapture(e.pointerId);
      if (i === Game.homeA) drag = { t: 'A' };
      else if (i === Game.homeB) drag = { t: 'B' };
      else {
        drag = { t: 'paint', val: Game.grid[i] ? 0 : 1 };
        Game.setWall(i, drag.val);
      }
      refresh();
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      const i = view.cellAt(e);
      if (drag && i >= 0) {
        if (drag.t === 'paint') {
          if (i !== Game.homeA && i !== Game.homeB && Game.grid[i] !== drag.val) Game.setWall(i, drag.val);
        } else if (drag.t === 'A') {
          Game.moveMarkerA(i);
        } else if (drag.t === 'B') {
          Game.moveMarkerB(i);
        }
        refresh();
      }
      if (i !== Game.hover) {
        Game.hover = i;
        refresh();
      }
    });

    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('pointercancel', () => { drag = null; });
    el.addEventListener('pointerleave', () => {
      if (Game.hover !== -1) { Game.hover = -1; refresh(); }
    });
  }
  attachPointer(canvas);
  attachPointer(canvas3d);

  /* ---------- Buttons and settings ---------- */

  $('run').addEventListener('click', () => {
    if (Game.running) {
      Game.running = false;
    } else {
      Game.prepareRun();
      Game.running = true;
    }
    refresh();
  });

  $('step').addEventListener('click', () => {
    Game.running = false;
    Game.prepareRun();
    Game.tick();
    refresh();
  });

  $('reset').addEventListener('click', () => { Game.resetAll(); refresh(); });
  $('newmaze').addEventListener('click', () => loadMaze($('size').value));
  $('size').addEventListener('change', () => loadMaze($('size').value));

  // Vision only matters in explore mode, and the body option only in plan mode.
  function syncModeUI() {
    const explore = Game.options.mode === 'explore';
    $('visionfield').classList.toggle('off', !explore);
    $('vision').disabled = !explore;
    $('bodylabel').classList.toggle('off', explore);
    $('body').disabled = explore;
  }
  $('view').addEventListener('change', () => setView($('view').value));
  $('mode').addEventListener('change', () => {
    Game.options.mode = $('mode').value;
    syncModeUI();
    Game.resetAll();
    refresh();
  });
  $('vision').addEventListener('change', () => {
    Game.options.vision = $('vision').value;
    Game.resetAll();
    refresh();
  });

  $('heur').addEventListener('change', () => {
    Game.options.heuristic = $('heur').value;
    Game.resetAll();
    refresh();
  });
  $('moves').addEventListener('change', () => {
    Game.options.moves = $('moves').value;
    Game.resetAll();
    refresh();
  });
  $('smooth').addEventListener('change', () => {
    Game.options.smooth = $('smooth').checked;
    Game.resetAll();
    refresh();
  });
  $('speed').addEventListener('input', () => {
    Game.options.speed = +$('speed').value;
    updateUI();
  });
  $('auto').addEventListener('change', () => { Game.options.autoNext = $('auto').checked; });
  $('body').addEventListener('change', () => { Game.options.bodyBlocks = $('body').checked; });
  $('costs').addEventListener('change', () => {
    Game.options.showCosts = $('costs').checked;
    view.draw();
  });

  /* ---------- Animation loop ---------- */

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;

    if (Game.running) {
      const speed = Game.options.speed;

      if (Game.phase === 'arrived') Game.tick(); // pick the next goal straight away

      if (Game.phase === 'explore') {
        // Exploring also glides continuously, but it looks around and replans as it goes.
        acc = 0;
        Game.stepExplore(CONFIG.MOVE_RATES[speed] * dt / 1000);
      } else if (Game.phase === 'move') {
        // Gliding is continuous: move the head by (cells per second) x (seconds since last frame).
        acc = 0;
        Game.stepMove(CONFIG.MOVE_RATES[speed] * dt / 1000);
      } else if (Game.phase === 'search') {
        // Searching is one cell at a time, so count up time and tick whenever one step is due.
        const interval = 1000 / CONFIG.SEARCH_RATES[speed];
        let ticks = 0;
        acc += dt;
        while (acc >= interval && Game.running && Game.phase === 'search' && ticks < 60) {
          acc -= interval;
          Game.tick();
          ticks++;
        }
        if (ticks === 60) acc = 0;
      }
      refresh();
    } else {
      acc = 0;
      // the 3D scene is alive even when paused (floating apple, camera easing), so keep drawing it
      if (view !== Render) view.draw();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Startup ---------- */

  Render.init(canvas, boardEl);
  Render3D.init(canvas3d, boardEl);
  if (!Render3D.isAvailable()) {
    // No WebGL (or the Three.js file is missing): keep the page working in 2D only.
    $('view').disabled = true;
    $('view').title = '3D needs WebGL, which is not available in this browser.';
  }

  function recolor() {
    Render.readColors();
    Render3D.readColors();
    view.draw();
  }

  // Redraw when the theme or window size changes.
  if (window.matchMedia) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    if (dark.addEventListener) dark.addEventListener('change', recolor);
  }
  if (window.MutationObserver) {
    new MutationObserver(recolor)
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(() => { view.fit(); view.draw(); }).observe(boardEl);
  } else {
    window.addEventListener('resize', () => { view.fit(); view.draw(); });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => view.draw());

  syncModeUI();
  loadMaze('medium');
  requestAnimationFrame(frame);
})();
