# Lemma

Lemma is Minesweeper where every board can be solved by deduction alone from
the first click. Before a board is dealt, a small deductive solver plays it
using only the numbers a player would see; if the solver ever has to guess,
the board is thrown away and another is drawn. That guarantee lets the game
be honest when you lose: it tells you whether the cell you clicked was
provable, and if it was not, it shows you one that was. When you win, the
board recolours to show the order in which the solver proved each cell.
Play it at **https://samarth5704.github.io/lemma/**.

## How to play

Open every cell that is not a mine. Each number counts the mines among its
eight neighbours. Your first click is never a mine and always opens an area.
Three sizes: Beginner (9×9, 10 mines), Intermediate (16×16, 40), Expert
(30×16, 99). The mine counter shows mines minus flags and can go negative.
Flags are notes for you; they are not needed to win.

- **Mouse:** left-click opens a cell. Right-click flags or unflags it.
- **Keyboard:** the board is one Tab stop. Arrow keys move one cell, Home and
  End go to the start and end of the row, Ctrl+Home and Ctrl+End go to the
  first and last cell. Enter or Space opens the focused cell. F flags it.
- **Touch:** turn on **Flag mode** to make a tap flag instead of open. There
  is no long-press.
- **Chording:** activating a number (click, tap, Enter or Space, in either
  mode) opens all of its covered neighbours, but only when the number of flags
  around it equals the number. With any other flag count it does nothing. A
  chord trusts your flags, so a wrong flag sets off the mine it was hiding.

A game in progress is saved in your browser and restored when you come back.
Starting a new game or changing size mid-game asks first.

## How the guarantee works

**The clue view.** The solver never sees the board. It sees an array holding
the number on each revealed cell and -1 for every other cell, covered or
flagged alike. That is all `deduce(width, height, clues)` receives, so it
cannot read the mines, cannot trust a wrong flag, and does not know the total
mine count.

**Two rules,** applied repeatedly until nothing changes:

- **Single-clue rule.** A number n with k neighbours already known to be
  mines and u unknown neighbours: if n − k = 0 the unknowns are all safe; if
  n − k = u they are all mines.
- **Subset rule.** If the unknown neighbours A of one number are a subset of
  the unknown neighbours B of another, the cells in B∖A hold exactly
  n_B − n_A mines. If that is 0 they are safe; if it equals |B∖A| they are
  all mines.

**Generation by reroll.** Mines are placed only after the first click, never
on the clicked cell or its neighbours, and never moved afterwards. The
generator then simulates play from that click: open everything the rules
prove safe, repeat. If every safe cell gets opened, the board is dealt. If the
solver gets stuck, the whole board is discarded and a new one is drawn from
the same seeded random stream. The generator has a hard cap of 1,100
attempts; if it is ever reached, the game falls back to an ordinary random
board, which is not guaranteed.

The same solver runs again after a loss, on the clues you could see at that
moment, to say whether your click was provable.

## The soundness trade-off

The solver is *sound*: everything it proves is true. It is deliberately not
*complete*: it ignores the global mine count and knows only two rules, so it
rejects some boards a strong player could finish. For example, when every
mine around a corner has been proved and one covered cell touches no revealed
number, only the mine count ("3 mines, 3 found") shows that the cell is
safe. The solver cannot use that, so it calls the board stuck and the
generator rejects it. A test builds exactly this board. The cost is a few
more rerolls; the benefit is a solver small enough to test for soundness
exhaustively, which is what makes the guarantee trustworthy.

Some boards cannot be solved by anyone, and the generator must give up on
them honestly. The test for that uses a 10×2 board with 5 mines, which no
layout can make solvable:

- Every column holds 0, 1 or 2 mines, and the total, 5, is odd, so some
  column holds exactly one mine *m* and one safe cell *s*.
- On a two-row board the two cells of a column are neighbours of each other,
  and every other cell that touches one of them touches both. Swapping *s*
  and *m* therefore changes no number anywhere except on *s* and *m*
  themselves, and the swapped layout is also legal.
- So every clue the solver could ever see is the same in both layouts, and a
  sound solver can never prove *s* safe. Flood cannot open *s* either: each
  of its other neighbours touches *m*, so none of them is a zero.

No attempt can succeed, whatever the random numbers, and the test checks that
the generator returns `{ ok: false }` after exactly its attempt cap.

## Measurement

Rerolling is only acceptable if it is fast enough, so the generator is
measured on 500 seeds per size and per first-click position (centre, middle of
the top edge, corner). Expert needs the most rerolls; the decision rule was
to keep rerolling only if the worst Expert p95 stays under 150 ms. Output of
`npm run measure`, run for this README on mains power:

```
Node v24.19.0
CPU  Intel(R) Core(TM) i5-10210U CPU @ 1.60GHz
500 seeds per difficulty and position (0..499), cap 5000.
First-click positions: centre; edge (middle of the top row); corner (index 0).
Percentiles are nearest-rank. Each difficulty is warmed up on 20 other seeds first;
the cold column is the very first generation of the run for that size.
```

| Difficulty   | Position | Attempts med | p95 | max | 1st attempt | ms med | ms p95 | ms max | cold ms | Failures at cap |
|--------------|----------|-------------:|----:|----:|------------:|-------:|-------:|-------:|--------:|----------------:|
| Beginner     | centre   |            1 |   2 |   5 |       80.6% |   0.11 |   0.42 |   1.54 |    4.87 |               0 |
| Beginner     | edge     |            1 |   2 |   4 |       80.4% |   0.09 |   0.23 |   0.46 |    0.29 |               0 |
| Beginner     | corner   |            1 |   3 |   5 |       72.6% |   0.09 |   0.24 |   0.44 |    0.15 |               0 |
| Intermediate | centre   |            1 |   5 |   9 |       55.8% |   0.49 |   1.44 |   2.50 |    0.31 |               0 |
| Intermediate | edge     |            1 |   5 |   9 |       50.2% |   0.68 |   2.35 |   5.27 |    1.92 |               0 |
| Intermediate | corner   |            2 |   6 |   9 |       42.6% |   0.71 |   2.21 |   7.81 |    3.11 |               0 |
| Expert       | centre   |           18 |  73 | 173 |        4.8% |  17.29 |  79.50 | 413.87 |   17.74 |               0 |
| Expert       | edge     |           18 |  71 | 211 |        4.6% |  16.11 |  70.27 | 160.46 |   26.30 |               0 |
| Expert       | corner   |           20 |  96 | 257 |        3.4% |  13.45 |  67.98 | 173.79 |    6.05 |               0 |

```
Decision rule (worst Expert position): centre p95 = 79.50 ms, under 150 ms: keep rerolling.
Cap check: worst Expert max attempts 257 x 4 = 1028.
```

Attempt counts are deterministic for these seeds; timings are not. The same
code measured an Expert centre p95 of 136.17 ms on this laptop on battery
during development, so the margin depends on the machine. The attempt cap of
1,100 is the worst Expert maximum (257) times four, rounded up.

## Running locally

Requires Node.js (CI uses the current LTS). There is no build step; the site
is served as written.

```bash
npm ci
```

```bash
npm test
```

```bash
npm run serve
```

`npm run serve` starts a static server on http://127.0.0.1:8080/ (ES modules
do not load from `file://`). The other checks are `npm run typecheck` (JSDoc
types via `tsc --noEmit`), `npm run contrast` (colour-token contrast, exits 1
on any miss), `npm run allowlist` (what gets published) and `npm run measure`
(the table above).

## Project layout

```
index.html               the page, with the inline SVG glyph sprite
styles/tokens.css        colour, spacing and type tokens (light and dark)
styles/app.css
src/core/                pure game logic: no DOM, no clock, no Math.random
  grid.js                dimensions, neighbours, counts, flood fill
  rng.js                 mulberry32 seeded random numbers
  rules.js               new game, reveal, flag, chord, status, timer, counter
  solver.js              the clue view and the two deduction rules
  generate.js            mine placement and the no-guess reroll loop
  proof.js               proof trace for the win map; loss explanation
src/store.js             the single store: state, actions, persistence
src/persist.js           versioned localStorage save, load and migrate
src/view/                grid, HUD, result panel, cell names, key handling
src/main.js              wires the store to the views
test/                    node:test suites, one per module
scripts/                 measure, contrast, allowlist, dev server
publish-allowlist.json   every tracked file, marked publish or exclude
docs/spec.md             the full specification
```

Only `index.html`, the two stylesheets and the files under `src/` are
published. `scripts/allowlist.mjs` checks that every tracked file is
classified, that published files reference only published files, and that no
published URL starts with `/` (the site lives under `/lemma/`). Deploys
upload only a staged copy of the publish set.

## Accessibility

Every cell is a real `<button>` in an ARIA grid with a roving tabindex, named
by position and content ("Row 3, column 5, 2 adjacent mines"). Meaning is
never carried by colour alone: numbers are digits, the detonated mine has a
different shape from the other mines, wrong flags carry a cross, loss clues
get a dashed outline and a text list, and the win map has a text inspector
line and a visually hidden step table.

What was verified, and how:

- **Contrast** is computed, not eyeballed. `npm run contrast` reads
  `styles/tokens.css` as shipped and checks, in both themes: every number
  colour at 4.5:1 or better on revealed cells; the proof-map ink at 4.5:1 on
  all eight bands; glyphs at 3:1 on their surfaces; the two-tone focus ring
  at 3:1 from at least one tone on every surface; text at 4.5:1; and OKLab
  separation between number colours and between adjacent bands. It prints
  every ratio and fails CI on any miss.
- **Unit tests** cover the accessible names (1-based rows and columns,
  singular and plural, the post-win and post-loss wording), keyboard focus
  movement (arrows clamp at edges and never wrap rows; Home, End, Ctrl+Home,
  Ctrl+End), which action a cell's activation performs, that the mine and the
  detonated glyph differ in shape, that nothing in `src/` or `index.html`
  uses `innerHTML`, and that the game stays fully playable when storage
  throws.
- **In a browser** (the Chromium-based preview pane of the Claude desktop
  app, with the published file set served under `/lemma/`, at a 320 px
  viewport): cells measured 44×44 px; on Expert the page did not scroll
  sideways (page width 320 px) while the board scrolled inside its own
  container; exactly one cell had `tabindex="0"`; the timer is not inside a
  live region; activating the focused cell opened 32 cells, kept focus on it
  with the name "Row 9, column 16, empty", and put "Opened 32 cells" in the
  polite live region.

Not verified: behaviour with any screen reader (including VoiceOver), real
touch devices, and the focus movement after a win or loss and in the
confirmation dialog, which are implemented but have no automated test.

## Known limitations

- Generation runs synchronously on the first click. On the measuring laptop
  an Expert board takes a median of about 17 ms and at worst a few hundred
  ms; a slow phone could visibly pause. Moving generation into a Web Worker
  is the planned fix if that happens.
- The solver rejects some boards that are solvable (see the soundness
  trade-off), so Lemma never deals them.
- Untested on VoiceOver and on real touch devices.

## Design notes

These are the decisions in Lemma that could reasonably have gone the other way,
and why they went the way they did.

### Every board is proven, and the proof is deliberately incomplete

Random Minesweeper deals boards that end in a coin-flip. Lemma only deals a
board once a deductive solver has cleared it from the first click. The solver
knows two rules, the single-clue rule and the subset rule, and it reads nothing
but the numbers on screen: it never sees the mines, never trusts the player's
flags, and ignores the global mine count.
The mine count is a fact about every covered cell at once, so using it means
reasoning about the whole board instead of one or two neighbouring numbers.
Two local rules are small enough to test for soundness across thousands of
random positions, and a guarantee from a solver that is ever wrong is worth
nothing, so I'd rather reject a few boards a strong player could have finished.
The test suite pins that trade-off with an endgame that only the global mine count can resolve: the solver reports it as stuck, and the generator rejects the board. A 10×2 board with 5 mines is a different kind of case, one that no solver can finish, with or without the count. An odd mine count forces some column to hold exactly one mine, and the two cells of a two-row column share every neighbour, so no visible number can tell them apart. The tests use it to show that the generator gives up honestly once it hits its cap.

Soundness is structural as well as tested. The solver's only input is a "clue
view" in which covered and flagged cells are both -1, so there is no code path
by which it could peek.

### The first click never loses, and nothing moves

Classic Windows Minesweeper made the first click safe by moving the mine to the
top-left corner after the fact, which is visible in the leaked NT 4.0 source and
produced a real bug where the board changed under the player. Lemma places the
mines after the first click, excluding the clicked cell and its eight
neighbours, so the first click always opens an area and the board never changes
once it exists.

### The loss screen is the product

Because every board is provable, the game can be truthful when you lose. If the
cell you clicked was provably a mine, the numbers that proved it are outlined,
including the upstream numbers when the proof was a chain. If it was not
provable, the game reveals a cell that was provably safe at that moment and
outlines the clues behind it. A chord that detonates is blamed on the wrong flag
that caused it, since the mine only went off because the flag lied.

Chains cost something. Recording the full chain for every deduction tripled
generation time, and only the loss screen ever needs it, so the solver stores
direct dependency pointers and the chain is walked once, after the loss.

### Colour comes from the proof

On a win, the board recolours by the step at which the solver first proved each
cell, from the opening to the last forced cell, in eight bands of one ochre hue.
Steps are ordered, so the ramp is sequential and single-hue with monotonic
lightness, and every adjacent pair is checked to differ by at least 0.03 in
OKLab.

The first version put the eight classic number colours on top of those bands.
To keep every digit at 4.5:1 on the deepest band, the dark-theme numbers were
squeezed into the same pale lightness, and the 3 and the 5 became the same pink
(ΔE 0.023).
But the bands only appear once the game is over, when nobody needs to tell a 3
from a 5 at a glance. So on a win every digit switches to one neutral ink, and
the number colours only have to contrast with paper during play.

### A two-tone focus ring

A single focus colour had to reach 3:1 against paper, slate and all eight
bands, which forced the covered cells to near-black and cut the ramp short. The
two-tone indicator (a dark ring outside a light halo, W3C technique C40)
removes that constraint, because one of the two tones always contrasts with
whatever it sits on. The slate went back to being slate.

### Rerolling, measured before it was trusted

The generator rerolls whole boards until one is provable, instead of repairing
the board where the solver gets stuck the way Simon Tatham's Mines does.
Rerolling is simpler and was fast enough, but the first measurement used a
centre first click, which is the easy case. The table above reports centre,
edge and corner separately, and the decision rule applies to the worst of them.
Rerolling stayed because the worst Expert p95 in the table above is 79.50 ms,
at the centre, comfortably inside the 150 ms budget on a low-power laptop. If
phones turn out too slow for that margin, the next step is moving generation
into a Web Worker, not rewriting the generator.

### Saving the seed, not the board

A saved game holds the seed and the first click, never the mines. On load, the
mines are regenerated through the exact path the first reveal uses. That makes
the save small and removes any chance of saved mines disagreeing with the saved
proof, at the cost of a coupling: if the generator ever changes, old saves would
regenerate a different board. A golden test hashes generated boards for fixed
seeds and fails with an instruction to bump `GENERATOR_VERSION`, and a version
mismatch discards the saved game instead of loading a wrong one.

### Buttons, not a canvas

Every cell is a real `<button>` in an ARIA grid with a roving tabindex and a
name like "Row 3, column 5, 2 adjacent mines". Activation runs only on the
button's click event, which the browser already fires for mouse, Enter and
Space, so no key can activate a cell twice. The board scrolls inside its own
container so cells stay 44 px on a phone without the page scrolling sideways.

### No framework, no build step

The game is plain ES modules served as written. Types come from JSDoc checked
by `tsc --noEmit`, with the core compiled against a library that has no DOM, so
touching `document` from game logic is a type error as well as a test failure.

## Attribution

- **No-guess generation:** the idea of only dealing boards that are solvable
  without guessing, and of the first click always opening an area, comes from
  Mines in [Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/)
  (MIT licence). No code is taken from it; Lemma's solver and generator are
  written independently, and Lemma rerolls whole boards where Mines repairs
  them.
- **First click:** classic Windows Minesweeper made the first click safe by
  moving the mine to the top-left corner, as visible in the leaked NT 4.0
  source ([the one-click bug](https://minesweepergame.com/history/one-click-bug.php)).
  Lemma deliberately does not move mines; it places them after the first
  click instead.
- **Board sizes and number colours** follow Windows Minesweeper convention
  (9×9 with 10 mines, 16×16 with 40, 30×16 with 99; 1 blue, 2 green, 3 red,
  4 navy, 5 maroon, 6 teal, 7 black, 8 grey). The colours are re-derived to
  pass contrast, not copied.
- **mulberry32** random number generator by Tommy Ettinger (2017), public
  domain via CC0, per the header of
  [gist 46a874533244883189143505d203312c](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c).
- **OKLab** colour space by Björn Ottosson,
  [A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/),
  used by the contrast script for lightness and colour-difference checks.
- **Two-tone focus indicator:** W3C WCAG technique
  [C40: Creating a two-color focus indicator](https://www.w3.org/WAI/WCAG22/Techniques/css/C40.html).
