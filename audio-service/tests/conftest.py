from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def _ensure_fixtures() -> None:
    """Generate the synthetic audio if it is missing.

    Fixtures are synthesised rather than committed: they are large, and
    regenerating them from code keeps their ground truth visible in the repo.
    """
    if (FIXTURES / "dark_pop_reference.wav").exists():
        return
    import sys

    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
    import make_test_audio  # type: ignore

    make_test_audio.main()


@pytest.fixture(scope="session", autouse=True)
def fixtures_present() -> None:
    _ensure_fixtures()


@pytest.fixture(scope="session")
def analyzer():
    from soundprint_audio.analyzer import LibrosaAnalyzer

    return LibrosaAnalyzer()


@pytest.fixture(scope="session")
def dark_pop(analyzer):
    """Ground truth: 100 BPM, 4/4, A minor, half-time feel, hook lift after 0:40."""
    return analyzer.analyze(FIXTURES / "dark_pop_reference.wav")


@pytest.fixture(scope="session")
def bright_uptempo(analyzer):
    """Ground truth: 128 BPM, 4/4, C major, straight backbeat, drop at 0:24."""
    return analyzer.analyze(FIXTURES / "bright_uptempo_reference.wav")


@pytest.fixture(scope="session")
def sparse_ambient(analyzer):
    """Ground truth: mono, no percussion, no meaningful pulse."""
    return analyzer.analyze(FIXTURES / "sparse_ambient_reference.wav")
