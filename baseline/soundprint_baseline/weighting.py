"""Source-balanced distributions.

The problem this solves
-----------------------
AcousticBrainz supplies tens of millions of rows; an optional local seed
supplies at most a few hundred. Pooling them by row count would make "normal music" mean "normal
AcousticBrainz", and every downstream comparative claim would silently inherit
that corpus's collection bias — heavily Western, heavily catalogued, heavily
whatever MusicBrainz contributors happened to submit.

So distributions are computed with **weights, not counts**:

    natural_share_d  = n_d / N                      how much the dataset has
    capped_share_d   = min(natural_share_d, cap)    ceiling applied
    target_share_d   = capped_share_d / Σ capped    renormalised
    weight_i         = target_share_d / n_d         per track, uniform in-source

A dataset with 95% of the rows and a 0.40 cap ends up contributing 40% of the
*weight*. It still dominates — it should, it is genuinely broader — but it can
no longer define the baseline by itself.

This is not an attempt to make every category mathematically equal. It is an
attempt to stop whichever dataset happens to be largest from deciding what
"typical" means.

Support thresholds
------------------
Weighting cannot rescue a thin population. A neighbourhood of nine tracks has
no meaningful 95th percentile no matter how carefully it is weighted, so
`ClaimGate` refuses claims below a support floor and refuses *strong* claims
("unusually high") below a higher one. Suppression is the correct output for
thin evidence, not a wider error bar.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class WeightingPolicy:
    policy_id: str
    max_source_share: float = 0.40
    # How far a small source may be up-weighted relative to its natural share.
    #
    # Capping alone is not enough. AcousticBrainz supplies 7.5M tempo values and
    # FMA supplies 13k. Cap-then-renormalise would hand those 13k tracks 60% of
    # the weight — each one counting for ~3,400 AcousticBrainz tracks. That is
    # "balanced" arithmetically and worthless statistically: the global picture
    # would be decided by whichever 13k tracks Echonest happened to analyse.
    #
    # So a source can be lifted toward parity, but only so far. Where the gap is
    # too large to close honestly, the result stays lopsided, `max_source_share`
    # records it, and ClaimGate downgrades the claim instead of pretending.
    max_upweight: float = 20.0
    # Below this a source is too small to represent its corpus and is included
    # at natural weight rather than being lifted at all.
    min_source_n_for_balancing: int = 500
    within_source: str = "uniform"
    stratify_by: tuple[str, ...] = ("dataset",)
    # A percentile from fewer than this many observations is noise.
    min_support_n: int = 200
    # "Unusual" is a stronger claim and needs a stronger sample.
    min_support_n_strong: int = 1000
    # A *global* claim backed by a single corpus is a claim about that corpus.
    min_sources: int = 2
    description: str = (
        "Source-capped weighting: no single dataset may exceed max_source_share of total "
        "weight. Tracks are weighted uniformly within a dataset. Claims are suppressed "
        "below the support thresholds rather than reported with wide uncertainty."
    )

    def to_json(self) -> str:
        d = asdict(self)
        d["stratify_by"] = list(self.stratify_by)
        return json.dumps(d, sort_keys=True)


DEFAULT_POLICY = WeightingPolicy(policy_id="balanced-v1")

# For a population that is by definition single-source (e.g. "the native
# Soundprint benchmark"), requiring two sources would suppress every claim. Such
# populations use this policy and are labelled as single-source in the UI.
SINGLE_SOURCE_POLICY = WeightingPolicy(
    policy_id="single-source-v1",
    max_source_share=1.0,
    min_sources=1,
    description=(
        "For intentionally single-corpus populations. No cross-source balancing is "
        "possible, so claims must be framed as relative to that corpus by name."
    ),
)


@dataclass
class SourceContribution:
    dataset_id: str
    n_raw: int
    natural_share: float = 0.0
    effective_share: float = 0.0
    per_track_weight: float = 0.0


@dataclass
class WeightedDistribution:
    feature: str
    n: int
    n_null: int
    n_sources: int
    max_source_share: float
    quantiles: dict[str, float]
    mean: float
    stddev: float
    sources: list[SourceContribution] = field(default_factory=list)
    # Sorted (value, cumulative_weight_fraction) ladder for percentile lookup
    # without retaining every observation.
    grid: list[tuple[float, float]] = field(default_factory=list)


def compute_source_weights(
    counts: dict[str, int], policy: WeightingPolicy
) -> dict[str, SourceContribution]:
    """Derive a per-track weight for each source.

    Two bounds are applied before renormalising:

        ceiling   min(natural_share, max_source_share)
                  stops the largest corpus defining the baseline alone

        lift      natural_share * max_upweight
                  stops a tiny corpus being handed the baseline instead

    A source below `min_source_n_for_balancing` is not lifted at all — with a
    few hundred tracks it cannot stand in for its corpus, so it participates at
    its natural weight and nothing more.

    Note that `max_upweight` bounds the *target* share before renormalisation.
    Once larger sources are capped, the surviving shares are rescaled to sum to
    1, so a small source's final multiple can exceed max_upweight. On the real
    corpus FMA lifts ~46x rather than 20x, taking it from 0.2% to 8% of the
    weight: present rather than invisible, and still nowhere near dominant.
    `effective_share` always reports the truth, and ClaimGate reads it.
    """
    total = sum(counts.values())
    if total <= 0:
        return {}

    contributions = {
        d: SourceContribution(dataset_id=d, n_raw=n, natural_share=n / total)
        for d, n in counts.items()
        if n > 0
    }
    if not contributions:
        return {}

    targets: dict[str, float] = {}
    for d, c in contributions.items():
        ceiling = min(c.natural_share, policy.max_source_share)
        if c.n_raw >= policy.min_source_n_for_balancing:
            lift = min(policy.max_source_share, c.natural_share * policy.max_upweight)
            targets[d] = max(ceiling, lift)
        else:
            targets[d] = c.natural_share

    target_total = sum(targets.values())
    if target_total <= 0:
        return {}

    for d, c in contributions.items():
        c.effective_share = targets[d] / target_total
        c.per_track_weight = c.effective_share / c.n_raw if c.n_raw else 0.0

    return contributions


QUANTILE_LEVELS = (0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)
GRID_POINTS = 201
"""Resolution of the stored percentile ladder — 0.5% steps.

Enough to place a value within half a percentile, which is finer than any claim
the product makes, while keeping each stored distribution a few KB.
"""


def weighted_quantile(
    sorted_pairs: list[tuple[float, float]], total_weight: float, q: float
) -> float:
    """Quantile of a weighted sample, given (value, weight) sorted by value."""
    if not sorted_pairs or total_weight <= 0:
        return math.nan
    target = q * total_weight
    cum = 0.0
    for value, w in sorted_pairs:
        cum += w
        if cum >= target:
            return value
    return sorted_pairs[-1][0]


def build_distribution(
    feature: str,
    values_by_source: dict[str, list[float]],
    policy: WeightingPolicy,
    n_null: int = 0,
) -> WeightedDistribution | None:
    """Compute a source-balanced distribution, or None if nothing usable.

    Returning None rather than an empty distribution is deliberate: a caller
    that gets an object back should be able to trust it has content.
    """
    counts = {d: len(v) for d, v in values_by_source.items() if v}
    if not counts:
        return None

    contributions = compute_source_weights(counts, policy)
    if not contributions:
        return None

    pairs: list[tuple[float, float]] = []
    for dataset_id, values in values_by_source.items():
        c = contributions.get(dataset_id)
        if not c or not values:
            continue
        w = c.per_track_weight
        pairs.extend((float(v), w) for v in values)

    if not pairs:
        return None

    pairs.sort(key=lambda p: p[0])
    total_weight = sum(w for _, w in pairs)
    n = len(pairs)

    quantiles = {
        f"p{int(round(q * 100)):02d}": weighted_quantile(pairs, total_weight, q)
        for q in QUANTILE_LEVELS
    }
    quantiles["min"] = pairs[0][0]
    quantiles["max"] = pairs[-1][0]

    mean = sum(v * w for v, w in pairs) / total_weight
    variance = sum(w * (v - mean) ** 2 for v, w in pairs) / total_weight
    stddev = math.sqrt(max(variance, 0.0))

    # Downsample to a fixed ladder so percentile lookup is O(log n) at query
    # time without keeping every observation in the database.
    grid: list[tuple[float, float]] = []
    cum = 0.0
    next_mark = 0.0
    step = 1.0 / (GRID_POINTS - 1)
    for value, w in pairs:
        cum += w
        frac = cum / total_weight
        while frac >= next_mark and len(grid) < GRID_POINTS:
            grid.append((value, round(next_mark, 5)))
            next_mark += step
    if not grid or grid[-1][1] < 1.0:
        grid.append((pairs[-1][0], 1.0))

    return WeightedDistribution(
        feature=feature,
        n=n,
        n_null=n_null,
        n_sources=len(contributions),
        max_source_share=max(c.effective_share for c in contributions.values()),
        quantiles=quantiles,
        mean=mean,
        stddev=stddev,
        sources=list(contributions.values()),
        grid=grid,
    )


# --------------------------------------------------------------- claim gate


@dataclass(frozen=True)
class ClaimVerdict:
    allowed: bool
    strength: str  # 'none' | 'descriptive' | 'strong'
    reason: str


class ClaimGate:
    """Decides whether the evidence supports a comparative statement at all.

    Three outcomes:

      none         say nothing — the sample cannot support a comparison
      descriptive  "higher than most tracks in this comparison set"
      strong       "unusually high relative to <named population>"

    The gate is applied before language is chosen, so an unsupported claim is
    never phrased and then softened; it is simply not made.
    """

    def __init__(self, policy: WeightingPolicy = DEFAULT_POLICY):
        self.policy = policy

    def evaluate(
        self, *, n: int, n_sources: int, max_source_share: float, is_global: bool
    ) -> ClaimVerdict:
        p = self.policy

        if n < p.min_support_n:
            return ClaimVerdict(
                False, "none",
                f"only {n} observations; {p.min_support_n} required for any comparative claim",
            )

        if is_global and n_sources < p.min_sources:
            return ClaimVerdict(
                False, "none",
                f"global claim needs at least {p.min_sources} independent sources, has {n_sources}",
            )

        # Even after capping, a population can remain lopsided — for instance
        # when only one source measures the feature at all. Report it
        # descriptively rather than as a fact about music in general.
        if max_source_share > 0.85 and is_global:
            return ClaimVerdict(
                True, "descriptive",
                f"one source contributes {max_source_share:.0%} of the weight; "
                "claim limited to describing this comparison set",
            )

        if n < p.min_support_n_strong:
            return ClaimVerdict(
                True, "descriptive",
                f"{n} observations supports a descriptive comparison but not a strong one "
                f"({p.min_support_n_strong} required)",
            )

        return ClaimVerdict(True, "strong", f"{n} observations across {n_sources} sources")
