import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadAssets } from './assets.ts';
import { createAuth } from './auth.ts';
import { loadConfig } from './config.ts';
import { FileStore } from './store.ts';

const config = loadConfig();
const store = new FileStore(config.storageDir);
const auth = createAuth(config.adminPassword, store.sessionKey());
const assets = loadAssets(config.assetsDir, { reload: !config.production });
const app = createApp({ config, store, auth, assets });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`food: listening on ${config.host}:${info.port} (base ${config.baseUrl})`);
});

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`food: ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
