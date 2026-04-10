# Changelog

## [0.2.0](https://github.com/a2anet/openclaw-a2a-plugin/compare/openclaw-a2a-plugin-v0.1.0...openclaw-a2a-plugin-v0.2.0) (2026-04-10)


### Features

* add comprehensive data and file support, reorganize A2A config, and fix `inbound.agentCard` persistence ([1518ad0](https://github.com/a2anet/openclaw-a2a-plugin/commit/1518ad04171fa16dbd76b64c68c509d38cc115b1))
* implement A2A protocol plugin for OpenClaw ([da13e48](https://github.com/a2anet/openclaw-a2a-plugin/commit/da13e488644c3fe751894b4280d26495054261e5))
* initialize project from javascript-template ([3921056](https://github.com/a2anet/openclaw-a2a-plugin/commit/3921056479896c4516b009427bdb3d1bdd2e7d15))
* route inbound A2A through OpenClawExecutor and align README.md with current config ([d1e2e4d](https://github.com/a2anet/openclaw-a2a-plugin/commit/d1e2e4dc961c4b8fcf661e83521481a47af73118))


### Bug Fixes

* convert Zod schemas to JSON Schema and default to `http` for local connections ([6555db8](https://github.com/a2anet/openclaw-a2a-plugin/commit/6555db8a8adc2b647c2608ccb898bb2b3bd9bd15))
* serve request-scoped Agent Cards from `/.well-known/agent-card.json` ([f815bea](https://github.com/a2anet/openclaw-a2a-plugin/commit/f815bea888fb95f93314d5172eb2375d41d17916))
* thread inbound A2A conversations by sender label and tighten auth label handling ([98ba9b5](https://github.com/a2anet/openclaw-a2a-plugin/commit/98ba9b5204fdd433ce05487306f5cf5d6fbbb3c5))
* update  for the current  and OpenClaw plugin APIs ([6bcb4f7](https://github.com/a2anet/openclaw-a2a-plugin/commit/6bcb4f7c798b28b5c19f73adc18eb4863a2795c5))
