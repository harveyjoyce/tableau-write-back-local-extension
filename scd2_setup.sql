-- ============================================================
-- scd2_setup.sql
--
-- Run this in your Snowflake worksheet to add the three
-- required columns to an EXISTING table for SCD Type 2 support.
--
-- Replace MY_DATABASE, PUBLIC, and DIM_CUSTOMER with your
-- actual database, schema, and table names.
-- ============================================================

USE DATABASE MY_DATABASE;
USE SCHEMA PUBLIC;


-- ── Step 1: Add SCD columns to your existing table ───────────
-- You only need to do this once per table.

ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS
  VALID_FROM  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS
  VALID_TO    TIMESTAMP_NTZ DEFAULT NULL;

ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS
  IS_CURRENT  BOOLEAN DEFAULT TRUE;


-- ── Step 2: Back-fill existing rows ──────────────────────────
-- Mark all existing rows as current versions with VALID_FROM = now.

UPDATE DIM_CUSTOMER
SET VALID_FROM  = CURRENT_TIMESTAMP,
    VALID_TO    = NULL,
    IS_CURRENT  = TRUE
WHERE VALID_FROM IS NULL;


-- ── Step 3: Add a surrogate key if you don't have one ────────
-- The surrogate key is a simple auto-increment ID that uniquely
-- identifies each physical row (including expired versions).
-- If your table already has an auto-increment primary key, skip this.

ALTER TABLE DIM_CUSTOMER ADD COLUMN IF NOT EXISTS
  SK_ID  NUMBER AUTOINCREMENT PRIMARY KEY;


-- ── Step 4: Verify ───────────────────────────────────────────
SELECT SK_ID, CUSTOMER_ID, CUSTOMER_NAME,
       VALID_FROM, VALID_TO, IS_CURRENT
FROM DIM_CUSTOMER
ORDER BY CUSTOMER_ID, VALID_FROM;


-- ── How it looks after a few edits ───────────────────────────
--
-- SK_ID | CUSTOMER_ID | CUSTOMER_NAME | VALID_FROM          | VALID_TO            | IS_CURRENT
-- ------+-------------+---------------+---------------------+---------------------+-----------
--   1   |    42        | Acme Corp     | 2024-01-01 09:00:00 | 2024-06-15 14:30:00 | FALSE
--   2   |    42        | Acme Corp Ltd | 2024-06-15 14:30:00 | 2025-01-20 11:00:00 | FALSE
--   3   |    42        | Acme Ltd      | 2025-01-20 11:00:00 | NULL                | TRUE
--
-- Querying the current state:
SELECT * FROM DIM_CUSTOMER WHERE IS_CURRENT = TRUE;
--
-- Querying as of a specific date:
SELECT * FROM DIM_CUSTOMER
WHERE VALID_FROM <= '2024-09-01'
  AND (VALID_TO IS NULL OR VALID_TO > '2024-09-01');
--
-- In the editor:
--   Primary Key Column  = CUSTOMER_ID  (your business key)
--   Surrogate Key Column = SK_ID       (the auto-increment row ID)


-- ── Useful queries on the audit log ──────────────────────────

-- See all changes made in the last 7 days:
SELECT *
FROM SNOWFLAKE_EDITOR_AUDIT
WHERE CHANGED_AT >= DATEADD('day', -7, CURRENT_TIMESTAMP)
ORDER BY CHANGED_AT DESC;

-- See what changed for a specific record:
SELECT OPERATION, OLD_VALUES, NEW_VALUES, CHANGED_AT
FROM SNOWFLAKE_EDITOR_AUDIT
WHERE TABLE_NAME = 'DIM_CUSTOMER'
  AND PK_VALUE   = '42'
ORDER BY CHANGED_AT;

-- Count changes by operation type:
SELECT TABLE_NAME, OPERATION, COUNT(*) AS N, MAX(CHANGED_AT) AS LAST_CHANGE
FROM SNOWFLAKE_EDITOR_AUDIT
GROUP BY 1, 2
ORDER BY LAST_CHANGE DESC;
