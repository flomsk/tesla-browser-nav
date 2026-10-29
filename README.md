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
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Add `?dev=true` to get a **Simulate** button that drives the selected route.

Search an address or tap a category, or long-press (right-click on desktop) the map to pick a point.

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
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Map, directions, voice instructions, address and place search |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared storage for police reports. Without it reports live in process memory (fine for one Node process, not for serverless) |
| `OPEN_CHARGE_MAP_KEY` | Charger power and connectors in charging search ([free key](https://openchargemap.org/profile/applications)); without it Mapbox results are used |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Analytics (optional) |
| `ADMIN_SECRET`, `INBOUND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL`, `APP_URL` | `/admin` usage dashboard and usage alert emails (optional; the admin API is disabled without `ADMIN_SECRET`) |

## Architecture

```
app/api/
  directions/      # Mapbox Directions: routes, steps, voice instructions, speed limits
  geocode/         # Address search + reverse geocoding (Mapbox Search Box)
  places/          # Category search near the car or along the route (Mapbox, Open Charge Map, fuel prices)
  police/          # Community police reports and votes
  road-events/     # Live DGT incidents (DATEX II)
  recording/       # GPX track storage
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
