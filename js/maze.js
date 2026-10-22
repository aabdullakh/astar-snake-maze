/* maze.js
 * Builds a random maze as a flat array: 1 = wall, 0 = floor.
 * Cell (x, y) lives at index y * cols + x.
 */
const Maze = {
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  // Step 1: recursive backtracker carves a "perfect" maze (exactly one route between any two cells).
  // Step 2: knock out some extra walls so loops exist and A* has more than one route to compare.
  generate(cols, rows, loopRatio = 0.12) {
    const grid = new Uint8Array(cols * rows).fill(1);
    const at = (x, y) => y * cols + x;
    const moves = [[2, 0], [-2, 0], [0, 2], [0, -2]];

    const stack = [[1, 1]];
    grid[at(1, 1)] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options = moves.filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && grid[at(nx, ny)] === 1;
      });
      if (!options.length) { stack.pop(); continue; }
      const [dx, dy] = options[Math.floor(Math.random() * options.length)];
      grid[at(x + dx / 2, y + dy / 2)] = 0; // knock down the wall between the two cells
      grid[at(x + dx, y + dy)] = 0;
      stack.push([x + dx, y + dy]);
    }

    // Walls that separate exactly two corridors (left/right or up/down) can become shortcuts.
    const candidates = [];
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (grid[at(x, y)] !== 1) continue;
        const horizontal = grid[at(x - 1, y)] === 0 && grid[at(x + 1, y)] === 0;
        const vertical = grid[at(x, y - 1)] === 0 && grid[at(x, y + 1)] === 0;
        if (horizontal !== vertical) candidates.push(at(x, y));
      }
    }
    this.shuffle(candidates);
    const remove = Math.floor(candidates.length * loopRatio);
    for (let k = 0; k < remove; k++) grid[candidates[k]] = 0;

    return grid;
  }
};
