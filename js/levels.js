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
//   'h' low slab: fills the top of its tile, only a SMALL ball rolls under it
//   'P' air pump: inflates the ball to BIG (floats in water, jumps higher, too wide for 1-tile gaps)
//   'D' deflate pin: shrinks the ball to SMALL (sinks in water, fits under slabs)
//   'H' fake brick: looks solid, but the ball passes through (hides secrets)
//   'L' secret lever: hidden inside a fake brick. Touch it to enter the bonus pinball table.
// Helpers: water(x1, y1, x2, y2) fills a water area (it can overlap other tiles),
//          blower(x, y, h) puts a fan that blows the ball up h tiles,
//          mover(x, y, axis, amplitude, speed, phase) adds a spiky spider.

function make(meta, build) {
  const { W, H } = meta;
  const grid = [];
  const water = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      row.push(y <= 1 || y === H - 1 || x === 0 || x === W - 1 ? '#' : ' ');
    }
    grid.push(row);
    water.push(new Array(W).fill(false));
  }
  const movers = [], blowers = [];
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
    water(x1, y1, x2, y2) {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (inb(x, y)) water[y][x] = true;
    },
    // carve a pool: clear the tiles and fill them with water
    pool(x1, y1, x2, y2) { api.rect(x1, y1, x2, y2, ' '); api.water(x1, y1, x2, y2); },
    blower(x, y, h = 7) { api.set(x, y, 'F'); blowers.push({ x, y, h }); },
  };
  build(api);
  return { ...meta, grid, water, movers, blowers };
}

export const LEVELS = [
  // 1 ------------------------------------------------------------------------
  make({ name: 'First Bounce', W: 98, H: 12, hue: 215,
    hint: 'Roll with ← → and jump with ↑ or Space. Collect every ring. A green pump blows you up to float on water!',
    touchHint: 'Use ◀ ▶ to roll and JUMP to jump. Collect every ring. A green pump blows you up to float on water!' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([8, 3]);
    l.rect(12, 2, 13, 2);
    l.rings([16, 4]);
    l.pit(20, 22);
    l.rect(26, 3, 30, 3);
    l.rings([28, 4]);
    l.spikes(35, 36);
    // a plain-looking block... with a secret inside
    l.rect(40, 2, 43, 3);
    l.set(40, 2, 'H'); l.set(41, 2, 'H'); l.set(42, 2, 'L');
    l.rings([45, 4]);
    l.set(47, 2, 'C');
    l.pit(50, 52);
    l.set(57, 2, 'b');
    l.rings([57, 6]);
    l.spikes(60, 62);
    l.rect(66, 2, 67, 2);
    l.rect(68, 2, 69, 3);
    l.rings([72, 4]);
    // water: the pump inflates you so you float over the spiky pool; the pin shrinks you again
    l.set(74, 2, 'P');
    l.rect(78, 2, 78, 3);
    l.pool(79, 2, 86, 3);
    l.spikes(79, 86);
    l.rect(87, 2, 87, 3);
    l.rings([82, 5]);
    l.set(90, 2, 'D');
    l.rings([92, 3]);
    l.set(95, 2, 'E');
  }),

  // 2 ------------------------------------------------------------------------
  make({ name: 'Spring Valley', W: 100, H: 12, hue: 165,
    hint: 'Springs launch you high. Water lets you float. Spiders bite!' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([7, 4]);
    l.set(11, 2, '*');
    l.rect(13, 2, 14, 5);
    l.rings([12, 7], [17, 3]);
    l.spikes(19, 20);
    // low tunnel (the ceiling hides a secret)
    l.rect(24, 5, 34, 10);
    l.ceilSpikes(28, 29, 4);
    l.spikes(31, 31);
    l.set(33, 5, 'L');
    l.rings([26, 3]);
    l.set(37, 2, 'C');
    l.mover(42, 2, 'x', 2, 2);
    l.rings([46, 4]);
    l.pit(49, 51);
    l.pit(54, 56);
    l.rings([53, 4]);
    // spring over the spike field
    l.set(58, 2, '*');
    l.rect(62, 6, 68, 6);
    l.spikes(61, 68);
    l.rings([65, 7]);
    l.set(71, 2, 'C');
    // first pool: float across
    l.rect(74, 2, 74, 3);
    l.pool(75, 2, 82, 3);
    l.spikes(75, 82);
    l.rect(83, 2, 83, 3);
    l.rings([78, 5]);
    l.ceilSpikes(80, 81, 6);
    l.set(88, 2, 'b');
    l.rect(89, 2, 90, 5);
    l.rings([88, 7]);
    l.set(96, 2, 'E');
  }),

  // 3 ------------------------------------------------------------------------
  make({ name: 'Pump Works', W: 104, H: 12, hue: 120,
    hint: 'Pins shrink you to slip under slabs. Pumps blow you up BIG: big balls jump higher and float.' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([6, 3]);
    l.set(10, 2, 'D');
    // slab tunnel: small ball only
    l.rect(14, 3, 22, 10);
    l.rect(14, 2, 22, 2, 'h');
    l.rings([18, 2]);
    l.rings([24, 3]);
    l.set(26, 2, 'P');
    // tall wall: big ball only
    l.rect(30, 2, 31, 4);
    l.rings([31, 7]);
    l.set(34, 2, 'C');
    // spiky pool: big floats over the spikes
    l.rect(36, 2, 36, 3);
    l.pool(37, 2, 44, 3);
    l.spikes(37, 43);
    l.rings([40, 5]);
    // the block after the pool hides a pocket
    l.rect(45, 2, 48, 5);
    l.rect(45, 3, 46, 4, 'H');
    l.set(47, 3, 'L');
    // 1-tile tunnel: too narrow for big
    l.set(51, 2, 'D');
    l.rect(54, 3, 62, 10);
    l.rings([58, 2]);
    l.set(66, 2, 'P');
    l.set(69, 2, 'C');
    l.mover(73, 2, 'x', 1.5, 2.2);
    l.rings([73, 5]);
    // second pool with ceiling spikes
    l.rect(77, 2, 77, 3);
    l.pool(78, 2, 86, 3);
    l.spikes(78, 86);
    l.ceilSpikes(80, 84, 6);
    l.rect(87, 2, 87, 3);
    l.rings([82, 4]);
    l.spikes(91, 92);
    l.rings([92, 5]);
    l.set(98, 2, 'E');
  }),

  // 4 ------------------------------------------------------------------------
  make({ name: 'Spike Caverns', W: 110, H: 14, hue: 275,
    hint: 'Timing is everything. Blowers carry you up. Checkpoints keep your progress.' }, (l) => {
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
    // a blower that leads... somewhere
    l.blower(67, 2, 10);
    l.rect(65, 11, 69, 12);
    l.set(67, 11, 'L');
    l.set(71, 2, 'C');
    l.mover(75, 2, 'x', 1.8, 2);
    l.mover(82, 2, 'x', 2, 2.5, 1);
    l.rings([79, 4]);
    l.set(88, 2, '*');
    l.rect(91, 6, 96, 6);
    l.rings([93, 7]);
    l.rect(97, 2, 98, 7);
    l.rings([98, 9]);
    l.set(106, 2, 'E');
  }),

  // 5 ------------------------------------------------------------------------
  make({ name: 'Bouncy Castle', W: 104, H: 16, hue: 320,
    hint: 'Hold JUMP while landing on pink blocks for a super bounce. Ride the blowers!' }, (l) => {
    l.set(3, 2, 'S');
    l.rect(8, 1, 20, 1, 'b');
    l.rings([11, 6], [15, 7], [19, 6]);
    l.set(21, 2, 'b');
    l.rect(22, 2, 23, 6);
    // look behind you after the castle wall
    l.set(23, 2, 'H'); l.set(22, 2, 'L');
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
    l.mover(46.5, 10, 'x', 3, 1.6);
    l.set(56, 2, 'C');
    l.mover(64, 4, 'y', 2, 2.2, 0);
    l.mover(68, 4, 'y', 2, 2.2, 1.5);
    l.mover(72, 4, 'y', 2, 2.2, 3);
    l.rings([66, 3], [70, 3]);
    // blower over a spike pit up to a high ledge
    l.spikes(75, 79);
    l.blower(77, 2, 10);
    l.rect(80, 9, 86, 9);
    l.rings([83, 10]);
    l.spikes(80, 90);
    l.mover(89, 8, 'y', 2, 2.4);
    l.rings([88, 12]);
    l.set(98, 2, 'E');
  }),

  // 6 ------------------------------------------------------------------------
  make({ name: 'Windy Heights', W: 122, H: 18, hue: 190,
    hint: 'Blowers lift you over the spikes. Don\'t look down!' }, (l) => {
    l.set(3, 2, 'S');
    l.rings([6, 3]);
    l.spikes(11, 23);
    l.blower(9, 2, 8);
    l.rect(11, 7, 14, 7);
    l.rings([13, 8]);
    l.mover(16.5, 9, 'y', 1.5, 2);
    l.rect(19, 7, 21, 7);
    l.rings([20, 8]);
    l.blower(24, 2, 13);
    l.spikes(25, 37);
    l.rect(26, 12, 30, 12);
    l.ceilSpikes(26, 30, 16);
    l.rings([28, 13]);
    l.set(29, 13, 'C');
    l.mover(33, 13.5, 'y', 1.5, 2.2);
    l.rect(35, 12, 39, 12);
    l.rings([37, 14]);
    // secret in the ceiling chunk above
    l.rect(37, 15, 39, 16);
    l.set(38, 15, 'L');
    l.set(43, 2, 'C');
    l.set(46, 2, 'D');
    l.rect(49, 3, 56, 6);
    l.rect(49, 2, 56, 2, 'h');
    l.rings([52, 2]);
    l.set(59, 2, 'P');
    l.mover(64, 2, 'x', 2, 2.4);
    // spiky pool, spider overhead
    l.rect(68, 2, 68, 3);
    l.pool(69, 2, 78, 3);
    l.spikes(69, 78);
    l.ceilSpikes(70, 77, 7);
    l.mover(73.5, 5.2, 'x', 3, 1.5);
    l.rect(79, 2, 79, 3);
    l.rings([74, 4]);
    // big ride up
    l.spikes(81, 82);
    l.spikes(84, 108);
    l.blower(83, 2, 12);
    l.rect(85, 11, 90, 11);
    l.rings([88, 12]);
    l.set(89, 12, 'C');
    l.rect(94, 9, 95, 9);
    l.mover(97, 11, 'y', 1.5, 2);
    l.rect(99, 7, 100, 7);
    l.mover(102, 9, 'y', 1.5, 2.3, 1);
    l.rect(104, 5, 105, 5);
    l.rings([99, 8], [104, 6]);
    l.set(112, 2, '+');
    l.rings([110, 3]);
    l.set(117, 2, 'E');
  }),

  // 7 ------------------------------------------------------------------------
  make({ name: 'Deep Waters', W: 122, H: 16, hue: 200,
    hint: 'Normal balls float, big balls float high, small balls sink. Choose wisely.' }, (l) => {
    l.rect(1, 2, 120, 5); // raised ground, pools are dug into it
    l.set(3, 6, 'S');
    l.rings([7, 7]);
    // pool 1: a spider skims the surface
    l.pool(10, 2, 20, 5);
    l.mover(15, 7.6, 'x', 3.5, 1.6);
    l.rings([15, 6]);
    l.set(24, 6, 'D');
    // pool 2: dive under the wall (small sinks)
    l.pool(26, 2, 41, 5);
    l.rect(30, 4, 38, 10);
    l.set(34, 4, 'L');
    l.spikes(32, 32);
    l.spikes(36, 36);
    l.rings([34, 2]);
    l.set(40, 2, 'P');
    l.set(44, 6, 'C');
    // pool 3: shrink, swim under, ride the blower
    l.set(47, 6, 'D');
    l.pool(49, 2, 58, 5);
    l.rect(52, 6, 53, 14);
    l.blower(56, 2, 11);
    l.rect(58, 10, 62, 10);
    l.rings([60, 11]);
    l.spikes(59, 77, 6);
    l.rect(66, 10, 68, 10);
    l.mover(70.5, 11.5, 'y', 1.5, 2);
    l.rect(73, 10, 75, 10);
    l.rings([67, 11], [74, 12]);
    l.set(75, 11, 'P');
    l.set(83, 6, 'C');
    // pool 4: long spiky crossing
    l.pool(86, 2, 106, 5);
    l.spikes(86, 106);
    l.ceilSpikes(89, 103, 9);
    l.mover(92, 7.6, 'y', 1.3, 1.7);
    l.mover(100, 7.6, 'y', 1.3, 1.9, 2);
    l.rings([96, 7]);
    l.set(108, 6, '+');
    l.rings([111, 7]);
    l.set(116, 6, 'E');
  }),

  // 8 ------------------------------------------------------------------------
  make({ name: 'The Abyss', W: 100, H: 16, hue: 205,
    hint: 'Grab the blue pin to shrink and sink to the seabed. Collect the rings down there, then pop the green pump to float back up!' }, (l) => {
    l.rect(1, 2, 98, 8);                  // raised ground; the abyss is dug into it
    l.set(3, 9, 'S');
    l.set(10, 9, 'C');
    l.rings([7, 10]);
    l.set(16, 9, 'D');                    // pin: small balls sink
    l.pool(20, 2, 70, 9);                 // 8 tiles deep
    l.rect(19, 9, 19, 9);                 // brim
    l.rect(71, 9, 71, 9);
    // seabed: rings = points, with a few blocks, spikes and spiders to dodge
    l.rings([23, 2], [26, 2], [29, 2]);
    l.rect(32, 2, 33, 3);
    l.rings([32, 5]);
    l.spikes(35, 36);
    l.rings([37, 4], [39, 2], [42, 2]);
    l.rect(45, 2, 47, 4);
    l.rings([46, 6]);
    l.mover(52, 5.5, 'y', 1.5, 1.4);
    l.rings([50, 2], [54, 2]);
    l.spikes(56, 57);
    l.mover(61, 3.9, 'x', 2.2, 1.3, 1);
    l.rings([59, 2], [63, 2], [65, 3]);
    l.rect(67, 2, 67, 3);
    l.set(69, 2, 'P');                    // pump: big balls float back to the surface
    l.set(73, 9, 'C');
    l.rings([76, 10]);
    // secret behind fake bricks
    l.rect(82, 9, 85, 10);
    l.set(82, 9, 'H'); l.set(83, 9, 'H'); l.set(84, 9, 'L');
    l.rings([88, 10]);
    l.set(94, 9, 'E');
  }),

  // 9 ------------------------------------------------------------------------
  make({ name: 'Neon Gauntlet', W: 134, H: 14, hue: 25,
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
    l.mover(36.5, 4.2, 'y', 2, 2);
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
    l.mover(63.5, 9, 'y', 1.5, 2.2);
    l.rings([61, 6], [72, 8]);
    l.set(78, 2, 'C');
    l.set(81, 2, '*');
    l.rect(85, 6, 91, 6);
    l.spikes(85, 92);
    l.mover(88, 7, 'x', 2, 1.8);
    l.rings([89, 9]);
    l.rect(87, 10, 89, 12);
    l.set(88, 10, 'L');
    l.mover(97, 4, 'y', 2, 2.4, 0);
    l.mover(101, 4, 'y', 2, 2.4, 2);
    l.mover(105, 4, 'y', 2, 2.4, 4);
    l.rings([99, 3], [103, 3]);
    l.rect(109, 2, 110, 3);
    l.rings([111, 5]);
    l.set(113, 2, 'D');
    l.rect(116, 3, 122, 12);
    l.rect(116, 2, 122, 2, 'h');
    l.rings([119, 2]);
    l.set(124, 2, 'P');
    l.spikes(126, 127);
    l.set(125, 5, '+');
    l.set(130, 2, 'E');
  }),
];
