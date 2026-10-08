# WorldGraph

A visual map of what's happening in the world and what it means for a business: a 3D globe of events, a knowledge graph of who and what is connected, cause-and-effect cascades, and crowd forecasts.

**Try it:** _the private test link is added here when it's published._

## What you can do

- **Globe:** see where things are happening now (last 24 hours, 7 days or 30 days), filter by sector, and see the Top 5 stories. Click a country, a state or an event to go deeper. A list view shows the same thing without the map.
- **Stories and cascades:** each story says what happened, why it matters ("so what") and what to do about it. The cascade view shows what caused it and what it may cause next. Every link says whether it was **reported**, **inferred** or **projected**, and how confident it is.
- **Regions:** any country, state or city has key numbers, a sector pulse, top stories, upcoming decisions and a side-by-side compare.
- **Knowledge graph and entity pages:** companies, commodities, places, policies and how they connect. You can keep private notes on any of them.
- **Crowd forecasts:** what forecasters expect (for example, "Will the central bank cut rates by December?"), with the source, how many took part and when it last changed. These are for information only.
- **My Business:** tell it your sectors, locations, suppliers and markets (about two minutes). It then shows what affects you, an opportunity radar and alerts since your last visit.
- **Ask and Daily brief:** ask a question and get three short points with sources, or read a six-card brief.

Search with Ctrl+K (⌘K on a Mac). There are dark and light themes, and it works on a phone.

## Where the information comes from

- **Live news** every 15 minutes: GDELT (worldwide news monitoring), 22 business and official news feeds, USGS earthquakes and GDACS disaster alerts. Only headlines, links and at most one sentence are stored, never whole articles.
- **Crowd forecasts:** Manifold (play money). Real-money markets are switched off.
- **Sample data:** about 230 example stories across every sector and continent, so the app is complete before live data builds up. It is always labelled **Sample data**. You can turn it on or off in Settings.

The sources and their terms are listed in `SOURCES.md`, and the app credits them in Settings.

## AI and cost

- **Test link:** the AI (headlines, "why it matters", actions, Ask) uses **your own Claude account**, only while you have the app open. There is no separate bill. The first time, Claude asks for your permission.
- **Website (later, on Netlify):** the AI uses the Claude API with a **US$2 a day** cap. It isn't deployed until you say so.

## Your data

- Your business profile, watchlist and notes are private to you.
  - On the test link, they're saved to your Claude account.
  - On the website, they're saved in your browser.
- Nobody else can see them, and they never hold personal details beyond what you type into your profile.

## What's waiting on you

1. **Switch on live news (5 minutes):**
   1. In Supabase, open the **worldgraph** project, press **Connect**, choose **Session pooler**, and copy the connection string. Replace `[YOUR-PASSWORD]` with the database password. If you don't know it, reset it under Project Settings → Database.
   2. In GitHub, open **amanakbar65/worldgraph** → Settings → Secrets and variables → Actions → **New repository secret**.
   3. Name it `DATABASE_URL` and paste the connection string as the value.

   The **Live data** job (Actions tab) then runs every 15 minutes.
2. **Before a public launch** (decisions for you):
   - check the news feeds' terms for commercial use;
   - ask Manifold about commercial use;
   - confirm GDACS's reuse licence;
   - get an Anthropic API key and set a budget;
   - give the go-ahead to deploy on Netlify.

## For developers

Start with `CLAUDE.md` (layout, commands, conventions), then `PLAN.md` (the design), `CHECKPOINT.md` (current state) and `PROGRESS.md` (history).

- **Backend:** Python 3.12 with uv. The SQL migrations hold the `api.*` functions every screen reads, and the live pipeline runs on GitHub Actions.
- **Frontend:** Vite, React and TypeScript, built as both the claude.ai test link and the website.
