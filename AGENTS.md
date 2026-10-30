# AGENTS.md — Tesla Browser Nav

Guide for coding agents (Claude Code, Cursor, Codex…) and humans working on this repo. Read it
before changing anything: it records what the code can't tell you — why things are the way they are.

## What this is

A Waze-style navigator that runs **in the Tesla in-car browser**. Tesla doesn't allow third-party
apps, so this is a web app (Next.js) built for the car screen and for driving in **Spain**.
Forked from [teslanav.com](https://github.com/R44VC0RP/teslanav.com) (Ryan Vogel, PolyForm
Noncommercial 1.0.0 — keep `LICENSE` and the attribution in README and code — the owner doesn't want it in the UI; no commercial use).

The upstream app was built on Waze's unofficial live-map feed, which Waze blocked. Everything that
came from Waze has been replaced (see *Data sources*). Don't try to scrape or proxy Waze again.

Repo: `flomsk/tesla-browser-nav`, branch `main` (pushed directly so far). The `upstream` remote
points at the original teslanav.com repo.

## Product principles (the owner cares about these)

- **The map stays clean.** Only what matters while driving: route, the car, speed, warnings.
  Places (chargers, fuel, cafés…) appear only on request (search / category chips) and disappear
  when search closes. Don't add always-on layers or extra buttons; remove clutter when you see it.
- **Glanceable and big.** Large touch targets (chips 48 px, rows 64 px, buttons 56 px), large
  text, one primary action per card. Nothing hover-only.
- **Voice for anything you'd otherwise have to read.** Every warning is spoken once, in the chosen
  language (en / es / ru). Audio only works after the "Start driving" tap unlocked it.
- **Spain first.** Official Spanish sources (DGT, SCT, Ministry) beat global ones where they exist.

## Commands

```bash
npm install --no-package-lock   # deps (bun.lock is from upstream; npm works fine)
npm run dev                     # http://localhost:3000
npx tsc --noEmit                # type check — must pass
npm test                        # logic tests (tests/*.test.ts via tsx) — must pass
npx eslint <files>              # lint what you touched (see "Lint")
npm run build
node scripts/build-cameras-es.mjs   # rebuild public/data/cameras-es.json (~3 min, Overpass)
```

## Testing without a car

- **Fixed GPS position:** `http://localhost:3000/?dev=true&lat=40.4168&lng=-3.7038`
  (dev only, in `hooks/useGeolocation.ts`). Automated browsers usually deny geolocation.
- **Drive a route:** with `?dev=true`, start navigation and press **Simulate** (bottom right): the
  car moves one route vertex every 200 ms at a fake 25 m/s. Vertices are unevenly spaced, so voice
  prompts can bunch up in simulation — an artefact, not a bug.
- Tap **Start driving** first (it unlocks audio). To see what would be spoken, wrap
  `speechSynthesis.speak` in the page and log `utterance.text`.
- Use a ≥ 1280 px wide viewport to look like the car (Tesla browser ≈ 1920×1200).
- Good test trips in Madrid: Sol → "Aeropuerto Madrid Barajas" (cameras on M-40/A-2, DGT
  incidents), Alcobendas (`lat=40.5372&lng=-3.6372`) → "Estación de Atocha" (A-1, evening jams).
- Fast Refresh caveat: changing the **length of a hook's dependency array** breaks that effect
  until a full reload. If something stops updating after an edit, reload before debugging.

## Architecture

```
app/page.tsx              The whole driving UI (big file from upstream). Keep it to state and
                          wiring; put logic in lib/ and hooks/.
app/api/
  directions/             Mapbox Directions (driving-traffic): steps, voice instructions and per
                          segment maxspeed / congestion / duration annotations
  geocode/                Address search + reverse geocoding (Mapbox Search Box)
  places/                 POST: category search near the car or along the route ahead
  police/                 Community police reports + votes (Upstash, or memory without it)
  road-events/            Live DGT incidents for all of Spain (client filters to the route)
  recording/, admin/      Upstream leftovers: GPX recording, usage dashboard (needs ADMIN_SECRET)
lib/
  navigation.ts           Route maths: index, progress, placeOnPolyline, routeAhead, haversine,
                          bearing, angleDifference
  traffic.ts              Congestion runs (colouring), jam detection, faster-route decision
  roadEvents.ts           DGT DATEX II parser + 3-minute cache (server)
  roadEventAlerts.ts      Match incidents to route / heading, warning distances, map pins
  placeSearch.ts          Category search: OCM chargers, Geoportal fuel, Mapbox for the rest
  mapboxSearch.ts         Search Box client (forward, category, along-route, reverse)
  chargingStations.ts     Open Charge Map client (server, 1 h cache)
  fuelPrices.ts           Spanish Ministry fuel prices (server, 30 min cache, 12 MB download)
  policeReports.ts        Police report store and TTL rules
  places.ts               Categories, keyword detection ("supercharger" → charging), fuel types,
                          escapeHtml
  navLanguage.ts          Languages, every phrase we speak ourselves, spokenDistance()
  voice.ts                speechSynthesis + WebAudio beep + unlockAudio()
  units.ts, brand.ts      km/mi formatting; app name (rename the app only in brand.ts)
hooks/
  useTurnByTurn           Progress along the route + Mapbox voice instructions
  useCameraAlerts         Speed cameras ahead (offline dataset)
  useRoadEvents(+Alerts)  DGT incidents: fetch every 3 min, warn once per incident
  useTrafficAlerts        Next jam on the route, warn once per jam
  useFasterRoute          Every 3 min re-route from the car: refresh, or offer a faster way
  usePoliceReports, useSpeedCameras, useGeolocation, …
components/               ManeuverBanner (the only trip card while navigating; has End),
                          NavigateSearch (search + chips + results), warning banners, Map.tsx
public/data/cameras-es.json   Offline cameras (DGT + Catalonia SCT + OSM), ~400 KB
public/sw.js              Service worker: Mapbox tiles + camera data (cache names `tbn-*`)
tests/                    Logic tests: plain tsx scripts that print PASS/FAIL
```

Conventions: `@/` imports; named exports (pages use default); `tbn-` prefix for localStorage keys
and caches; any external text put into HTML (map popups) goes through `escapeHtml`. Map markers are
DOM markers — cap any new marker layer (we keep ≤ ~120) because the car browser is slow. Hooks
passed new arrays/objects every render cause effect loops (the map redraws routes on every new
`routes` array) — memoise.

## Data sources

| What | Source | Notes |
|---|---|---|
| Map, directions, voice, live traffic | Mapbox | `NEXT_PUBLIC_MAPBOX_TOKEN`. Account is on **demo access** (no card): lower usage caps, token can't be rotated |
| Address & place search | Mapbox Search Box | Same token. Along-route search: `route` (polyline6) + `sar_type=isochrone` |
| Speed cameras | DGT DATEX II + Catalonia SCT + OSM | Static file, rebuilt by script. SCT uses UTM 31N with broken decimals — the script repairs them |
| Road incidents | DGT DATEX II situations (`nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v36.xml`, redirects to newer versions) | Spain except Catalonia / Basque Country |
| EV chargers | Open Charge Map | `OPEN_CHARGE_MAP_KEY`. Tesla = operator ids **23 and 3534** (both) |
| Fuel prices | Ministerio, Geoportal Gasolineras REST | No key; ~11.4k stations |
| Police | Our own crowdsourcing | Needs Upstash on serverless hosting |

Ruled out: Google Places / Apple Maps POIs (their terms forbid showing them on another map), Waze
(blocked), LocationIQ (upstream searched only the US with it — removed).

## Decisions and thresholds (change deliberately)

- **Speed cameras:** cone ±35° ahead of heading; warn at clamp(speed × 20 s, 300 m, 800 m);
  re-alert after 10 min; icons from zoom 13 (warnings use all cameras regardless of zoom).
- **Camera dataset cleanup** (`build-cameras-es.mjs`): OSM type comes from the node's
  `enforcement` relations (average_speed → section, traffic_signals → red light); OSM nodes are
  dropped if mobile/temporary, "PREaviso" signs, "pedagògic" boards, seatbelt/STOP cameras,
  lifecycle-prefixed, or not edited since 2021; OSM within 150 m of an official camera (any type)
  is a duplicate; same-type OSM within 30 m and DGT points within 30 m of each other merge.
- **Camera heading** (`heading`, travel direction it checks): OSM numeric `direction`; DGT sections
  start → end; DGT cabins only when the nearest one-way carriageway and the PK order agree (~40 %
  of cabins, ~97 % match with OSM). Merging cameras that check different ways drops the heading.
  Alerts skip a camera whose heading differs from ours by > 90°; no heading = warn both ways.
- **Police reports:** live 30 min after the last confirmation, at most 3 h; a "not there" vote caps
  the rest at 10 min; removed when down > up; reports within 200 m merge; 6 reports / 10 min per IP.
- **DGT incidents:**
  - one event per situation; the kind is picked by priority (closure > accident > fire > …);
  - short-lived kinds (accident, stopped vehicle, obstacle, slow traffic, fog) older than 24 h are
    dropped — DGT leaves some open for months;
  - on a route an incident must be within 40 m of the line *and* in our direction: a stretch's
    from → to must run our way, otherwise its TPEG direction must be within 70° of the route bearing;
  - warning distances: closure 3 km; accident, fire, slow traffic 2 km; obstacle, rockfall, flood
    1.5 km; stopped vehicle, lane closed 1 km; roadworks 800 m;
  - without a route, only hazards (not roadworks, lane closures, stopped cars) in a ±30° cone are
    shown and warned;
  - **while navigating, DGT `slowTraffic` isn't announced** — the Mapbox jam warning covers it.
- **Traffic jams (Mapbox):** heavy/severe segments, gaps ≤ 200 m merged, ≥ 300 m long and ≥ 30 s
  delay (60 s missed a real A-1 jam). Delay = annotated duration − time at 90 % of the speed limit
  (50 km/h when unknown). Warned 2 km ahead, once per jam start location.
- **Faster route:** every 3 min while navigating with > 3 km left. A fresh route overlapping ≥ 85 %
  with what's left of ours is "the same way" → silently replaces it (fresh traffic and ETA). A
  different way saving ≥ 3 min → card + voice, auto-dismissed after 30 s; a dismissed way isn't
  offered again during that trip.
- **Search:** category keywords (en/es/ru) trigger category search; "supercharger"/"tesla" →
  Tesla-only within ~30 km. Chargers rank fast/Tesla first. Along a route: ≤ 1.5 km off the road,
  sorted by distance ahead; picking a result while navigating reroutes straight to it.
- **Map while driving:** only the chosen route (plus an offered faster one), no refit on route
  updates (`fitRoutes={!destination}`); search results fit the view and pause auto-centering.

## Lint

`npx eslint app/page.tsx components/Map.tsx` reports ~7 errors inherited from upstream
(set-state-in-effect, Date.now in render, …). Don't add new ones: compare the count before and
after your change. New files should lint clean.

## Status

Done: offline cameras, police reports, turn-by-turn + voice (en/es/ru), speedometer with limits,
start screen, unified search with categories and along-route search, chargers and fuel prices,
DGT incidents, live traffic (colours, jam warnings, faster route), km/mi, rebrand.

Open / known gaps:
- **Never tested in a real Tesla yet** (GPS quality, es/ru speech voices, touch, performance).
- **Not deployed.** Plan: Vercel (EU region) with env vars from `.env.example` plus Upstash for
  police reports. The owner has a Vercel MCP server configured (loads in a new Claude session).
- `lib/redis.ts` creates an Upstash client even without env (dev warnings; usage tracking fails
  silently).
- Catalonia (SCT) and Basque Country incident feeds not integrated.
- Language/units changes apply on the next route calculation, not mid-route.
- No automatic re-route around a DGT closure (warning only).
- Upstream leftovers to prune: GPX record/view pages, admin dashboard, Waze naming in page.tsx
  (`showWazeAlerts`, `alertsLoading`, `WazeAlert` type now used for police + DGT pins).
