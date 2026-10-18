# PowerHouse on Google Play

The Play Store app is a **Trusted Web Activity**: a thin Android shell that opens the hosted PWA
full-screen in Chrome. There is no second codebase. A `firebase deploy` updates the Android app,
the iPhone home-screen app and the website at once — the "fixed at 09:15, live for the 09:30
client" property survives the store. A store release is only needed when this shell changes
(icon, name, package settings, target SDK).

What is already done in the repository:

| | |
|---|---|
| Service worker | Precaches the build, opens offline, never auto-reloads (`src/pwa/serviceWorker.ts`) |
| Fonts | Self-hosted; nothing loads from Google at runtime |
| Back gesture | Closes an open sheet instead of leaving the screen (`src/ui/Sheet.tsx`) |
| Account deletion | In-app (both panels) + `/delete-account` page + `delete-account` Edge Function |
| Privacy policy | `public/privacy.html` — **a draft with `[brackets]` to fill in** |
| Asset links | `public/.well-known/assetlinks.json` — **fingerprints to fill in** |
| Hosting | `firebase.json` no longer ignores dotfiles, so `.well-known/` actually deploys |
| Icons | `public/icons/*`, and `store/play-icon-512.png` for the listing |

Everything below needs your accounts, your keys or your decisions.

---

## 0. Decide two things first — neither can change later

1. **The domain.** The app's host is compiled into the Android package. Moving from
   `*.web.app` to `app.powerhouse.gr` later means a new store release *and* a new
   `assetlinks.json` on the new domain. Pick the final one now and connect it in
   Firebase Hosting → Add custom domain.
2. **The package id.** `gr.powerhouse.app` is what `assetlinks.json` currently says. It is
   permanent once uploaded. Use a reverse domain you control.

## 1. Play Console account

- One-time $25 at <https://play.google.com/console>.
- **Personal account**: before your first production release you must run a **closed test with
  at least 12 testers opted in for 14 days in a row**. Start recruiting on day one.
- **Organization account**: exempt from that, shows the business name, needs a free
  D-U-N-S number (takes days to weeks — apply now if you invoice as a business).

## 2. Supabase (see `supabase/README.md` for each step)

1. Paste `trainhub-αθλητες-στην-εφαρμογη.sql` (migration 012) in the SQL editor.
2. Authentication → URL Configuration: Site URL = your domain; add
   `https://<domain>/auth/callback` to Redirect URLs.
3. Authentication → Providers: enable **Google** and **Azure** (Microsoft) with their client
   ids. Then set `VITE_AUTH_PROVIDERS=google,azure` for the build.
4. Deploy the Edge Function: `supabase functions deploy delete-account` and
   `supabase secrets set APP_ORIGIN=https://<domain>`.

## 3. Build the Android package

```bash
npm i -g @bubblewrap/cli
mkdir powerhouse-twa && cd powerhouse-twa      # outside this repository
bubblewrap init --manifest https://<domain>/manifest.webmanifest
```

Answers to the prompts:

| Prompt | Answer |
|---|---|
| Domain | your final domain, no `https://` |
| URL path | `/` |
| Application name | `PowerHouse` |
| Short name | `PowerHouse` |
| Application ID | `gr.powerhouse.app` (or your own — then update `assetlinks.json`) |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Status bar colour | `#F4F0E7` |
| Splash screen colour | `#F4F0E7` |
| Icon URL | `https://<domain>/icons/icon-512.png` |
| Maskable icon URL | `https://<domain>/icons/icon-maskable-512.png` |
| Include support for Play Billing | **No** — gyms are invoiced outside the app |
| Request geolocation permission | No |
| Key store | create a new one; **back it up off this machine with both passwords** |

Then:

```bash
# Google Play rejects new apps and updates that target below API 36 (since 31 Aug 2026).
grep -n targetSdkVersion app/build.gradle      # raise it to 36 if Bubblewrap wrote less
bubblewrap build                               # → app-release-bundle.aab
bubblewrap fingerprint list                    # your UPLOAD key's SHA-256
```

## 4. Asset links — the step everyone gets wrong

Android only hides the URL bar if `https://<domain>/.well-known/assetlinks.json` lists the
certificate **the installed app is signed with**. With Play App Signing that is *Google's* key,
not the one on your laptop:

1. Upload the `.aab` to the **Internal testing** track first.
2. Play Console → your app → Test and release → App integrity → **App signing key certificate**
   → copy the SHA-256.
3. Put it, and your upload key's SHA-256 from step 3, into `public/.well-known/assetlinks.json`
   in place of the two `REPLACE:` lines. Deploy.
4. Check: <https://developers.google.com/digital-asset-links/tools/generator>.

Symptom of getting it wrong: the app works in testing and shows a browser URL bar in production.

## 5. Store listing and forms

- **Listing** (Greek, plus English): name, 80-character short description, full description,
  `store/play-icon-512.png`, a 1024×500 feature graphic, at least two phone screenshots.
  Take screenshots from `npm run dev` with no `.env` — it runs on the seeded demo gym, so no
  real athlete appears in a public listing. Settings → "Δες την εφαρμογή ως αθλητής" shows the
  athlete panel.
- **Privacy policy URL**: `https://<domain>/privacy` (after filling in the brackets).
- **App access**: give the reviewer a username and password — a demo trainer account, created
  the way Streamlit creates trainers. The reviewer cannot receive an email code.
- **Data safety**: collects name, email address, and health & fitness data (workouts; notes may
  mention injuries); encrypted in transit; users can request deletion; not shared (Supabase
  and Firebase are processors, which Play does not count as sharing); no ads.
- **Account deletion URL**: `https://<domain>/delete-account`.
- **Health apps declaration**: fitness tracking, not a medical device.
- **Target audience**: 18+. **Content rating**: complete the questionnaire. **Ads**: none.

## 6. Release path

Internal testing (your trainers, instant) → Closed testing (12 testers × 14 days on a personal
account) → Production.

Payments: do not add a price, an upgrade button or a link to pay inside the app — selling access
in an Android app goes through Play Billing. Invoice gyms outside it.
