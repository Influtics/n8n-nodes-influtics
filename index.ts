/**
 * Package entry point.
 *
 * Re-exports every node class and credential so `import 'n8n-nodes-influtics'`
 * (the value `package.json: "main"` resolves to) gives consumers the full
 * surface in one named-import namespace. n8n's community-node loader reads
 * `main` to discover the package; without this file `dist/index.js` is
 * missing and the loader surfaces a parse error on the missing entry.
 *
 * Per the official `@n8n/node-cli` template (`npx n8n-node new`).
 */

export { InfluticsApi } from './credentials/InfluticsApi.credentials.js';
export { InfluticsVideo } from './nodes/InfluticsVideo/InfluticsVideo.node.js';
export { InfluticsBlogger } from './nodes/InfluticsBlogger/InfluticsBlogger.node.js';
export { InfluticsTrend } from './nodes/InfluticsTrend/InfluticsTrend.node.js';
export { InfluticsAccount } from './nodes/InfluticsAccount/InfluticsAccount.node.js';
