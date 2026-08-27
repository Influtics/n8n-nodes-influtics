# n8n-nodes-influtics

Official [Influtics](https://influtics.com) integration for [n8n](https://n8n.io) — track influencer videos, bloggers, and trends across TikTok, Instagram, YouTube, VK, and more.

## Install

1. In n8n, open **Settings → Community Nodes**.
2. Click **Install a community node**.
3. Enter `n8n-nodes-influtics` and confirm.

After install, configure the **Influtics API** credential with your API key from the Influtics dashboard under **Settings → API**.

## Operations

### Influtics Video

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Track | `POST` | `/v1/videos/track` |
| Get Stats | `GET` | `/v1/videos/stats` |
| Get By ID | `GET` | `/v1/videos/by-id/{id}` |
| Get By External ID | `GET` | `/v1/videos/by-external-id/{id}` |
| Update By External ID | `PATCH` | `/v1/videos/by-external-id/{id}` |

### Influtics Blogger

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Track | `POST` | `/v1/bloggers/track` (returns `job_id`) |
| Get Job | `GET` | `/v1/bloggers/jobs/{job_id}` |
| By Username | `GET` | `/v1/bloggers/by-username/{username}` |

The **Track** operation is async; pair it with **Get Job** using the expression `{{ $json.job_id }}` in the next workflow step.

### Influtics Trend

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Search | `GET` | `/v1/trends/search` |

### Influtics Account

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Get Usage | `GET` | `/v1/account/usage` |
| Get Limits | `GET` | `/v1/account/limits` |

## Errors

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | API key is missing or invalid. |
| `PAID_PLAN_REQUIRED` | This endpoint requires a paid subscription. Upgrade at the URL surfaced in the error description. |
| `BLOGGER_NOT_TRACKED` | Creator isn't tracked by your org — run **Influtics Blogger → Track** first. |
| `JOB_TIMEOUT` | The async job didn't complete in time — poll again or retry. |
| `VALIDATION_ERROR` | A required field is missing or invalid. |

## Troubleshooting

### `Error loading package: Unexpected token '*'` on install

This error originates inside n8n (`loadClassInIsolation`), not in your environment. It means n8n's `PackageDirectoryLoader` failed to load one of the node entry-point files declared in `package.json`'s `n8n` field.

**If you're on v1.0.5 or later:** the published `package.json` declares explicit relative paths in `n8n.nodes` and `n8n.credentials`. If you still see this error, n8n is loading a stale on-disk install left behind by an earlier (≤ v1.0.4) version — wipe the install cache and reinstall (steps below).

**If you're on v1.0.4 or earlier:** the package.json declared glob patterns (`dist/nodes/**/*.node.js`). n8n's `PackageDirectoryLoader.loadAll()` does NOT expand globs — it treats them as literal file paths, and `directory-loader.ts:loadClass` extracts the className via `path.parse(sourcePath).name.split('.')[0]`, which yields the string `"**"`. n8n then interpolates that into its `vm.Script` template `new (require('${filePath}').${className})()` and V8 throws `SyntaxError: Unexpected token '*'` at parse time. **Upgrade to v1.0.5** — no other workaround exists on the package side.

#### Wipe the install cache (v1.0.5+ still seeing the error)

n8n's community-node installer (`CommunityPackagesController`) reuses the on-disk folder between upgrades. If a previous install left broken files behind, the new install lands on top of them.

**Self-hosted (Docker):**

```bash
docker compose down n8n
docker volume ls | grep n8n  # find the volume that holds the install cache
docker run --rm -v <volume>:/data alpine sh -c \
  'rm -rf /data/.n8n/nodes/node_modules/n8n-nodes-influtics'
docker compose up -d n8n
# Reinstall via Settings → Community Nodes → Install a community node.
```

**Self-hosted (bare metal / PM2):**

```bash
sudo systemctl stop n8n
rm -rf ~/.n8n/nodes/node_modules/n8n-nodes-influtics
sudo systemctl start n8n
# Reinstall via Settings → Community Nodes → Install a community node.
```

#### Confirm the install succeeded

Open a workflow, add a node, search for `Influtics`. All four should appear: **Influtics Video**, **Influtics Blogger**, **Influtics Trend**, **Influtics Account**.

If they still don't appear, capture the install log from **Settings → Community Nodes → click the package → View error log** and open an issue at https://github.com/Influtics/n8n-nodes-influtics/issues with the log attached.

## Documentation

- Public API reference: https://docs.influtics.com/
- Issues: https://github.com/Influtics/n8n-nodes-influtics/issues

## License

MIT — see [LICENSE](LICENSE).