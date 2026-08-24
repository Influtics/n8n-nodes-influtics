# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [1.0.0] - 2026-08-24

First public community-node release. Covers the full Influtics public REST API surface:

- InfluticsApi credential (single Bearer API key).
- InfluticsVideo node (5 operations).
- InfluticsBlogger node (3 operations, async Track returns job_id).
- InfluticsTrend node (1 operation).
- InfluticsAccount node (2 operations).
- GenericFunctions transport + error mapper.
- Vitest + nock test suite.
- GitHub Actions CI (lint + test on every push/PR).