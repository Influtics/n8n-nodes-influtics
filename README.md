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

## Documentation

- Public API reference: https://docs.influtics.com/
- Issues: https://github.com/Influtics/n8n-nodes-influtics/issues

## License

MIT — see [LICENSE](LICENSE).