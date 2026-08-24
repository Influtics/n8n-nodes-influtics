# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial community-node release covering all public Influtics API endpoints.

## [0.1.0] - TBD

### Added
- InfluticsApi credential (single API key).
- InfluticsVideo node: Track, Get Stats, Get By ID, Get By External ID, Update By External ID.
- InfluticsBlogger node: Track, Get Job, By Username.
- InfluticsTrend node: Search.
- InfluticsAccount node: Get Usage, Get Limits.
- Shared GenericFunctions transport + error mapper.
- Vitest test suite with nock fixtures covering success, error, and 402 paywall cases.
- GitHub Actions CI (lint + test).