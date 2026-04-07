-- ============================================================
-- practice_dataset.sql
--
-- Run this entire file in your Snowflake worksheet to create
-- three tables pre-loaded with realistic sample data.
--
-- BEFORE RUNNING: set your worksheet context at the top to
-- your database and schema (e.g. MY_DATABASE / PUBLIC)
--
-- HOW TO RUN:
--   1. Paste this whole file into a Snowflake worksheet
--   2. Click "Run All" (the play button with lines icon)
--
-- WHAT THIS CREATES:
--   DIM_CUSTOMER  -- 5 customers, each with 2-3 historical versions
--   DIM_PRODUCT   -- 6 products, each with 2 historical versions
--   FACT_ORDERS   -- 30 orders spread across 2022-2024
--
-- SUGGESTED PRACTICE EXERCISES (see bottom of file)
-- ============================================================


-- ============================================================
-- TABLE 1: DIM_CUSTOMER
-- A customer dimension with full SCD Type 2 history.
-- Each real-world customer has multiple rows showing how their
-- details changed over time.
-- ============================================================

CREATE OR REPLACE TABLE DIM_CUSTOMER (
    SK_ID           NUMBER AUTOINCREMENT PRIMARY KEY,  -- surrogate key (row identifier)
    CUSTOMER_ID     NUMBER        NOT NULL,             -- business key (same across versions)
    CUSTOMER_NAME   VARCHAR(100)  NOT NULL,
    EMAIL           VARCHAR(150),
    CITY            VARCHAR(100),
    COUNTRY         VARCHAR(50),
    TIER            VARCHAR(20),    -- Bronze / Silver / Gold / Platinum
    ACCOUNT_MANAGER VARCHAR(100),
    VALID_FROM      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    VALID_TO        TIMESTAMP_NTZ,                     -- NULL = currently active
    IS_CURRENT      BOOLEAN       NOT NULL DEFAULT TRUE
);

-- ── Customer 1: Acme Corp ─────────────────────────────────────
-- Started as Bronze in London, moved to Paris, upgraded to Gold
INSERT INTO DIM_CUSTOMER
    (CUSTOMER_ID, CUSTOMER_NAME, EMAIL, CITY, COUNTRY, TIER, ACCOUNT_MANAGER, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (1, 'Acme Corp', 'contact@acme.com', 'London', 'UK', 'Bronze', 'Sarah Chen',
     '2022-01-15 09:00:00', '2022-11-03 14:22:00', FALSE),

    (1, 'Acme Corp', 'contact@acme.com', 'Paris', 'France', 'Bronze', 'Sarah Chen',
     '2022-11-03 14:22:00', '2023-08-20 10:05:00', FALSE),

    (1, 'Acme Corp', 'contact@acme.com', 'Paris', 'France', 'Gold', 'Sarah Chen',
     '2023-08-20 10:05:00', NULL, TRUE);

-- ── Customer 2: Bright Futures Ltd ────────────────────────────
-- Started in Manchester, expanded internationally, changed account manager
INSERT INTO DIM_CUSTOMER
    (CUSTOMER_ID, CUSTOMER_NAME, EMAIL, CITY, COUNTRY, TIER, ACCOUNT_MANAGER, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (2, 'Bright Futures Ltd', 'hello@brightfutures.co.uk', 'Manchester', 'UK', 'Silver', 'James Park',
     '2022-03-01 08:30:00', '2023-02-14 16:45:00', FALSE),

    (2, 'Bright Futures Ltd', 'hello@brightfutures.co.uk', 'Dublin', 'Ireland', 'Silver', 'James Park',
     '2023-02-14 16:45:00', '2023-10-01 09:00:00', FALSE),

    (2, 'Bright Futures Ltd', 'hello@brightfutures.co.uk', 'Dublin', 'Ireland', 'Platinum', 'Emma Wilson',
     '2023-10-01 09:00:00', NULL, TRUE);

-- ── Customer 3: Delta Systems ──────────────────────────────────
-- Changed name after acquisition, upgraded tier
INSERT INTO DIM_CUSTOMER
    (CUSTOMER_ID, CUSTOMER_NAME, EMAIL, CITY, COUNTRY, TIER, ACCOUNT_MANAGER, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (3, 'Delta Systems', 'info@deltasystems.com', 'Berlin', 'Germany', 'Bronze', 'Marco Rossi',
     '2022-06-10 11:00:00', '2023-05-22 13:30:00', FALSE),

    (3, 'Delta Systems GmbH', 'info@deltasystems.de', 'Berlin', 'Germany', 'Silver', 'Marco Rossi',
     '2023-05-22 13:30:00', NULL, TRUE);

-- ── Customer 4: Evergreen Analytics ───────────────────────────
-- Moved city, then downgraded tier (common after contract renegotiation)
INSERT INTO DIM_CUSTOMER
    (CUSTOMER_ID, CUSTOMER_NAME, EMAIL, CITY, COUNTRY, TIER, ACCOUNT_MANAGER, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (4, 'Evergreen Analytics', 'team@evergreen.io', 'Amsterdam', 'Netherlands', 'Gold', 'Emma Wilson',
     '2021-11-20 10:00:00', '2023-01-08 09:15:00', FALSE),

    (4, 'Evergreen Analytics', 'team@evergreen.io', 'Rotterdam', 'Netherlands', 'Silver', 'Emma Wilson',
     '2023-01-08 09:15:00', NULL, TRUE);

-- ── Customer 5: Nova Retail Group ─────────────────────────────
-- New customer, only one version so far (a simple current-only record)
INSERT INTO DIM_CUSTOMER
    (CUSTOMER_ID, CUSTOMER_NAME, EMAIL, CITY, COUNTRY, TIER, ACCOUNT_MANAGER, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (5, 'Nova Retail Group', 'procurement@nova-retail.com', 'Stockholm', 'Sweden', 'Bronze', 'Sarah Chen',
     '2024-01-10 14:00:00', NULL, TRUE);


-- ============================================================
-- TABLE 2: DIM_PRODUCT
-- A product dimension with SCD Type 2 history tracking
-- price changes and category reassignments.
-- ============================================================

CREATE OR REPLACE TABLE DIM_PRODUCT (
    SK_ID           NUMBER AUTOINCREMENT PRIMARY KEY,
    PRODUCT_ID      NUMBER        NOT NULL,
    PRODUCT_NAME    VARCHAR(150)  NOT NULL,
    CATEGORY        VARCHAR(50),
    SUBCATEGORY     VARCHAR(50),
    UNIT_PRICE      NUMBER(10,2)  NOT NULL,
    SUPPLIER        VARCHAR(100),
    IS_ACTIVE       BOOLEAN       DEFAULT TRUE,
    VALID_FROM      TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    VALID_TO        TIMESTAMP_NTZ,
    IS_CURRENT      BOOLEAN       NOT NULL DEFAULT TRUE
);

-- ── Product 1: Cloud Storage Pro ──────────────────────────────
-- Price increased, then recategorised
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (101, 'Cloud Storage Pro', 'Software', 'Storage', 49.99, 'TechVault Ltd', TRUE,
     '2022-01-01', '2023-03-01', FALSE),

    (101, 'Cloud Storage Pro', 'SaaS', 'Infrastructure', 64.99, 'TechVault Ltd', TRUE,
     '2023-03-01', NULL, TRUE);

-- ── Product 2: Analytics Dashboard ────────────────────────────
-- Supplier changed, price dropped
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (102, 'Analytics Dashboard', 'Software', 'BI Tools', 199.00, 'DataWorks Inc', TRUE,
     '2022-01-01', '2022-09-15', FALSE),

    (102, 'Analytics Dashboard', 'SaaS', 'BI Tools', 149.00, 'OpenMetrics Co', TRUE,
     '2022-09-15', NULL, TRUE);

-- ── Product 3: Enterprise Support Package ─────────────────────
-- Price increase mid-year
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (103, 'Enterprise Support Package', 'Services', 'Support', 299.00, 'Internal', TRUE,
     '2022-01-01', '2023-07-01', FALSE),

    (103, 'Enterprise Support Package', 'Services', 'Support', 349.00, 'Internal', TRUE,
     '2023-07-01', NULL, TRUE);

-- ── Product 4: Mobile SDK License ─────────────────────────────
-- Recategorised from Software to Platform
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (104, 'Mobile SDK License', 'Software', 'Developer Tools', 89.99, 'DevKit Partners', TRUE,
     '2022-06-01', '2023-01-01', FALSE),

    (104, 'Mobile SDK License', 'Platform', 'Developer Tools', 89.99, 'DevKit Partners', TRUE,
     '2023-01-01', NULL, TRUE);

-- ── Product 5: Data Backup Service ────────────────────────────
-- Discontinued (IS_ACTIVE set to false)
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (105, 'Data Backup Service', 'Software', 'Storage', 29.99, 'TechVault Ltd', TRUE,
     '2022-01-01', '2023-11-30', FALSE),

    (105, 'Data Backup Service', 'Software', 'Storage', 29.99, 'TechVault Ltd', FALSE,
     '2023-11-30', NULL, TRUE);

-- ── Product 6: AI Insights Module ─────────────────────────────
-- New product, only one version
INSERT INTO DIM_PRODUCT
    (PRODUCT_ID, PRODUCT_NAME, CATEGORY, SUBCATEGORY, UNIT_PRICE, SUPPLIER, IS_ACTIVE, VALID_FROM, VALID_TO, IS_CURRENT)
VALUES
    (106, 'AI Insights Module', 'SaaS', 'AI & ML', 249.00, 'NeuralSoft', TRUE,
     '2024-01-15', NULL, TRUE);


-- ============================================================
-- TABLE 3: FACT_ORDERS
-- 30 orders spread across 2022-2024.
-- Uses CUSTOMER_ID and PRODUCT_ID (business keys) so you can
-- practice point-in-time joins against the dimension tables.
-- ============================================================

CREATE OR REPLACE TABLE FACT_ORDERS (
    ORDER_ID     NUMBER AUTOINCREMENT PRIMARY KEY,
    ORDER_DATE   DATE          NOT NULL,
    CUSTOMER_ID  NUMBER        NOT NULL,   -- FK to DIM_CUSTOMER (business key)
    PRODUCT_ID   NUMBER        NOT NULL,   -- FK to DIM_PRODUCT (business key)
    QUANTITY     NUMBER        NOT NULL,
    UNIT_PRICE   NUMBER(10,2)  NOT NULL,   -- price charged at time of order
    REVENUE      NUMBER(10,2)  NOT NULL,   -- QUANTITY * UNIT_PRICE
    STATUS       VARCHAR(20)   NOT NULL,   -- Completed / Pending / Cancelled
    REGION       VARCHAR(50)
);

INSERT INTO FACT_ORDERS (ORDER_DATE, CUSTOMER_ID, PRODUCT_ID, QUANTITY, UNIT_PRICE, REVENUE, STATUS, REGION)
VALUES
    -- 2022 orders (customers and products at their ORIGINAL versions)
    ('2022-02-10', 1, 101,  2,  49.99,   99.98, 'Completed', 'EMEA'),
    ('2022-03-15', 2, 102,  1, 199.00,  199.00, 'Completed', 'EMEA'),
    ('2022-04-01', 3, 103,  1, 299.00,  299.00, 'Completed', 'DACH'),
    ('2022-05-20', 4, 101,  5,  49.99,  249.95, 'Completed', 'Benelux'),
    ('2022-06-12', 1, 102,  1, 199.00,  199.00, 'Completed', 'EMEA'),
    ('2022-07-08', 2, 104,  3,  89.99,  269.97, 'Completed', 'EMEA'),
    ('2022-08-22', 4, 105,  2,  29.99,   59.98, 'Completed', 'Benelux'),
    ('2022-09-05', 3, 102,  1, 199.00,  199.00, 'Completed', 'DACH'),
    ('2022-10-18', 1, 103,  1, 299.00,  299.00, 'Completed', 'EMEA'),
    ('2022-11-30', 2, 101,  4,  49.99,  199.96, 'Completed', 'EMEA'),

    -- 2023 orders (some customers/products mid-transition)
    ('2023-01-14', 4, 101,  3,  49.99,  149.97, 'Completed', 'Benelux'),
    ('2023-02-28', 1, 104,  2,  89.99,  179.98, 'Completed', 'EMEA'),
    ('2023-03-20', 3, 103,  1, 299.00,  299.00, 'Completed', 'DACH'),
    ('2023-04-05', 2, 101,  1,  64.99,   64.99, 'Completed', 'EMEA'),
    ('2023-05-17', 4, 102,  2, 149.00,  298.00, 'Completed', 'Benelux'),
    ('2023-06-22', 1, 105,  5,  29.99,  149.95, 'Completed', 'EMEA'),
    ('2023-07-09', 3, 104,  1,  89.99,   89.99, 'Completed', 'DACH'),
    ('2023-08-01', 2, 103,  2, 349.00,  698.00, 'Completed', 'EMEA'),
    ('2023-09-14', 5, 106,  1, 249.00,  249.00, 'Pending',   'Nordic'),
    ('2023-10-30', 1, 101,  3,  64.99,  194.97, 'Completed', 'EMEA'),

    -- 2024 orders (current versions of all dimensions)
    ('2024-01-08', 2, 106,  2, 249.00,  498.00, 'Completed', 'EMEA'),
    ('2024-01-25', 3, 101,  4,  64.99,  259.96, 'Completed', 'DACH'),
    ('2024-02-14', 5, 102,  1, 149.00,  149.00, 'Completed', 'Nordic'),
    ('2024-02-28', 1, 106,  1, 249.00,  249.00, 'Completed', 'EMEA'),
    ('2024-03-10', 4, 103,  2, 349.00,  698.00, 'Cancelled', 'Benelux'),
    ('2024-03-22', 2, 104,  3,  89.99,  269.97, 'Completed', 'EMEA'),
    ('2024-04-05', 5, 101,  2,  64.99,  129.98, 'Completed', 'Nordic'),
    ('2024-04-18', 3, 106,  1, 249.00,  249.00, 'Pending',   'DACH'),
    ('2024-05-01', 1, 103,  1, 349.00,  349.00, 'Completed', 'EMEA'),
    ('2024-05-15', 4, 106,  2, 249.00,  498.00, 'Completed', 'Benelux');


-- ============================================================
-- VERIFY THE DATA LOADED CORRECTLY
-- Run these SELECT statements to confirm everything is in place
-- ============================================================

SELECT 'DIM_CUSTOMER rows' AS table_name, COUNT(*) AS total_rows,
       SUM(CASE WHEN IS_CURRENT THEN 1 ELSE 0 END) AS current_rows
FROM DIM_CUSTOMER
UNION ALL
SELECT 'DIM_PRODUCT rows', COUNT(*),
       SUM(CASE WHEN IS_CURRENT THEN 1 ELSE 0 END)
FROM DIM_PRODUCT
UNION ALL
SELECT 'FACT_ORDERS rows', COUNT(*), NULL
FROM FACT_ORDERS;

-- Expected results:
--   DIM_CUSTOMER   13 total rows,  5 current rows
--   DIM_PRODUCT    11 total rows,  6 current rows
--   FACT_ORDERS    30 total rows,  NULL


-- ============================================================
-- PRACTICE EXERCISES
-- Try these in Snowflake after loading the data, and then
-- practice editing data through the Tableau extension.
-- ============================================================

-- Exercise 1: View all current customers
-- (Use this as your starting point in the editor -- Primary Key: CUSTOMER_ID, Surrogate Key: SK_ID)
SELECT * FROM DIM_CUSTOMER WHERE IS_CURRENT = TRUE ORDER BY CUSTOMER_ID;

-- Exercise 2: View the full history for Acme Corp (CUSTOMER_ID = 1)
SELECT CUSTOMER_ID, CUSTOMER_NAME, CITY, TIER, VALID_FROM, VALID_TO, IS_CURRENT
FROM DIM_CUSTOMER
WHERE CUSTOMER_ID = 1
ORDER BY VALID_FROM;

-- Exercise 3: What did Acme's record look like on 1 March 2023?
-- (Before they upgraded to Gold in August 2023)
SELECT CUSTOMER_ID, CUSTOMER_NAME, CITY, TIER, IS_CURRENT
FROM DIM_CUSTOMER
WHERE CUSTOMER_ID = 1
  AND VALID_FROM <= '2023-03-01'
  AND (VALID_TO IS NULL OR VALID_TO > '2023-03-01');

-- Exercise 4: Point-in-time join
-- Revenue by customer tier, where each order uses the tier that was active at order time
-- Compare this to the naive join (below) to see how much the numbers differ
SELECT
    c.TIER,
    c.COUNTRY,
    SUM(o.REVENUE)  AS total_revenue,
    COUNT(*)        AS order_count
FROM FACT_ORDERS o
JOIN DIM_CUSTOMER c
  ON  o.CUSTOMER_ID  = c.CUSTOMER_ID
  AND o.ORDER_DATE  >= c.VALID_FROM::DATE
  AND (c.VALID_TO IS NULL OR o.ORDER_DATE < c.VALID_TO::DATE)
GROUP BY c.TIER, c.COUNTRY
ORDER BY total_revenue DESC;

-- Exercise 5: NAIVE join (wrong -- uses current tier for ALL orders including historical ones)
-- Notice how Bronze revenue is understated vs Exercise 4 because those customers
-- have since upgraded and the naive join assigns all their orders to the new tier
SELECT
    c.TIER,
    c.COUNTRY,
    SUM(o.REVENUE)  AS total_revenue_wrong,
    COUNT(*)        AS order_count
FROM FACT_ORDERS o
JOIN DIM_CUSTOMER c
  ON  o.CUSTOMER_ID = c.CUSTOMER_ID
  AND c.IS_CURRENT  = TRUE
GROUP BY c.TIER, c.COUNTRY
ORDER BY total_revenue_wrong DESC;

-- Exercise 6: Products that changed price -- and what revenue would look like
-- if we had charged the current price on all historical orders
SELECT
    p_current.PRODUCT_NAME,
    p_current.UNIT_PRICE                        AS current_price,
    SUM(o.UNIT_PRICE * o.QUANTITY)              AS actual_revenue_charged,
    SUM(p_current.UNIT_PRICE * o.QUANTITY)      AS revenue_at_current_price,
    SUM(p_current.UNIT_PRICE * o.QUANTITY)
      - SUM(o.UNIT_PRICE * o.QUANTITY)          AS difference
FROM FACT_ORDERS o
JOIN DIM_PRODUCT p_current
  ON  o.PRODUCT_ID   = p_current.PRODUCT_ID
  AND p_current.IS_CURRENT = TRUE
GROUP BY p_current.PRODUCT_NAME, p_current.UNIT_PRICE
ORDER BY difference DESC;


-- ============================================================
-- SUGGESTED EDITOR EXERCISES
-- Open the extension in Tableau and try these actions:
--
-- TYPE 1 MODE (open DIM_PRODUCT, PK = PRODUCT_ID):
--   1. Edit the AI Insights Module -- change the price to 299.00
--      Notice: the old price of 249.00 is gone. This is Type 1.
--
-- TYPE 2 MODE (open DIM_CUSTOMER, PK = CUSTOMER_ID, SK = SK_ID):
--   1. Click "History" on any customer to see their version timeline
--   2. Edit Nova Retail Group (CUSTOMER_ID = 5) -- change TIER to Silver
--      Notice: a new row is inserted, the old Bronze row is expired
--   3. Click "History" again -- you now see two versions
--   4. Run Exercise 3 type query in Snowflake to confirm the old version is preserved
--
-- AUDIT LOG:
--   After making changes, run this in Snowflake to see the log:
--   SELECT * FROM SNOWFLAKE_EDITOR_AUDIT ORDER BY CHANGED_AT DESC;
-- ============================================================
