const fs = require('fs');
const path = require('path');

const C = 500;          // board center (canvas is 1000x1000)
const RR = 330;         // radius of the main road
const CELL_R = 11;      // cell radius
const STASH_X = 430;    // stash distance from the center, along the image edge
const SHOW_NUMBERS = false; // cell numbers stay in the SVG but are hidden (display="none") when false
const ARROW_R = 380;    // radius of the direction arrow (outside the road)
const STEP = 36;        // distance between goal lane / stash cells
const camps = [
  { name: 'joueur 1', color: '#d62828' },
  { name: 'joueur 2', color: '#1d4ed8' },
  { name: 'joueur 3', color: '#15803d' },
  { name: 'joueur 4', color: '#d4a000' },
];

const f = (n) => +n.toFixed(2);
const rad = (deg) => (deg * Math.PI) / 180;
const polar = (angle, r) => [C + r * Math.cos(rad(angle)), C + r * Math.sin(rad(angle))];

// angle (degrees, clockwise from the right) of the n-th cell (1..18, clockwise) of camp k
const cellAngle = (k, n) => -90 + k * 90 + (n - 1) * 5;

const out = [];
const circle = (x, y, color, sw = 2) =>
  out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${CELL_R}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
const text = (x, y, s, color, size = 11, weight = 'normal', hidden = false) =>
  out.push(`<text${hidden ? ' display="none"' : ''} x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${s}</text>`);

out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">`);
out.push(`<rect width="1000" height="1000" fill="#ffffff"/>`);

// clockwise direction arrow following the curve of the board, starting next to cell 1 of player 1
out.push(`<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#777777"/></marker></defs>`);
const arrowStart = cellAngle(0, 18) + 5; // just past cell 1 of player 1
const arrowSpan = 40;
const [x1, y1] = polar(arrowStart, ARROW_R);
const [x2, y2] = polar(arrowStart + arrowSpan, ARROW_R);
out.push(`<path d="M ${f(x1)} ${f(y1)} A ${ARROW_R} ${ARROW_R} 0 0 1 ${f(x2)} ${f(y2)}" fill="none" stroke="#777777" stroke-width="3" marker-end="url(#arrowhead)"/>`);

camps.forEach((camp, k) => {
  out.push(`<g id="joueur-${k + 1}">`);

  // main road quarter: 18 cells numbered 1..18
  for (let n = 1; n <= 18; n++) {
    const [x, y] = polar(cellAngle(k, n), RR);
    const label = 19 - n; // numbering runs counterclockwise: cell 1 is the last one clockwise
    circle(x, y, camp.color, label === 1 ? 4.5 : 2);
    text(x, y, label, camp.color, 11, label === 1 ? 'bold' : 'normal', !SHOW_NUMBERS);
  }

  // goal lane (no numbers): 4 cells going inward from cell 3
  const aGoal = cellAngle(k, 19 - 3); // cell labeled 3
  for (let j = 1; j <= 4; j++) {
    const [x, y] = polar(aGoal, RR - j * STEP);
    circle(x, y, camp.color);
  }

  // stash (no numbers): row of 4 cells parallel to the image edge, level with cell 1
  // (built for the camp on the right edge, then rotated by k quarter turns around the center)
  const a1 = cellAngle(0, 18); // cell labeled 1 of the first camp
  const sy0 = C + RR * Math.sin(rad(a1));
  const sx0 = C + STASH_X;
  const turn = (x, y) => {
    let dx = x - C, dy = y - C;
    for (let q = 0; q < k; q++) [dx, dy] = [-dy, dx];
    return [C + dx, C + dy];
  };
  out.push(`<rect x="${f(sx0 - STEP / 2)}" y="${f(sy0 - 2 * STEP)}" width="${STEP}" height="${4 * STEP}" rx="${STEP / 2}" fill="none" stroke="${camp.color}" stroke-width="2" transform="rotate(${k * 90} ${C} ${C})"/>`);
  for (let j = 0; j < 4; j++) {
    const [x, y] = turn(sx0, sy0 + (j - 1.5) * STEP);
    circle(x, y, camp.color);
  }

  // camp label, inside the circle
  const [lx, ly] = polar(cellAngle(k, 6), 200);
  text(lx, ly, camp.name, camp.color, 16, 'bold');

  out.push(`</g>`);
});

out.push(`</svg>`);
fs.writeFileSync(process.argv[2] || path.join(__dirname, 'tock_board_round.svg'), out.join('\n') + '\n');
