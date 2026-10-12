# Encore · tours routed by taste

**Encore is an AI agent that plans tours for independent artists using Qloo's taste graph.** Type an artist; Encore ranks every candidate market by real audience affinity, picks venues whose crowd matches, finds emerging local openers with fan overlap, tells you which famous cities to skip, and shows the Qloo evidence behind every stop.

> Work in progress for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Full write-up, screenshots and limitations coming.

## Why

Most independent tours lose money, and the route is usually guessed from where the band has friends, or from the same ten "big" cities everyone plays. A generic LLM makes the same guess. Qloo knows where an artist's audience actually concentrates, what else they love, and which rooms they go to.

## How it works

An agent loop (Gemini function calling) drives a set of Qloo tools:

| Tool | Qloo call | Why |
|---|---|---|
| `resolve_artist` | `GET /search` | Resolve the artist entity |
| `rank_markets` | `GET /v2/insights` `filter.type=urn:heatmap` per city | Audience affinity and scene size per market |
| `taste_neighbors` | `/v2/insights` `filter.type=urn:entity:artist` | Fan overlap, scene context |
| `audience_profile` | `/v2/insights` brands / TV / podcasts / movies + demographics | Promo targeting and sponsors |
| `find_venues` | `/v2/insights` `filter.type=urn:entity:place` + venue tag + city | Rooms whose crowd matches |
| `local_openers` | `/v2/insights` artists + `signal.location.query` | Local acts with fan overlap who sell tickets |
| `neighbourhood_hotspots` | heatmap inside the city | Where to poster and advertise |

The chosen cities are routed into a short drive (nearest-neighbour + 2-opt), and every Qloo request is shown in an evidence trail.

## Run it

```bash
npm i -g vercel
export QLOO_API_KEY=...      # hackathon key, server-side only
export GEMINI_API_KEY=...    # Google AI Studio
vercel dev
```

## Responsible use

Qloo results are aggregate audience affinities, not facts about any individual. Encore sends no personal data to Qloo and stores no Qloo responses in this repository.

## License

MIT
