# Agent Dashboard

Real-time dashboard for monitoring Claude Code agent sessions.

## Architecture

- **Frontend**: Static HTML (`public/index.html`) — Three.js penguins + 2D canvas office
- **Backend**: Vercel serverless Python functions (`api/`)
- **Storage**: Upstash Redis (event stream)
- **Hook collector**: `event-collector.py` — runs as Claude Code hook, POSTs events to `/api/collect`

## Setup

1. Create Upstash Redis database at https://upstash.com
2. Copy `.env.example` → `.env.local`, fill in credentials
3. Add `COLLECT_TOKEN` to Vercel environment variables
4. Configure Claude Code hooks to run `event-collector.py`

## Local dev

```bash
python server.py  # http://localhost:3737
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard UI |
| POST | `/api/collect` | Receive hook event (requires x-token header) |
| GET | `/api/state` | Computed sessions + active agents |
| GET | `/api/events?since=&limit=` | Raw events |
| POST | `/api/clear` | Clear all events from Redis |
