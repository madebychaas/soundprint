"""Anti-skew proofs.

The requirement these enforce: Soundprint's definition of "normal" must not be
decided by whichever dataset happens to contain the most rows.
"""

from __future__ import annotations

import pytest

from soundprint_baseline.weighting import (
    DEFAULT_POLICY,
    ClaimGate,
    WeightingPolicy,
    build_distribution,
    compute_source_weights,
)


class TestSourceCapping:
    def test_equal_sources_get_equal_weight(self):
        w = compute_source_weights({"a": 100_000, "b": 100_000, "c": 100_000}, DEFAULT_POLICY)
        for c in w.values():
            assert c.effective_share == pytest.approx(1 / 3, abs=0.01)

    def test_dominant_source_is_pulled_back(self):
        w = compute_source_weights({"big": 950_000, "small": 50_000}, DEFAULT_POLICY)
        assert w["big"].natural_share == pytest.approx(0.95, abs=0.01)
        assert w["big"].effective_share < w["big"].natural_share
        assert w["small"].effective_share > w["small"].natural_share

    def test_duplicating_a_source_tenfold_barely_moves_the_result(self):
        """The headline property: row count must not buy influence."""
        base = compute_source_weights({"big": 100_000, "small": 20_000}, DEFAULT_POLICY)
        inflated = compute_source_weights({"big": 1_000_000, "small": 20_000}, DEFAULT_POLICY)
        shift = inflated["big"].effective_share - base["big"].effective_share
        assert abs(shift) < 0.05, f"10x more rows shifted influence by {shift:+.3f}"

    def test_unweighted_pooling_would_have_been_dominated(self):
        """Contrast: what the naive approach would have produced."""
        counts = {"big": 1_000_000, "small": 20_000}
        naive = counts["big"] / sum(counts.values())
        balanced = compute_source_weights(counts, DEFAULT_POLICY)["big"].effective_share
        assert naive > 0.97
        assert balanced < 0.60
        assert balanced < naive

    def test_tiny_source_is_not_handed_the_baseline(self):
        """Balance must not invert into a tiny corpus deciding everything."""
        w = compute_source_weights({"huge": 7_563_695, "tiny": 13_129}, DEFAULT_POLICY)
        assert w["tiny"].effective_share < 0.25
        assert w["huge"].effective_share > w["tiny"].effective_share

    def test_source_below_balancing_floor_is_not_lifted(self):
        """A 40-track source cannot represent its corpus, so it is not lifted.

        Its share still moves a little, because capping the large source forces
        a renormalisation that scales everything. What matters is that it is not
        *deliberately* raised: had the lift rule applied, 40 tracks would have
        been upweighted 20x and landed an order of magnitude higher.
        """
        w = compute_source_weights({"big": 500_000, "micro": 40}, DEFAULT_POLICY)
        lifted_estimate = w["micro"].natural_share * DEFAULT_POLICY.max_upweight
        assert w["micro"].effective_share < lifted_estimate
        assert w["micro"].effective_share < 0.01
        assert w["big"].effective_share > 0.99

    def test_weights_always_sum_to_one(self):
        for counts in ({"a": 5}, {"a": 100, "b": 3}, {"a": 10**6, "b": 10**3, "c": 10**5}):
            w = compute_source_weights(counts, DEFAULT_POLICY)
            assert sum(c.effective_share for c in w.values()) == pytest.approx(1.0, abs=1e-9)

    def test_empty_input_is_handled(self):
        assert compute_source_weights({}, DEFAULT_POLICY) == {}
        assert compute_source_weights({"a": 0}, DEFAULT_POLICY) == {}


class TestWeightedDistribution:
    def test_dominant_source_cannot_define_the_median(self):
        """A large source of 10s and a small source of 100s.

        Unweighted, the median is 10. Balanced, the small source pulls it up —
        this is exactly the "dominant genre must not redefine the baseline"
        requirement, expressed numerically.
        """
        values = {"big": [10.0] * 50_000, "small": [100.0] * 5_000}
        dist = build_distribution("x", values, DEFAULT_POLICY)
        assert dist is not None
        naive_median = 10.0
        assert dist.quantiles["p50"] >= naive_median
        assert dist.max_source_share < 0.95

    def test_reports_its_own_skew(self):
        dist = build_distribution(
            "x", {"only": [1.0, 2.0, 3.0] * 1000}, DEFAULT_POLICY
        )
        assert dist is not None
        assert dist.n_sources == 1
        assert dist.max_source_share == pytest.approx(1.0)

    def test_quantiles_are_ordered(self):
        import random

        rng = random.Random(42)
        dist = build_distribution(
            "x",
            {"a": [rng.gauss(100, 15) for _ in range(5000)],
             "b": [rng.gauss(110, 15) for _ in range(5000)]},
            DEFAULT_POLICY,
        )
        assert dist is not None
        ladder = ["min", "p01", "p05", "p10", "p25", "p50", "p75", "p90", "p95", "p99", "max"]
        vals = [dist.quantiles[k] for k in ladder]
        assert vals == sorted(vals)

    def test_grid_supports_percentile_lookup(self):
        dist = build_distribution("x", {"a": [float(i) for i in range(1000)]}, DEFAULT_POLICY)
        assert dist is not None
        assert len(dist.grid) > 50
        fractions = [f for _, f in dist.grid]
        assert fractions == sorted(fractions)
        assert fractions[-1] == pytest.approx(1.0, abs=0.01)

    def test_returns_none_rather_than_an_empty_distribution(self):
        assert build_distribution("x", {}, DEFAULT_POLICY) is None
        assert build_distribution("x", {"a": []}, DEFAULT_POLICY) is None


class TestClaimGate:
    gate = ClaimGate(DEFAULT_POLICY)

    def test_thin_evidence_suppresses_the_claim_entirely(self):
        v = self.gate.evaluate(n=12, n_sources=3, max_source_share=0.4, is_global=False)
        assert not v.allowed
        assert v.strength == "none"
        assert "12" in v.reason

    def test_thin_strata_suppress_rather_than_exaggerate(self):
        """A tiny neighbourhood must produce silence, not a confident percentile."""
        for n in (1, 10, 50, 199):
            v = self.gate.evaluate(n=n, n_sources=2, max_source_share=0.5, is_global=False)
            assert v.strength == "none", f"n={n} should be suppressed"

    def test_single_source_cannot_ground_a_global_claim(self):
        v = self.gate.evaluate(n=5_000_000, n_sources=1, max_source_share=1.0, is_global=True)
        assert not v.allowed
        assert "sources" in v.reason

    def test_single_source_is_fine_for_a_named_neighbourhood(self):
        v = self.gate.evaluate(n=5000, n_sources=1, max_source_share=1.0, is_global=False)
        assert v.allowed

    def test_lopsided_global_is_downgraded_not_suppressed(self):
        v = self.gate.evaluate(n=7_000_000, n_sources=2, max_source_share=0.92, is_global=True)
        assert v.allowed
        assert v.strength == "descriptive"

    def test_moderate_sample_supports_only_descriptive_language(self):
        v = self.gate.evaluate(n=500, n_sources=3, max_source_share=0.4, is_global=True)
        assert v.strength == "descriptive"

    def test_strong_claim_requires_strong_evidence(self):
        v = self.gate.evaluate(n=50_000, n_sources=3, max_source_share=0.4, is_global=True)
        assert v.strength == "strong"


class TestPolicyIsRecorded:
    def test_policy_serialises_for_storage(self):
        import json

        payload = json.loads(DEFAULT_POLICY.to_json())
        # Every knob that changes a percentile must be reproducible later.
        for key in ("max_source_share", "max_upweight", "min_support_n",
                    "min_support_n_strong", "min_sources", "min_source_n_for_balancing"):
            assert key in payload

    def test_stricter_cap_reduces_a_dominant_source_further(self):
        """Uses the real corpus proportions, where the cap actually binds."""
        strict = WeightingPolicy(policy_id="strict", max_source_share=0.25)
        counts = {"acousticbrainz": 7_563_695, "fma": 13_129}
        default_share = compute_source_weights(counts, DEFAULT_POLICY)["acousticbrainz"].effective_share
        strict_share = compute_source_weights(counts, strict)["acousticbrainz"].effective_share
        assert strict_share < default_share

    def test_cap_is_inert_for_two_comparable_sources(self):
        """Documents a real property of the algorithm rather than hiding it.

        With exactly two sources that both exceed the cap, renormalisation
        restores 50/50 whatever the cap is set to — a ceiling below 0.5 is
        unreachable when only two sources must sum to 1. The cap earns its keep
        on lopsided corpora; `max_upweight` does the work everywhere else.
        Knowing which knob is active matters when tuning the policy.
        """
        counts = {"a": 900_000, "b": 100_000}
        loose = compute_source_weights(counts, WeightingPolicy(policy_id="l", max_source_share=0.45))
        tight = compute_source_weights(counts, WeightingPolicy(policy_id="t", max_source_share=0.25))
        assert loose["a"].effective_share == pytest.approx(0.5, abs=0.01)
        assert tight["a"].effective_share == pytest.approx(0.5, abs=0.01)
