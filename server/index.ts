/**
 * Elevyn Brain — local HTTP control plane.
 *
 * Architecture decision:
 * The projector UI runs in a browser (fullscreen on the wall display).
 * Browsers cannot open apps or run AppleScript. This Node process is the
 * MacBook "brain" — commands, memory, system status, and AI providers live here.
 *
 * On Vercel the same Express app is exported from `api/[[...path]].ts`
 * instead of calling listen().
 */

import 'dotenv/config';
import { createApp } from './createApp.js';
import { isHosted, isMac } from './services/platform.js';
import { prewarmSpeechCache } from './services/voice/tts.js';

const PORT = Number(process.env.PORT ?? process.env.ELEVYN_PORT ?? 8787);
const API_TOKEN = process.env.ELEVYN_API_TOKEN ?? '';

async function main() {
  const app = createApp();
  const host = isHosted ? '0.0.0.0' : '127.0.0.1';

  app.listen(PORT, host, () => {
    console.log(`\n  ✦ Elevyn brain listening on http://${host}:${PORT}`);
    console.log(
      `    mode: ${isHosted ? 'hosted' : 'local'} · system control: ${isMac ? 'on' : 'off'} · auth: ${API_TOKEN ? 'token' : 'open'}\n`,
    );
    void prewarmSpeechCache();
  });
}

main().catch((err) => {
  console.error('Elevyn brain failed to start:', err);
  process.exit(1);
});
