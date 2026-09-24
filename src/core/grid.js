/**
 * @param {number} width
 * @param {number} height
 */
export function cellCount(width, height) {
  return width * height;
}

/**
 * @param {number} width
 * @param {number} x
 * @param {number} y
 */
export function toIndex(width, x, y) {
  return y * width + x;
}

/**
 * @param {number} width
 * @param {number} index
 * @returns {{ x: number, y: number }}
 */
export function toXY(width, index) {
  return { x: index % width, y: Math.floor(index / width) };
}

/**
 * Neighbours in row-major order. Computed from (x, y) with a bounds check on
 * each axis; never by adding offsets to the flat index, which would wrap the
 * right edge onto the next row.
 * @param {number} width
 * @param {number} height
 * @param {number} index
 * @returns {number[]}
 */
export function neighbours(width, height, index) {
  const { x, y } = toXY(width, index);
  /** @type {number[]} */
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (dx === 0 && dy === 0) continue;
      out.push(toIndex(width, nx, ny));
    }
  }
  return out;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} mines
 * @returns {Uint8Array}
 */
export function computeCounts(width, height, mines) {
  const out = new Uint8Array(mines.length);
  for (let i = 0; i < mines.length; i++) {
    let c = 0;
    for (const n of neighbours(width, height, i)) c += mines[n];
    out[i] = c;
  }
  return out;
}

/**
 * Iterative flood with a queue and a visited set. Opens each start cell and,
 * from every opened zero, its covered neighbours. Never opens flagged cells.
 * Each cell is enqueued, and so opened, at most once. Starts must be safe.
 * Mutates only the `cells` array passed in.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} counts
 * @param {Uint8Array} cells
 * @param {number[]} starts
 * @returns {{ opened: number[] }}
 */
export function flood(width, height, counts, cells, starts) {
  const visited = new Uint8Array(cells.length);
  /** @type {number[]} */
  const queue = [];
  for (const s of starts) {
    if (!visited[s] && cells[s] === 0) {
      visited[s] = 1;
      queue.push(s);
    }
  }
  /** @type {number[]} */
  const opened = [];
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    cells[i] = 2;
    opened.push(i);
    if (counts[i] !== 0) continue;
    for (const n of neighbours(width, height, i)) {
      if (!visited[n] && cells[n] === 0) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return { opened };
}

