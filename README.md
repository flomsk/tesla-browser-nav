# Tesla Browser Nav

A Waze-style navigator that runs in the Tesla in-car browser. Tesla does not allow third-party apps, so this is a web app built for the car screen: big touch targets, voice guidance through the car speakers and alerts tuned for driving in Spain.

Built with Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4 and Mapbox GL.

> Based on [teslanav.com](https://github.com/R44VC0RP/teslanav.com) by Ryan Vogel. Licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE): free for personal, non-commercial use.

## Features

- Turn-by-turn navigation (Mapbox Directions): maneuver banner, ETA, rerouting
- Voice guidance in English, Spanish or Russian
- Speed cameras for Spain, bundled offline: DGT, Servei Català de Trànsit and OpenStreetMap
- Camera warnings ahead of the car with a beep, voice and the camera's speed limit
- Speedometer with the current speed limit (camera or road segment)
- Live traffic: route line coloured by congestion, spoken warning before a jam (length and delay), and every 3 minutes a check for a faster way (offered when it saves 3+ minutes)
- Community police reports: "Police here" button, confirmations and automatic expiry
- Live DGT incidents (accidents, closures, obstacles, slow traffic, roadworks): pins and a spoken warning for the ones on your route in your direction; without a route, hazards straight ahead. Spain except Catalonia and the Basque Country
- One search box: addresses, or a category chip (Charging, Café, Food, Fuel, Parking); typing "supercharger" or "café" works too
- While navigating, search looks along the route ahead and a pick becomes the new destination
- Chargers with max power and Superchargers first (Open Charge Map), fuel with today's prices for Spain (Ministry Geoportal)
- Kilometers or miles
- Map tile and camera data caching through a service worker

## Development

### Prerequisites

- Node.js 20+ (or Bun)
- A Mapbox account with a public token (demo access without a card works for testing)

### Setup

```bash
git clone https://github.com/flomsk/tesla-browser-nav.git
cd tesla-browser-nav
npm install --no-package-lock
cp .env.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN (and OPEN_CHARGE_MAP_KEY)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), tap **Start driving** (this unlocks voice and sounds), then search an address or tap a category. A long press (right-click on desktop) on the map also picks a destination.

### Trying it without a car

- `http://localhost:3000/?dev=true&lat=40.4168&lng=-3.7038` — dev mode with a fixed GPS position (any coordinates).
- In dev mode start a route and press **Simulate**: the car drives the route, so you can hear the voice guidance and see camera, incident and jam warnings.
- Make the browser window at least 1280 px wide to get the car-screen layout.

### Commands

```bash
npm run dev                          # Dev server on http://localhost:3000
npm run build                        # Production build
npm run start                        # Production server
npm run lint                         # ESLint
npx tsc --noEmit                     # Type check
npm test                             # Logic tests (navigation, incidents, traffic)
node scripts/build-cameras-es.mjs    # Rebuild public/data/cameras-es.json (~3 min)
```

## Environment variables

See [.env.example](./.env.example). Only `NEXT_PUBLIC_MAPBOX_TOKEN` is required.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Map, directions, voice instructions, address and place search |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared storage for police reports. Without it reports live in process memory (fine for one Node process, not for serverless) |
| `OPEN_CHARGE_MAP_KEY` | Charger power and connectors in charging search ([free key](https://openchargemap.org/profile/applications)); without it Mapbox results are used |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics (optional) |
| `ADMIN_SECRET`, `INBOUND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL`, `APP_URL` | `/admin` usage dashboard and usage alert emails (optional; the admin API is disabled without `ADMIN_SECRET`) |

## Deploying

Any Node host works (`npm run build && npm run start`). The plan is Vercel in an EU region:

1. Import `flomsk/tesla-browser-nav` in Vercel.
2. Add the environment variables from the table above. For police reports on Vercel, create a free Upstash Redis database and set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — serverless functions don't share memory.
3. Open the deployed URL in the Tesla browser and add it to favourites.

Mapbox demo access (no card) has lower usage caps than a standard account; add a payment method in Mapbox if the app is used regularly (the free monthly tier still applies).

## Architecture

```
app/api/
  directions/      # Mapbox Directions: routes, steps, voice instructions, speed limits, traffic
  geocode/         # Address search + reverse geocoding (Mapbox Search Box)
  places/          # Category search near the car or along the route (Mapbox, Open Charge Map, fuel prices)
  police/          # Community police reports and votes
  road-events/     # Live DGT incidents (DATEX II)
  recording/       # GPX track storage
  admin/usage/     # API usage stats + threshold alerts
components/        # UI (map, maneuver banner, camera warning, speedometer, ...)
hooks/             # GPS, turn-by-turn, camera / incident / jam alerts, faster route, police
lib/               # Navigation and traffic maths, data source clients, voice, units, languages
tests/             # Logic tests (npm test)
public/data/       # Offline speed camera dataset for Spain
public/sw.js       # Service worker: tile and data cache
scripts/           # Dataset builders
```

## Status

Works end to end in a desktop browser with simulated driving. Not yet tested in a real Tesla and not yet deployed. Details, design decisions, thresholds and known gaps are in [AGENTS.md](./AGENTS.md).

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE). Copyright (c) 2025 Ryan Vogel; modifications in this repository follow the same license.
