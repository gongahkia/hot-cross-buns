SHELL := /bin/sh

.PHONY: sync format format-check lint typecheck test check build benchmark clean

sync:
	uv sync --extra dev

format:
	uv run ruff format src tests tools/benchmark_python.py
	uv run ruff check --fix src tests tools/benchmark_python.py

format-check:
	uv run ruff format --check src tests tools/benchmark_python.py

lint:
	uv run ruff check src tests tools/benchmark_python.py

typecheck:
	uv run mypy src

test:
	PYTHONDONTWRITEBYTECODE=1 uv run pytest

check: format-check lint typecheck test

build:
	uv build

benchmark:
	PYTHONDONTWRITEBYTECODE=1 uv run python tools/benchmark_python.py

clean:
	rm -rf .mypy_cache .pytest_cache .ruff_cache dist
