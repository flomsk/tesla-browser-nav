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
- Community police reports: "Police here" button, confirmations and automatic expiry
- EV chargers with max power, Tesla Superchargers highlighted (Open Charge Map)
- Fuel stations with today's prices for Spain (Ministry Geoportal, no key needed)
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
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Add `?dev=true` to get a **Simulate** button that drives the selected route.

Pick a destination with a long press (right-click on desktop) on the map. Address search needs `LOCATION_IQ_TOKEN`.

### Commands

```bash
npm run dev                          # Dev server on http://localhost:3000
npm run build                        # Production build
npm run start                        # Production server
npm run lint                         # ESLint
npx tsc --noEmit                     # Type check
node scripts/build-cameras-es.mjs    # Rebuild public/data/cameras-es.json (~3 min)
```

## Environment variables

See [.env.example](./.env.example). Only `NEXT_PUBLIC_MAPBOX_TOKEN` is required.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Map, directions, voice instructions |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared storage for police reports. Without it reports live in process memory (fine for one Node process, not for serverless) |
| `OPEN_CHARGE_MAP_KEY` | EV chargers layer ([free key](https://openchargemap.org/site/develop/api)) |
| `LOCATION_IQ_TOKEN` | Address search and reverse geocoding |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics (optional) |
| `INBOUND_API_KEY`, `EMAIL_FROM`, `FEEDBACK_EMAIL` | Feedback form emails (optional) |
| `ADMIN_SECRET`, `ALERT_EMAIL`, `APP_URL` | `/admin` usage dashboard and usage alerts (optional; the admin API is disabled without `ADMIN_SECRET`) |

## Architecture

```
app/api/
  directions/      # Mapbox Directions: routes, steps, voice instructions, speed limits
  geocode/         # LocationIQ forward + reverse geocoding
  police/          # Community police reports and votes
  fuel/            # Fuel stations + prices (Spanish Ministry Geoportal)
  chargers/        # EV chargers (Open Charge Map)
  recording/       # GPX track storage
  feedback/        # Feedback emails
  admin/usage/     # API usage stats + threshold alerts
components/        # UI (map, maneuver banner, camera warning, speedometer, ...)
hooks/             # GPS, turn-by-turn progress, camera alerts, police reports
lib/               # Navigation math, voice, units, languages, police store
public/data/       # Offline speed camera dataset for Spain
public/sw.js       # Service worker: tile and data cache
scripts/           # Dataset builders
```

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE). Copyright (c) 2025 Ryan Vogel; modifications in this repository follow the same license.
