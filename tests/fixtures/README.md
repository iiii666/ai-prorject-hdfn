# Legacy compatibility fixtures

Source: Node.js commit `462a7a99a9bd2e250be5e430241a484af523b636`, `DW_SEED_END=2026-11-10`.

`legacy.json` contains five analytics/order queries (default, filtered, full prior year, leap month, empty range), three forecasts, and bootstrap. Only generated timestamps are excluded from comparisons. Monetary values, percentages, rankings, and ordering are compared.

`seed_hashes.json` hashes every generated row per table using UTF-8 canonical JSON (sorted keys, compact separators), excluding `created_at` and `finished_at`. It verifies the Python generator preserves the original seeded data, including order/campaign associations.

`schema.sql` is the original SQLite test schema. It is used only by isolated tests; the application and generator do not depend on it.
