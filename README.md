# Y$ER Futures Risk Calculator

A glassmorphism-styled futures risk & position-sizing calculator for NQ, ES, YM, RTY, GC, and SI (plus their micros), with a live session tracker (Asia Range, London Killzone, NY Killzone, Weekend).

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL it prints (usually http://localhost:5173).

## Build for production

```bash
npm run build
```

Output goes to the `dist/` folder.

## Deploy to GitHub Pages

1. Install the gh-pages helper:
   ```bash
   npm install --save-dev gh-pages
   ```
2. Add these two lines to `package.json`:
   ```json
   "homepage": "https://<your-username>.github.io/<repo-name>",
   "scripts": {
     "predeploy": "npm run build",
     "deploy": "gh-pages -d dist"
   }
   ```
3. Push your code to GitHub first (see below), then run:
   ```bash
   npm run deploy
   ```
4. In the GitHub repo settings, under **Pages**, set the source branch to `gh-pages`.

Your live app will be at `https://<your-username>.github.io/<repo-name>`.
