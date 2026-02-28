# Memory Classification System

This document defines how memory is classified, scored, and returned in Roy.

## 1) Classification Axes

Roy classifies each memory on two primary axes:

- `kind` (6 values)
- `scope` (3 values)

### 1.1 `kind` values

- `identity`
- `task`
- `knowledge`
- `reference`
- `note`
- `unclassified`

### 1.2 `scope` values

- `session`
- `project`
- `global`

### 1.3 Total category combinations

Total possible category buckets:

- `6 kinds x 3 scopes = 18 buckets`

Examples:

- `knowledge/global`
- `identity/session`
- `task/project`
- `reference/global`

## 2) Memory Record Fields

Core fields used by classification and retrieval:

- `id`
- `parentId`
- `chunkIndex`
- `content`
- `kind`
- `scope`
- `importance`
- `tokenCount`
- `recallCount`
- `lastRecalledAt`
- `validityScore`
- `isNegative`
- `createdAt`
- `updatedAt`
- `embedding` (internal retrieval vector)

## 3) Auto Kind Classification (Non-regex)

When `remember` uses `kind=auto` (default), classification is semantic and embedding-based:

- Prototype Cluster (multiple prototypes per kind)
- Neighbor Density Voting (ANN neighbors, weighted by similarity)
- Confidence Fusion:
  - `final = 0.65 * prototype + 0.35 * density`
- Confidence threshold:
  - if confidence `< 0.75`, fallback to `knowledge`
- Self-learning prototype expansion:
  - if confidence `> 0.9`, memory embedding is appended to kind prototypes

This replaces regex-based kind inference.

## 4) Retrieval and Scoring Dimensions

Roy uses hybrid scoring with these components:

- `vectorScore` (semantic similarity)
- `lexicalScore` (keyword overlap / FTS boost)
- `importanceScore` (importance with decay)
- `recencyScore` (freshness)

Base weighted score:

- `0.6 * vector + 0.2 * lexical + 0.1 * importance + 0.1 * recency`

Then adjusted by:

- `validityScore` multiplier
- `isNegative` penalty

## 5) Recall Modes

CLI supports two recall modes:

- `--accurate` (default): stricter threshold, fewer/higher-confidence results
- `--reelated`: looser threshold, broader recall results

Both modes still use the same classification system (`kind/scope`), only thresholding differs.

## 6) Why seemingly related memories appear

If query is short (e.g. `like`), semantic search can still return conceptually close entries even without exact keyword matches.

That behavior is expected because vector similarity is dominant in scoring.

## 7) Display Format

Current human-readable recall output format:

- `[kind/scope] content`

Example:

- `[knowledge/global] I like minimalistic user interfaces`
