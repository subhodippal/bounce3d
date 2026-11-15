# Rebound 3D

A retro-inspired bouncing-ball platformer, rebuilt in 3D with [three.js](https://threejs.org/).
Roll, jump and bounce through 8 levels: collect every ring to open the exit portal, and avoid spikes and spiky spiders.
Pumps make the ball big, pins make it small, water makes it float, and blowers lift it into the air.
Every level also hides a **secret lever** behind fake bricks that opens a bonus **pinball table**.

- Runs in any modern browser on **PC and mobile** (touch controls turn on automatically on touch screens)
- **Installable as a PWA** and playable fully **offline**
- No build step: plain static files, ready for **GitHub Pages**

## Controls

| Action  | Keyboard               | Touch | Gamepad          |
|---------|------------------------|-------|------------------|
| Move    | ← → / A D              | Hold left / right half of screen | Left stick / D-pad |
| Jump    | ↑ / W / Space          | Swipe up (anywhere) | A / D-pad up     |
| Pause   | Esc / P                | ❚❚    |                  |
| Restart | R                      |       |                  |

Hold jump longer to jump higher. On touch screens, swipe down a little and up again to jump again without lifting your finger. Hold jump as you land on a **pink block** for a super bounce.

### Ball sizes, water and blowers

| Size   | Get it from | Jump | In water | Notes |
|--------|-------------|------|----------|-------|
| Normal | level start | 2.5 tiles | floats low | fits 1-tile gaps |
| Big    | green **pump** | 3.3 tiles | floats high | too wide for 1-tile gaps |
| Small  | blue **pin** | 2.2 tiles | sinks | rolls under low slabs |

Checkpoints remember your size. **Blowers** push the ball up their air column and catch its sideways drift.

### Secret pinball

Each level hides a lever inside fake bricks (they turn see-through when the ball is inside them). Touch the lever to enter a bonus pinball table:
← → (or the left/right halves of a touch screen) flip the flippers, and ↑ / Space / swipe up launches the ball (it also launches by itself).
After 3 balls drain you return to the level, and the bonus is added to your score. The level list marks levels where you found the secret with ✦.

## Run locally

The game needs a web server (opening `index.html` directly from disk won't work). A zero-dependency Node server is included:

```bash
node server.js            # port 8000
node server.js -p 8005    # pick a port (also --port 8005, or PORT=8005)
npm start                 # same as node server.js
```

It prints two addresses:

```
This computer:      http://localhost:8005/
Phone (same Wi-Fi): http://192.168.x.x:8005/
```

Open the second one on any phone or tablet connected to the same Wi-Fi.
If the phone can't connect, allow the port through your firewall (Ubuntu: `sudo ufw allow 8005/tcp`).

> Browsers only allow offline mode and **Install app** on `localhost` or HTTPS.
> Over plain `http://192.168.x.x` on a phone the game plays normally, but it can't be installed.
> To install it on a phone, use the GitHub Pages (HTTPS) link.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (the files should sit at the repo root).
2. On GitHub, go to **Settings → Pages**, then under **Source** choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/<repo>/`.

All paths are relative, so it works from a sub-path. `.nojekyll` is included so Pages serves every file as-is.

## Install as an app

- **Android / Chrome / Edge:** use the **⬇ Install app** button on the main menu, or *Install app* in the browser menu.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

## Project layout

```
index.html              page + UI screens
css/style.css           HUD, menus, touch controls
js/main.js              renderer, physics, game loop, input, UI
js/levels.js            level definitions (easy to edit/add)
js/pinball.js           secret bonus pinball table
js/audio.js             synthesized sound effects (WebAudio)
vendor/three.module.min.js   three.js r160 (bundled locally for offline play)
manifest.webmanifest, sw.js, icons/   PWA files
```

## Making levels

Levels in `js/levels.js` are built with small helper calls (`rect`, `pit`, `spikes`, `rings`, `mover`, `pool`, `water`, `blower`, …) on a tile grid where **y grows upward** and rows 0–1 are the ground. The header comment in that file lists every tile type.

Physics reference: a normal jump clears walls **2 tiles** high and gaps **4 tiles** wide; a big ball clears **3-tile** walls; a spring reaches about **5.8 tiles** up.

## Updating a deployed version

When you change any file, bump `VERSION` in `sw.js` (for example `rebound3d-v2`) so installed copies pick up the update.

## Debugging

Open the game with `?debug` in the URL to expose `window.__rebound` (state, teleport, physics simulator) in the console.
