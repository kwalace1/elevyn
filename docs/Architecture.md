# Elevyn Architecture

## North star

Elevyn is a **local-first AI operating system**. The MacBook is the brain. The projector is the face. Voice is the primary input. Cloud AI is optional, never required.

We design for thousands of users later — modular services, clear boundaries, swappable providers — while shipping a demoable MVP tonight.

## Why this shape (and not alternatives)

### Browser UI + Node brain (not Electron yet)

**Tonight:** Vite/React fullscreen on the projector + Express on localhost.

Browsers cannot open apps or run AppleScript. A local Node process can. Splitting UI and brain keeps the projector surface thin and the control plane honest.

**Next:** Package the brain as a Tauri/Electron sidecar or `launchd` daemon. The HTTP contract (`/api/*`) stays stable — the UI does not rewrite.

We rejected pure Electron-for-MVP because it slows the first magical demo without buying capability we don't need yet (the projector already has a browser).

### Not a Next.js app

Elevyn is not a marketing site or SaaS dashboard. SSR and edge deployment patterns fight local-first OS realities (filesystem, AppleScript, Ollama on loopback). Vite + Express is the correct product shape.

### AI providers are plugins

```
AIProvider {
  id, displayName
  isAvailable()
  complete(messages)
}
```

Ollama is the offline default. OpenRouter is a first-class cloud provider (OpenAI-compatible) and becomes preferred when `OPENROUTER_API_KEY` is set — the right trade for low-power Intel Macs that cannot run local models at voice latency. OpenAI / Claude / Gemini remain stubs with the same interface. The brain never imports a vendor SDK directly.

**Cost stance:** Prefer `openrouter/free` or any `:free` model ID so conversational AI can stay $0. Paid models are opt-in via `OPENROUTER_MODEL`.

### Commands are a registry, not a switch statement

```
CommandHandler {
  id, name, description, examples
  execute(ctx) → result
}
```

Unlimited commands. The brain only knows *intent → commandId*. Handlers own side effects (open app, lock, sleep, AppleScript).

### Memory is not the model

Models are ephemeral. Elevyn memory is durable, categorized, and searchable:

`personal · projects · devices · preferences · notes · conversations · tasks`

MVP store: JSON file. Interface stays the same when we move to SQLite + embeddings.

## Runtime topology

```
┌──────────────────────────┐
│  Projector / Browser UI  │  voice STT/TTS, dashboard
│  localhost:5173          │
└────────────┬─────────────┘
             │ HTTP /api
┌────────────▼─────────────┐
│  Elevyn Brain (Node)     │  localhost:8787
│  ├─ AI registry          │
│  ├─ ElevynBrain          │  interpret utterance
│  ├─ Command registry     │  execute actions
│  ├─ Memory service       │  searchable store
│  └─ System status        │  health, apps, net
└────────────┬─────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
  Ollama           macOS
  (optional)     open / osascript
```

## Interaction loop

1. **Idle** — orb breathes
2. **Listening** — Web Speech recognition
3. **Thinking** — brain interprets (local matcher → LLM)
4. **Acting** — command registry executes if needed
5. **Speaking** — TTS replies
6. Back to **Idle**

Local intent matching runs *before* the LLM so “Open Cursor” works even when Ollama is down. That is a product decision, not a hack: reliability is part of magic.

## Folder map

```
server/                 # Brain (control plane)
  services/ai/          # providers + ElevynBrain
  services/commands/    # registry + handlers
  services/memory/      # categorized store
  services/system/      # live Mac status
  routes/               # HTTP surface

src/                    # Projector UI
  components/           # orb, rails, glass, mic
  services/             # api + voice abstractions
  hooks/                # elevyn loop, dashboard, clock
  types/                # shared domain vocabulary
  styles/               # OS design tokens

docs/                   # Architecture, roadmap
data/memory/            # durable memory (gitignored contents)
```

## Extension points (design for v5 now)

| Capability | Hook |
|------------|------|
| New AI vendor | Implement `AIProvider`, register |
| New command | Implement `CommandHandler`, register |
| Local STT/TTS | Implement voice interfaces in `src/services/voice` |
| Windows PC | Device bridge service + `DeviceStatus` feed |
| Smart home | `services/devices` + command handlers |
| Cursor / GitHub agents | Automation service calling existing registries |
| Multi-user | Auth layer in front of brain; memory namespaced |

## Security posture (early but intentional)

- Arbitrary shell execution is **registered but disabled** in MVP
- Destructive power commands (shutdown/restart) deferred
- Brain binds to localhost only for now
- Future: allowlists, confirmation UX for irreversible actions, signed automation policies
