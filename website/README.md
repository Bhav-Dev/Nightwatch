# SnoreHive website

The marketing site: a static [Astro](https://docs.astro.build) build with its own package, separate from the app and the server. The pages follow the "SnoreHive website" design (home, a remedy page, the articles index and an article), with the same tokens and components reused for the other pages.

## Run it

Needs Node 22.22 or later.

```bash
cd website
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview   # serve dist/ locally
```

`npm run build:artifact` makes a copy in `dist-artifact/` with relative links, for previewing the site from a folder (such as a Claude Artifact). The real site does not need it.

## Pages

| URL | Source |
| --- | --- |
| `/` | `src/pages/index.astro` |
| `/remedies`, `/remedies/<id>` | `src/pages/remedies/`, content in `src/content/remedies/` |
| `/articles`, `/articles/<id>` | `src/pages/articles/`, content in `src/content/articles/` |
| `/methods` | `src/pages/methods.astro` (the old `site/methods.html`, folded in) |
| `/when-to-see-a-gp` | `src/pages/when-to-see-a-gp.astro` |
| `/privacy`, `/terms` | Stubs until the legal text is written |
| `/affiliate-disclosure`, `/contact` | Short pages; contact is an email address |
| `/auth` | Hands an email sign-in link over to the app (see below) |
| `/data/<id>.csv` | An article's figures, linked from the article once the figures are real |

URLs have no trailing slash (`/methods`), which is the form the app links to.

## Layout

```
website/
  astro.config.mjs        site URL, sitemap, MDX
  vercel.json             skip unrelated builds, headers
  public/                 favicons, og.png, store badges, the Nunito font
  scripts/
    make-assets.mjs       rebuilds the badge, favicons and og.png
    relative-links.mjs    used by build:artifact
  src/
    config.ts             store links, app scheme, contact email, prices
    data/community.ts     every community figure the site shows (sample numbers for now)
    content.config.ts     the remedies and articles collections
    content/              remedies/*.md, articles/*.md and *.mdx
    components/           shared pieces; components/article/ holds the charts
    layouts/              Base (every page), Doc (reading pages)
    lib/                  formatting, hexagon paths, content helpers
    pages/                one file per route
    styles/global.css     colour tokens, type and layout
```

## The community figures are sample numbers

Every figure the site shows (remedy rankings, people and night counts, the alcohol article's charts) comes from `src/data/community.ts`. None of them are real yet. While `sample` is `true` there, every page that shows figures says they are sample figures, and charts are captioned as illustrative.

When the nightly aggregates exist:

1. Copy the real figures into `src/data/community.ts`.
2. Rewrite each remedy's `shortAnswer` so it matches its numbers.
3. Check the alcohol article still reads true. Its numbers in the text (the points, the hour) are worked out from the data, but its sentences are not.
4. Set `sample` to `false`. The article's CSV download link then appears.

The sample-size rules match `/methods`: 30 people and 300 nights for a ranked result, 10 for early data, and no figure under 10.

## Add an article

Make a file in `src/content/articles/`. The file name is the URL.

```md
---
title: Do warm, humid nights change snoring?
description: One sentence for search results and link previews.
topic: weather            # remedies, habits, weather or monthly
date: 2026-11-04
readMinutes: 5
cover: weather            # drinks, cells, weather, weeks, hours, tests or month
---

The article in Markdown.
```

- Use `.mdx` to put charts or a callout in the text. `alcohol-and-snoring.mdx` shows how.
- `status: planned` lists the article as coming soon, with no page of its own. The six other cards on the index are planned like this.
- `featured: true` puts it in the large card at the top of the index. Only one article should be featured.
- `home: 4` with `question: …` adds it to the home page's questions, in that position.
- Charts read their figures from `src/data/community.ts`. Add the article's data there, and add its key to the `figures` enum in `src/content.config.ts`.

Copy rules: sentence case, no exclamation marks, and no medical claims. SnoreHive measures snoring and shows patterns; never say it diagnoses anything or detects apnoea. Every article ends with the GP line.

## Add a remedy

Make `src/content/remedies/<id>.md` with `question`, `label`, `description` and `steps` (see `mouth-tape.md`). Add its figures under the same `<id>` in `src/data/community.ts`. The page then appears on `/remedies`, and on the home page's ranking once it has enough people. Set `amazonUrl` to show a shop button; none are set yet.

## Placeholders to fill

- **Domain.** Local builds use `https://snorehive.example`. On Vercel the production domain is picked up automatically (see below).
- **Contact email.** `hello@snorehive.example` until `PUBLIC_CONTACT_EMAIL` is set at build time.
- **Store listings.** The badges link to the real App Store and Google Play listings, which are not live yet. Set `stores.live` to `true` in `src/config.ts` on launch day to drop the "coming soon" line.
- **Privacy and terms.** Stubs that say the full text will be published before release. Write the real text with whoever handles legal; do not ship without it.
- **Figures.** Sample numbers, as above.
- **Amazon links.** None. The affiliate disclosure page and footer line are ready for them.

## Assets

The store badges in `public/badges/` are the official ones from Apple and Google; keep their artwork unchanged. `scripts/make-assets.mjs` rebuilds the trimmed Google Play badge, the favicons and `og.png`:

```bash
node scripts/make-assets.mjs <path to Google's en_badge_web_generic.png> <path to Nunito[wght].ttf>
```

Either argument can be left out to skip that step. Nunito is under the SIL Open Font License (`public/fonts/Nunito-OFL.txt`).

## Email sign-in: /auth

The server's sign-in email links to `${APP_LINK_BASE}/auth?token=…`. With `APP_LINK_BASE` set to the site's address, the link opens `/auth`, which:

- removes the token from the address bar straight away, and sends no referrer;
- on a phone, opens `nightwatch://auth?token=…` and shows an "Open SnoreHive" button in case the app did not open;
- on a computer, asks the person to open the email on their phone, because the app is not there.

The page is not indexed, is left out of the sitemap, and loads no analytics. If analytics are ever added to the site, keep them off this page.

## Deploy on Vercel

The site deploys as plain static files. It needs no adapter and no rewrites.

**Project settings** (Vercel dashboard, New Project, import this repository):

- **Root Directory:** `website`
- **Framework Preset:** Astro
- **Build Command, Output Directory, Install Command:** leave the defaults (`npm run build`, `dist`, `npm install`)
- **Production Branch:** `claude/ecstatic-carson-2trne4`, under Settings, Git
- **Environment variables:** none needed

`vercel.json` does three things:

- **Skips unrelated builds.** Its `ignoreCommand` skips a build when a push changes nothing under `website/`.
- **Removes trailing slashes.** It redirects `/methods/` to `/methods`.
- **Sets headers.** It keeps `/auth` out of search results and caches. It also serves `/.well-known/apple-app-site-association` as JSON, ready for when that file is added to `public/.well-known/` for iOS universal links. The file needs the Apple Team ID and the app's associated-domains entitlement, so it is not here yet.

**The site's address.** Astro uses it for canonical links, Open Graph tags, the sitemap and robots.txt. `astro.config.mjs` takes `SITE_URL` when it is set. Otherwise it uses Vercel's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), and otherwise the placeholder. On Vercel this means the right domain with no setup: first the `*.vercel.app` address, then the custom domain once it is the project's production domain. `SITE_URL` is only needed to force a different address.

**Custom domain.** In the project, go to Settings, Domains and add the domain. Then add the DNS records Vercel shows at your registrar: an A record for the apex domain, or a CNAME for a subdomain such as `www`. Vercel issues the certificate itself. If you add both the apex and `www`, set one to redirect to the other. The next deploy picks up the new production domain.

**After the domain is live:**

1. Set the server's `APP_LINK_BASE` to `https://<domain>` (see `server/README.md`), so sign-in emails go through `/auth` rather than straight to `nightwatch://`, which many email apps will not open.
2. Set the app's `EXPO_PUBLIC_SITE_URL` to `https://<domain>` for its next build. It still defaults to `https://nightwatch.app`, and the app uses it for its Terms, Privacy, Methods and affiliate disclosure links.
