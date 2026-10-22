/* ==========================================================================
   HYDRO BIOGEO LAB — LANDING PAGE ANIMATION (home.js)
   ==========================================================================

   WHAT THIS FILE DOES
   -------------------
   It draws an animated topographic landscape inside the <canvas id="terrain">
   element of home.html. In five steps:

     1. TERRAIN    – We invent a landscape: a grid of elevation values made
                     from "noise" (random-but-smooth numbers), plus a hill
                     and a river valley.
     2. CONTOURS   – D3's d3.contours() turns that grid into contour lines
                     (lines of equal elevation), like on a topographic map.
     3. CAMERA     – A small 3D "camera" looks at the landscape. At the top of
                     the page it looks from the side (tilted); as you scroll,
                     it rotates until it looks straight down.
     4. PULSES     – Lime dots with glowing tails move over the landscape.
                     At first they slide ALONG contour lines; as you scroll
                     they turn and flow DOWNHILL, like water.
     5. CURSOR     – Lines near the mouse get darker (a "spotlight").

   WHERE D3 IS USED (look for the "D3:" tags in the comments)
   ---------------------------------------------------------
     d3.contours()        compute contour lines from a grid of numbers
     d3.blur2()           smooth (blur) a 2D grid
     d3.extent()          find the [min, max] of an array
     d3.range()           make a list of numbers, e.g. d3.range(3) → [0, 1, 2]
     d3.interpolateRgb()  blend between two colours
     d3.rgb()             read a colour into its red/green/blue parts

   WHY A <canvas> AND NOT SVG?
   ---------------------------
   In most D3 examples you draw with SVG (one <path> element per shape).
   Here the camera moves every frame, so every line must be redrawn ~60
   times per second. SVG would have to update thousands of elements each
   time; a canvas is just a picture we repaint, which is much faster.
   D3 still does the "thinking" (contours, colours, ranges); the canvas
   only does the painting.

   HOW THE CODE IS ORGANISED
   -------------------------
     A. Settings (CONFIG)            – the knobs you can play with
     B. Setup                        – find HTML elements, create canvases
     C. build()                      – make the terrain and contours
     D. Camera / projection          – 3D landscape point → 2D screen point
     E. Drawing the contour lines
     F. Pulses (moving dots)
     G. render()                     – paint one frame
     H. Scrolling                    – scroll position → camera angle, texts
     I. Animation loop and events    – mouse, scroll, resize
     J. Noise generator              – the random-but-smooth numbers
   ========================================================================== */


/* Everything is wrapped in a function that runs immediately:
       (function () { ... })();
   This keeps our variables private, so they can't clash with variables
   from other scripts on the page (e.g. D3 itself). */
(function () {
  "use strict";   // makes JavaScript stricter: typos in variable names become errors

  /* ------------------------------------------------------------------------
     B. SETUP — find the HTML elements we need
     ------------------------------------------------------------------------ */

  // document.querySelector() finds the first element matching a CSS selector.
  // (D3 has the same idea: d3.select(".intro") — here we use plain JS.)
  const intro = document.querySelector(".intro");     // the tall scrolling section
  const stage = document.querySelector(".stage");     // the part that stays on screen
  const canvas = document.getElementById("terrain");  // where we draw

  // If something is missing (or D3 failed to load), stop quietly.
  if (!intro || !stage || !canvas || typeof d3 === "undefined") return;


  /* ------------------------------------------------------------------------
     A. SETTINGS — change these numbers to change the look
     ------------------------------------------------------------------------ */
  const CONFIG = {
    // --- Pattern: shape of the landscape ---
    scale: 1,               // size of the hills (bigger = wider hills)
    octaves: 4,             // amount of detail (more = bumpier terrain)
    levels: 30,             // number of contour lines
    smoothing: 2,           // how much the terrain is blurred (in grid cells)
    seed: 7,                // change this number to get a different landscape
    regionalSlope: 1,     // overall tilt of the land: higher on the left, lower on the right
                            //   (0 = no tilt; larger = stronger contrast between the two sides)

    // --- 3D view: the camera ---
    zDepth: 300,            // how tall the relief is (in pixels)
    tiltStart: 60,          // camera angle at the top of the page (degrees):
                            //   0 = looking straight down, 90 = looking from the side
                            //   (60° = camera 30° above the horizon)
    startCenterY: 0.9,      // vertical position of the landscape at the start
                            //   (0 = top of the screen, 1 = bottom)
    tiltEnd: 1,             // camera angle at the end of the intro (≈ straight down)
    perspective: 2.2,       // camera distance (× screen size); smaller = stronger perspective
    zoom: 0.8,              // how close the camera is: 1 = close-up, smaller = further away
                            //   (0.6 shows about 1.7× more landscape in each direction,
                            //   with smaller hills; lower values cost more computing time)

    // --- Lines ---
    lineWidth: 0.9,         // normal contour line width (px)
    indexEvery: 5,          // every 5th line is an "index contour" (thicker), like on real maps
    indexWidth: 1.7,        // index contour width (px)

    // --- Fill: optional colour between contour lines ---
    fill: false,
    fillOpacity: 0.05,

    // --- Pulses: the moving lime dots ---
    pulseCount: 70,         // number of dots (on a desktop-size screen)
    speedMin: 0.035,        // slowest speed (grid cells per frame)
    speedMax: 0.07,         // fastest speed
    trailLength: 70,        // how many points the tail remembers
    trailEvery: 4,          // a new tail point every N frames (longer tails, same cost)
    headRadius: 3,          // radius of the dot (0 = tail only)
    glowSize: 4.5,          // glow size (× dot radius)
    glowStrength: 0.75,     // glow intensity (0 to 1)
    lifetime: 3200,         // max life of a dot before it restarts elsewhere (frames)
    flowStart: 0.12,        // scroll progress (0–1) where dots start leaving the contour lines…
    flowEnd: 0.6,           // …and where they fully flow downhill

    // --- Colours ---
    gradientStart: "#b9c9d5",   // low elevations (pale grey-blue)
    gradientEnd: "#1a4d6e",     // high elevations (the site's dark blue)
    pulseColor: "#c1ff28",      // lime
    highlightColor: "#0f3a57",  // lines under the cursor

    // --- Cursor spotlight ---
    spotRadius: 230             // radius of the darkened area around the mouse (px)
  };

  // Respect the visitor's system setting "reduce motion" (accessibility).
  // matchMedia() lets JavaScript ask the same questions as CSS @media rules.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A canvas is drawn through its "context": an object with drawing commands
  // (moveTo, lineTo, stroke, fill, ...). "2d" = the 2D drawing API.
  const ctx = canvas.getContext("2d");

  // Three extra canvases that are NEVER shown on the page ("off-screen").
  // We use them as scratch paper to save work:
  const baseCanvas = document.createElement("canvas");   // all contour lines, drawn once per camera angle
  const hiCanvas = document.createElement("canvas");     // the same lines in dark ("highlighted") style
  const tmpCanvas = document.createElement("canvas");    // used to cut out the round cursor spotlight
  const baseCtx = baseCanvas.getContext("2d");
  const hiCtx = hiCanvas.getContext("2d");
  const tmpCtx = tmpCanvas.getContext("2d");

  // The texts that fade in and out while scrolling.
  const titleEl = document.querySelector(".overlay-title");
  const welcomeEl = document.querySelector(".overlay-welcome");
  const cueEl = document.querySelector(".scroll-cue");

  // D3: d3.interpolateRgb(a, b) returns a FUNCTION. Give it a number from 0 to 1
  // and it returns a colour between a and b: lineColor(0) = pale, lineColor(1) = dark,
  // lineColor(0.5) = halfway. We use it to colour each contour by its elevation.
  const lineColor = d3.interpolateRgb(CONFIG.gradientStart, CONFIG.gradientEnd);

  // D3: d3.rgb("#c1ff28") splits a colour into {r: 193, g: 255, b: 40},
  // so we can build "rgba(r,g,b,opacity)" strings with any transparency.
  const pulse = d3.rgb(CONFIG.pulseColor);

  // Variables that change while the page runs (hence "let", not "const").
  let W = 0, H = 0, dpr = 1;   // canvas width/height in CSS pixels; device pixel ratio
  let world = null;            // the terrain grid and its dimensions (filled in build())
  let levels = [];             // the contour lines
  let particles = [];          // the moving dots
  let paths = null;            // contour lines converted to screen shapes (Path2D)
  // "Keys" remember for which camera angle something was last drawn,
  // so we don't redraw it if the camera hasn't moved.
  let pathKey = "", baseKey = "", hiKey = "";

  // The camera has a CURRENT state (cam) and a TARGET state (camTarget).
  // Scrolling changes the target; each frame, the current state moves a little
  // towards the target. This makes the motion smooth instead of jumpy.
  //   tilt = camera angle, cy = vertical position, mix = 0 (follow contours) → 1 (flow downhill)
  const cam = { tilt: CONFIG.tiltStart, cy: CONFIG.startCenterY, mix: 0 };
  const camTarget = { tilt: CONFIG.tiltStart, cy: CONFIG.startCenterY, mix: 0 };

  // Same idea for the cursor spotlight: position (x, y) and radius (r).
  const spot = { x: 0, y: 0, r: 0 };
  const spotTarget = { x: 0, y: 0, r: 0 };

  let running = false;   // is the animation loop currently scheduled?
  let visible = true;    // is the intro section on screen?


  /* ------------------------------------------------------------------------
     C. BUILD — create the terrain and its contour lines
     Runs once at the start, and again if the window is resized.
     ------------------------------------------------------------------------ */
  function build() {
    // Size of the drawing area, in CSS pixels.
    W = stage.clientWidth;
    H = stage.clientHeight;

    // High-resolution ("retina") screens have 2+ real pixels per CSS pixel.
    // We make the canvas bigger in real pixels so lines stay sharp (max 2× to stay fast).
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [canvas, baseCanvas, hiCanvas, tmpCanvas]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    // ...and scale every drawing command by dpr, so we can keep thinking in CSS pixels.
    for (const g of [ctx, baseCtx, hiCtx, tmpCtx]) g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The "world" (the landscape) is bigger than the screen, so its edges
    // stay hidden even when the camera is tilted.
    // Wb × Hb is the area seen at zoom = 1. When the camera moves further away
    // (zoom < 1), the world must be bigger (÷ zoom) to still fill the screen,
    // and the grid needs more columns to keep the same detail.
    const unit = Math.max(W, H);
    const Wb = W * 1.9, Hb = H * 2.6;       // base world size (at zoom = 1)
    const Ww = Wb / CONFIG.zoom;            // world width
    const Hw = Hb / CONFIG.zoom;            // world depth
    const nx = Math.round(((W < 700 ? 140 : 210) / CONFIG.zoom) * 0.85);   // grid columns (fewer on phones)
    const ny = Math.round((nx * Hw) / Ww);  // grid rows (keeps cells roughly square)
    const feature = 0.36 * unit * CONFIG.scale;   // typical hill size
    const noise = makeNoise2D(CONFIG.seed);        // our noise function (section J)

    // "Fractal Brownian motion" (fbm): add several layers ("octaves") of noise.
    // Each layer has twice the detail (frequency) and half the height (amplitude)
    // of the previous one: big hills + medium bumps + small wrinkles = natural terrain.
    function fbm(x, y) {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let o = 0; o < CONFIG.octaves; o++) {
        sum += amp * noise(x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;   // 2.03 instead of 2 avoids visible repeating patterns
      }
      return sum / norm;   // keeps the result in roughly the same range (-1 to 1)
    }

    // The river valley: for each position Y (depth), where is the river on X?
    // A slanted line plus a sine wave = a gently meandering river.
    // (A nod to the St. Lawrence on the lab's home page map.)
    // Sizes use the BASE world (Wb, Hb), so the river keeps its real size and
    // simply looks smaller when the camera moves away.
    const riverX = (Y) => Wb * 0.2 + Y * 0.18 + Wb * 0.035 * Math.sin(Y / (Hb * 0.09));

    // Elevation at world position (X, Y).
    function elevation(X, Y) {
      let e = fbm(X / feature, Y / feature);   // base: natural-looking hills

      // Regional slope: the whole land rises towards the left and descends towards
      // the river on the right. Math.tanh() makes a smooth S-shaped ramp (-1 → 1)
      // that levels off far from the centre, so the edges don't become extreme.
      // The ramp spans the VISIBLE width (W ÷ zoom), so the effect looks the same at any zoom.
      e -= CONFIG.regionalSlope * Math.tanh(X / ((W / CONFIG.zoom) * 0.45));

      // Add a big round hill on the left (a nod to Mont Royal).
      // Math.exp(-distance² / ...) is a "Gaussian bump": 1 at the centre, fading to 0.
      const mx = X + Wb * 0.17, my = Y + Hb * 0.04, mr = Wb * 0.12;
      e += 0.95 * Math.exp(-(mx * mx + my * my * 1.3) / (2 * mr * mr));

      // Dig the valley: subtract a narrow deep bump + a wide shallow one along the river.
      const d = X - riverX(Y), w = Wb * 0.045;
      e -= 0.85 * Math.exp(-(d * d) / (2 * w * w)) + 0.3 * Math.exp(-(d * d) / (2 * 16 * w * w));
      return e;
    }

    // Fill the grid. It's a 1D array of nx × ny numbers, row after row:
    // the value at column i, row j is stored at index i + j * nx.
    // (That's the format d3.contours() expects.)
    const values = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // convert grid position (i, j) to world position, centred on 0
        values[i + j * nx] = elevation((i / nx - 0.5) * Ww, (j / ny - 0.5) * Hw);
      }
    }

    // D3: d3.blur2() blurs a 2D grid in place (smoother terrain → smoother contour lines).
    if (CONFIG.smoothing > 0) d3.blur2({ data: values, width: nx, height: ny }, CONFIG.smoothing);

    // D3: d3.extent() returns [smallest, largest] value of an array.
    // We then rescale all elevations to the range 0 (lowest) → 1 (highest).
    const [vmin, vmax] = d3.extent(values);
    for (let k = 0; k < values.length; k++) values[k] = (values[k] - vmin) / (vmax - vmin);

    // D3: d3.range(1, 30) → [1, 2, ..., 29]. Divided by 30 → [0.033, 0.067, ..., 0.967].
    // These are the elevations ("thresholds") where we want a contour line.
    const thresholds = d3.range(1, CONFIG.levels).map((k) => k / CONFIG.levels);

    // D3: THE KEY STEP. d3.contours() is a "generator": we configure it
    // (.size = grid dimensions, .thresholds = which elevations), then call it on the grid.
    // It returns one object per threshold, in GeoJSON "MultiPolygon" format:
    //   { value: 0.5, coordinates: [ polygon, polygon, ... ] }
    // where each polygon is a list of rings, and each ring a list of [x, y] points
    // in GRID units (0 to nx, 0 to ny).
    // In a typical D3 map you'd now draw these with d3.geoPath() into SVG <path>s.
    const contours = d3.contours().size([nx, ny]).thresholds(thresholds)(values);

    // Simplify that structure for fast drawing: for each contour level keep
    //   z     = its elevation (0–1)
    //   index = is it a thicker "index contour"?
    //   rings = each ring flattened to [x0, y0, x1, y1, ...] in a compact Float32Array
    levels = contours
      .map((c, i) => ({
        z: c.value,
        index: (i + 1) % CONFIG.indexEvery === 0,
        rings: c.coordinates.flatMap((poly) => poly.map((ring) => Float32Array.from(ring.flat())))
      }))
      .filter((l) => l.rings.length);   // drop levels with no lines

    // Remember the terrain for the other functions. D = camera distance
    // (further away when zoomed out, so the perspective looks the same).
    world = { values, nx, ny, Ww, Hw, D: (unit * CONFIG.perspective) / CONFIG.zoom };
    pathKey = baseKey = hiKey = "";     // forget old drawings: everything must be redrawn

    // Create the moving dots. Fewer on small screens (area = fraction of a 1440×900 screen).
    const area = Math.min(1, (W * H) / (1440 * 900));
    const count = Math.max(18, Math.round(CONFIG.pulseCount * area));

    // Put the camera directly where the current scroll position wants it (no easing).
    updateFromScroll();
    cam.tilt = camTarget.tilt;
    cam.cy = camTarget.cy;
    cam.mix = camTarget.mix;

    // D3: d3.range(count) → [0, 1, ..., count-1]; .map() turns each into a new dot.
    particles = d3.range(count).map(() => {
      const p = spawn({});
      p.age = Math.floor(Math.random() * p.life * 0.6);   // random ages, so they don't all restart together
      return p;
    });

    // "Pre-run" the dots for 400 steps so their tails already exist when the page appears.
    if (!reduceMotion) {
      for (let s = 0; s < 400; s++) for (const p of particles) step(p);
    }

    render();
  }


  /* ------------------------------------------------------------------------
     D. CAMERA — turn a 3D point of the landscape into a 2D point on screen
     ------------------------------------------------------------------------
     A landscape point has:  gx, gy = position on the grid,  z = elevation (0–1).
     We:
       1. convert it to world coordinates (X across, Y in depth, Z up), centred on 0;
       2. rotate it around the horizontal axis by the camera tilt
          (basic trigonometry: cos and sin of the angle);
       3. apply perspective: things further from the camera look smaller
          (divide by the distance), and the zoom;
       4. shift to the middle of the screen.
     projector() returns a FUNCTION that does this for the current camera,
     with the sin/cos computed only once (a small speed trick).
     ------------------------------------------------------------------------ */
  function projector() {
    const t = (cam.tilt * Math.PI) / 180;   // degrees → radians
    const c = Math.cos(t), s = Math.sin(t);
    const { nx, ny, Ww, Hw, D } = world;    // "destructuring": pull these out of the world object
    const sx = Ww / nx, sy = Hw / ny, ox = Ww / 2, oy = Hw / 2;
    const cx = W / 2, cy = H * cam.cy, zd = CONFIG.zDepth, minDist = D * 0.12, zoom = CONFIG.zoom;

    return function (gx, gy, z, out) {
      const X = gx * sx - ox;                          // 1. grid → world, centred
      const Y = gy * sy - oy;
      const Z = z * zd;
      const dist = D - (Y * s + Z * c);                // 2. distance from the camera after rotation
      const k = (D / (dist > minDist ? dist : minDist)) * zoom; // 3. perspective scale (never divide by ~0) × zoom
      out[0] = cx + X * k;                             // 4. screen x
      out[1] = cy + (Y * c - Z * s) * k;               //    screen y (higher ground moves up)
      return out;   // we reuse the "out" array instead of creating a new one (faster)
    };
  }

  // A short text describing the camera, e.g. "60.00|0.9000".
  // If it hasn't changed since last time, nothing needs to be re-projected.
  function camKey() {
    return cam.tilt.toFixed(2) + "|" + cam.cy.toFixed(4);
  }


  /* ------------------------------------------------------------------------
     E. DRAWING THE CONTOUR LINES
     ------------------------------------------------------------------------ */

  // Project every contour point to the screen and store the result as Path2D
  // objects (one per contour level). A Path2D is a reusable shape: we build it
  // once and can then stroke it as many times as we like.
  function buildPaths() {
    const key = camKey();
    if (key === pathKey) return;   // camera unchanged → reuse the existing paths
    const P = projector();
    const pt = [0, 0];
    const { nx, ny } = world;

    // d3.contours() closes every line along the edge of the grid (it makes closed
    // shapes). Those edge segments would show up as straight lines, so we skip them.
    const onBorder = (x, y) => x <= 0 || y <= 0 || x >= nx || y >= ny;

    paths = levels.map((l) => {
      const path = new Path2D();
      for (const ring of l.rings) {
        let prevB = false;
        for (let k = 0; k < ring.length; k += 2) {    // step by 2: [x, y] pairs
          const b = onBorder(ring[k], ring[k + 1]);
          P(ring[k], ring[k + 1], l.z, pt);           // 3D → screen
          // moveTo = lift the pen and move; lineTo = draw a line to here.
          // Lift the pen at the start of a ring and along border segments.
          if (k === 0 || (b && prevB)) path.moveTo(pt[0], pt[1]);
          else path.lineTo(pt[0], pt[1]);
          prevB = b;
        }
      }
      return path;
    });
    pathKey = key;
  }

  // Paint all contour lines onto a canvas context "g".
  // highlight = false → normal colours; true → all dark (for the cursor spotlight).
  function drawLevels(g, highlight) {
    g.clearRect(0, 0, W, H);   // erase
    g.lineJoin = "round";      // rounded corners where line segments meet
    levels.forEach((l, i) => {
      if (CONFIG.fill && !highlight) {
        g.globalAlpha = CONFIG.fillOpacity;
        g.fillStyle = lineColor(l.z);
        g.fill(paths[i]);
      }
      // globalAlpha = transparency of everything drawn next (0 invisible → 1 opaque).
      // Higher lines are more opaque, so summits stand out.
      g.globalAlpha = highlight ? 1 : 0.4 + 0.55 * l.z;
      // D3 in action: lineColor(z) picks a colour on the pale → dark gradient.
      g.strokeStyle = highlight ? CONFIG.highlightColor : lineColor(l.z);
      g.lineWidth = (l.index ? CONFIG.indexWidth : CONFIG.lineWidth) + (highlight ? 0.6 : 0);
      g.stroke(paths[i]);       // draw the outline of the shape
    });
    g.globalAlpha = 1;          // reset, so later drawings aren't transparent
  }


  /* ------------------------------------------------------------------------
     F. PULSES — the moving lime dots
     ------------------------------------------------------------------------
     Each dot ("particle") is a small object:
       gx, gy   position on the grid
       vx, vy   velocity (how much it moves per frame)
       speed, age, life
       dir      +1 or -1: which way it goes around a contour line
       level    the contour line it follows (its elevation)
       trail    list of past positions, used to draw the tail

     The "mix" value (from scrolling) decides where it goes:
       mix = 0 → along the contour line (perpendicular to the slope)
       mix = 1 → straight downhill (like water: a "flow line")
       between → a blend of both, so dots gradually peel off their lines.
     ------------------------------------------------------------------------ */

  // Elevation at any (non-integer) grid position, by "bilinear interpolation":
  // a weighted average of the 4 surrounding grid values.
  function sample(gx, gy) {
    const { values, nx, ny } = world;
    const x = Math.min(Math.max(gx, 0), nx - 1.001);   // stay inside the grid
    const y = Math.min(Math.max(gy, 0), ny - 1.001);
    const i = Math.floor(x), j = Math.floor(y);        // the cell's top-left corner
    const fx = x - i, fy = y - j;                      // how far into the cell (0–1)
    const a = values[i + j * nx], b = values[i + 1 + j * nx];
    const c = values[i + (j + 1) * nx], d = values[i + 1 + (j + 1) * nx];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  // Is this landscape point currently visible on screen (with a 40 px margin)?
  function onScreen(gx, gy) {
    const pt = projector()(gx, gy, sample(gx, gy), [0, 0]);
    return pt[0] > -40 && pt[0] < W + 40 && pt[1] > -40 && pt[1] < H + 40;
  }

  // (Re)start a dot at a new random place.
  function spawn(p) {
    const { nx, ny } = world;
    // Try up to 40 random places; keep the first one that is visible and suitable.
    for (let tries = 0; tries < 40; tries++) {
      p.gx = nx * (0.04 + Math.random() * 0.92);
      p.gy = ny * (0.04 + Math.random() * 0.92);
      // When dots flow downhill (mix near 1), prefer starting on high ground,
      // so they have a long way to run. Math.pow(z, 2.5) is small for low z.
      const high = Math.random() < Math.pow(sample(p.gx, p.gy), 2.5 * cam.mix) + 0.03;
      if (high && onScreen(p.gx, p.gy)) break;
    }
    p.dir = Math.random() < 0.5 ? 1 : -1;        // clockwise or anticlockwise along the line
    p.level = nearestLevel(sample(p.gx, p.gy));  // the drawn contour line closest to it
    p.vx = 0;
    p.vy = 0;
    p.age = 0;
    p.speed = CONFIG.speedMin + Math.random() * (CONFIG.speedMax - CONFIG.speedMin);
    p.life = CONFIG.lifetime * (0.6 + Math.random() * 0.4);
    p.trail = [[p.gx, p.gy, sample(p.gx, p.gy)]];   // tail points are [gx, gy, z]
    return p;
  }

  // Elevation of the nearest DRAWN contour line (lines are at 1/30, 2/30, ...).
  function nearestLevel(z) {
    const L = CONFIG.levels;
    return Math.min(L - 1, Math.max(1, Math.round(z * L))) / L;
  }

  // Move one dot by one frame.
  function step(p) {
    const m = cam.mix;

    // The SLOPE (gradient) at the dot's position: how fast the elevation changes
    // in x (dx) and in y (dy). We measure it by sampling a little to each side
    // ("finite differences"). The gradient points UPHILL.
    const h = 0.75;
    const dx = (sample(p.gx + h, p.gy) - sample(p.gx - h, p.gy)) / (2 * h);
    const dy = (sample(p.gx, p.gy + h) - sample(p.gx, p.gy - h)) / (2 * h);
    const mag = Math.hypot(dx, dy);   // steepness (length of the gradient)

    if (mag > 1e-6) {   // skip perfectly flat spots
      const ux = dx / mag, uy = dy / mag;   // uphill direction, length 1

      // Two possible directions:
      //   along the contour = uphill direction turned 90°:  (-uy, ux) × dir
      //   downhill          = minus the uphill direction:   (-ux, -uy)
      // Blend them with m (0 → contour, 1 → downhill).
      let ax = (1 - m) * (-uy * p.dir) + m * -ux;
      let ay = (1 - m) * (ux * p.dir) + m * -uy;
      const am = Math.hypot(ax, ay) || 1;

      // Steer gently: keep 82% of the old velocity, add 18% of the new direction.
      // This "inertia" gives smooth curves instead of zig-zags.
      p.vx = p.vx * 0.82 + (ax / am) * p.speed * 0.18;
      p.vy = p.vy * 0.82 + (ay / am) * p.speed * 0.18;

      // While following contours, small errors make dots drift off their line.
      // Nudge them back: err = how far (in cells) they are above/below their line.
      if (m < 1) {
        const err = (sample(p.gx, p.gy) - p.level) / mag;
        const fix = Math.max(-1, Math.min(1, err)) * 0.25 * (1 - m);
        p.gx -= ux * fix;   // too high → move downhill a bit, and vice versa
        p.gy -= uy * fix;
      }
    }

    // Move.
    p.gx += p.vx;
    p.gy += p.vy;
    p.age++;

    // While flowing downhill, the dot keeps track of the nearest contour line,
    // so if you scroll back up it can lock onto that line and follow it.
    if (m > 0.5) p.level = nearestLevel(sample(p.gx, p.gy));

    // Restart the dot if it left the grid, got stuck in a hollow, or is too old.
    const { nx, ny } = world;
    const out = p.gx < 1 || p.gy < 1 || p.gx > nx - 2 || p.gy > ny - 2;
    const stuck = m > 0.5 && p.age > 40 && Math.hypot(p.vx, p.vy) < p.speed * 0.15;
    if (out || stuck || p.age > p.life) {
      spawn(p);
      return;
    }

    // Update the tail. Every few frames we ADD a point (the tail grows forward and
    // the oldest point is removed); in between, we just MOVE the last point,
    // so the head stays glued to the dot.
    const q = [p.gx, p.gy, sample(p.gx, p.gy)];
    const n = p.trail.length;
    if (p.age % CONFIG.trailEvery === 0) {
      p.trail.push(q);                                          // add at the end
      if (p.trail.length > CONFIG.trailLength) p.trail.shift(); // remove the oldest
    } else {
      p.trail[n - 1] = q;
    }
  }

  // Paint every dot and its tail.
  function drawPulses() {
    const P = projector();
    // The tail is drawn in 8 pieces ("bands"), from faint and thin (old end)
    // to bright and thick (near the head). That's what makes it fade.
    const BANDS = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const p of particles) {
      const n = p.trail.length;
      if (n < 2) continue;   // need 2 points to draw a line

      // Fade in when a dot is born and fade out before it dies (no popping).
      const fade = Math.min(1, p.age / 40, (p.life - p.age) / 60);
      if (fade <= 0) continue;

      // Project every tail point to the screen (the tail is stored in 3D,
      // so it stays correct while the camera rotates).
      const pts = p.trail.map((q) => P(q[0], q[1], q[2], [0, 0]));

      for (let b = 0; b < BANDS; b++) {
        const i0 = Math.floor((b * (n - 1)) / BANDS);        // first point of this piece
        const i1 = Math.floor(((b + 1) * (n - 1)) / BANDS);  // last point of this piece
        if (i1 <= i0) continue;
        const t = (b + 1) / BANDS;    // 0.125 (old end) → 1 (head)

        ctx.beginPath();
        ctx.moveTo(pts[i0][0], pts[i0][1]);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i][0], pts[i][1]);

        // First stroke: wide and very transparent = the soft glow around the tail.
        // (Template literal `...${x}...` inserts values into a string.)
        ctx.strokeStyle = `rgba(${pulse.r},${pulse.g},${pulse.b},${(0.25 * CONFIG.glowStrength * t * fade).toFixed(3)})`;
        ctx.lineWidth = 3 + 5 * t;
        ctx.stroke();
        // Second stroke, same shape: thin and bright = the tail itself.
        ctx.strokeStyle = `rgba(${pulse.r},${pulse.g},${pulse.b},${(t * fade).toFixed(3)})`;
        ctx.lineWidth = 0.6 + 1.8 * t;
        ctx.stroke();
      }

      if (CONFIG.headRadius > 0) {
        const [hx, hy] = pts[n - 1];   // the head = the last tail point

        // The glow: a circle filled with a RADIAL GRADIENT that goes from
        // semi-transparent lime in the centre to fully transparent at the edge.
        const gr = CONFIG.headRadius * CONFIG.glowSize;
        const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, gr);
        glow.addColorStop(0, `rgba(${pulse.r},${pulse.g},${pulse.b},${(CONFIG.glowStrength * fade).toFixed(3)})`);
        glow.addColorStop(0.35, `rgba(${pulse.r},${pulse.g},${pulse.b},${(0.45 * CONFIG.glowStrength * fade).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${pulse.r},${pulse.g},${pulse.b},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hx, hy, gr, 0, Math.PI * 2);   // a full circle (0 to 2π radians)
        ctx.fill();

        // The dot itself: lime, with a paler centre so it looks lit from inside.
        const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, CONFIG.headRadius);
        core.addColorStop(0, `rgba(247,255,214,${fade.toFixed(3)})`);
        core.addColorStop(0.6, `rgba(${pulse.r},${pulse.g},${pulse.b},${fade.toFixed(3)})`);
        core.addColorStop(1, `rgba(${pulse.r},${pulse.g},${pulse.b},${(0.9 * fade).toFixed(3)})`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(hx, hy, CONFIG.headRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }


  /* ------------------------------------------------------------------------
     G. RENDER — paint one complete frame
     ------------------------------------------------------------------------ */
  function render() {
    // 1. Contour lines. Re-project and repaint them ONLY if the camera moved;
    //    otherwise reuse the picture saved on baseCanvas (a big speed-up).
    buildPaths();
    if (baseKey !== pathKey) {
      drawLevels(baseCtx, false);
      baseKey = pathKey;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(baseCanvas, 0, 0, W, H);   // copy the saved picture onto the visible canvas

    // 2. Cursor spotlight: show the DARK version of the lines, but only inside
    //    a soft circle around the mouse.
    if (spot.r > 1) {
      if (hiKey !== pathKey) {
        drawLevels(hiCtx, true);   // dark version, also saved per camera angle
        hiKey = pathKey;
      }
      // On the scratch canvas: paste the dark lines...
      tmpCtx.globalCompositeOperation = "source-over";   // normal drawing mode
      tmpCtx.clearRect(0, 0, W, H);
      tmpCtx.drawImage(hiCanvas, 0, 0, W, H);
      // ...then "destination-in" keeps them only where we paint next,
      // with the opacity of what we paint: a radial gradient = a soft-edged circle.
      tmpCtx.globalCompositeOperation = "destination-in";
      const g = tmpCtx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.r);
      g.addColorStop(0, "rgba(0,0,0,1)");      // centre: keep fully
      g.addColorStop(0.55, "rgba(0,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");      // edge: keep nothing
      tmpCtx.fillStyle = g;
      tmpCtx.fillRect(0, 0, W, H);
      tmpCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(tmpCanvas, 0, 0, W, H);   // put the result on top of the normal lines
    }

    // 3. Dots and tails, on top of everything.
    if (!reduceMotion) drawPulses();
  }


  /* ------------------------------------------------------------------------
     H. SCROLLING — scroll position → camera angle and text visibility
     ------------------------------------------------------------------------ */

  // Three small maths helpers used everywhere in animation:
  //   clamp(v, a, b)  keep v between a and b
  //   lerp(a, b, t)   "linear interpolation": t = 0 → a, t = 1 → b, t = 0.5 → halfway
  //   smooth(a, b, v) 0 before a, 1 after b, a smooth S-curve in between
  //                   ("smoothstep" — gentle start and end, no sudden jumps)
  // (D3 has similar tools: d3.interpolateNumber and d3.easeCubic.)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function updateFromScroll() {
    // getBoundingClientRect() tells where an element is relative to the window.
    // r.top becomes negative as the intro scrolls up out of view.
    const r = intro.getBoundingClientRect();
    const total = Math.max(1, r.height - stage.clientHeight);   // scrollable distance
    const p = clamp(-r.top / total, 0, 1);   // progress: 0 = start of intro, 1 = end

    // Camera: rotates between 8% and 72% of the scroll.
    const t = smooth(0.08, 0.72, p);
    camTarget.tilt = lerp(CONFIG.tiltStart, CONFIG.tiltEnd, t);
    camTarget.cy = lerp(CONFIG.startCenterY, 0.5, t);
    // Dots: from following contours (0) to flowing downhill (1).
    camTarget.mix = smooth(CONFIG.flowStart, CONFIG.flowEnd, p);

    // Title: fades out and slides up between 4% and 30% of the scroll.
    // We change CSS properties directly from JavaScript with element.style.
    const titleOut = smooth(0.04, 0.3, p);
    titleEl.style.opacity = (1 - titleOut).toFixed(3);
    titleEl.style.transform = `translateY(${(-60 * titleOut).toFixed(1)}px)`;
    cueEl.style.opacity = (1 - smooth(0.02, 0.12, p)).toFixed(3);   // "Scroll ↓" hint

    // "Welcome to the lab" + logo: fade in and slide up between 62% and 85%.
    const welcomeIn = smooth(0.62, 0.85, p);
    welcomeEl.style.opacity = welcomeIn.toFixed(3);
    welcomeEl.style.transform = `translateY(calc(-50% + ${(30 * (1 - welcomeIn)).toFixed(1)}px))`;
    welcomeEl.style.visibility = welcomeIn > 0.01 ? "visible" : "hidden";
  }


  /* ------------------------------------------------------------------------
     I. ANIMATION LOOP AND EVENTS
     ------------------------------------------------------------------------ */

  // Move each property of obj a fraction ("rate") of the way towards goal.
  // Called every frame, this gives smooth "easing" (fast at first, then slowing).
  // Returns true while something is still moving.
  function easeTowards(obj, goal, keys, rate, eps) {
    let moving = false;
    for (const k of keys) {
      const d = goal[k] - obj[k];
      if (Math.abs(d) > eps) { obj[k] += d * rate; moving = true; }
      else obj[k] = goal[k];   // close enough: snap to the goal
    }
    return moving;
  }

  // One frame of animation.
  function loop() {
    running = false;
    if (!visible || !world) return;   // intro off screen → do nothing (saves battery)
    const camMoving = easeTowards(cam, camTarget, ["tilt", "cy", "mix"], 0.14, 0.001);
    const spotMoving = easeTowards(spot, spotTarget, ["x", "y", "r"], 0.15, 0.1);
    if (!reduceMotion) for (const p of particles) step(p);
    render();
    // requestAnimationFrame(fn) asks the browser to call fn before the next
    // screen refresh (usually 60 times per second). Calling it again from
    // inside loop() creates the animation loop.
    if (!reduceMotion || camMoving || spotMoving) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  // Start the loop if it isn't already running.
  function kick() {
    if (!running && visible) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  // EVENTS: functions the browser calls when something happens.
  // (In D3 you'd write selection.on("scroll", ...) — same idea.)

  // Scrolling → update the camera target and the texts.
  // { passive: true } promises we won't block scrolling (smoother on phones).
  window.addEventListener("scroll", () => { updateFromScroll(); kick(); }, { passive: true });

  // Mouse (or finger) moves over the animation → move the spotlight there.
  stage.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;   // position inside the canvas
    if (spotTarget.r === 0) { spot.x = x; spot.y = y; }          // appear under the cursor
    spotTarget.x = x;
    spotTarget.y = y;
    spotTarget.r = CONFIG.spotRadius;
    kick();
  });
  // Mouse leaves → the spotlight shrinks away.
  stage.addEventListener("pointerleave", () => { spotTarget.r = 0; kick(); });

  // IntersectionObserver tells us when an element enters or leaves the screen.
  // We pause the animation while the intro is scrolled out of view.
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    kick();
  }).observe(intro);

  // Window resized → rebuild everything for the new size.
  // We wait 200 ms after the last resize event ("debounce"), so we don't
  // rebuild dozens of times while the user is dragging the window edge.
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 200);
  });

  // GO!
  build();
  kick();


  /* ------------------------------------------------------------------------
     J. NOISE GENERATOR — 2D simplex noise (algorithm by Stefan Gustavson)
     ------------------------------------------------------------------------
     Math.random() gives unrelated numbers: as terrain, that looks like static.
     "Noise" gives random numbers that change SMOOTHLY from one point to the
     next — gentle hills instead of static. Simplex noise is a classic method
     used in games and computer graphics.

     You don't need to understand the inside of this function to use it:
     noise(x, y) returns a number between about -1 and 1, and nearby (x, y)
     give similar values. The "seed" makes the randomness repeatable: the
     same seed always gives the same landscape.
     ------------------------------------------------------------------------ */
  function makeNoise2D(seed) {
    // 1. Shuffle the numbers 0–255 using the seed (a tiny pseudo-random generator).
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];   // swap two entries
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    // 2. Eight possible "slope directions" assigned to the corners of a triangle grid.
    const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const F2 = 0.5 * (Math.sqrt(3) - 1);   // skew factor: square grid → triangle grid
    const G2 = (3 - Math.sqrt(3)) / 6;     // unskew factor: back to a square grid

    // Contribution of one triangle corner, fading smoothly with distance.
    function corner(gi, x, y) {
      let t = 0.5 - x * x - y * y;
      if (t < 0) return 0;
      t *= t;
      const g = grad[gi & 7];
      return t * t * (g[0] * x + g[1] * y);
    }

    // 3. The noise function: find the triangle containing (x, y) and add up
    //    the contributions of its 3 corners.
    return function (x, y) {
      const sk = (x + y) * F2;
      const i = Math.floor(x + sk), j = Math.floor(y + sk);
      const t = (i + j) * G2;
      const x0 = x - (i - t), y0 = y - (j - t);
      const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      return 70 * (   // 70 scales the result to roughly -1…1
        corner(perm[ii + perm[jj]], x0, y0) +
        corner(perm[ii + i1 + perm[jj + j1]], x1, y1) +
        corner(perm[ii + 1 + perm[jj + 1]], x2, y2)
      );
    };
  }
})();
