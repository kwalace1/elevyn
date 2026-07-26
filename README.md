# Elevyn

**The operating system for your room.**

Elevyn is a local-first AI OS that lives on your MacBook and projects onto your wall. You speak. It listens. It acts. It feels like a calm, intelligent presence — not a chatbot.

Inspired by the *capability* of Iron Man's technology, designed like Apple, Nothing, Rivian, and Arc if they built an AI OS.

## Tonight's MVP

- Projector-ready command center UI
- Voice in (Web Speech) → Elevyn brain → Voice out (TTS)
- Open apps: Cursor, Finder, Spotify, Chrome, Terminal, and more
- Live system status, calendar placeholder, notifications, running apps
- Local AI via Ollama (with deterministic fallback when Ollama is offline)
- Registry-based commands + searchable memory service

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** — preferably fullscreen on the projector display.

Use **Chrome** or **Edge** for microphone access (Web Speech API).

### AI providers (pick one)

**OpenRouter (recommended on Intel / 8GB Macs)** — fast cloud inference, can stay $0 with free models:

```bash
cp .env.example .env
# Add OPENROUTER_API_KEY from https://openrouter.ai/keys
# Default model is openrouter/free (auto free tier)
npm run dev
```

**Ollama (fully local / offline)** — best on Apple Silicon with enough RAM:

```bash
# Install from https://ollama.com
ollama pull llama3.2
```

Without any LLM, Elevyn still opens apps and responds to greetings / time via the local intent engine.

See `.env.example` for `ELEVYN_AI_PROVIDER`, model overrides, and Ollama settings.

## Architecture at a glance

| Layer | Role |
|-------|------|
| **UI** (`src/`) | Projector surface — presence, dashboard, voice UX |
| **Brain** (`server/`) | Local control plane — AI, commands, memory, system |
| **Providers** | Swappable AI backends behind one interface |
| **Commands** | Unlimited registry — never hardcode actions in the brain |

See [docs/Architecture.md](docs/Architecture.md) and [docs/Roadmap.md](docs/Roadmap.md).

## Deployment

Elevyn splits into two deployable halves. What you get depends on **where the brain runs**.

| Capability | UI on Vercel + hosted brain | UI on Vercel + brain on your Mac |
|---|---|---|
| Dashboard, work mode, panels | ✅ | ✅ |
| Voice in (Chrome), notes, tasks, timers, capture | ✅ | ✅ |
| Conversation via OpenRouter | ✅ | ✅ |
| Neural TTS (edge-tts) | ✅ (Docker image ships Python) | ✅ |
| Open/close Mac apps, lock, sleep, running apps | ❌ | ✅ |

Mac-only commands don't crash a hosted brain — they reply that the control needs the local instance.

### 1. Frontend → Vercel

Import the repo in Vercel. `vercel.json` already sets the Vite build and SPA rewrites.

Set these **Environment Variables** (build-time — redeploy after changing):

```
VITE_ELEVYN_API=https://your-brain-host
VITE_ELEVYN_TOKEN=<same value as ELEVYN_API_TOKEN>
```

Without `VITE_ELEVYN_API` the deployed UI tries to reach `127.0.0.1` and will show the brain as offline.

### 2. Brain → container host (Railway / Render / Fly)

The included `Dockerfile` builds the brain and installs Python + `edge-tts`.

```
ELEVYN_HOSTED=1
ELEVYN_API_TOKEN=<long random string>
ELEVYN_ALLOWED_ORIGINS=https://your-app.vercel.app
OPENROUTER_API_KEY=<key>
OPENROUTER_MODEL=inclusionai/ling-3.0-flash:free
```

The host injects `PORT` automatically. Locally: `npm run build:brain && npm start`.

> **Always set `ELEVYN_API_TOKEN` on a public brain.** Without it, anyone who finds the URL can drive Elevyn. `/api/health` stays open so the UI can show connection status.

### 3. Hybrid — Vercel UI, brain on your Mac

Keeps full Mac control while the UI is hosted. Run the brain locally, expose it over HTTPS (Cloudflare Tunnel / ngrok), then point `VITE_ELEVYN_API` at the tunnel URL. A Vercel page is HTTPS, so the brain must be HTTPS too.

### Running light on a slow Mac

```bash
ELEVYN_TTS_PREWARM=0 npm run dev   # skip Python TTS warmup at boot
```

Prefer OpenRouter over Ollama on low-RAM machines, and let the cloud brain handle AI while your Mac only renders the UI.

## Voice demos

- “Open Cursor”
- “Open Spotify”
- “Open Chrome”
- “Open Terminal”
- “Open Finder”
- “What time is it?”
- “Who are you?”

## Design language

- Pure black / dark gray / white / electric cyan
- Glass panels, quiet motion, purposeful glow
- Typography: **Syne** (display) + **Outfit** (body)

## Philosophy

Elevyn is not a website. Elevyn is not a chat bubble.

It is an operating system for the room — minimal, elegant, confident, calm, always alive.
