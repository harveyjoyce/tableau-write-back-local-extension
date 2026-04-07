# Tableau Snowflake Editor — Complete Beginner Guide

Edit, insert, and delete Snowflake rows directly inside a Tableau dashboard — no SQL client needed.

---

## What You Are Building

```
┌─────────────────────────────────────┐
│         Tableau Dashboard           │
│  ┌───────────────────────────────┐  │
│  │   Snowflake Editor Extension  │  │  <- loads a webpage
│  │   (web app in an iframe)      │  │
│  └───────┬───────────────────────┘  │
└──────────│──────────────────────────┘
           │ HTTP requests (fetch)
           ▼
┌─────────────────────────────────────┐
│   Node.js Server  (your computer)   │  <- runs in Terminal
│   express + snowflake-sdk           │
└──────────┬──────────────────────────┘
           │ Snowflake driver
           ▼
┌─────────────────────────────────────┐
│         Snowflake Cloud DB          │
└─────────────────────────────────────┘
```

---

## Files in this Project

```
tableau-snowflake-editor-write-back/
|
+-- server.js                      <- Node.js back-end (talks to Snowflake)
+-- package.json                   <- Node dependencies list
+-- .env.example                   <- Template for your credentials
+-- scd2_setup.sql                 <- SQL to add SCD columns to existing tables
+-- practice_dataset.sql           <- Sample data to practise with
|
+-- public/                        <- The web app Tableau loads
|   +-- index.html
|   +-- style.css
|   +-- app.js
|
+-- tableau-snowflake-editor.trex  <- The Tableau extension manifest
```

---

## Prerequisites

### 1. Node.js

1. Go to https://nodejs.org
2. Download the LTS version and run the installer
3. Verify it worked — open Terminal (Mac) or Command Prompt (Windows) and type:

```
node --version
```

You should see something like v20.11.0.

### 2. Tableau Desktop 2019.4 or later

Tableau Public does not support extensions. You need the paid Tableau Desktop.

---

## Step 1 — Copy the Project Files

Unzip the project into a folder you can find easily:

- Mac:    ~/Documents/tableau-snowflake-editor-write-back
- Windows: C:\Users\YourName\Documents\tableau-snowflake-editor-write-back

---

## Step 2 — Install Dependencies

IMPORTANT: You must do this every time you set up the project in a new folder.
The node_modules folder is never included in the zip — npm downloads it fresh.

Open Terminal (Mac: Cmd+Space, type Terminal) or Command Prompt (Windows: Win+R, type cmd).

Navigate to your project folder:

```
cd C:\Users\YourName\Documents\tableau-snowflake-editor-write-back
```

Install packages:

```
npm install
```

Text will scroll — that is normal. Wait for the prompt to return.

Got "Error: Cannot find module 'express'" when running node server.js?
That means this step was skipped or run in the wrong folder.
cd into the project folder, run npm install, then try again.

---

## Step 3 — Set Up Your Snowflake Credentials

Create the credentials file. In your terminal (inside the project folder):

Mac/Linux:
```
cp .env.example .env
```

Windows:
```
copy .env.example .env
```

Open the new .env file in any text editor and fill in your values:

```
SF_ACCOUNT=xy12345.eu-west-1
SF_USERNAME=my_snowflake_user
SF_PASSWORD=my_super_secret_password
SF_DATABASE=MY_DATABASE
SF_SCHEMA=PUBLIC
SF_WAREHOUSE=COMPUTE_WH
SF_ROLE=
PORT=3000
```

How to find your SF_ACCOUNT:
1. Log in to Snowflake (app.snowflake.com)
2. Click your name in the bottom-left corner
3. Hover over your account name -> "Copy account identifier"
4. Looks like: xy12345.eu-west-1 or orgname-accountname

Never share this file or commit it to git. The .gitignore already excludes it.

---

## Step 4 — Load the Practice Dataset

The file practice_dataset.sql creates three ready-made tables so you have real data
to experiment with before touching your own tables.

1. Log in to Snowflake -> Worksheets -> + Worksheet
2. Set the context at the top: your database, schema (PUBLIC), and warehouse
3. Open practice_dataset.sql in a text editor, select all, copy
4. Paste into the Snowflake worksheet
5. Click "Run All" (the play button with lines, not the single arrow)

This creates:
- DIM_CUSTOMER  -- customer dimension, SCD Type 2 ready, 5 customers with history
- DIM_PRODUCT   -- product dimension, SCD Type 2 ready, 6 products with history
- FACT_ORDERS   -- 30 orders to join against the dimensions

---

## Step 5 — Start the Server

In your terminal (inside the project folder):

```
node server.js
```

You should see:

```
Connected to Snowflake successfully!
Audit table ready (SNOWFLAKE_EDITOR_AUDIT)
Server running at http://localhost:3000
```

Keep this terminal window open while using Tableau. Closing it stops the extension.

Troubleshooting:

  "Could not connect to Snowflake"
  -> Check your .env file. SF_ACCOUNT is usually the problem.

  "Cannot find module 'express'"
  -> Run npm install in the project folder first.

  "EADDRINUSE: address already in use :::3000"
  -> Change PORT=3001 in .env and update the URL in the .trex file too.

---

## Step 6 — Test the Server

Visit http://localhost:3000 in your browser. You should see the editor app.

Also check: http://localhost:3000/api/health
Should return: {"success":true,"message":"Server running"}

---

## Step 7 — Add the Extension to Tableau

1. Open Tableau Desktop
2. Open or create a workbook, then go to a Dashboard sheet
3. In the left panel under Objects, drag Extension onto the dashboard
4. Click "My Extensions"
5. Navigate to your project folder, select tableau-snowflake-editor.trex
6. Click OK on the security warning
7. The editor loads inside the dashboard panel

---

## Step 8 — Using the Extension

Setup (first time, inside the panel):

1. Choose a table from the dropdown
2. Enter the Primary Key column (the unique ID column, e.g. CUSTOMER_ID)
3. Choose an edit mode -- see the full explanation below
4. If using Type 2, enter the Surrogate Key column (e.g. SK_ID)
5. Click "Load Table"

Editing data:
  Edit a row:    hover over it -> click Edit -> change values -> Save to Snowflake
  Add a row:     click "+ New Row" -> fill in fields -> Save to Snowflake
  Delete a row:  hover -> click Delete -> confirm

Smart inputs (v2 feature):
The form automatically picks the right control for each column type:

  DATE columns             -> calendar date picker
  TIMESTAMP columns        -> date and time picker
  BOOLEAN columns          -> checkbox toggle
  NUMBER / INTEGER / FLOAT -> number input with arrow keys
  VARCHAR with <= 30 distinct values -> dropdown (auto-detected, no config needed)
  VARCHAR with >  30 distinct values -> free-text box

Other controls:
  Search box    -> filters the visible page across all columns instantly
  Refresh       -> re-fetches data from Snowflake
  Pagination    -> navigate large tables page by page
  Settings      -> go back to switch tables or change mode

---

## Understanding Edit Modes: Type 1 vs Type 2

This is the most important concept in the app.

---

### Type 1 -- Overwrite

When you edit a row, the old values are replaced. No history is kept.

Use Type 1 when:
- You are correcting a typo (the value was always wrong, not genuinely changed)
- The column does not matter for historical analysis
- You are editing a fact table or lookup table, not a dimension

What happens in the database:

```sql
-- Before:  CUSTOMER_ID=42 | CITY='London'
UPDATE DIM_CUSTOMER SET CITY = 'Paris' WHERE CUSTOMER_ID = 42;
-- After:   CUSTOMER_ID=42 | CITY='Paris'
-- London is gone forever.
```

---

### Type 2 -- Keep History (Slowly Changing Dimension)

When you edit a row, the old version is expired (given an end date, flagged inactive)
and a new row is inserted with your changes. Nothing is ever deleted. Every version
of every record is preserved.

Use Type 2 when:
- Something genuinely changed in the real world
- You need to report on what things looked like at a past point in time
- Your dimension table joins to a fact table and those facts should reflect what
  the dimension value WAS at the time the fact occurred -- not what it is today

Good candidates for Type 2:
- Customers (address, tier, account manager)
- Products (price, category, supplier)
- Employees (department, title, manager)
- Territories (region grouping)

What happens in the database:

```sql
-- Before:
-- SK_ID=1 | CUSTOMER_ID=42 | CITY='London' | IS_CURRENT=TRUE | VALID_TO=NULL

-- Step 1: expire the old row
UPDATE DIM_CUSTOMER
SET IS_CURRENT = FALSE, VALID_TO = CURRENT_TIMESTAMP
WHERE SK_ID = 1;

-- Step 2: insert the new version
INSERT INTO DIM_CUSTOMER (CUSTOMER_ID, CITY, IS_CURRENT, VALID_FROM, VALID_TO)
VALUES (42, 'Paris', TRUE, CURRENT_TIMESTAMP, NULL);

-- After:
-- SK_ID=1 | CUSTOMER_ID=42 | CITY='London' | IS_CURRENT=FALSE | VALID_TO='2023-06-15'
-- SK_ID=2 | CUSTOMER_ID=42 | CITY='Paris'  | IS_CURRENT=TRUE  | VALID_TO=NULL
```

The three required columns:

  VALID_FROM   TIMESTAMP_NTZ          When this version became true
  VALID_TO     TIMESTAMP_NTZ nullable  When this version expired (NULL = still active)
  IS_CURRENT   BOOLEAN                 Quick filter flag -- TRUE on the live row only

You also need a surrogate key -- a simple auto-increment column like SK_ID that
uniquely identifies each physical row including expired ones. This is different from
your business key (CUSTOMER_ID). One customer has one CUSTOMER_ID but many SK_IDs,
one per version.

Run scd2_setup.sql to add these columns to an existing table.

Querying a Type 2 table:

```sql
-- Current state only:
SELECT * FROM DIM_CUSTOMER WHERE IS_CURRENT = TRUE;

-- Full history for one customer:
SELECT * FROM DIM_CUSTOMER WHERE CUSTOMER_ID = 42 ORDER BY VALID_FROM;

-- Point-in-time query -- what did the world look like on 1 Sep 2023?
SELECT * FROM DIM_CUSTOMER
WHERE VALID_FROM <= '2023-09-01'
  AND (VALID_TO IS NULL OR VALID_TO > '2023-09-01');

-- Join orders to the dimension as-of the order date:
-- Each order gets the tier/city that was true WHEN it was placed, not today's value.
SELECT
    o.ORDER_ID,
    o.ORDER_DATE,
    o.REVENUE,
    c.CUSTOMER_NAME,
    c.TIER  AS tier_at_time_of_order,
    c.CITY  AS city_at_time_of_order
FROM FACT_ORDERS o
JOIN DIM_CUSTOMER c
  ON  o.CUSTOMER_ID  = c.CUSTOMER_ID
  AND o.ORDER_DATE  >= c.VALID_FROM
  AND (c.VALID_TO IS NULL OR o.ORDER_DATE < c.VALID_TO);
```

A worked example -- Acme Corp:

  Jan 2023   Acme signs up.   SK_ID=1 | City=London | Tier=Bronze | IS_CURRENT=TRUE
  Jun 2023   They move HQ.    SK_ID=1 expires. SK_ID=2 inserted: City=Paris  | IS_CURRENT=TRUE
  Jan 2024   They upgrade.    SK_ID=2 expires. SK_ID=3 inserted: Tier=Gold   | IS_CURRENT=TRUE

  Query: what tier was Acme in September 2023?
  WHERE VALID_FROM <= '2023-09-01' AND (VALID_TO IS NULL OR VALID_TO > '2023-09-01')
  Answer: SK_ID=2, Tier=Bronze. Correct -- they did not upgrade until Jan 2024.

  With Type 1 this would return Gold, because the overwrite destroyed the Bronze record.
  That would make every historical order look like it came from a Gold customer -- wrong.

In the editor settings:
  Primary Key Column   = your business key   (e.g. CUSTOMER_ID) -- same across all versions
  Surrogate Key Column = your row identifier (e.g. SK_ID)       -- unique per physical row

---

## The Audit Log

Every change made through the editor is automatically written to SNOWFLAKE_EDITOR_AUDIT.
This table is created on first run.

```sql
-- All recent changes:
SELECT * FROM SNOWFLAKE_EDITOR_AUDIT ORDER BY CHANGED_AT DESC LIMIT 50;

-- History of changes to one record:
SELECT OPERATION, OLD_VALUES, NEW_VALUES, CHANGED_AT
FROM SNOWFLAKE_EDITOR_AUDIT
WHERE TABLE_NAME = 'DIM_CUSTOMER' AND PK_VALUE = '42'
ORDER BY CHANGED_AT;

-- What field values actually changed:
SELECT
    CHANGED_AT,
    OLD_VALUES:CITY::VARCHAR  AS old_city,
    NEW_VALUES:CITY::VARCHAR  AS new_city
FROM SNOWFLAKE_EDITOR_AUDIT
WHERE TABLE_NAME = 'DIM_CUSTOMER' AND OPERATION = 'SCD2_UPDATE';
```

---

## Step 9 -- Deploy to a Shared Server (Optional)

Right now the server runs only on your laptop. For team use, host it on a cloud
server (AWS, Azure, GCP, Heroku, Render, etc.) and update two files:

1. In tableau-snowflake-editor.trex, change the URL:
```xml
<source-location>
  <url>https://your-server.com</url>
</source-location>
```

2. In public/app.js line ~10, change:
```js
const API_BASE = 'https://your-server.com/api';
```

Then share the updated .trex file with your team.

---

## Folder Quick Reference

  server.js                         project root    Backend -- runs node server.js
  package.json                      project root    npm dependency list
  .env                              project root    Your credentials (never share)
  scd2_setup.sql                    project root    SQL to prep a table for Type 2
  practice_dataset.sql              project root    Sample data to practise with
  public/index.html                 public/         UI structure
  public/style.css                  public/         Styling
  public/app.js                     public/         UI logic
  tableau-snowflake-editor.trex     anywhere        Tableau extension manifest

---

## Common Questions

Q: "Extension not trusted" in Tableau
A: Click OK -- normal for local extensions.

Q: Extension loads but shows nothing
A: Make sure node server.js is still running in your terminal.

Q: Edits are not saving
A: Press F12 in the extension panel -> Console tab to see the error.

Q: I do not see the History button
A: History only appears when Type 2 mode is active. Go to Settings and re-load the table.

Q: How do I find the surrogate key column name?
A: Run DESCRIBE TABLE your_table_name; in Snowflake and look for a NUMBER column
   with DEFAULT AUTOINCREMENT. Or just check the practice dataset -- it uses SK_ID.

Q: Can I use this with Tableau Server / Cloud?
A: Yes, but the Node.js server must be publicly accessible. Follow Step 9.

Q: How do I stop the server?
A: Press Ctrl+C in the terminal where node server.js is running.

Q: I want auto-restart while editing code
A: Run npm run dev instead. Uses nodemon to restart on every file save.

---

## Security Notes

- The .env file contains your password -- never commit it to git
- Use a dedicated Snowflake service account with only the permissions it needs
- For production, add API authentication (JWT tokens or API keys)
- Consider Snowflake key-pair authentication instead of passwords

---

## Need Help?

1. Check the terminal where node server.js is running -- errors print there
2. Press F12 while the extension is open in Tableau -> Console tab
3. Visit http://localhost:3000/api/health to verify the server is alive
