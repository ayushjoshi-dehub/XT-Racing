# Road Rash 2026 — Pacific Run

A cinematic first-person motorcycle combat racer, playable directly in your browser. Built as a modern reimagining of EA's 1991 classic *Road Rash* using Three.js and Vite.


## 🏍️ What is this?

Road Rash 2026 puts you in the saddle of a high-performance bike on a winding Pacific coastal road. Race against 6 rivals, split through traffic, and fight your way to the front — no rules, no mercy, just the run.

## ✨ Features

- **First-person motorcycle cockpit** with detailed 3D bike model
- **Combat system** — strike rivals to clear the path to the finish
- **Nitro boost** for bursts of speed
- **6 AI riders** with independent racing behavior
- **Dynamic traffic** with cars and street-level obstacles
- **Atmospheric world** — palm trees, street lights, mountains, mist, and city buildings
- **Cinematic post-processing** — bloom, radial speed-blur, and chromatic aberration
- **Full race HUD** — position, speed, distance, gear, health, nitro
- **Pause / resume** with race stats and restart option
- **Mobile touch controls** for on-the-go play
- **Audio engine** with engine rumble and 3D spatial sound

## 🎮 Controls

| Key | Action |
|-----|--------|
| `W` / `↑` | Throttle |
| `A` / `D` | Steer |
| `Shift` | Nitro |
| `Space` | Strike (when rival is in range) |
| `P` / `Esc` | Pause / Resume |

## 🛠️ Tech Stack

- [Three.js](https://threejs.org/) — 3D rendering, post-processing, and shaders
- [Vite](https://vitejs.dev/) — dev server and build tooling
- Vanilla JS — no framework overhead, pure browser game loop

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A modern browser with WebGL 2 support (Chrome, Edge, Firefox, Safari)

### Install & Run

```powershell
# Install dependencies
npm install

# Start development server
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Build for Production

```powershell
npm run build
npm run preview
```

## 🌐 Deploy

The project is configured for static deployment. Build outputs go to `dist/` and can be hosted on any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.).

## 📦 Project Structure

```
bike racing/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.js
│   ├── global.css
│   └── game/
│       ├── RoadRashGame.js
│       ├── AudioEngine.js
│       ├── visuals.js
│       ├── constants.js
│       └── ...
```

- `src/main.js` — WebGL detection and game bootstrap
- `src/game/RoadRashGame.js` — core game loop, state machine, input, physics
- `src/game/visuals.js` — Three.js scene construction, models, environments
- `src/game/AudioEngine.js` — engine sounds, spatial audio, effects

## 🎯 Roadmap

- [ ] Online multiplayer
- [ ] Track selection (Sunset, Alpine, City Night)
- [ ] Bike customization and upgrades
- [ ] Leaderboard integration
- [ ] Mobile gyroscope steering

## 🤝 Contributing

Pull requests are welcome. Please keep changes focused and tested before submitting.

## 📄 License

MIT

---

*Built as a passion project. Not affiliated with EA or the original Road Rash.*
