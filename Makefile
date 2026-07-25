SHELL := /bin/zsh

PRESET ?= macos-debug

.PHONY: configure build test format

configure:
	cmake --preset $(PRESET)

build: configure
	cmake --build --preset $(PRESET) --parallel 3

test: build
	ctest --preset $(PRESET) --output-on-failure

format:
	cmake --preset macos-format
	cmake --build --preset macos-format --parallel 3
