.PHONY: build setup runtime run web-check check fmt test vet help

VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
export VERSION COMMIT BUILD_DATE

build: setup runtime
	@node --check web/main.mjs

setup: app-host/node_modules/.package-lock.json web/node_modules/.package-lock.json

app-host/node_modules/.package-lock.json: app-host/package.json app-host/package-lock.json
	npm ci --prefix app-host
	@touch $@

web/node_modules/.package-lock.json: web/package.json web/package-lock.json
	npm ci --prefix web
	@touch $@

runtime:
	node scripts/build-runtime.mjs

run: build
	node web/main.mjs

web-check: build
	node --test web/tests/*.test.mjs

check: build test vet
	node --test web/tests/*.test.mjs
	HOT_CROSS_BUNS_INDEPENDENCE_BINARY="$(CURDIR)/runtime/hot-cross-buns-runtime$(if $(filter Windows_NT,$(OS)),.exe,)" npm test --prefix app-host
	node --test scripts/google-oauth-build.test.mjs

fmt:
	gofmt -w cmd internal

test:
	go test ./...

vet:
	go vet ./...

help:
	@printf '%s\n' \
	  'make run       Start the local browser app' \
	  'make build     Build the Go backend runtime and prepare browser dependencies' \
	  'make web-check Test the browser gateway with the Go runtime' \
	  'make check     Build, test and vet the backend, host and browser app'
