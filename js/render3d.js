/* render3d.js
 * A 3D view of the same game, drawn with Three.js. Like render.js it only reads from Game.
 *
 * The game's grid (x, y) maps onto the 3D world as (x, 0, y): x goes right, y goes toward the
 * camera, and the third axis (up) is height. Game points are in cell units, so one cell is one
 * 3D unit wide.
 *
 * What is drawn:
 *   floor tiles   one per cell, colored by search state (or fog in explore mode)
 *   walls         one box per wall cell; in explore mode they rise out of the ground when seen
 *   route         glowing dots along the route the snake follows
 *   snake         spheres along its body (tapered, with a small slither), plus head, eyes, tongue
 *   goal          a floating apple
 *   vision        a glowing disc around the head in explore mode
 *
 * Two camera modes: 'overview' looks down at the whole maze, 'chase' follows the snake.
 */
const Render3D = (() => {
  const WALL_H = 0.75;
  const MAX_BODY = 90;
  const MAX_DOTS = 2500;

  let available = typeof THREE !== 'undefined';
  let renderer, scene, camera, canvas, boardEl;
  let colors = {};
  let colorsDirty = true;
  let mode = 'overview';
  let w = 600, h = 380;

  // scene objects that depend on the maze size
  let builtKey = '';
  let walls, tiles, slab, wallHeights, wallTint;
  // objects that do not
  let routeDots, bodySpheres, head, tongue, apple, appleLight, startRing, visionRing, visionDisc, hoverBox;
  let hemi, sun;

  const dummy = typeof THREE !== 'undefined' ? new THREE.Object3D() : null;
  const tmpColor = typeof THREE !== 'undefined' ? new THREE.Color() : null;

  let lastGrid = null, lastKnown = null, lastRoute = null;
  let lastTime = 0, wavePhase = 0;
  let camPos = null, camLook = null, smoothHeading = [1, 0];
  let camSnap = true;

  /* ---------- setup ---------- */

  function init(canvasEl, wrapperEl) {
    canvas = canvasEl;
    boardEl = wrapperEl;
    if (!available) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      available = false;
      return false;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 200);
    camPos = new THREE.Vector3();
    camLook = new THREE.Vector3();

    hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);

    buildFixedObjects();
    readColors();
    return true;
  }

  function isAvailable() { return available; }

  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const get = (name) => style.getPropertyValue(name).trim();
    colors = {
      bg: get('--bg'), floor: get('--floor'), wall: get('--wall'), closed: get('--closed'),
      open: get('--open'), path: get('--path'), snake: get('--snake'), goal: get('--goal'),
      ink: get('--ink'), fog: get('--fog')
    };
    colorsDirty = true;
  }

  // Objects that are the same for every maze size.
  function buildFixedObjects() {
    const sphere = new THREE.SphereGeometry(1, 16, 12);

    bodySpheres = new THREE.InstancedMesh(sphere, new THREE.MeshStandardMaterial({ roughness: 0.55 }), MAX_BODY);
    bodySpheres.castShadow = true;
    bodySpheres.frustumCulled = false;
    scene.add(bodySpheres);

    routeDots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial(), MAX_DOTS);
    routeDots.frustumCulled = false;
    routeDots.count = 0;
    scene.add(routeDots);

    // head: a slightly squashed sphere, two eyes with pupils, and a tongue. It faces +z.
    head = new THREE.Group();
    const headMesh = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    headMesh.scale.set(1, 0.85, 1.15);
    headMesh.castShadow = true;
    head.add(headMesh);
    head.userData.mesh = headMesh;
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const black = new THREE.MeshBasicMaterial({ color: 0x0b1118 });
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(sphere, white);
      eye.scale.setScalar(0.27);
      eye.position.set(side * 0.5, 0.38, 0.62);
      head.add(eye);
      const pupil = new THREE.Mesh(sphere, black);
      pupil.scale.setScalar(0.13);
      pupil.position.set(side * 0.52, 0.4, 0.82);
      head.add(pupil);
    });
    tongue = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0xe0334c }));
    tongue.position.set(0, -0.15, 1.1);
    head.add(tongue);
    scene.add(head);

    // goal apple
    apple = new THREE.Group();
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), new THREE.MeshStandardMaterial({ roughness: 0.35, emissive: 0x330800 }));
    fruit.castShadow = true;
    apple.add(fruit);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e }));
    stem.position.y = 0.29;
    apple.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3f9b4a }));
    leaf.scale.set(1.6, 0.35, 0.8);
    leaf.position.set(0.08, 0.31, 0);
    apple.add(leaf);
    apple.userData.fruit = fruit;
    scene.add(apple);
    appleLight = new THREE.PointLight(0xff5533, 0.9, 3.2);
    scene.add(appleLight);

    startRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 8, 40), new THREE.MeshBasicMaterial());
    startRing.rotation.x = Math.PI / 2;
    scene.add(startRing);

    // vision: a ring and a faint disc, scaled to the vision radius each frame
    visionRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 72), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    visionRing.rotation.x = -Math.PI / 2;
    visionDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    visionDisc.rotation.x = -Math.PI / 2;
    scene.add(visionRing);
    scene.add(visionDisc);

    hoverBox = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
    hoverBox.rotation.x = -Math.PI / 2;
    hoverBox.visible = false;
    scene.add(hoverBox);
  }

  // Objects whose count depends on the maze size. Rebuilt when the size changes.
  function buildMaze() {
    const { cols, rows } = Game;
    const n = cols * rows;
    [walls, tiles, slab].forEach((o) => {
      if (!o) return;
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
    });

    tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.97, 0.1, 0.97), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    tiles.receiveShadow = true;
    tiles.frustumCulled = false;
    scene.add(tiles);

    walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.75 }), n);
    walls.castShadow = true;
    walls.receiveShadow = true;
    walls.frustumCulled = false;
    scene.add(walls);

    slab = new THREE.Mesh(new THREE.BoxGeometry(cols + 0.8, 0.5, rows + 0.8), new THREE.MeshStandardMaterial({ roughness: 1 }));
    slab.position.set(cols / 2, -0.3, rows / 2);
    slab.receiveShadow = true;
    scene.add(slab);

    wallHeights = new Float32Array(n);
    wallTint = new Float32Array(n);
    for (let i = 0; i < n; i++) wallTint[i] = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1; // fixed pseudo-random 0..1

    // light and shadow cover the whole maze
    sun.position.set(cols * 0.35, Math.max(cols, rows) * 0.9, rows * 0.1);
    sun.target.position.set(cols / 2, 0, rows / 2);
    const r = Math.max(cols, rows) * 0.75;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: Math.max(cols, rows) * 3 });
    sun.shadow.camera.updateProjectionMatrix();

    builtKey = cols + 'x' + rows;
    lastGrid = null;
    lastKnown = null;
    colorsDirty = true;
  }

  /* ---------- size and picking ---------- */

  function fit() {
    if (!available) return;
    w = Math.max(200, boardEl.clientWidth);
    h = Math.round(w * (w < 520 ? 0.85 : 0.62)); // a bit taller on phones so the whole maze fits
    canvas.style.height = h + 'px';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camSnap = true; // re-frame at once after a resize
  }

  function setMode(m) {
    mode = m === 'chase' ? 'chase' : 'overview';
    camera.fov = mode === 'chase' ? 58 : 40;
    camera.updateProjectionMatrix();
  }

  // Which cell is under the pointer? Fires a ray through the walls and tiles and takes the nearest hit.
  const raycaster = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
  const ndc = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;
  function cellAt(e) {
    if (!available || !walls) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([walls, tiles], false);
    for (const hit of hits) {
      if (hit.instanceId !== undefined) return hit.instanceId;
    }
    return -1;
  }

  /* ---------- per-frame updates ---------- */

  function setInstance(mesh, i, x, y, z, sx, sy, sz) {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  function updateCells() {
    const { cols, grid, search: a } = Game;
    const n = grid.length;
    const explore = Game.options.mode === 'explore' && Game.known;
    const snap = lastGrid !== grid || lastKnown !== Game.known;
    // unseen ground is darker than the fog color used in 2D, so it reads as "unknown"
    const fogColor = tmpColor.clone().set(colors.fog).multiplyScalar(0.62);
    lastGrid = grid;
    lastKnown = Game.known;

    for (let i = 0; i < n; i++) {
      const x = (i % cols) + 0.5, z = ((i / cols) | 0) + 0.5;
      const wall = grid[i] === 1;
      const seen = !explore || Game.known[i] === 1;

      // walls grow out of the floor when they come into view
      const target = wall && seen ? WALL_H : 0;
      let hgt = snap ? target : wallHeights[i] + (target - wallHeights[i]) * 0.2;
      if (Math.abs(hgt - target) < 0.003) hgt = target;
      wallHeights[i] = hgt;
      if (hgt < 0.01) setInstance(walls, i, x, -5, z, 0.0001, 0.0001, 0.0001);
      else setInstance(walls, i, x, hgt / 2, z, 0.98, hgt, 0.98);

      // the tile underneath
      let c = colors.floor;
      if (explore && !seen) c = fogColor;
      else if (a && !explore && !wall) {
        if (a.closed[i]) c = colors.closed;
        else if (a.seen[i]) c = colors.open;
      }
      setInstance(tiles, i, x, -0.05, z, 1, 1, 1);
      tiles.setColorAt(i, tmpColor.set(c));

      if (colorsDirty) {
        walls.setColorAt(i, tmpColor.set(colors.wall).offsetHSL(0, 0, (wallTint[i] - 0.5) * 0.07));
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    if (colorsDirty && walls.instanceColor) walls.instanceColor.needsUpdate = true;
  }

  // The route as glowing dots. Rebuilt only when the game makes a new route.
  function updateRoute() {
    const showing = Game.phase === 'move' || Game.phase === 'explore' ||
      Game.phase === 'arrived' || Game.phase === 'preview';
    const route = showing ? Game.route : null;
    if (route === lastRoute && !colorsDirty) return;
    lastRoute = route;
    if (!route) { routeDots.count = 0; return; }
    const pts = Path.sample(route.points, 0.16);
    const count = Math.min(pts.length, MAX_DOTS);
    for (let k = 0; k < count; k++) setInstance(routeDots, k, pts[k][0], 0.03, pts[k][1], 1, 1, 1);
    routeDots.count = count;
    routeDots.instanceMatrix.needsUpdate = true;
  }

  function updateSnake(dt, now) {
    if (Game.running && (Game.phase === 'move' || Game.phase === 'explore')) wavePhase += dt * 9;

    const body = Path.sample(Game.bodyPoints(), 0.09);
    const count = Math.min(body.length, MAX_BODY);
    const baseR = CONFIG.SNAKE_WIDTH / 2;
    const c1 = tmpColor.set(colors.snake).clone();
    const c2 = c1.clone().offsetHSL(0, 0, 0.09);
    for (let k = 0; k < count; k++) {
      const t = k / Math.max(1, count - 1);
      const r = baseR * (1 - 0.5 * t);
      // sideways direction at this point, for the slither
      const p = body[k];
      const q = body[Math.min(count - 1, k + 1)], o = body[Math.max(0, k - 1)];
      let dx = q[0] - o[0], dz = q[1] - o[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const wiggle = 0.045 * Math.min(1, k / 8) * Math.sin(k * 0.09 * 4.2 - wavePhase);
      setInstance(bodySpheres, k, p[0] - dz * wiggle, r * 0.95, p[1] + dx * wiggle, r, r * 0.95, r);
      bodySpheres.setColorAt(k, ((k >> 2) & 1) ? c2 : c1);
    }
    bodySpheres.count = count;
    bodySpheres.instanceMatrix.needsUpdate = true;
    if (bodySpheres.instanceColor) bodySpheres.instanceColor.needsUpdate = true;

    // head
    const [fx, fz] = Game.heading();
    const hp = body[0];
    const hr = CONFIG.HEAD_RADIUS;
    head.position.set(hp[0], hr * 0.85, hp[1]);
    head.rotation.y = Math.atan2(fx, fz);
    head.scale.setScalar(hr);
    head.userData.mesh.material.color.set(colors.snake);
    // tongue flicks out now and then
    const flick = Math.pow(Math.max(0, Math.sin(now * 4.5)), 10);
    tongue.scale.z = 0.01 + flick * 0.7;
    tongue.position.z = 1.05 + flick * 0.35;
  }

  function updateMarkers(now) {
    const g = Game.centerOf(Game.goal);
    const bob = Math.sin(now * 2.2) * 0.04;
    apple.position.set(g[0], 0.32 + bob, g[1]);
    apple.rotation.y = now * 0.9;
    apple.userData.fruit.material.color.set(colors.goal);
    appleLight.position.set(g[0], 0.9, g[1]);

    const o = Game.centerOf(Game.origin);
    startRing.position.set(o[0], 0.025, o[1]);
    startRing.material.color.set(colors.ink);

    const explore = Game.options.mode === 'explore' && Game.known;
    visionRing.visible = visionDisc.visible = !!explore;
    if (explore) {
      const R = CONFIG.VISION[Game.options.vision] || CONFIG.VISION.medium;
      const hp = Game.headPoint();
      [visionRing, visionDisc].forEach((m) => { m.position.set(hp[0], 0.04, hp[1]); m.scale.setScalar(R); });
      visionRing.material.color.set(colors.ink);
      visionDisc.material.color.set(colors.snake);
    }

    if (Game.hover >= 0) {
      const c = Game.centerOf(Game.hover);
      hoverBox.position.set(c[0], WALL_H + 0.02, c[1]);
      if (Game.grid[Game.hover] === 0) hoverBox.position.y = 0.03;
      hoverBox.material.color.set(colors.ink);
      hoverBox.visible = true;
    } else {
      hoverBox.visible = false;
    }
  }

  function updateCamera(dt) {
    const { cols, rows } = Game;
    let wantPos, wantLook;

    if (mode === 'chase') {
      const hp = Game.headPoint();
      const [fx, fz] = Game.heading();
      const hk = 1 - Math.exp(-dt * 4);
      smoothHeading[0] += (fx - smoothHeading[0]) * hk;
      smoothHeading[1] += (fz - smoothHeading[1]) * hk;
      const m = Math.hypot(smoothHeading[0], smoothHeading[1]) || 1;
      const sx = smoothHeading[0] / m, sz = smoothHeading[1] / m;
      wantPos = new THREE.Vector3(hp[0] - sx * 2.6, 3.1, hp[1] - sz * 2.6);
      wantLook = new THREE.Vector3(hp[0] + sx * 1.4, 0.1, hp[1] + sz * 1.4);
    } else {
      // far enough back that the whole maze fits, looking down at an angle
      const el = 58 * Math.PI / 180;
      const vf = camera.fov * Math.PI / 180;
      const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const needW = (cols + 1.6) / 2 / Math.tan(hf / 2);
      const needH = ((rows + 1.6) / 2 * Math.sin(el) + 1.2) / Math.tan(vf / 2) + (rows / 2) * Math.cos(el);
      const dist = Math.max(needW * 1.06, needH * 0.92 * 0.86);
      wantLook = new THREE.Vector3(cols / 2, 0, rows / 2 + 0.6);
      wantPos = new THREE.Vector3(cols / 2, Math.sin(el) * dist, rows / 2 + 0.6 + Math.cos(el) * dist);
    }

    const k = camSnap ? 1 : 1 - Math.exp(-dt * 5); // ease toward the target, at the same speed on any frame rate
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    camSnap = false;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function draw() {
    if (!available || !renderer || !Game.trail.length) return;
    if (builtKey !== Game.cols + 'x' + Game.rows) { buildMaze(); camSnap = true; }

    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - (lastTime || now));
    lastTime = now;

    if (colorsDirty) {
      scene.background = new THREE.Color(colors.bg);
      slab.material.color.set(colors.wall).multiplyScalar(0.55);
      routeDots.material.color.set(colors.path);
      startRing.material.color.set(colors.ink);
      const dark = getComputedStyle(document.documentElement).colorScheme === 'dark' ||
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches &&
          document.documentElement.dataset.theme !== 'light');
      hemi.intensity = dark ? 0.55 : 0.85;
      sun.intensity = dark ? 0.75 : 0.9;
    }

    updateCells();
    updateRoute();
    updateSnake(dt, now);
    updateMarkers(now);
    updateCamera(dt);
    colorsDirty = false;
    renderer.render(scene, camera);
  }

  return { init, isAvailable, readColors, fit, setMode, cellAt, draw };
})();
