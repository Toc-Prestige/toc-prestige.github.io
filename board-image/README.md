# Board image

`gen_board.js` generates a simplified round TOCK board as an SVG (Node.js, no dependencies).

## Usage

From the project root:

```sh
node board-image/gen_board.js
```

This writes `board-image/tock_board_round.svg`. To choose another output file:

```sh
node board-image/gen_board.js path/to/output.svg
```

## What it draws

- 72 road cells on a circle, 18 per camp, numbered 1 to 18 counterclockwise (cell 1 has the bold outline).
- One outline color per camp: joueur 1 to joueur 4.
- A 4-cell goal lane per camp, connected to its cell 3 (not numbered).
- A 4-cell stash per camp (not numbered).

`board-round.svg` is the hand-made reference the script is modeled on.
