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

### `Error loading package: Unexpected token '*'` after upgrading

The error almost always means a **stale install cache**, not a packaging bug. n8n's community-node installer (`CommunityPackagesController`) reuses the on-disk folder between upgrades; if the previous version was broken (≤1.0.2), the broken files stay in place and the new install layer lands on top of them. v1.0.3+ is verifiably clean (CommonJS, no ESM imports that V8 script mode would reject) — confirmed by `npm pack` + `tar -xzf` + `loadClassInIsolation` against the published tarball on Node 24.

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

**Confirm the install succeeded** — open a workflow, add a node, search for `Influtics`. All four should appear: **Influtics Video**, **Influtics Blogger**, **Influtics Trend**, **Influtics Account**.

If they still don't appear, capture the install log from `Settings → Community Nodes → click the package → View error log` and open an issue at https://github.com/Influtics/n8n-nodes-influtics/issues with the log attached.

## Documentation

- Public API reference: https://docs.influtics.com/
- Issues: https://github.com/Influtics/n8n-nodes-influtics/issues

## License

MIT — see [LICENSE](LICENSE).