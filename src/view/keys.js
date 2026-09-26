/**
 * Pure keyboard and activation mapping for the board. No DOM here, so node
 * tests import it directly.
 */

/**
 * The cell focus moves to for a navigation key, or null if the key is not a
 * navigation key. Arrows clamp at the edges and never wrap onto another row.
 * @param {number} index
 * @param {string} key KeyboardEvent.key
 * @param {boolean} ctrlKey
 * @param {number} width
 * @param {number} height
 * @returns {number | null}
 */
export function nextFocus(index, key, ctrlKey, width, height) {
  const x = index % width;
  const y = Math.floor(index / width);
  switch (key) {
    case 'ArrowLeft': return y * width + Math.max(0, x - 1);
    case 'ArrowRight': return y * width + Math.min(width - 1, x + 1);
    case 'ArrowUp': return Math.max(0, y - 1) * width + x;
    case 'ArrowDown': return Math.min(height - 1, y + 1) * width + x;
    case 'Home': return ctrlKey ? 0 : y * width;
    case 'End': return ctrlKey ? width * height - 1 : y * width + width - 1;
    default: return null;
  }
}

/**
 * What activating a cell does: a revealed cell chords in either mode; a
 * covered or flagged cell flags in flag mode and reveals otherwise.
 * @param {{ cells: Uint8Array }} game
 * @param {number} index
 * @param {boolean} flagMode
 * @returns {'reveal' | 'flag' | 'chord'}
 */
export function activationFor(game, index, flagMode) {
  if (game.cells[index] === 2) return 'chord';
  return flagMode ? 'flag' : 'reveal';
}
