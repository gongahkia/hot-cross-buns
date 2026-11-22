.PHONY: build setup runtime run web-check terminal terminal-setup terminal-build terminal-check package dist install check fmt test vet help

VERSION ?= dev
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
PACKAGE_DIR ?= $(CURDIR)/ui/release/hot-cross-buns-terminal
PREFIX ?= $(HOME)/.local
export VERSION COMMIT BUILD_DATE

# Terminal packaging uses the same Go runtime as the local web app.
build: setup runtime
	cd ui && bun run build

setup: app-host/node_modules/.package-lock.json ui/node_modules/.hot-cross-buns-ready

app-host/node_modules/.package-lock.json: app-host/package.json app-host/package-lock.json
	npm ci --prefix app-host
	@touch $@

ui/node_modules/.hot-cross-buns-ready: ui/package.json ui/bun.lock app-host/package.json
	cd ui && bun install --frozen-lockfile
	@touch $@

runtime:
	node ui/scripts/build-runtime.mjs

web/node_modules/.package-lock.json: web/package.json web/package-lock.json
	npm ci --prefix web
	@touch $@

run: app-host/node_modules/.package-lock.json web/node_modules/.package-lock.json runtime
	node web/main.mjs

web-check: app-host/node_modules/.package-lock.json web/node_modules/.package-lock.json runtime
	node --test web/tests/*.test.mjs

terminal: build
	bun ui/launcher/hot-cross-buns.mjs
terminal-setup: setup
terminal-build: build
terminal-check: check

package: build
	node ui/scripts/package.mjs "$(PACKAGE_DIR)"

dist: package

install: package
	node ui/scripts/install.mjs "$(PACKAGE_DIR)" "$(PREFIX)"

check: build test vet web/node_modules/.package-lock.json
	node --test web/tests/*.test.mjs
	cd ui && bun run check
	npm test --prefix app-host
	cd ui && bun run test
	node --test ui/scripts/install.test.mjs ui/scripts/uninstall.test.mjs scripts/google-oauth-build.test.mjs

fmt:
	gofmt -w cmd internal

test:
	go test ./...

vet:
	go vet ./...

help:
	@printf '%s\n' \
	  'make run      Start the local browser app' \
	  'make web-check Test the browser gateway with the Go runtime' \
	  'make terminal Build and open the chat TUI' \
	  'make build    Build the Go runtime and OpenTUI frontend' \
	  'make setup    Install pinned host and terminal dependencies' \
	  'make package  Create a fresh terminal package (PACKAGE_DIR=...)' \
	  'make install  Install a fresh package into PREFIX (default ~/.local)' \
	  'make check    Build, typecheck, test and vet the terminal product'
