# Phantasy Allure — deployment guide

This project is a small full-stack app that deploys as "static hosting": Vercel
serves `index.html` / `admin.html` directly, and also runs two serverless
functions under `/api`. Your **GitHub repo doubles as the database**
(`data/stories.json`) — no separate database service needed.

```
index.html      → public site, reads from /api/stories
admin.html       → author dashboard (PIN-protected)
api/auth.js      → checks the admin PIN
api/stories.js   → list / save / delete stories (reads & writes data/stories.json via GitHub)
api/ai.js        → proxies "Enhance / Continue" to Claude, key stays server-side
lib/storage.js   → shared GitHub Contents API helper
data/stories.json → the actual story data (starts empty, [])
```

## What changed from before

- **Fix Grammar** now calls [LanguageTool's free public API](https://languagetool.org)
  **directly from the browser** — no server proxy, no API key. It returns a list
  of issues with suggested replacements so you can review and apply each one
  individually. A LanguageTool attribution link is displayed near the results as
  required by their free API terms.
  - The rate limit on the free tier is approximately 20 requests per minute per IP.
  - Because grammar checking is now browser-side, **`ANTHROPIC_API_KEY` is no
    longer required just for Fix Grammar**. You only need it if you use Enhance or
    Continue.
- **Enhance** and **Continue** remain generative (Claude via `/api/ai`) because
  LanguageTool only detects grammar issues — it cannot rewrite or extend prose.
- **Autosave**: the editor saves itself ~15 s after you stop typing, when you
  switch panels, or when you hide the tab. A local backup is also kept in
  this browser as a safety net if the network save fails.
- **Cover images** are resized (max 900 px) and re-compressed as JPEG before
  upload, so they don't bloat storage.
- **Published stories are stored in your GitHub repo** and served to every
  visitor via `/api/stories` — not just stored in your own browser anymore.
- The PIN is checked **server-side** (`ADMIN_PIN` env var) instead of being
  hardcoded in the page source.
- **Mobile-friendly**: both `index.html` and `admin.html` are now fully
  responsive down to 320 px — the stories grid, hero, and reading modal adapt
  to one-handed phone use; the admin editor stacks to single-column on small
  screens; the stories table becomes a card list; all touch targets are ≥ 44 px.
- Fixed a pre-existing bug where `index.html`'s entire `<script>` block had a
  stray backslash before every backtick/`${...}`, which made **all** of its
  JavaScript silently fail.
- Fixed a bug where the "Continue" AI button would overwrite the whole
  chapter instead of appending to it.

---

## 1. Create the GitHub repo

1. Create a new **GitHub repository** (public or private — both work).
2. Push everything in this project folder to it (including `data/stories.json`
   with its `[]` contents — that file *must* exist in the repo).

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/<you>/<your-repo>.git
git push -u origin main
```

## 2. Create a GitHub token (so the API can write stories.json)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access**: "Only select repositories" → pick this repo.
3. **Permissions** → Repository permissions → **Contents: Read and write**.
   (Everything else can stay "No access".)
4. Generate the token and copy it — you'll paste it into Vercel in step 4.
   Treat it like a password.

## 3. Get an Anthropic API key (optional — only needed for Enhance / Continue)

1. Go to [console.anthropic.com](https://console.anthropic.com/) and create
   an API key under **API Keys**.
2. Note: this is a *separate* thing from a claude.ai subscription — it's
   billed per-use (Enhance and Continue use small, capped requests, so costs
   should be minimal for personal use, but keep an eye on usage).
3. If you only plan to use Fix Grammar, you can skip this step and omit
   `ANTHROPIC_API_KEY` from Vercel. Enhance and Continue will simply return an
   error if the key is missing.

## 4. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com/), sign in with GitHub, and **Import
   Project** → select your new repo.
2. Framework preset: leave as "Other" (no build step needed).
3. Before deploying (or right after, in **Project Settings → Environment
   Variables**), add:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | the fine-grained PAT from step 2 |
| `GITHUB_REPO` | `yourusername/your-repo-name` |
| `GITHUB_BRANCH` | `main` (or whatever your default branch is) |
| `ADMIN_PIN` | a PIN **you** choose — do not reuse `070703` |
| `ANTHROPIC_API_KEY` | the key from step 3 *(optional — only for Enhance/Continue)* |

4. Deploy. Vercel will give you a `https://your-project.vercel.app` URL.

## 5. Try it out

- Visit `/index.html` (or just `/`) — should show "The library awaits its
  first story…" with the animated background working.
- Visit `/admin.html`, enter your `ADMIN_PIN`. If you see "Server not
  configured. Missing environment variables: …", double check step 4 — env
  var changes require a redeploy (Vercel does this automatically, but it can
  take a minute).
- Write a passage and click **Fix Grammar** — LanguageTool will analyze your
  text and list any issues. Click a suggested replacement to apply it directly.
- Try **Enhance** or **Continue** if you've set up an Anthropic API key.
- Click **Publish**, then open `/index.html` in a different browser/device —
  the story should appear there too.

---

## How Fix Grammar works

Fix Grammar calls `https://api.languagetool.org/v2/check` directly from your
browser using `POST` with `Content-Type: application/x-www-form-urlencoded`
and `language: en-US`. The response's `matches` array is rendered as a list of
issues showing:

- The error message
- The affected text in context
- Clickable replacement buttons — clicking one applies that fix in-place

No text is ever sent to the Anthropic API for grammar checking. No API key is
needed. A LanguageTool attribution link is shown near the results.

**Limitations of the free tier:**
- ~20 requests per minute per IP
- Each request is capped at ~40,000 characters
- For longer chapters, split into Parts and check per part

## How saving works

When you save/publish/autosave a story, the API commits an updated
`data/stories.json` to your GitHub repo. This means:

- Every save creates a small git commit — you'll see your story history in
  the repo's commit log.
- There's a brief (sub-second to a couple of seconds) round trip to GitHub,
  so the "Saving…" indicator may show for a moment.
- If two saves happen at almost the same instant, the function automatically
  retries with the latest data.

## Known limits / things to watch

- **`data/stories.json` size**: GitHub's Contents API can only read/write
  files up to **1 MB** this way. With cover images resized to ~900 px JPEGs
  (typically 60–200 KB each as base64), that's comfortably enough for roughly
  a dozen stories with covers. If you outgrow this, the next step is moving
  images to separate files (e.g. Vercel Blob).
- **AI request size**: each Enhance / Continue call is capped at 12,000
  characters (~2,500 words) per request, to keep things fast and reasonably
  priced. For longer chapters, split into Parts and run the tool per part.
- **Single admin PIN**: there's still just one shared PIN, now validated
  server-side. Good enough for a single-author site.

## Local development

You'll get the most realistic local setup with the
[Vercel CLI](https://vercel.com/docs/cli):

```bash
npm i -g vercel
vercel link
vercel env pull .env.local   # pulls the env vars you set in the dashboard
vercel dev
```

This runs both the static pages and the `/api/*` functions locally.

## Tests

`test/run.mjs` runs the two API functions (`/api/auth` and `/api/stories`)
against a mocked GitHub API, plus the `/api/ai` function against a mocked
Anthropic API, covering auth checks, publish/draft visibility, deletes, and
AI error handling. Grammar checking is now browser-side (LanguageTool) and is
not tested here.

```bash
node test/run.mjs
```
