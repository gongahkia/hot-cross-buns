from pathlib import Path

from hcb.benchmarks import create_large_fixture, measure_large_fixture


def test_deterministic_large_fixture_local_performance(tmp_path: Path) -> None:
    database = tmp_path / "large.db"
    create_large_fixture(database)
    result = measure_large_fixture(database)

    assert result.search_results == 11
    assert result.agenda_results > 100
    assert result.cached_tasks == 10_000
    assert result.cached_events == 2_000

    # These are regression tripwires, not microbenchmarks. The generous limits
    # tolerate shared CI runners while still detecting accidental quadratic work.
    assert result.cold_open_seconds < 5.0
    assert result.search_10k_seconds < 5.0
    assert result.agenda_seconds < 5.0
    assert result.tui_cache_load_seconds < 5.0
