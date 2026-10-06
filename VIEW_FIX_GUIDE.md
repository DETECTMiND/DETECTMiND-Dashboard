# Database View Fix Guide

This guide explains how to fix the database views in your DETECTMiND Supabase instance.

## Issues Fixed

### 1. **daily_usage - Invalid GROUP BY Clause** (CRITICAL)
- **Problem**: The GROUP BY clause included `u.unlock_count`, a non-aggregated column from the LEFT JOIN
- **Impact**: Creates duplicate rows—one for each unique unlock_count value
- **Example**: If a participant had 5 unlocks, the same daily data would appear in 5 separate rows
- **Fix**: Removed `u.unlock_count` from GROUP BY

### 2. **hourly_usage - Timezone Double-Conversion** (HIGH)
- **Problem**: Redundant timezone conversions could cause hour shifts, especially during DST transitions
- **Impact**: Incorrect usage_date and hour_of_day values near midnight or during timezone transitions
- **Fix**: Simplified timezone handling to apply AT TIME ZONE only once

---

## How to Fix

### Option 1: Quick Fix (Only the 2 broken views)
**Time**: ~30 seconds | **Risk**: Low

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your DETECTMiND project
3. Go to **SQL Editor**
4. Create a new query
5. Copy the contents of [`quick_fix_views.sql`](./quick_fix_views.sql)
6. Paste into the SQL editor
7. Click **Run**
8. Check the verification output (should show row counts)

### Option 2: Full Fix (All views, maximum safety)
**Time**: ~1 minute | **Risk**: Very Low

This recreates ALL views to ensure consistency.

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your DETECTMiND project
3. Go to **SQL Editor**
4. Create a new query
5. Copy the contents of [`fix_views.sql`](./fix_views.sql)
6. Paste into the SQL editor
7. Click **Run**
8. Verify using the commented verification queries at the bottom

---

## Verification

After running either script, verify the fixes worked:

### Quick Verification
Run these queries in the SQL editor:

```sql
-- Should return 0 rows (means no duplicates)
SELECT participant_id, usage_date, COUNT(*) as row_count
FROM daily_usage
GROUP BY participant_id, usage_date
HAVING COUNT(*) > 1;

-- Should return hours 0-23
SELECT DISTINCT hour_of_day FROM hourly_usage ORDER BY hour_of_day;

-- Check row counts are reasonable
SELECT 'daily_usage' as view_name, COUNT(*) as total_rows FROM daily_usage
UNION ALL
SELECT 'hourly_usage' as view_name, COUNT(*) as total_rows FROM hourly_usage
UNION ALL
SELECT 'daily_pickups' as view_name, COUNT(*) as total_rows FROM daily_pickups
UNION ALL
SELECT 'daily_notifications' as view_name, COUNT(*) as total_rows FROM daily_notifications
UNION ALL
SELECT 'daily_battery_summary' as view_name, COUNT(*) as total_rows FROM daily_battery_summary
UNION ALL
SELECT 'daily_steps' as view_name, COUNT(*) as total_rows FROM daily_steps;
```

### What to Look For
✅ **Good Signs**:
- Duplicate check returns 0 rows
- hour_of_day has values 0-23 (complete hours)
- All views have reasonable row counts

❌ **Bad Signs**:
- Duplicate check returns rows with COUNT(*) > 1
- hour_of_day is missing hours or has invalid values
- Views have 0 rows (if you have data)

---

## Dashboard Impact

After applying the fixes, the **Processed Data** page will show:

### Fixed Behaviors
1. **Daily Usage**: One row per participant per day (no duplicates)
2. **Hourly Usage**: Correct hour boundaries across timezone transitions
3. **Steps Dataset**: Accurate participant counts when viewing "All Participants" with "Average" mode
4. **Notifications Dataset**: Consistent averaging without record duplication

### In the Dashboard
- Go to **Processed Data** tab
- Select **Daily Usage** → should show 1 entry per participant per date
- Select **Hourly Usage** → check that hours align correctly (00:00 - 23:00)
- Select **All Participants** + **Average** mode → verify numbers are reasonable

---

## Files Included

| File | Purpose | Usage |
|------|---------|-------|
| `fix_views.sql` | Full recreation of ALL views | Best for complete consistency |
| `quick_fix_views.sql` | Only fixes the 2 broken views | Fastest option |
| `supabase_schema.sql` | Updated schema with fixes | Reference/documentation |

---

## Technical Details

### Changes Made

#### daily_usage
```sql
-- BEFORE (incorrect):
GROUP BY s.participant_id, s.usage_date, u.unlock_count;

-- AFTER (correct):
GROUP BY s.participant_id, s.usage_date;
```
**Why**: The LEFT JOIN already gives us u.unlock_count per participant-date. Grouping by its value creates multiple rows per date.

#### hourly_usage
```sql
-- BEFORE (risky):
generate_series(
    date_trunc('hour', start_ts AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London',
    date_trunc('hour', end_ts   AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London',
    interval '1 hour'
) AS hour_start
-- then later:
(hour_start AT TIME ZONE 'Europe/London')::date AS usage_date

-- AFTER (simplified):
generate_series(
    date_trunc('hour', start_ts AT TIME ZONE 'Europe/London'),
    date_trunc('hour', end_ts   AT TIME ZONE 'Europe/London'),
    interval '1 hour'
) AS hour_start
-- then later:
hour_start::date AS usage_date
```
**Why**: `date_trunc()` with AT TIME ZONE already returns a properly-aligned timestamp. Re-applying AT TIME ZONE creates unnecessary complexity and potential edge cases.

---

## Rollback

If you need to rollback to the original (broken) views:

1. Get the original from git history:
   ```bash
   git show HEAD~1:supabase_schema.sql > supabase_schema_old.sql
   ```

2. Extract just the view definitions from the old file

3. Or contact your dev team to restore from a backup

---

## Questions?

- **Dashboard still showing wrong numbers?** Ensure you ran one of the fix scripts completely
- **Error when running the script?** Check that the `screen_sessions` table exists (should be created automatically)
- **Need to verify the data?** Run the verification queries above

---

## Summary

| Item | Status |
|------|--------|
| daily_usage duplicates | ✅ Fixed |
| hourly_usage timezones | ✅ Fixed |
| JavaScript aggregation | ✅ Fixed (in previous commit) |
| Raw data sorting | ✅ Fixed (in previous commit) |
| Dashboard calculations | ✅ All correct |
