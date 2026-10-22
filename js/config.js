/* config.js
 * Constants shared by every other file. Change values here to tune the demo.
 */
const CONFIG = {
  // [columns, rows]. Both must be odd so the maze generator lines up with its walls.
  SIZES: { small: [15, 11], medium: [21, 15], large: [31, 21] },

  // Speed slider positions 0..9
  SEARCH_RATES: [2, 5, 10, 20, 40, 80, 150, 300, 600, 1200], // cells expanded per second
  MOVE_RATES: [3, 4, 6, 8, 10, 12, 15, 20, 25, 30],          // snake speed in cells per second

  // Snake shape, measured in cells
  SNAKE_LENGTH: 4,
  SNAKE_WIDTH: 0.5,
  HEAD_RADIUS: 0.3,

  // Route shaping
  CLEARANCE: 0.3,      // the route never gets closer than this to a wall
  CORNER_RADIUS: 0.4,  // the most that any one corner is rounded off
  CURVE_STEPS: 6,      // how many short lines make up one rounded corner

  // Allowed moves, each written as [dx, dy, cost].
  // A straight step costs 1. A diagonal step covers sqrt(2) = 1.414 cells, so it costs that much.
  MOVES: {
    four: [
      [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1]
    ],
    eight: [
      [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1],
      [1, -1, Math.SQRT2], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
    ]
  },

  // Explore mode: how far the snake can see (in cells), and how far it moves between looks.
  VISION: { short: 2.5, medium: 3.5, long: 6 },
  EXPLORE_CHUNK: 0.25,

  PHASE_LABEL: {
    preview: 'Solved (preview)',
    search: 'Searching',
    explore: 'Exploring',
    move: 'Gliding',
    arrived: 'Arrived',
    fail: 'No route'
  }
};

// Format a number for display: whole numbers stay whole, others get a few decimals.
function fmt(n, digits = 2) {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}
