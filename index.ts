/**
 * Package entry point.
 *
 * Re-exports the single Influtics action node + credential so
 * `import 'n8n-nodes-influtics'` (the value `package.json: "main"` resolves
 * to) gives consumers the full surface in one named-import namespace. n8n's
 * community-node loader reads `main` to discover the package; without this
 * file `dist/index.js` is missing and the loader surfaces a parse error.
 *
 * Per the official `@n8n/node-cli` template (`npx n8n-node new`).
 */

export { InfluticsApi } from './credentials/InfluticsApi.credentials';
export { Influtics } from './nodes/Influtics/Influtics.node';
