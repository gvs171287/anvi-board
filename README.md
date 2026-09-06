# School Days — setup & push to GitHub

This folder has your component (`src/App.jsx`), the GitHub Actions deploy workflow
(`.github/workflows/deploy.yml`), and the Cloudflare Worker proxy (`cloudflare-worker.js`)
already in place. A few steps turn this into a real Vite project and push it live.

## 1. Turn this into a working Vite project

From a terminal, in a fresh folder (not this one):

```
npx create-vite@latest school-calendar -- --template react
cd school-calendar
npm install
npm install lucide-react
npm install tailwindcss @tailwindcss/vite
```

Then:
- Add the Tailwind Vite plugin to `vite.config.js` (see Tailwind's "Get started with Vite" docs — it's one import + one line in the plugins array)
- Add `@import "tailwindcss";` as the first line of `src/index.css`
- Replace the generated `src/App.jsx` with the `src/App.jsx` from this folder
- Copy `.github/workflows/deploy.yml` from this folder into your new project (same path)
- Copy `cloudflare-worker.js` into your new project's root (it's not part of the build, just kept alongside for reference)

Test it locally: `npm run dev`, open the printed localhost URL.

## 2. Set up the Cloudflare Worker (for the AI extraction feature)

1. Go to dash.cloudflare.com → Workers & Pages → Create Worker
2. Paste in `cloudflare-worker.js`
3. Settings → Variables → add secret `ANTHROPIC_API_KEY` with your key from console.anthropic.com
4. Deploy, copy the Worker's URL

## 3. Push to GitHub

```
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repo on github.com (no README/gitignore, so it stays empty), then:

```
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## 4. Add your Worker URL as a GitHub secret

In your repo: Settings → Secrets and variables → Actions → New repository secret
- Name: `VITE_API_PROXY_URL`
- Value: your Cloudflare Worker URL from step 2

## 5. Enable GitHub Pages

In your repo: Settings → Pages → under "Build and deployment", set Source to "GitHub Actions".

Push a commit (or re-run the workflow under the Actions tab) and your app goes live at:

```
https://YOUR_USERNAME.github.io/YOUR_REPO_NAME
```

usually within a minute or two.
