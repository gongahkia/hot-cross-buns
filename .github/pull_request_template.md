# Summary

- TBD

# User-visible behavior

- TBD

# Security and privacy

- [ ] no security/privacy impact
- [ ] touches OAuth, keyring storage, Google transport, SQLite, imports/exports,
      reminders, or diagnostics
- [ ] user-facing security/privacy documentation updated

# Validation

- [ ] `uv run ruff format --check src tests tools/benchmark_python.py`
- [ ] `uv run ruff check src tests tools/benchmark_python.py`
- [ ] `uv run mypy src`
- [ ] `PYTHONDONTWRITEBYTECODE=1 uv run pytest`
- [ ] `uv build`
- [ ] not run; explain:

# Documentation

- [ ] docs updated or not required
- [ ] live Google acceptance impact recorded
