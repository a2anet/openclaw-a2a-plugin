.PHONY: install lint typecheck test fix ci install-hooks

install:
	bun install

lint:
	bun run check

typecheck:
	bun run typecheck

test:
	bun test --coverage

fix:
	bun run check:fix

ci: lint typecheck test

install-hooks:
	./scripts/install-git-hooks.sh
