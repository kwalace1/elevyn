# Elevyn Roadmap

## v0.1 — Tonight (MVP) ✅

- [x] Project foundation + modular services
- [x] Projector command-center UI
- [x] Animated AI Core (idle / listening / thinking / speaking / offline)
- [x] Voice loop (Web Speech + browser TTS)
- [x] Open app commands (Cursor, Finder, Spotify, Chrome, Terminal, …)
- [x] AI provider interface + Ollama adapter
- [x] OpenRouter provider (free-model default for low-power Macs)
- [x] Local intent fallback when Ollama is offline
- [x] Memory service (categorized, searchable)
- [x] Live system health + running apps
- [x] Docs: README, Architecture, Roadmap

## v0.2 — Room presence

- [ ] Install / guide Ollama as first-run ritual
- [ ] Streaming AI replies + interruptible speech
- [ ] Push-to-talk + wake phrase (“Elevyn”)
- [ ] Windows PC agent bridge (status + remote open)
- [ ] Real calendar (EventKit / Google)
- [ ] Real weather
- [ ] Notification center inbox (macOS)

## v0.3 — Control surface

- [ ] Close / focus apps with confirmation
- [ ] Allowlisted terminal commands
- [ ] Lock / sleep / display sleep polish
- [ ] Smart home devices service (Hue, HomeKit bridge)
- [ ] Projector scene modes (focus / ambient / demo)

## v0.4 — Agent OS

- [ ] Cursor automation hooks
- [ ] GitHub triage agent
- [ ] Email / calendar planning agent
- [ ] Multi-step automations (`services/automation`)
- [ ] Conversation memory written back to MemoryService

## v0.5 — Product shell

- [ ] Tauri desktop wrapper (menubar + brain lifecycle)
- [ ] Onboarding + permissions flow
- [ ] Profiles / rooms / multi-machine sync (local-first)
- [ ] Plugin SDK for third-party commands
- [ ] Local vector memory (embeddings on-device)

## Future ideas (parked, not forgotten)

- Spatial audio presence when you enter the room
- Gaze / presence sensor for “looking at Elevyn”
- Shared family room mode vs deep-work mode
- Offline vision (what’s on my desk) via local VLM
- Elevyn mobile remote as secondary control surface
- Signed automation marketplace

## Non-goals

- Becoming a generic ChatGPT wrapper
- Cloud-only dependency for core loop
- Gamer RGB / hologram cosplay UI
- Hardcoding one-off commands in the brain
