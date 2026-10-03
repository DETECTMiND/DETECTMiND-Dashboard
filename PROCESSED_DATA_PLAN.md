# Processed Data — plan & architecture

The **Processed Data** tab turns the raw event streams the app uploads into
research-ready, derived datasets. This doc is the roadmap for growing it.

## Principle

Keep the division of labour clean:

- **App** → records raw, timestamped events only (screen on/off, app foreground,
  battery, location, …). No aggregation on-device.
- **Supabase (SQL views)** → all derivation and aggregation. Views are live,
  re-runnable, and changeable without an app release. This is where "processed
  data" lives.
- **Dashboard** → reads the views and presents tables + charts per participant.

Rule of thumb: if a number can be *computed from events*, compute it in a SQL
view, not in the app and not re-derived ad-hoc in React. One source of truth.

## What exists today

| View | Grain | Feeds |
|------|-------|-------|
| `screen_sessions` | one screen-on session (gap-capped 2h) | building block |
| `daily_usage` | participant × day | summary cards, daily totals |
| `hourly_usage` | participant × hour | hourly table + heatmap + avg-by-hour |
| `daily_app_usage` | participant × day × app | top-apps |

Dashboard page: `studies/[id]/processed/page.tsx` — per-participant selector,
summary cards, average-minutes-per-hour chart, and a date × hour heatmap table.

All views bucket by **Europe/London**. Change the timezone in one place
(`migration_2026_10_usage_summary_views.sql` / `supabase_schema.sql`).

## Roadmap — more processed datasets

Each item = one SQL view + one section on the Processed Data page. Ordered by
likely research value.

1. **Daily app-category usage** — group `data_app_usage` by a category map
   (social / messaging / productivity / games / browsing). Needs a small
   `package_name → category` lookup table (or the app_category the gesture
   collector already resolves). View: `daily_category_usage`.

2. **Unlocks & pickups per day/hour** — frequency of phone pickups (unlock
   events) as its own metric, separate from duration. A "checking habit"
   signal. View: `pickups_hourly`.

3. **First-use / last-use per day** — timestamp of first unlock and last
   screen-off each day (sleep/wake proxy). View: `daily_first_last_use`.

4. **Night-time usage** — screen-on minutes between e.g. 00:00–06:00 per day.
   Derivable from `hourly_usage` with a WHERE on `hour_of_day`.

5. **Notification response latency** — pair `data_notifications.posted_at` with
   the next unlock / app-open; median time-to-respond. Uses screen_state +
   notifications.

6. **Battery & charging patterns** — daily charge cycles, time-on-charger,
   average discharge rate, from `data_battery`. View: `daily_battery_summary`.

7. **Location-derived** — daily number of distinct places (cluster lat/long),
   time at home vs out, total distance. Heavier; consider PostGIS.

8. **ESM compliance** — response rate, median latency, per schedule, from
   `data_esm_responses` (expired vs answered). View: `esm_compliance`.

9. **Communication summary** — calls/SMS counts and durations per day, from
   `data_calls` / `data_sms` (hashed contacts, so counts only).

## How to add a new processed dataset (checklist)

1. Write a `CREATE OR REPLACE VIEW` with `security_invoker = on`, bucket by the
   study timezone, `GRANT SELECT ... TO authenticated`.
2. Add it to both `supabase_schema.sql` (canonical) and a new
   `migration_YYYY_MM_*.sql` (to run on the live DB).
3. Add a section to `processed/page.tsx` (summary cards + table and/or chart),
   reusing the participant selector and the loading/error patterns already there.
4. If a lookup table is needed (e.g. app categories), add it to the schema and
   seed it.
5. Run the migration in the Supabase SQL editor.

## Data-quality notes

- Screen sessions can be inflated by dropped `off` events → capped at 2h and
  flagged via `was_capped` / `capped_sessions`. Surface capped counts so
  researchers can judge reliability per participant.
- `data_app_usage` (UsageStatsManager) is the robust cross-check for
  screen-based totals; large divergence flags missing screen_state events.
