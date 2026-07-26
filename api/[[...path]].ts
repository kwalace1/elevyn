/**
 * Vercel serverless entry — mounts the Elevyn Express brain at /api/*.
 *
 * GitHub → Vercel is the only hosting path Kevin wants. No Railway.
 * The React UI is the Vite static build; this handler is the brain.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../server/createApp.js';

const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}

export const config = {
  maxDuration: 60,
};
