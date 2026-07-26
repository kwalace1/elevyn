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

## Deployment (GitHub + Vercel only)

One Vercel project hosts **both** the UI and the brain:

| Capability | On Vercel |
|---|---|
| Dashboard, work mode, panels | ✅ |
| Voice in (Chrome), notes, tasks, timers, capture | ✅ |
| Conversation via OpenRouter | ✅ |
| Spoken replies | ✅ (browser TTS; neural Edge voice stays on Mac) |
| Open/close Mac apps, lock, sleep | ❌ |

No Railway, Render, or other hosts required. Your Mac only needs Chrome.

### Deploy

1. Import `kwalace1/elevyn` at [vercel.com/new](https://vercel.com/new)
2. Add **one** Environment Variable (Production + Preview):

```
OPENROUTER_API_KEY=<your key from https://openrouter.ai/keys>
```

Optional:

```
OPENROUTER_MODEL=inclusionai/ling-3.0-flash:free
ELEVYN_AI_PROVIDER=openrouter
```

3. Deploy. Open the `.vercel.app` URL in **Chrome**, allow the mic, enable wake listening.

The frontend calls same-origin `/api/*`. Locally, Vite already proxies `/api` to the Mac brain on `:8787`, so `npm run dev` still works the same.

### Privacy

The public URL can be used by anyone who finds it. To lock it down, turn on **Vercel Deployment Protection** (Pro) or put a password on the deployment — don't put secrets in `VITE_*` vars; those ship to the browser.

### Running light on a slow Mac

```bash
ELEVYN_TTS_PREWARM=0 npm run dev
```

Prefer OpenRouter over Ollama on low-RAM machines. Or skip local entirely and use the Vercel URL.

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
