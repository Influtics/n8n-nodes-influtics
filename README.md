# n8n-nodes-influtics

Official [Influtics](https://influtics.com) integration for [n8n](https://n8n.io) — track influencer videos, bloggers, and trends across TikTok, Instagram, YouTube, VK, and more.

## Install

In n8n:

1. Go to **Settings → Community Nodes**.
2. Click **Install a community node**.
3. Enter `n8n-nodes-influtics` and confirm.

After install, configure the **Influtics API** credential with your API key from the Influtics dashboard under **Settings → API**.

## Nodes

| Node | Operations |
|-------|------------|
| **Influtics Video** | Track · Get Stats · Get By ID · Get By External ID · Update By External ID |
| **Influtics Blogger** | Track · Get Job · By Username |
| **Influtics Trend** | Search |
| **Influtics Account** | Get Usage · Get Limits |

## Documentation

- Public API reference: https://influtics.com/api-reference
- Design spec: [`plans/2026-08-23-n8n-nodes-influtics-design.md`](../blob/main/plans/2026-08-23-n8n-nodes-influtics-design.md) *(published in this repo after first tag)*
- Issues: https://github.com/Influtics/n8n-nodes-influtics/issues

## Status

`v0.0.0` — bootstrap. Implementation in progress; see the [design spec](plans/2026-08-23-n8n-nodes-influtics-design.md) for the full plan.

## License

MIT — see [LICENSE](LICENSE).