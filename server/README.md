# Server — Elevyn Brain

Local control plane. Owns AI providers, command execution, memory, and system status.

- `index.ts` — HTTP entry
- `routes/` — REST surface for the UI
- `services/ai/` — provider interface, Ollama, brain orchestration
- `services/commands/` — registry + handlers (never hardcode in the brain)
- `services/memory/` — durable categorized memory
- `services/system/` — live Mac snapshot

Bind: `http://127.0.0.1:8787`
