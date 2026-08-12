"""Feature ontology: mapping external vocabulary onto Soundprint concepts.

The rule this module exists to enforce:

    genre      is not Sound DNA
    mood       is not DSP
    instrument label is not an isolated-source measurement

An external dataset saying a track is "dark" is evidence that *a human or a
classifier applied the word dark*. It is not a brightness measurement. The two
correlate; they are not the same evidence, and collapsing them would let a mood
tag be laundered into an acoustic claim.

So every mapping carries a `relation`:

    maps_to          the external term IS this Soundprint concept
    correlates_with  the terms tend to co-occur, but one does not imply the other
    unmapped         recorded so we know it exists, deliberately not translated

Only `maps_to` mappings are used to resolve semantic queries. `correlates_with`
rows are documentation and future analysis material — the query layer never
follows them to produce a claim.

Numeric features are a different problem: they mean roughly the same thing
across extractors but are not interchangeable in absolute value. Essentia's BPM
and librosa's BPM usually agree; their spectral centroids are computed over
different windows and do not. FEATURE_MAP records the canonical Soundprint
feature name plus how comparable the external value actually is.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------- semantics

# Soundprint semantic concept namespace. Deliberately shallow — this is a
# vocabulary for grouping comparison populations, not a musicological taxonomy.
SEMANTIC_NAMESPACES = ("semantic.genre", "semantic.mood", "semantic.theme", "semantic.instrument")


@dataclass(frozen=True)
class SemanticMapping:
    external_term: str
    external_dataset: str
    external_type: str
    soundprint_concept: str
    relation: str
    notes: str = ""


def normalize_label(raw: str) -> str:
    """Lowercase, strip, collapse separators. Keeps distinct concepts distinct."""
    return "-".join(raw.strip().lower().replace("_", " ").replace("/", " ").split())


def semantic_concept(label_type: str, label: str) -> str:
    ns = {
        "genre": "semantic.genre",
        "mood": "semantic.mood",
        "theme": "semantic.theme",
        "instrument": "semantic.instrument",
        "tag": "semantic.tag",
    }[label_type]
    return f"{ns}.{normalize_label(label)}"


# Terms whose acoustic-sounding names make conflation especially tempting.
# Recorded explicitly so the correlation is documented and *not* acted on.
KNOWN_CORRELATIONS: list[SemanticMapping] = [
    SemanticMapping(
        "dark", "mtg-jamendo", "mood", "acoustic.spectral.brightness_index", "correlates_with",
        "Tracks tagged dark often have a low spectral centroid, but the tag is applied to "
        "mood and lyrical content too. Never resolve 'dark' to a brightness threshold.",
    ),
    SemanticMapping(
        "energetic", "mtg-jamendo", "mood", "acoustic.dynamics.loudness_range_db", "correlates_with",
        "Perceived energy tracks loudness and density, but a quiet track can be tagged energetic.",
    ),
    SemanticMapping(
        "calm", "mtg-jamendo", "mood", "acoustic.rhythm.onset_density_per_beat", "correlates_with",
        "Calm correlates with sparse events; it is not a density measurement.",
    ),
    SemanticMapping(
        "heavy", "mtg-jamendo", "mood", "acoustic.bass.low_end_ratio", "correlates_with",
        "'Heavy' is used for distortion, tempo and subject matter as well as low end.",
    ),
    SemanticMapping(
        "ambient", "mtg-jamendo", "genre", "acoustic.tempo.pulse_clarity", "correlates_with",
        "Ambient material often has weak pulse, but the genre label is not a pulse measurement.",
    ),
    SemanticMapping(
        "acoustic", "mtg-jamendo", "instrument", "acoustic.spectral.flatness", "correlates_with",
        "An instrument label. Soundprint runs no source separation and cannot verify it.",
    ),
]


# --------------------------------------------------------------- numerics

@dataclass(frozen=True)
class FeatureMapping:
    """How an external numeric feature relates to a Soundprint measurement."""

    external_name: str
    external_dataset: str
    soundprint_feature: str
    extractor: str
    #  'same_quantity'      measures the same thing; ranks and values comparable
    #  'same_rank_only'     measures the same thing differently; compare ranks, not values
    #  'related_quantity'   related but distinct; do not pool into one distribution
    comparability: str
    notes: str = ""


FEATURE_MAP: list[FeatureMapping] = [
    # ---- AcousticBrainz (Essentia) ----
    FeatureMapping(
        "rhythm.bpm", "acousticbrainz", "tempo.bpm", "essentia", "same_quantity",
        "Both estimate beats per minute. Octave errors occur in both; distributions align well.",
    ),
    FeatureMapping(
        "rhythm.onset_rate", "acousticbrainz", "rhythm.onset_rate_per_second", "essentia", "same_rank_only",
        "Onset detection functions differ; ordering is informative, absolute rate is not.",
    ),
    FeatureMapping(
        "rhythm.danceability", "acousticbrainz", "rhythm.danceability_external", "essentia", "related_quantity",
        "Soundprint measures no danceability. Kept as external-only context; never pooled.",
    ),
    FeatureMapping(
        "tonal.key_key", "acousticbrainz", "tonal.key", "essentia", "same_quantity",
        "Pitch-class name. Directly comparable as a category.",
    ),
    FeatureMapping(
        "tonal.key_scale", "acousticbrainz", "tonal.mode", "essentia", "same_quantity",
        "major/minor. Directly comparable.",
    ),
    FeatureMapping(
        "tonal.key_strength", "acousticbrainz", "tonal.key_confidence", "essentia", "same_rank_only",
        "Different confidence formulations; ranks comparable, absolute values not.",
    ),
    FeatureMapping(
        "tonal.chords_changes_rate", "acousticbrainz", "tonal.harmonic_change_rate", "essentia", "same_rank_only",
        "Essentia counts chord-symbol changes; Soundprint thresholds chroma distance. Related, not identical.",
    ),
    # ---- FMA (librosa + Echonest) ----
    FeatureMapping(
        "echonest.audio_features.tempo", "fma", "tempo.bpm", "echonest", "same_quantity",
        "Echonest tempo estimate.",
    ),
    FeatureMapping(
        "echonest.audio_features.energy", "fma", "dynamics.energy_external", "echonest", "related_quantity",
        "A proprietary composite. Soundprint has no equivalent; never pooled with native features.",
    ),
    FeatureMapping(
        "echonest.audio_features.acousticness", "fma", "production.acousticness_external", "echonest", "related_quantity",
        "Proprietary classifier output. Context only.",
    ),
    FeatureMapping(
        "spectral_centroid.mean", "fma", "spectral.centroid_hz_mean", "librosa", "same_rank_only",
        "Same librosa function, but FMA computes it at a different sample rate and hop than "
        "Soundprint. Ranks comparable; absolute Hz should not be pooled.",
    ),
]

FEATURES_SAFE_TO_POOL = {
    m.soundprint_feature for m in FEATURE_MAP if m.comparability == "same_quantity"
}
"""Only these may be pooled into one cross-dataset distribution.

Everything else is kept per-dataset, because pooling incomparable extractors
produces a distribution that looks authoritative and means nothing.
"""


def load_into(conn) -> int:
    """Persist the ontology so the running product can explain any mapping."""
    rows = 0

    for m in KNOWN_CORRELATIONS:
        conn.execute(
            """INSERT OR REPLACE INTO ontology_term
               (external_term, external_dataset, external_type, soundprint_concept, relation, notes)
               VALUES (?,?,?,?,?,?)""",
            (m.external_term, m.external_dataset, m.external_type,
             m.soundprint_concept, m.relation, m.notes),
        )
        # The term's true home is its semantic concept, recorded alongside.
        conn.execute(
            """INSERT OR REPLACE INTO ontology_term
               (external_term, external_dataset, external_type, soundprint_concept, relation, notes)
               VALUES (?,?,?,?,?,?)""",
            (m.external_term, m.external_dataset, m.external_type,
             semantic_concept(m.external_type, m.external_term), "maps_to",
             "Semantic label, not an acoustic measurement."),
        )
        rows += 2

    for f in FEATURE_MAP:
        conn.execute(
            """INSERT OR REPLACE INTO ontology_term
               (external_term, external_dataset, external_type, soundprint_concept, relation, notes)
               VALUES (?,?,?,?,?,?)""",
            (f.external_name, f.external_dataset, "numeric_feature",
             f"acoustic.{f.soundprint_feature}", "maps_to",
             f"[{f.comparability}] extractor={f.extractor}. {f.notes}"),
        )
        rows += 1

    return rows
