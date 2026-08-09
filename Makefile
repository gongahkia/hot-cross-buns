SHELL := /bin/zsh

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Linux)
PRESET ?= fedora43-debug
FORMAT_PRESET ?= linux-format
else
PRESET ?= macos-debug
FORMAT_PRESET ?= macos-format
endif

.PHONY: configure build test format

configure:
	cmake --preset $(PRESET)

build: configure
	cmake --build --preset $(PRESET) --parallel 3

test: build
	ctest --preset $(PRESET) --output-on-failure

format:
	cmake --preset $(FORMAT_PRESET)
	cmake --build --preset $(FORMAT_PRESET) --parallel 3
