// Level definitions for Rebound 3D.
// Coordinates: x grows right, y grows UP (y = 0 is the bottom row).
// Rows y = 0..1 are ground, row y = H-1 is the ceiling; x = 0 and x = W-1 are walls.
//
// Tile legend
//   '#' solid block        'b' bouncy block (hold JUMP on landing for a super bounce)
//   '^' floor spikes       'v' ceiling spikes
//   '*' spring pad         'o' ring (collect all to open the portal)
//   'C' checkpoint         '+' extra life
//   'S' start              'E' exit portal
// Moving hazards are added with mover(x, y, axis, amplitude, speed, phase).

function make(meta, build) {
  const { W, H } = meta;
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      row.push(y <= 1 || y === H - 1 || x === 0 || x === W - 1 ? '#' : ' ');
    }
    grid.push(row);
  }
  const movers = [];
  const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const api = {
    set(x, y, c) { if (inb(x, y)) grid[y][x] = c; },
    rect(x1, y1, x2, y2, c = '#') {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) api.set(x, y, c);
    },
    pit(x1, x2) { api.rect(x1, 0, x2, 1, ' '); },
    spikes(x1, x2, y = 2) { api.rect(x1, y, x2, y, '^'); },
    ceilSpikes(x1, x2, y) { api.rect(x1, y, x2, y, 'v'); },
    rings(...pts) { for (const [x, y] of pts) api.set(x, y, 'o'); },
    mover(x, y, axis = 'x', amp = 2, speed = 2, phase = 0) { movers.push({ x, y, axis, amp, speed, phase }); },
  };
  build(api);
  return { ...meta, grid, movers };
}

export const LEVELS = [
  make({ name: 'First Bounce', W: 80, H: 12, hue: 215,
    hint: 'Roll with ← → and jump with ↑ or Space. Collect every ring to open the portal.',
    touchHint: 'Hold the left or right side of the screen to roll. Swipe up to jump. Collect every ring!' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([8, 3]);
    l.rect(12, 2, 13, 2);
    l.rings([16, 4]);
    l.pit(20, 22);
    l.rect(26, 3, 30, 3);
    l.rings([28, 4]);
    l.spikes(35, 36);
    l.rect(40, 2, 41, 3);
    l.rings([44, 3]);
    l.set(47, 2, 'C');
    l.pit(50, 52);
    l.set(57, 2, 'b');
    l.rings([57, 6]);
    l.spikes(60, 62);
    l.rect(66, 2, 67, 2);
    l.rect(68, 2, 69, 3);
    l.rings([72, 4]);
    l.set(76, 2, 'E');
  }),

  make({ name: 'Spring Valley', W: 95, H: 12, hue: 165,
    hint: 'Yellow springs launch you high. Watch out for spikes on the ceiling.' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([7, 4]);
    l.set(11, 2, '*');
    l.rect(13, 2, 14, 5);
    l.rings([12, 7], [17, 3]);
    l.spikes(19, 20);
    // low tunnel
    l.rect(24, 5, 34, 10);
    l.ceilSpikes(28, 29, 4);
    l.spikes(31, 31);
    l.rings([26, 3]);
    l.set(37, 2, 'C');
    l.mover(42, 2, 'x', 2, 2);
    l.rings([45, 4]);
    l.pit(48, 50);
    l.pit(53, 55);
    l.rings([52, 4]);
    // spring over the spike field
    l.set(56, 2, '*');
    l.rect(60, 6, 66, 6);
    l.spikes(60, 66);
    l.rings([63, 7]);
    l.set(70, 2, 'C');
    l.set(75, 2, 'b');
    l.rect(76, 2, 77, 5);
    l.rings([75, 7], [82, 3]);
    l.set(90, 2, 'E');
  }),

  make({ name: 'Spike Caverns', W: 110, H: 14, hue: 275,
    hint: 'Timing is everything. Checkpoints keep your progress.' }, (l) => {
    l.set(3, 2, 'S');
    l.rect(8, 5, 20, 12);
    l.ceilSpikes(11, 12, 4);
    l.ceilSpikes(17, 18, 4);
    l.spikes(14, 14);
    l.rings([10, 2], [19, 2]);
    l.mover(24, 4, 'y', 2, 2);
    l.rings([27, 3]);
    l.pit(30, 32);
    l.pit(36, 38);
    l.rings([34, 4]);
    l.set(42, 2, 'C');
    // staircase above a spike pit
    l.rect(46, 3, 48, 3);
    l.rect(51, 5, 53, 5);
    l.rect(56, 7, 58, 7);
    l.rect(61, 9, 63, 9);
    l.spikes(49, 65);
    l.rings([57, 8], [62, 10]);
    l.set(62, 12, '+');
    l.set(70, 2, 'C');
    l.mover(75, 2, 'x', 2, 2);
    l.mover(83, 2, 'x', 2.5, 2.5, 1);
    l.rings([79, 4]);
    l.set(86, 2, '*');
    l.rect(90, 6, 96, 6);
    l.rings([93, 7]);
    l.rect(97, 2, 98, 7);
    l.rings([98, 9]);
    l.set(106, 2, 'E');
  }),

  make({ name: 'Bouncy Castle', W: 100, H: 16, hue: 320,
    hint: 'Hold JUMP while landing on pink blocks for a super bounce.' }, (l) => {
    l.set(3, 2, 'S');
    l.rect(8, 1, 20, 1, 'b');
    l.rings([11, 6], [15, 7], [19, 6]);
    l.set(21, 2, 'b');
    l.rect(22, 2, 23, 6);
    l.pit(26, 34);
    l.set(28, 3, 'b');
    l.set(32, 3, 'b');
    l.rings([30, 6]);
    l.set(29, 9, '+');
    l.set(37, 2, 'C');
    l.spikes(40, 52);
    l.set(42, 3, 'b');
    l.set(45, 3, 'b');
    l.set(48, 3, 'b');
    l.set(51, 3, 'b');
    l.rings([43, 7], [47, 7]);
    l.set(56, 2, 'C');
    l.mover(64, 4, 'y', 2, 2.2, 0);
    l.mover(68, 4, 'y', 2, 2.2, 1.5);
    l.mover(72, 4, 'y', 2, 2.2, 3);
    l.rings([66, 3], [70, 3]);
    l.set(76, 2, '*');
    l.rect(80, 6, 86, 6);
    l.spikes(80, 88);
    l.rings([83, 7]);
    l.set(95, 2, 'E');
  }),

  make({ name: 'Neon Gauntlet', W: 130, H: 14, hue: 25,
    hint: 'The final gauntlet. Everything you have learned. Good luck!' }, (l) => {
    l.set(3, 2, 'S');
    l.spikes(8, 9);
    l.rings([8, 4]);
    l.rect(13, 5, 25, 12);
    l.ceilSpikes(15, 16, 4);
    l.spikes(19, 19);
    l.spikes(23, 23);
    l.rings([21, 3]);
    l.set(29, 2, 'C');
    l.pit(32, 34);
    l.pit(39, 41);
    l.mover(36.5, 2, 'x', 1, 2);
    l.rings([36, 4]);
    l.set(46, 2, 'b');
    l.rect(47, 2, 48, 6);
    l.rings([46, 8]);
    l.set(52, 2, 'C');
    l.rect(55, 3, 57, 3);
    l.rect(60, 5, 62, 5);
    l.rect(65, 7, 67, 7);
    l.rect(70, 7, 73, 7);
    l.spikes(58, 74);
    l.rings([61, 6], [72, 8]);
    l.set(78, 2, 'C');
    l.set(81, 2, '*');
    l.rect(85, 6, 91, 6);
    l.spikes(85, 92);
    l.mover(88, 7, 'x', 2, 1.8);
    l.rings([89, 9]);
    l.mover(97, 4, 'y', 2, 2.4, 0);
    l.mover(101, 4, 'y', 2, 2.4, 2);
    l.mover(105, 4, 'y', 2, 2.4, 4);
    l.rings([99, 3], [103, 3]);
    l.rect(109, 2, 110, 3);
    l.rings([111, 5]);
    l.set(116, 4, '+');
    l.spikes(119, 120);
    l.set(125, 2, 'E');
  }),
];
