# Lennox Jett — Setup & Deployment

## What's in here
- `server.js` — the backend: handles signup, login, sessions, and serves your site
- `public/` — everything people see: homepage, sign in, create account, dashboard
- `data/` — where the database file gets created automatically (don't touch it)
- No external packages needed — runs on plain Node.js, nothing to install

## Running it on your own computer (to test)
1. Install Node.js if you don't have it: https://nodejs.org (get the LTS version)
2. Open a terminal in this folder
3. Run: `node server.js`
4. Open your browser to `http://localhost:3000`

Try creating an account, signing out, and signing back in to confirm it works.

## Putting it live on the internet
This is a real backend, so it needs a host that can run Node.js — not the same
as the free static-site hosts (Netlify, GitHub Pages) that only serve plain files.

Easiest free/cheap options that run Node.js servers:
- **Render** (render.com) — free tier, connect it to a GitHub repo, it runs `node server.js` for you
- **Railway** (railway.app) — similar, usage-based pricing after free trial

Steps (Render, roughly):
1. Put this folder in a GitHub repository
2. On Render, create a new "Web Service", connect the repo
3. Set the start command to `node server.js`
4. Deploy — Render gives you a live URL

**Important:** the database file (`data/lennoxjett.db`) lives on the server's
disk. Some free hosting tiers wipe the disk on restart, which would delete all
your accounts. If you outgrow the free tier, ask about moving to a hosted
database (like Postgres) — that's a small follow-up change, not a rebuild.

## What still needs to be connected
- **PayPal payments** — the "Pay with PayPal" buttons on the homepage are
  placeholders right now. Once you have a PayPal Business account, this can
  be wired to actually confirm payment and flip a user's `has_paid` flag in
  the database.
- **Bank transfer** — inherently manual: you'll check your bank account and
  update a customer's access by hand. There's no automatic way around this.
