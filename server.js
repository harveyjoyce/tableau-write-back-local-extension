// ============================================================
// server.js — Tableau Snowflake Editor backend (v2)
//
// NEW in v2:
//  - SCD Type 2 support (expire old row, insert new version)
//  - Audit log (auto-creates SNOWFLAKE_EDITOR_AUDIT table)
//  - /api/distinct  — returns distinct values for a column
//    (used by the frontend to auto-build dropdowns)
//  - /api/history   — returns all SCD versions for a PK value
// ============================================================

const express   = require('express');
const cors      = require('cors');
const snowflake = require('snowflake-sdk');
const path      = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Snowflake connection ──────────────────────────────────────
const connection = snowflake.createConnection({
  account   : process.env.SF_ACCOUNT,
  username  : process.env.SF_USERNAME,
  password  : process.env.SF_PASSWORD,
  database  : process.env.SF_DATABASE,
  warehouse : process.env.SF_WAREHOUSE,
  schema    : process.env.SF_SCHEMA,
  role      : process.env.SF_ROLE || undefined,
});

connection.connect((err) => {
  if (err) {
    console.error('❌  Could not connect to Snowflake:', err.message);
    process.exit(1);
  }
  console.log('✅  Connected to Snowflake!');
  ensureAuditTable();   // create audit table on startup if it doesn't exist
});

// ── Query helper ──────────────────────────────────────────────
function runQuery(sql, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText : sql,
      binds,
      complete: (err, _stmt, rows) => err ? reject(err) : resolve(rows),
    });
  });
}

function sendError(res, err, status = 500) {
  console.error('API error:', err.message || err);
  res.status(status).json({ success: false, error: err.message || String(err) });
}

// Validate table name to prevent SQL injection
function validName(name) {
  return /^[A-Za-z0-9_]+$/.test(name);
}

// ── Audit log setup ───────────────────────────────────────────
// Creates the audit table once on server start if it doesn't exist.
// This table stores every INSERT, UPDATE, and DELETE made via the editor.
async function ensureAuditTable() {
  try {
    await runQuery(`
      CREATE TABLE IF NOT EXISTS "${process.env.SF_SCHEMA}"."SNOWFLAKE_EDITOR_AUDIT" (
        AUDIT_ID       NUMBER AUTOINCREMENT PRIMARY KEY,
        TABLE_NAME     VARCHAR(255),
        OPERATION      VARCHAR(10),       -- INSERT | UPDATE | DELETE | SCD2_UPDATE
        PK_COLUMN      VARCHAR(255),
        PK_VALUE       VARCHAR(1000),
        OLD_VALUES     VARIANT,           -- previous row as JSON (NULL for inserts)
        NEW_VALUES     VARIANT,           -- new row as JSON (NULL for deletes)
        CHANGED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅  Audit table ready (SNOWFLAKE_EDITOR_AUDIT)');
  } catch (err) {
    // Non-fatal — audit logging degrades gracefully
    console.warn('⚠️  Could not create audit table:', err.message);
  }
}

// Write one audit row. Fire-and-forget — never blocks a user action.
async function writeAudit({ table, operation, pkColumn, pkValue, oldValues, newValues }) {
  try {
    await runQuery(
      `INSERT INTO "${process.env.SF_SCHEMA}"."SNOWFLAKE_EDITOR_AUDIT"
         (TABLE_NAME, OPERATION, PK_COLUMN, PK_VALUE, OLD_VALUES, NEW_VALUES)
       VALUES (?, ?, ?, ?, PARSE_JSON(?), PARSE_JSON(?))`,
      [
        table,
        operation,
        pkColumn  || null,
        pkValue   !== undefined ? String(pkValue) : null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
      ]
    );
  } catch (err) {
    console.warn('Audit write failed (non-fatal):', err.message);
  }
}

// =============================================================
// API ROUTES
// =============================================================

// ── GET /api/tables ──────────────────────────────────────────
app.get('/api/tables', async (req, res) => {
  try {
    const rows = await runQuery(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = :1 AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME != 'SNOWFLAKE_EDITOR_AUDIT'
       ORDER BY TABLE_NAME`,
      [process.env.SF_SCHEMA]
    );
    res.json({ success: true, tables: rows.map(r => r.TABLE_NAME) });
  } catch (err) { sendError(res, err); }
});

// ── GET /api/columns?table=X ─────────────────────────────────
app.get('/api/columns', async (req, res) => {
  const { table } = req.query;
  if (!table) return res.status(400).json({ success: false, error: 'Missing ?table=' });
  try {
    const rows = await runQuery(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = :1 AND TABLE_NAME = :2
       ORDER BY ORDINAL_POSITION`,
      [process.env.SF_SCHEMA, table.toUpperCase()]
    );
    res.json({ success: true, columns: rows });
  } catch (err) { sendError(res, err); }
});

// ── GET /api/distinct?table=X&column=Y ───────────────────────
// Returns up to 100 distinct values for a column.
// The frontend uses this to decide whether to show a dropdown
// (if <= DROPDOWN_THRESHOLD distinct values) or a free-text input.
const DROPDOWN_THRESHOLD = 30;

app.get('/api/distinct', async (req, res) => {
  const { table, column } = req.query;
  if (!table || !column)   return res.status(400).json({ success: false, error: 'Missing ?table= or ?column=' });
  if (!validName(table))   return res.status(400).json({ success: false, error: 'Invalid table name' });
  if (!validName(column))  return res.status(400).json({ success: false, error: 'Invalid column name' });

  try {
    const rows = await runQuery(
      `SELECT DISTINCT "${column}" AS VAL
       FROM "${table}"
       WHERE "${column}" IS NOT NULL
       ORDER BY VAL
       LIMIT 101`   // fetch 1 extra so we know if there are more than 100
    );
    const values     = rows.map(r => r.VAL);
    const isDropdown = values.length <= DROPDOWN_THRESHOLD;
    res.json({ success: true, values: values.slice(0, 100), isDropdown });
  } catch (err) { sendError(res, err); }
});

// ── GET /api/data?table=X&limit=N&offset=N ───────────────────
app.get('/api/data', async (req, res) => {
  const { table } = req.query;
  const limit  = Math.min(parseInt(req.query.limit)  || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  if (!table)           return res.status(400).json({ success: false, error: 'Missing ?table=' });
  if (!validName(table)) return res.status(400).json({ success: false, error: 'Invalid table name' });

  try {
    const rows  = await runQuery(`SELECT * FROM "${table}" LIMIT ${limit} OFFSET ${offset}`);
    const total = await runQuery(`SELECT COUNT(*) AS CNT FROM "${table}"`);
    res.json({ success: true, rows, total: total[0].CNT });
  } catch (err) { sendError(res, err); }
});

// ── GET /api/history?table=X&pkColumn=Y&pkValue=Z ────────────
// Returns all SCD Type 2 versions of a record (sorted by VALID_FROM).
// Only meaningful when the table has VALID_FROM / IS_CURRENT columns.
app.get('/api/history', async (req, res) => {
  const { table, pkColumn, pkValue } = req.query;
  if (!table || !pkColumn || pkValue === undefined)
    return res.status(400).json({ success: false, error: 'Missing required params' });
  if (!validName(table) || !validName(pkColumn))
    return res.status(400).json({ success: false, error: 'Invalid table or column name' });

  try {
    // Find the surrogate key column so we can fetch all related surrogate rows.
    // Convention: any row with the same "business key" groups into one history chain.
    // We find all rows sharing the same business-key value then sort by VALID_FROM.
    const rows = await runQuery(
      `SELECT * FROM "${table}"
       WHERE "${pkColumn}" = ?
       ORDER BY VALID_FROM ASC NULLS FIRST`,
      [pkValue]
    );
    res.json({ success: true, rows });
  } catch (err) { sendError(res, err); }
});

// ── POST /api/data  (INSERT) ──────────────────────────────────
app.post('/api/data', async (req, res) => {
  try {
    const { table, row } = req.body;
    if (!table || !row)    return res.status(400).json({ success: false, error: 'Missing table or row' });
    if (!validName(table)) return res.status(400).json({ success: false, error: 'Invalid table name' });

    const columns  = Object.keys(row);
    const values   = Object.values(row);
    const colList  = columns.map(c => `"${c}"`).join(', ');
    const bindList = columns.map(() => '?').join(', ');

    await runQuery(`INSERT INTO "${table}" (${colList}) VALUES (${bindList})`, values);
    writeAudit({ table, operation: 'INSERT', newValues: row });
    res.json({ success: true, message: 'Row inserted' });
  } catch (err) { sendError(res, err); }
});

// ── PUT /api/data  (UPDATE — Type 1, simple overwrite) ───────
// Body: { table, pkColumn, pkValue, updates: {col: val, ...} }
app.put('/api/data', async (req, res) => {
  try {
    const { table, pkColumn, pkValue, updates } = req.body;
    if (!table || !pkColumn || pkValue === undefined || !updates)
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    if (!validName(table)) return res.status(400).json({ success: false, error: 'Invalid table name' });

    const setClauses = Object.keys(updates).map(c => `"${c}" = ?`).join(', ');
    const values     = [...Object.values(updates), pkValue];

    if (!setClauses) return res.status(400).json({ success: false, error: 'No fields to update — updates object is empty' });

    // Capture old row for audit before overwriting
    const oldRows = await runQuery(`SELECT * FROM "${table}" WHERE "${pkColumn}" = ?`, [pkValue]);
    await runQuery(`UPDATE "${table}" SET ${setClauses} WHERE "${pkColumn}" = ?`, values);
    writeAudit({ table, operation: 'UPDATE', pkColumn, pkValue, oldValues: oldRows[0], newValues: updates });
    res.json({ success: true, message: 'Row updated' });
  } catch (err) { sendError(res, err); }
});

// ── PUT /api/scd2  (UPDATE — Type 2, keep history) ─────────────
// Body: { table, pkColumn, pkValue, surrogateKeyColumn, updates }
app.put('/api/scd2', async (req, res) => {
  try {
    const { table, pkColumn, pkValue, surrogateKeyColumn, updates } = req.body;
    if (!table || !pkColumn || pkValue === undefined || !surrogateKeyColumn || !updates)
      return res.status(400).json({ success: false, error: 'Missing required fields for SCD2' });
    if (!validName(table) || !validName(surrogateKeyColumn))
      return res.status(400).json({ success: false, error: 'Invalid table or column name' });

    // 1. Fetch the current active row
    const currentRows = await runQuery(
      `SELECT * FROM "${table}" WHERE "${pkColumn}" = ? AND IS_CURRENT = TRUE LIMIT 1`,
      [pkValue]
    );
    if (!currentRows || currentRows.length === 0) {
      return res.status(404).json({ success: false, error: `No current row found where ${pkColumn} = ${pkValue}` });
    }
    const currentRow     = currentRows[0];
    const surrogateValue = currentRow[surrogateKeyColumn];

    // 2. Expire the old row
    await runQuery(
      `UPDATE "${table}" SET "IS_CURRENT" = FALSE, "VALID_TO" = CURRENT_TIMESTAMP
       WHERE "${surrogateKeyColumn}" = ?`,
      [surrogateValue]
    );

    // 3. Build the new row: start from old values, apply updates, reset SCD columns
    const newRow = { ...currentRow, ...updates };
    delete newRow[surrogateKeyColumn];   // let the DB assign a new surrogate key
    newRow['VALID_FROM'] = new Date().toISOString();
    newRow['VALID_TO']   = null;
    newRow['IS_CURRENT'] = true;

    const columns  = Object.keys(newRow);
    const values   = Object.values(newRow);
    const colList  = columns.map(c => `"${c}"`).join(', ');
    const bindList = columns.map(() => '?').join(', ');

    await runQuery(`INSERT INTO "${table}" (${colList}) VALUES (${bindList})`, values);
    writeAudit({ table, operation: 'SCD2_UPDATE', pkColumn, pkValue, oldValues: currentRow, newValues: newRow });
    res.json({ success: true, message: 'SCD2 update: old row expired, new version inserted' });
  } catch (err) { sendError(res, err); }
});

// ── DELETE /api/data ──────────────────────────────────────────
app.delete('/api/data', async (req, res) => {
  try {
    const { table, pkColumn, pkValue } = req.body;
    if (!table || !pkColumn || pkValue === undefined)
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    if (!validName(table)) return res.status(400).json({ success: false, error: 'Invalid table name' });

    const oldRows = await runQuery(`SELECT * FROM "${table}" WHERE "${pkColumn}" = ?`, [pkValue]);
    await runQuery(`DELETE FROM "${table}" WHERE "${pkColumn}" = ?`, [pkValue]);
    writeAudit({ table, operation: 'DELETE', pkColumn, pkValue, oldValues: oldRows[0] });
    res.json({ success: true, message: 'Row deleted' });
  } catch (err) { sendError(res, err); }
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ success: true, message: 'Server running ✅' }));

// ── JSON 404 handler (must be after all routes) ───────────────
// Without this, unmatched routes return Express's default HTML page,
// which is what causes "unexpected token < in JSON at position 0".
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler (must be last, needs 4 args) ─────────
// Catches any unhandled async errors thrown inside route handlers
// and returns them as JSON instead of the default HTML error page.
app.use((err, req, res, _next) => {
  console.error('Unhandled route error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀  Server at http://localhost:${PORT}\n`);
});
