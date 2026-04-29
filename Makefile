# Hot Cross Buns — CLI build shortcuts.
# All targets operate on the macOS app at apps/apple.
#
# Local CLI builds are unsigned by default so the edit loop does not depend on
# Xcode account-keychain provisioning profiles. Use `make build SIGN=1` when
# you explicitly want Xcode to sign with the project's development team.

APPLE_DIR := apps/apple
PROJECT   := $(APPLE_DIR)/HotCrossBuns.xcodeproj
SCHEME    := HotCrossBunsMac
DEST      := platform=macOS,arch=arm64
DERIVED   := build/apple/DerivedData
APP_PATH  := $(DERIVED)/Build/Products/Debug/Hot\ Cross\ Buns.app
SIGN      ?= 0
SIGNING_FLAGS_0 := CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
SIGNING_FLAGS_1 := -allowProvisioningUpdates
SIGNING_FLAGS := $(SIGNING_FLAGS_$(SIGN))

# DEVELOPMENT_TEAM is set in project.yml.
XCODEBUILD := xcodebuild \
	-project $(PROJECT) \
	-scheme $(SCHEME) \
	-destination '$(DEST)' \
	-derivedDataPath $(DERIVED)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: gen
gen: ## Regenerate the Xcode project from project.yml (required after adding files)
	cd $(APPLE_DIR) && xcodegen generate

.PHONY: build
build: gen ## Compile the macOS app (unsigned)
	$(XCODEBUILD) $(SIGNING_FLAGS) build

.PHONY: run
run: build ## Build and launch the app
	open $(APP_PATH)

.PHONY: rerun
rerun: ## Kill running app, rebuild, and launch (the common recompile-after-change loop)
	- killall HotCrossBunsMac 2>/dev/null || true
	$(MAKE) run

.PHONY: test
test: gen ## Run the full XCTest suite
	$(XCODEBUILD) $(SIGNING_FLAGS) test

.PHONY: test-one
test-one: gen ## Run one test suite. Usage: make test-one SUITE=TaskDraftTests
	@if [ -z "$(SUITE)" ]; then echo "Usage: make test-one SUITE=<TestClassName>"; exit 2; fi
	$(XCODEBUILD) $(SIGNING_FLAGS) test -only-testing:HotCrossBunsMacTests/$(SUITE)

.PHONY: open
open: gen ## Open the project in Xcode
	open $(PROJECT)

.PHONY: clean
clean: ## Remove build artefacts
	rm -rf $(DERIVED)
	rm -rf $(APPLE_DIR)/build

.PHONY: dmg
dmg: ## Package a signed / notarised DMG (requires Developer ID env + secrets)
	./scripts/package-macos-dmg.sh

.PHONY: watch
watch: ## Auto-rebuild on file change (requires fswatch: brew install fswatch)
	@command -v fswatch >/dev/null || { echo "fswatch not installed. brew install fswatch"; exit 1; }
	@echo "Watching $(APPLE_DIR)/HotCrossBuns for changes…"
	@fswatch -o -e '\.xcodeproj' $(APPLE_DIR)/HotCrossBuns | while read _; do $(MAKE) -s rerun; done
