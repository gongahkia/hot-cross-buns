.PHONY: run test smoke diagnostics regressions benchmark bench bench-update check render-smoke walk-smoke export-smoke clean

LOVE ?= love
LUAJIT ?= luajit

run:
	$(LOVE) .

test:
	$(LUAJIT) tests/run.lua

smoke:
	$(LUAJIT) tests/run.lua --smoke

diagnostics:
	$(LUAJIT) tests/run.lua --diagnostics

regressions:
	$(LUAJIT) tests/run.lua --regressions

benchmark:
	$(LUAJIT) tests/bench.lua --chunk-radius 1

bench:
	$(LUAJIT) tests/bench.lua --chunk-radius 1 --baseline tests/bench.baseline.json --baseline-tolerance 0.5

bench-update:
	$(LUAJIT) tests/bench.lua --chunk-radius 1 --update-baseline tests/bench.baseline.json

check: test smoke diagnostics regressions bench

render-smoke:
	SDL_AUDIODRIVER=dummy $(LOVE) . --skip-menu --render-smoke

walk-smoke:
	SDL_AUDIODRIVER=dummy $(LOVE) . --skip-menu --walk-smoke --walk-smoke-frames 240 --perf-interval 0.5

export-smoke:
	rm -rf dist/export-smoke
	mkdir -p dist/export-smoke
	SDL_AUDIODRIVER=dummy $(LOVE) . --skip-menu --export-map dist/export-smoke/map --export-size 64

clean:
	rm -rf dist
