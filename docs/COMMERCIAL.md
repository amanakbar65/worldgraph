# WorldGraph: commercial setup and running costs

Prices were checked on official pages on 22–23 Oct 2026 and are in US dollars before tax. ⏳ means unconfirmed. Re-check before signing up.
The owner's rule: everything here is built in and switched off until launch, so launching means adding keys and turning switches on, not building.

## 1. Launch-ready services (recommended stack)

| Need | Pick | Cost | Why | Alternatives |
|---|---|---|---|---|
| Database, sign-in, file storage | **Supabase Pro** | $25 a month plus compute (includes $10 compute credit, 8 GB disk then $0.125/GB, 250 GB egress, 100k sign-ins a month, daily backups kept 7 days) | Already in use. PostGIS, pgvector and auth in one place | Neon (database only); self-hosting |
| Archive of older raw data | **Cloudflare R2** | $0.015/GB-month, first 10 GB free, **no egress fees** | 100 GB of Parquet costs about $1.35 a month | Supabase Storage, AWS S3 |
| Website and server functions | **Netlify** Free now, Pro $20–63 at launch (credit tiers) | 15 credits per production deploy, 20 per GB of bandwidth | Already in use. Deploys only run on `[deploy]` commits to save credits | Cloudflare Workers ($5) for AI streaming at scale; Vercel Pro |
| Pipeline every 15 minutes | **GitHub Actions** (free while the repo is public) | $0 now. A private repo costs about $40 a month, or use a Hetzner VPS from €6.49 | Already in use | Render cron |
| AI | **Claude Haiku 5.5** for sorting news, **Claude Sonnet 5.5** for cascades, Ask and summaries; Batch API (50% off) and prompt caching | Haiku $0.10 in / $0.50 out per million tokens; Sonnet $2 / $10; cache reads cost a tenth of input | Best cost per useful answer; one key covers both | Opus 5.5 ($4 / $20) for the hardest analysis only |
| Embeddings (similar stories and duplicate entities) | **Voyage voyage-4-lite** | $0.02 per million tokens, 200M free tokens per account | Effectively free at our volume | Local model (free, uses pipeline CPU) |
| Payments, worldwide, run from India | **Paddle** (merchant of record) | 5% + 50¢ per payment | Handles VAT and GST in every country; open to Indian sellers. Stripe India takes new accounts by invite only | Dodo Payments (4% + 40¢); add Razorpay later for UPI in India |
| Domain and DNS | **Cloudflare Registrar** | .com $10.46 a year (**rises to about $11.17 on 1 Nov 2026**); DNS and email forwarding free | **worldgraph.com is available** (checked 23 Oct; .ai, .app, .io and .co are taken) | Namecheap |
| Email (sign-in links, alerts, digests) | **Resend** | Free for 3k a month; Pro $20 for 50k | Also sends Supabase sign-in emails | Postmark |
| Error tracking | **Sentry** | Free (5k errors); Team $26 | | |
| Product analytics | **PostHog** | Free for 1M events a month | Funnels and session replays, with privacy settings | Plausible ($9) |
| Uptime and status page | **Better Stack** (free, commercial use ⏳) | Free; UptimeRobot $12 | Also alerts if the pipeline stops | |
| Privacy policy, terms, cookies | **Termly** | $10–15 a month | Needed before taking payments; India's DPDP law mostly applies from about May 2027 | iubenda |

### Built in now, switched on at launch
Each service sits behind an adapter and a flag, so the app runs fully without it:
- payments;
- sign-in;
- email;
- analytics;
- errors;
- archive storage;
- paid data feeds.

Turning one on takes three steps:
1. Add its key to Netlify and GitHub.
2. Flip the flag.
3. Follow the steps in `docs/LAUNCH.md`.

The code, settings screens and tests ship before launch. Phase L in PLAN.md lists everything.

## 2. Data sources

**Free, safe for commercial use (adopt in this order):**
1. **Wikidata** (CC0) and **GLEIF LEI** (CC0): companies, industries, headquarters, and parent/subsidiary ownership.
2. **CEPII BACI** (commercial use allowed, must cite): exports between countries by product, with value, tonnes and year. Plus **World Bank WDI and Pink Sheet** (CC BY) for country indicators and monthly commodity prices.
3. **SEC EDGAR** (public domain): subsidiaries, major shareholders, and revenue by region, which gives company→country exposure.
4. **IMF PortWatch** (daily traffic through 28 chokepoints; email the IMF for commercial permission) and the **World Port Index** (3,700 ports).
5. **UCDP** (CC BY) conflict events and **official sanctions lists** (OFAC, UK, EU, UN).
6. **EIA**, **USDA PSD** (public domain): energy and crop supply, stocks and prices.
7. Plus GDELT events (already in use, free) and Global Energy Monitor (plant and mine owners, CC BY; check commercial use).

**Avoid for display, or license first:**
- UN Comtrade and WITS (internal use only; show BACI instead).
- ACLED, IEA datasets, FAOSTAT for commercial promotion, and OpenSanctions bulk data (non-commercial licence).
- Metaculus, and Manifold (needs an agreement at launch).
- Real-money forecast markets stay off.

**Paid, worth adding at launch:**

| Source | Adds | Cost |
|---|---|---|
| **Twelve Data Venture** | Prices for stocks, currencies and commodities, with the right to show them publicly | $149–499 a month |
| **NewsAPI.ai** (Event Registry) | News already tagged with entities, so cause-and-effect links are cleaner and duplicates rarer | $90 a month |
| Metals-API | Metal prices | $20–100 a month |

**Paid, at growth:**

| Source | Adds | Cost |
|---|---|---|
| OpenCorporates | Registry-verified company facts | £2,250–12,000 a year |
| Diffbot | Company graph with investors and subsidiaries | $299–899 a month |
| OpenSanctions licence | Sanctions and politically exposed people | €500–1,500 a month ⏳ |
| ImportGenius | Supplier→buyer links from US customs records | $229–1,999 a month |

**Enterprise only, later:** Kpler or Vortexa (ship-by-ship cargo flows), Orbis or PitchBook (deep ownership and private markets), Reuters or Bloomberg. Each costs five to six figures a year.

## 3. Storage plan (permanent and money-efficient)

| Tier | What | Where | Size |
|---|---|---|---|
| Hot | The last 90 days of stories, articles (headline, link, one-line snippet) and links; the change log | Supabase Postgres | About 0.6 GB |
| Knowledge, kept for ever | Entities, properties, ownership and trade links, the influence graph (rolled-up cause and effect), indicators, AI summaries, loops | Supabase Postgres | 0.5–2 GB, growing slowly |
| Archive | Everything older than 90 days | Cloudflare R2 as Parquet files, read by the pipeline for long-term insights | About 2.5 GB a year, about $0.40 a month |

- Today the database is 122 MB after 16 days of live news.
- The free plan (500 MB) lasts until the data enrichment lands. Then Supabase Pro is needed at **about $25–30 a month**.
- Full article text is never stored.

## 4. The AI "clock" (keeps the graph growing and accurate)

| Job | How often | Model | Cost estimate |
|---|---|---|---|
| Sort every new story (business-relevant? which entities?) | Every 15 min, batched | Haiku 5.5 | about $3 a month |
| Cause-and-effect analysis of the ~200 most important stories a day | Hourly batch | Sonnet 5.5 (Batch API, cached) | about $35 a month |
| Influence-graph roll-up, loop detection, insights (no AI needed) | Nightly | SQL | $0 |
| Entity upkeep: summaries and properties refreshed from sources, with citations | Nightly, only for changed entities | Haiku 5.5, Sonnet for top entities | about $8 a month |
| Re-check old links (still true? contradicted?) | Weekly | Haiku 5.5 | about $3 a month |
| "What changed" digest and cluster labels | Daily and weekly | Sonnet 5.5 | about $5 a month |

**Total: about $50–60 a month**, which fits the existing $2-a-day cap.

- Today, without a pipeline AI key, only 28 of ~4,650 live stories have been analysed, and only 3 live cause-and-effect links exist.
- The clock needs a Claude API key in GitHub's secrets.

## 5. Monthly running cost

| | Testing (now) | Launch (~1k users) | Growth (~10k users, 300 paying) | Scale (~50k users, 2k paying) |
|---|---|---|---|---|
| Hosting, database, email, monitoring, legal, domain | $0–30 | $60–140 | $220–300 | $600–1,000 |
| AI: clock and users' questions | $50–60 | $80–150 | $300–600 | $1,400–2,700 |
| Data feeds | $0 | about $250 (Twelve Data and NewsAPI.ai) | $500–1,500 lean, $3,000–4,000 full | $3,000–5,000 |
| **Total** | **≈ $50–90** | **≈ $390–540** | **≈ $1.0k–2.4k lean** | **≈ $5k–8.7k** |
| Payment fees (Paddle) | – | small | about $375 | about $2,500 |

## 6. How it pays for itself (suggested plans)

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Globe, stories, cascades, graph, forecasts; 5 Ask questions a day (Haiku) |
| Pro | $15 a month or $144 a year (local pricing in India, such as ₹499) | Unlimited Ask (fair use, Sonnet), what-if, alerts and digests, saved lenses and trails, exports, history |
| Team | $49 per seat per month | Shared boards and lenses, team alerts, priority data |
| Learner | 50% off with a student email | Pro features |

**Break-even** (after Paddle's fee of about $13.75 per $15 subscription):
- launch: about 30–40 paying users;
- lean growth: about 75–175;
- scale: 400–650, against 2,000 assumed.
