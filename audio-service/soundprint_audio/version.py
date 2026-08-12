"""Analyzer versioning.

ANALYZER_VERSION is stored alongside every persisted analysis. When the
extraction logic changes in a way that would produce different numbers for the
same input, bump it. The web app compares the stored version against the
service's current version to decide whether a re-analysis is warranted, so
analyses are never silently recomputed and never silently stale.

Bump MINOR when adding new fields (old analyses remain valid, just thinner).
Bump MAJOR when existing field semantics change (old analyses are not
comparable to new ones).
"""

ANALYZER_VERSION = "1.0.0"
