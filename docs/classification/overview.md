# Classification

## Ownership

`services/intelligence` owns the rulebook, evidence, counterparties, UPI parsing, and classification. The API stores the resulting records.

## Boundaries

Mobile apps never call the classifier directly. Classification output crosses the boundary as a `classification.completed` event defined in `packages/domain-events`.
