# PowerHouse on Google Play and the App Store

One codebase, three outlets:

| Outlet | What it is | How it updates |
|---|---|---|
| Website / PWA | `dist/` on Firebase Hosting | `firebase deploy` |
| Android app | Capacitor shell in `android/`, the same `dist/` inside it | Capgo live update, or a Play release |
| iPhone app | Capacitor shell in `ios/`, the same `dist/` inside it | Capgo live update, or an App Store release |
| Streamlit pilot | `streamlit/`, untouched by all of this | Merge to `main` |

The store apps load the build **from the phone**, not from the website. That is what makes them
pass App Review (a remote-website wrapper is rejected under 4.2) and what makes them open with no
signal. The price: a website deploy does not reach them by itself — Capgo does (§5).

Order: **Android first.** iOS needs a Mac (or a cloud Mac) and $99/year, and nothing in the
Android path depends on it.

---

## 0. Decisions that cannot change later

1. **App id `gr.powerhouse.app`.** Permanent in both stores the moment it is uploaded. It is also
   the sign-in return scheme (`gr.powerhouse.app://auth/callback`). Changing it means changing
   `capacitor.config.ts`, `APP_SCHEME` in `src/native/platform.ts`, the intent filter in
   `android/app/src/main/AndroidManifest.xml`, `CFBundleURLSchemes` in `ios/App/App/Info.plist`
   and the Android `applicationId` / Xcode bundle id — before the first upload, never after.
2. **The domain.** Every invite and share link the app hands out is built from
   `VITE_PUBLIC_ORIGIN`. Pick the final one (`app.powerhouse.gr`, not `*.web.app`) and connect
   it in Firebase Hosting → Add custom domain.
3. **Play account type.** *Personal*: before the first production release, a **closed test with
   at least 12 testers opted in for 14 days in a row** — start recruiting on day one.
   *Organization*: exempt, needs a D-U-N-S number (days to weeks).

## 1. Supabase — once, for both stores

1. Paste `trainhub-αθλητες-στην-εφαρμογη.sql` (015) if it has not been pasted.
2. Authentication → URL Configuration → Redirect URLs, add **both**:
   - `https://<domain>/auth/callback` (website)
   - `gr.powerhouse.app://auth/callback` (store apps)
3. Authentication → Providers:
   - **Google**: in Google Cloud, a *Web* OAuth client (not Android/iOS — the flow runs through
     Supabase), redirect URI = the callback Supabase shows.
   - **Azure** (Microsoft): unchanged from the website.
   - **Apple** — required for the iPhone app: App Review rejects an app that offers Google
     sign-in without Sign in with Apple (4.8). In developer.apple.com: an App ID with *Sign in
     with Apple*, a **Services ID** (its return URL = the Supabase callback), and a **key**.
     Supabase generates the client secret from the key — **it expires after 6 months**; put a
     reminder in the calendar now, or every Apple sign-in fails on that day.
4. `supabase functions deploy delete-account` and `supabase secrets set APP_ORIGIN=https://<domain>`.

## 2. Build settings for the store apps

`.env.production` (never committed):

```bash
VITE_SUPABASE_URL=…
VITE_SUPABASE_ANON_KEY=…
VITE_USERNAME_DOMAIN=powerhouse.gr
VITE_AUTH_PROVIDERS=google,azure,apple
VITE_PUBLIC_ORIGIN=https://<domain>
```

Without `VITE_PUBLIC_ORIGIN` every link the app shares points at `https://localhost`.

```bash
npm ci
npm run native:sync        # vite build + cap sync: dist/ → android/ and ios/
```

## 3. Android

### 3.1 Tools
Android Studio (it brings the SDK and JDK 21). `npm run native:android` builds, syncs and opens
the project. Run it on a real phone first: sign in as a trainer, log a set offline, come back
online, sign in as an athlete with Google.

### 3.2 Icons and splash
Generated from the PH mark in `public/icons/icon.svg`; the sources are in `assets/`. After
changing them:

```bash
npx @capacitor/assets generate --android --ios \
  --iconBackgroundColor '#5E7355' --iconBackgroundColorDark '#5E7355' \
  --splashBackgroundColor '#F4F0E7' --splashBackgroundColorDark '#161922'
git checkout android/app/src/main/AndroidManifest.xml   # the tool reformats it; keep ours
```

### 3.3 Version
`android/app/build.gradle` → `versionCode` (integer, +1 on **every** upload) and `versionName`
(what people see). A live update does not touch either.

### 3.4 Signing
Android Studio → Build → Generate Signed App Bundle → create a **new upload keystore**. Back it up
off the laptop with both passwords. With Play App Signing (default) Google holds the real key; a
lost upload key can be reset through support, a lost app-signing key could not.

Output: `android/app/release/app-release.aab`.

### 3.5 Play Console
- Create the app → **Internal testing** → upload the `.aab`. Your trainers get it in minutes.
- **Listing** (Greek, plus English): 80-character short description, full description,
  `store/play-icon-512.png`, a 1024×500 feature graphic, ≥2 phone screenshots. Take the
  screenshots from `npm run dev` with no `.env` — the seeded demo gym, so no real athlete appears
  in a public listing. Settings → «Δες την εφαρμογή ως αθλητής» shows the athlete panel.
- **App access**: a reviewer username + password (a demo trainer, created the way Streamlit
  creates trainers). The reviewer cannot receive an email code.
- **Privacy policy**: `https://<domain>/privacy` (fill in the `[brackets]` in `public/privacy.html`).
- **Account deletion URL**: `https://<domain>/delete-account`. In-app deletion exists in both panels.
- **Data safety**: collects name, email, health & fitness (workouts; notes may mention
  injuries); encrypted in transit; deletable on request; not shared (Supabase and Firebase are
  processors); no ads. `allowBackup` is off, so nothing goes to Google Drive backups.
- **Health apps declaration**: fitness tracking, not a medical device.
- **Target audience** 18+, content-rating questionnaire, ads: none.
- Path: Internal → Closed (12 × 14 days if personal) → Production.

### 3.6 Optional: links open in the app
Invite and share links open in the browser today, which works. To open them in the app instead
(Android App Links), add to `MainActivity` in `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="<domain>" android:pathPrefix="/welcome" />
  <data android:pathPrefix="/join" />
</intent-filter>
```

and put the **App signing key** SHA-256 (Play Console → App integrity) into
`public/.well-known/assetlinks.json`. `src/native/links.ts` already routes such a link in place.
This is a native change: it ships with a store release, not a live update.

## 4. iOS — when you decide it is needed

### 4.1 What it costs
- Apple Developer Program, $99/year, enrolled as an **organization** if the business has a
  D-U-N-S number (the listing then shows the business name).
- A Mac with current Xcode. No Mac: a macOS CI runner (GitHub Actions `macos-latest`,
  Codemagic, Ionic Appflow) can build and upload; you still need Xcode once for signing setup
  unless the CI does automatic signing with an App Store Connect API key.

### 4.2 Build
```bash
npm run native:ios     # opens ios/App/App.xcodeproj (Swift Package Manager, no CocoaPods)
```
In Xcode → target *App* → Signing & Capabilities: your team, bundle id `gr.powerhouse.app`.
Version / Build in the General tab (Build +1 on every upload). Product → Archive → Distribute
→ App Store Connect → **TestFlight** first.

### 4.3 App Store Connect
- **App Privacy** labels: the same data as Play's data safety form, *linked to the user*, not
  used for tracking.
- **Sign-in information for review**: a demo trainer username and password, and one sentence:
  «Trainers sign in with a username and password issued by the gym; athletes sign in with
  Google, Microsoft, Apple or email after an invite.» Without it the review stops at the
  sign-in screen and is rejected.
- **Account deletion**: in-app, already there (5.1.1(v)).
- **Export compliance**: `ITSAppUsesNonExemptEncryption = false` is set (HTTPS only).
- No price, upgrade button or payment link inside the app — on either store. Gyms are invoiced
  outside it.

## 5. Live updates (Capgo)

What it does: a merged change to `src/` reaches installed store apps without a store review,
downloaded in the background and applied **when someone taps the update banner** — the same
banner and the same «not while the outbox holds writes» rule as the website
(`src/native/liveUpdate.ts`, `autoUpdate: 'onlyDownload'`).

What it cannot do: anything native — a new plugin, a permission, the icon, the app id, the
manifest. Those need §3/§4 again. Capgo refuses a bundle built against another native version.

Both stores allow this for JS/HTML/CSS that does not change what the app is for (Apple's
Developer Program License Agreement on interpreted code,
Play's device-and-network-abuse policy). Shipping a new *purpose* through it is how you lose the
listing.

Setup, once:
```bash
npx @capgo/cli@latest login <API key from capgo.app>
npx @capgo/cli@latest app add gr.powerhouse.app
```

Every release of the web code:
```bash
npm run build
npx @capgo/cli@latest bundle upload --channel production --delta
```

Capgo is a paid service after the trial; check current pricing. The plugin can point at a
self-hosted update server instead (`updateUrl` in `capacitor.config.ts`) if that ever matters.

## 6. Which change needs what

| Change | Website | Store apps |
|---|---|---|
| Screen, text, logic in `src/` | `firebase deploy` | Capgo upload |
| New Capacitor plugin, permission, icon, splash, app name | — | store release (§3/§4) |
| SQL migration | paste in Supabase | nothing (the capability probe covers the gap) |
| Streamlit | merge to `main` | — |

## 7. Repository notes

- `android/` and `ios/` are generated by `npx cap add` and then **edited by hand** (scheme,
  `allowBackup`, Info.plist). Commit them; never delete and regenerate without carrying the
  edits over. `npx cap sync` is safe — it only copies `dist/` and the plugin list.
- `public/.well-known/assetlinks.json` matters only for §3.6 now. It still deploys
  (`firebase.json` no longer ignores dotfiles).
- The service worker is not registered inside the store apps — the build is already on the
  device, and a second cache would fight Capgo's bundle swap.
