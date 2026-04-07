// ============================================================
// app.js  v2
//
// NEW IN v2:
//  - Smart inputs: dates, numbers, booleans get proper widgets
//  - Auto-dropdowns: columns with ≤30 distinct values become
//    <select> dropdowns, loaded once per column then cached
//  - SCD Type 2 mode: expire-and-insert instead of UPDATE
//  - History viewer: see all versions of a dimension record
//  - Audit trail: every change is logged server-side
// ============================================================

const API_BASE = 'http://localhost:3000/api';

// ── State ────────────────────────────────────────────────────
const state = {
  table          : null,
  pkColumn       : null,
  surrogateKey   : null,     // SCD2 surrogate key column
  scdMode        : 'scd1',   // 'scd1' | 'scd2'
  columns        : [],
  allRows        : [],
  filteredRows   : [],
  distinctCache  : {},       // { "COLUMN_NAME": { isDropdown, values } }
  currentPage    : 1,
  rowsPerPage    : 200,
  totalRows      : 0,
  editingRow     : null,
  deletingRow    : null,
};

// ── DOM refs ─────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const initScreen    = $('init-screen');
const setupPanel    = $('setup-panel');
const editorPanel   = $('editor-panel');
const tableSelect   = $('table-select');
const pkInput       = $('pk-input');
const surrogateInput= $('surrogate-input');
const rowsPerPageEl = $('rows-per-page');
const loadBtn       = $('load-btn');
const setupError    = $('setup-error');
const tableTitle    = $('table-title');
const modeBadge     = $('mode-badge');
const rowCountBadge = $('row-count-badge');
const searchInput   = $('search-input');
const gridContainer = $('grid-container');
const loading       = $('loading');
const toast         = $('toast');
const prevBtn       = $('prev-btn');
const nextBtn       = $('next-btn');
const pageInfo      = $('page-info');
const addRowBtn     = $('add-row-btn');
const refreshBtn    = $('refresh-btn');
const settingsBtn   = $('settings-btn');
const modalOverlay  = $('modal-overlay');
const modalTitle    = $('modal-title');
const modalFields   = $('modal-fields');
const modalClose    = $('modal-close');
const modalCancel   = $('modal-cancel');
const modalSave     = $('modal-save');
const historyOverlay= $('history-overlay');
const historyTitle  = $('history-title');
const historyGrid   = $('history-grid');
const historyClose  = $('history-close');
const historyDone   = $('history-done');
const deleteOverlay = $('delete-overlay');
const deleteMsg     = $('delete-msg');
const deleteCancel  = $('delete-cancel');
const deleteConfirm = $('delete-confirm');
const scd2Fields    = $('scd2-fields');

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
async function init() {
  try { await tableau.extensions.initializeAsync(); }
  catch (e) { console.warn('Not in Tableau — browser mode'); }

  initScreen.style.display  = 'none';
  setupPanel.style.display  = 'flex';
  await populateTableDropdown();

  // SCD mode radio toggle
  document.querySelectorAll('input[name="scd-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.scdMode = radio.value;
      scd2Fields.style.display = radio.value === 'scd2' ? 'block' : 'none';
      // Re-style radio options
      $('opt-scd1').classList.toggle('selected', radio.value === 'scd1');
      $('opt-scd2').classList.toggle('selected', radio.value === 'scd2');
    });
  });
  $('opt-scd1').classList.add('selected');
}

// ─────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  loading.style.display = 'flex';
  try {
    const res  = await fetch(url, options);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const preview = text.substring(0, 300).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(
        `Server returned non-JSON (HTTP ${res.status}). ` +
        `Check the terminal where node server.js is running. ` +
        `Preview: ${preview}`
      );
    }

    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  } finally {
    loading.style.display = 'none';
  }
}

async function populateTableDropdown() {
  try {
    const data = await apiFetch(`${API_BASE}/tables`);
    tableSelect.innerHTML = '<option value="">— select a table —</option>';
    data.tables.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      tableSelect.appendChild(opt);
    });
  } catch (err) { showSetupError(`Could not load tables: ${err.message}`); }
}

// ─────────────────────────────────────────────────────────────
// LOAD TABLE
// ─────────────────────────────────────────────────────────────
async function loadTable() {
  const table = tableSelect.value;
  const pk    = pkInput.value.trim().toUpperCase();
  const sk    = surrogateInput.value.trim().toUpperCase();
  const mode  = document.querySelector('input[name="scd-mode"]:checked').value;

  if (!table) { showSetupError('Please select a table.'); return; }
  if (!pk)    { showSetupError('Please enter the primary key column.'); return; }
  if (mode === 'scd2' && !sk) {
    showSetupError('For Type 2 mode, enter the surrogate key column.'); return;
  }

  setupError.style.display = 'none';
  state.table        = table;
  state.pkColumn     = pk;
  state.surrogateKey = sk || null;
  state.scdMode      = mode;
  state.rowsPerPage  = parseInt(rowsPerPageEl.value);
  state.currentPage  = 1;
  state.distinctCache= {};

  try {
    const colData = await apiFetch(`${API_BASE}/columns?table=${table}`);
    state.columns = colData.columns;
  } catch (err) { showSetupError(`Could not load columns: ${err.message}`); return; }

  const pkExists = state.columns.some(c => c.COLUMN_NAME === pk);
  if (!pkExists) {
    showSetupError(`Column "${pk}" not found in "${table}". Check the spelling — Snowflake is case-sensitive.`);
    return;
  }

  if (mode === 'scd2') {
    const skExists = state.columns.some(c => c.COLUMN_NAME === sk);
    if (!skExists) {
      showSetupError(`Surrogate key column "${sk}" not found in "${table}".`);
      return;
    }
    // Verify SCD columns exist
    const colNames = state.columns.map(c => c.COLUMN_NAME);
    const missingScd = ['VALID_FROM','VALID_TO','IS_CURRENT'].filter(c => !colNames.includes(c));
    if (missingScd.length > 0) {
      showSetupError(
        `SCD Type 2 requires these columns which are missing: ${missingScd.join(', ')}. ` +
        `Run the SQL in README.md to add them, or switch to Type 1 mode.`
      );
      return;
    }
  }

  setupPanel.style.display  = 'none';
  editorPanel.style.display = 'flex';
  tableTitle.textContent    = table;
  modeBadge.textContent     = mode === 'scd2' ? 'Type 2 (SCD)' : 'Type 1';
  modeBadge.className       = `badge badge-mode ${mode === 'scd2' ? 'badge-scd2' : ''}`;

  // Pre-fetch distinct values for all columns in the background
  prefetchDistinctValues();

  await fetchPage(1);
}

// Pre-fetch distinct values for all columns (fires in parallel, non-blocking)
async function prefetchDistinctValues() {
  const colNames = state.columns.map(c => c.COLUMN_NAME);
  await Promise.all(colNames.map(col => fetchDistinct(col)));
}

async function fetchDistinct(colName) {
  if (state.distinctCache[colName]) return;   // already cached
  try {
    const data = await fetch(
      `${API_BASE}/distinct?table=${state.table}&column=${colName}`
    );
    const json = await data.json();
    if (json.success) state.distinctCache[colName] = json;
  } catch (_) { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────
async function fetchPage(page) {
  state.currentPage = page;
  const offset = (page - 1) * state.rowsPerPage;
  try {
    const data = await apiFetch(
      `${API_BASE}/data?table=${state.table}&limit=${state.rowsPerPage}&offset=${offset}`
    );
    state.allRows     = data.rows;
    state.filteredRows= data.rows;
    state.totalRows   = data.total;
    rowCountBadge.textContent = `${data.total.toLocaleString()} rows`;
    renderGrid(state.filteredRows);
    updatePagination();
  } catch (err) { showToast(`Load error: ${err.message}`, 'error'); }
}

// ─────────────────────────────────────────────────────────────
// GRID RENDERING
// ─────────────────────────────────────────────────────────────
function renderGrid(rows) {
  if (!rows || rows.length === 0) {
    gridContainer.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>No rows found</h3>
        <p>Table is empty or search matched nothing.</p>
      </div>`;
    return;
  }

  const colNames = state.columns.map(c => c.COLUMN_NAME);

  const actionHeader = state.scdMode === 'scd2'
    ? `<th class="actions-col">ACTIONS + HISTORY</th>`
    : `<th class="actions-col">ACTIONS</th>`;

  const thead = `<thead><tr>
    ${colNames.map(c => `<th title="${c}">${c}</th>`).join('')}
    ${actionHeader}
  </tr></thead>`;

  const tbody = `<tbody>${rows.map(row => {
    const pk = row[state.pkColumn];
    const isCurrent = row['IS_CURRENT'];
    const rowClass = state.scdMode === 'scd2' && isCurrent === false ? 'row-expired' : '';

    const cells = colNames.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return `<td class="null-cell">NULL</td>`;
      if (typeof val === 'boolean') return `<td class="bool-cell ${val ? 'bool-true' : 'bool-false'}">${val ? 'TRUE' : 'FALSE'}</td>`;
      const str     = String(val);
      const display = str.length > 80 ? str.substring(0, 80) + '…' : str;
      return `<td title="${escHtml(str)}">${escHtml(display)}</td>`;
    }).join('');

    const editBtn   = `<button class="row-btn row-btn-edit" onclick='openEditModal(${JSON.stringify(row).replace(/'/g,"&#39;")})'>Edit</button>`;
    const deleteBtn = `<button class="row-btn row-btn-delete" onclick='openDeleteModal(${JSON.stringify(row).replace(/'/g,"&#39;")})'>Delete</button>`;
    const historyBtn = state.scdMode === 'scd2'
      ? `<button class="row-btn row-btn-history" onclick='openHistoryModal(${JSON.stringify(pk).replace(/'/g,"&#39;")})'>History</button>`
      : '';

    return `<tr class="${rowClass}">
      ${cells}
      <td><div class="row-actions">${editBtn}${deleteBtn}${historyBtn}</div></td>
    </tr>`;
  }).join('')}</tbody>`;

  gridContainer.innerHTML = `<table>${thead}${tbody}</table>`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updatePagination() {
  const total = Math.max(1, Math.ceil(state.totalRows / state.rowsPerPage));
  pageInfo.textContent  = `Page ${state.currentPage} of ${total}`;
  prevBtn.disabled = state.currentPage <= 1;
  nextBtn.disabled = state.currentPage >= total;
}

// ─────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────
function applySearch(q) {
  if (!q) { state.filteredRows = state.allRows; }
  else {
    const lq = q.toLowerCase();
    state.filteredRows = state.allRows.filter(row =>
      Object.values(row).some(v => v !== null && String(v).toLowerCase().includes(lq))
    );
  }
  renderGrid(state.filteredRows);
}

// ─────────────────────────────────────────────────────────────
// SMART INPUT BUILDER
// Returns an <input>, <select>, or <input type="date"> depending
// on the column's data type and cardinality.
// ─────────────────────────────────────────────────────────────

// Snowflake data types → input widget type
const TYPE_MAP = {
  DATE      : 'date',
  TIME      : 'time',
  TIMESTAMP_NTZ: 'datetime-local',
  TIMESTAMP_LTZ: 'datetime-local',
  TIMESTAMP_TZ : 'datetime-local',
  TIMESTAMP : 'datetime-local',
  BOOLEAN   : 'boolean',
  NUMBER    : 'number',
  INTEGER   : 'number',
  FLOAT     : 'number',
  DOUBLE    : 'number',
  BIGINT    : 'number',
  SMALLINT  : 'number',
  TINYINT   : 'number',
  BYTEINT   : 'number',
  DECIMAL   : 'number',
  NUMERIC   : 'number',
  REAL      : 'number',
};

function buildInput(col, value, readonly = false) {
  const colName  = col.COLUMN_NAME;
  const dataType = (col.DATA_TYPE || '').toUpperCase().split('(')[0].trim();
  const inputType = TYPE_MAP[dataType] || 'text';

  // Check if this column has a cached distinct list (auto-dropdown)
  const cached = state.distinctCache[colName];
  if (cached && cached.isDropdown && !readonly) {
    const sel = document.createElement('select');
    sel.id = `field-${colName}`;
    sel.dataset.column = colName;
    sel.dataset.dtype  = dataType;

    // Add blank / NULL option
    const blankOpt = document.createElement('option');
    blankOpt.value = ''; blankOpt.textContent = '— NULL —';
    sel.appendChild(blankOpt);

    cached.values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      if (String(v) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    });

    // Allow typing a new value too (show text box on "Other…")
    const otherOpt = document.createElement('option');
    otherOpt.value = '__other__';
    otherOpt.textContent = 'Other (type below)…';
    sel.appendChild(otherOpt);

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.id   = `field-${colName}-other`;
    otherInput.style.display = 'none';
    otherInput.dataset.column = colName;
    otherInput.dataset.dtype  = dataType;
    otherInput.placeholder    = 'Type a custom value';

    sel.addEventListener('change', () => {
      otherInput.style.display = sel.value === '__other__' ? 'block' : 'none';
    });

    // If current value not in dropdown list, pre-select "Other"
    const inList = value === null || value === ''
      || cached.values.some(v => String(v) === String(value));
    if (!inList && value !== null && value !== '') {
      sel.value         = '__other__';
      otherInput.value  = String(value);
      otherInput.style.display = 'block';
    }

    // Return a wrapper div with both elements
    const wrap = document.createElement('div');
    wrap.dataset.isCombo = '1';
    wrap.appendChild(sel);
    wrap.appendChild(otherInput);
    return wrap;
  }

  // Boolean → toggle checkbox
  if (inputType === 'boolean') {
    const wrap = document.createElement('div');
    wrap.className = 'bool-toggle-wrap';

    const toggle = document.createElement('input');
    toggle.type  = 'checkbox';
    toggle.id    = `field-${colName}`;
    toggle.dataset.column = colName;
    toggle.dataset.dtype  = 'BOOLEAN';
    toggle.checked = (value === true || value === 'TRUE' || value === 1);
    if (readonly) toggle.disabled = true;

    const lbl = document.createElement('label');
    lbl.htmlFor = `field-${colName}`;
    lbl.textContent = toggle.checked ? 'TRUE' : 'FALSE';
    toggle.addEventListener('change', () => { lbl.textContent = toggle.checked ? 'TRUE' : 'FALSE'; });

    wrap.appendChild(toggle);
    wrap.appendChild(lbl);
    return wrap;
  }

  // Default: standard <input>
  const input = document.createElement('input');
  input.type  = inputType === 'text' ? 'text' : inputType;
  input.id    = `field-${colName}`;
  input.dataset.column = colName;
  input.dataset.dtype  = dataType;

  if (value !== null && value !== undefined) {
    // Format date/datetime values for native date input
    if (inputType === 'date' && value) {
      input.value = String(value).substring(0, 10);
    } else if (inputType === 'datetime-local' && value) {
      input.value = String(value).substring(0, 16).replace(' ', 'T');
    } else {
      input.value = String(value);
    }
  }

  input.placeholder = (value === null || value === '') ? 'NULL' : '';
  if (readonly) { input.readOnly = true; input.style.opacity = '0.45'; input.title = 'Cannot edit primary key'; }
  return input;
}

// Reads a value back from a smart input (handles dropdowns, checkboxes, etc.)
function readInput(colName) {
  const id = `field-${colName}`;

  // Boolean checkbox
  const chk = document.getElementById(id);
  if (chk && chk.type === 'checkbox') return chk.checked;

  // Combo (dropdown + other)
  const sel = document.getElementById(id);
  if (sel && sel.tagName === 'SELECT') {
    if (sel.value === '__other__') {
      const otherVal = (document.getElementById(`${id}-other`) || {}).value || '';
      return otherVal.trim() === '' ? null : otherVal.trim();
    }
    return sel.value === '' ? null : sel.value;
  }

  // Regular input
  const inp = document.getElementById(id);
  if (!inp) return null;
  const v = inp.value.trim();
  return v === '' ? null : v;
}

// ─────────────────────────────────────────────────────────────
// ADD / EDIT MODAL
// ─────────────────────────────────────────────────────────────
function openEditModal(rowOrNull) {
  state.editingRow   = rowOrNull;
  modalTitle.textContent = rowOrNull ? (state.scdMode === 'scd2' ? 'Edit row (SCD Type 2)' : 'Edit row') : 'New row';
  modalFields.innerHTML = '';

  // SCD2 info banner
  if (rowOrNull && state.scdMode === 'scd2') {
    const banner = document.createElement('div');
    banner.className = 'info-banner';
    banner.innerHTML = '❄ <strong>Type 2 mode:</strong> Saving will expire this row and insert a new version. The old row is preserved in history.';
    modalFields.appendChild(banner);
  }

  state.columns.forEach(col => {
    const colName = col.COLUMN_NAME;
    // Skip SCD system columns from manual editing (managed automatically)
    const autoManaged = rowOrNull && ['VALID_FROM','VALID_TO','IS_CURRENT'].includes(colName);
    const isReadonly  = (colName === state.pkColumn && rowOrNull)
                     || (colName === state.surrogateKey && rowOrNull)
                     || autoManaged;

    const value = rowOrNull ? (rowOrNull[colName] ?? null) : null;

    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `field-${colName}`);
    label.textContent = colName;

    const typeHint = document.createElement('span');
    typeHint.className = 'hint';
    typeHint.textContent = col.DATA_TYPE;
    label.appendChild(typeHint);

    if (autoManaged) {
      const autoTag = document.createElement('span');
      autoTag.className = 'auto-tag';
      autoTag.textContent = 'auto';
      label.appendChild(autoTag);
    }

    // Check if this column has an auto-dropdown available
    const cached = state.distinctCache[colName];
    if (cached && cached.isDropdown && !isReadonly) {
      const countTag = document.createElement('span');
      countTag.className = 'hint dropdown-hint';
      countTag.textContent = `↓ ${cached.values.length} options`;
      label.appendChild(countTag);
    }

    const inputEl = buildInput(col, value, isReadonly);

    group.appendChild(label);
    group.appendChild(inputEl);
    modalFields.appendChild(group);
  });

  modalOverlay.style.display = 'flex';
  const first = modalFields.querySelector('input:not([readonly]):not([disabled]), select');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeEditModal() {
  modalOverlay.style.display = 'none';
  state.editingRow = null;
}

async function saveRow() {
  const rowData = {};
  state.columns.forEach(col => {
    // Skip auto-managed SCD columns — server handles them
    if (state.editingRow && ['VALID_FROM','VALID_TO','IS_CURRENT'].includes(col.COLUMN_NAME)) return;
    // Skip PK and surrogate key on edits
    if (state.editingRow && col.COLUMN_NAME === state.pkColumn)     return;
    if (state.editingRow && col.COLUMN_NAME === state.surrogateKey) return;

    rowData[col.COLUMN_NAME] = readInput(col.COLUMN_NAME);
  });

  try {
    if (state.editingRow) {
      const pkValue = state.editingRow[state.pkColumn];

      if (state.scdMode === 'scd2') {
        await apiFetch(`${API_BASE}/scd2`, {
          method : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({
            table            : state.table,
            pkColumn         : state.pkColumn,
            pkValue,
            surrogateKeyColumn: state.surrogateKey,
            updates          : rowData,
          }),
        });
        showToast('SCD2 update: new version created ✓', 'success');
      } else {
        await apiFetch(`${API_BASE}/data`, {
          method : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ table: state.table, pkColumn: state.pkColumn, pkValue, updates: rowData }),
        });
        showToast('Row updated ✓', 'success');
      }
    } else {
      // INSERT: include SCD columns if in Type 2 mode
      if (state.scdMode === 'scd2') {
        rowData['VALID_FROM']  = new Date().toISOString();
        rowData['VALID_TO']    = null;
        rowData['IS_CURRENT']  = true;
      }
      await apiFetch(`${API_BASE}/data`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ table: state.table, row: rowData }),
      });
      showToast('Row inserted ✓', 'success');
    }
    closeEditModal();
    await fetchPage(state.currentPage);
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ─────────────────────────────────────────────────────────────
// HISTORY MODAL (SCD2 only)
// ─────────────────────────────────────────────────────────────
async function openHistoryModal(pkValue) {
  historyTitle.textContent = `History for ${state.pkColumn} = ${pkValue}`;
  historyGrid.innerHTML    = '<p style="color:var(--text-secondary)">Loading…</p>';
  historyOverlay.style.display = 'flex';

  try {
    const data = await apiFetch(
      `${API_BASE}/history?table=${state.table}&pkColumn=${state.pkColumn}&pkValue=${encodeURIComponent(pkValue)}`
    );

    if (!data.rows || data.rows.length === 0) {
      historyGrid.innerHTML = '<p style="color:var(--text-secondary)">No history found for this value.</p>';
      return;
    }

    const colNames = state.columns.map(c => c.COLUMN_NAME);
    const thead    = `<thead><tr>${colNames.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody    = `<tbody>${data.rows.map(row => {
      const isCurrent = row['IS_CURRENT'];
      const cls       = isCurrent ? 'history-current' : 'history-expired';
      return `<tr class="${cls}">
        ${colNames.map(col => {
          const v = row[col];
          if (v === null || v === undefined) return `<td class="null-cell">NULL</td>`;
          return `<td title="${escHtml(String(v))}">${escHtml(String(v).substring(0, 60))}</td>`;
        }).join('')}
      </tr>`;
    }).join('')}</tbody>`;

    historyGrid.innerHTML = `
      <p class="history-legend">
        <span class="legend-dot current"></span> Current version &nbsp;
        <span class="legend-dot expired"></span> Expired version
      </p>
      <table>${thead}${tbody}</table>`;
  } catch (err) {
    historyGrid.innerHTML = `<p style="color:var(--danger)">Error loading history: ${err.message}</p>`;
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE MODAL
// ─────────────────────────────────────────────────────────────
function openDeleteModal(row) {
  state.deletingRow = row;
  const pk = row[state.pkColumn];
  deleteMsg.textContent =
    `This will permanently delete the row where ${state.pkColumn} = "${pk}". This cannot be undone.`;
  deleteOverlay.style.display = 'flex';
}

function closeDeleteModal() {
  deleteOverlay.style.display = 'none';
  state.deletingRow = null;
}

async function confirmDelete() {
  try {
    await apiFetch(`${API_BASE}/data`, {
      method : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        table   : state.table,
        pkColumn: state.pkColumn,
        pkValue : state.deletingRow[state.pkColumn],
      }),
    });
    showToast('Row deleted ✓', 'success');
    closeDeleteModal();
    await fetchPage(state.currentPage);
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ─────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  toast.textContent    = msg;
  toast.className      = `toast ${type}`;
  toast.style.display  = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function showSetupError(msg) {
  setupError.textContent   = msg;
  setupError.style.display = 'block';
}

// ─────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────
loadBtn.addEventListener('click', loadTable);
pkInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadTable(); });

settingsBtn.addEventListener('click', () => {
  editorPanel.style.display = 'none';
  setupPanel.style.display  = 'flex';
  populateTableDropdown();
});

refreshBtn.addEventListener('click', () => fetchPage(state.currentPage));
searchInput.addEventListener('input', e => applySearch(e.target.value));
prevBtn.addEventListener('click', () => { if (state.currentPage > 1) fetchPage(state.currentPage - 1); });
nextBtn.addEventListener('click', () => fetchPage(state.currentPage + 1));
addRowBtn.addEventListener('click', () => openEditModal(null));

modalClose.addEventListener('click', closeEditModal);
modalCancel.addEventListener('click', closeEditModal);
modalSave.addEventListener('click', saveRow);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeEditModal(); });

historyClose.addEventListener('click', () => { historyOverlay.style.display = 'none'; });
historyDone.addEventListener('click',  () => { historyOverlay.style.display = 'none'; });
historyOverlay.addEventListener('click', e => { if (e.target === historyOverlay) historyOverlay.style.display = 'none'; });

deleteCancel.addEventListener('click', closeDeleteModal);
deleteConfirm.addEventListener('click', confirmDelete);
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeEditModal(); closeDeleteModal(); historyOverlay.style.display = 'none'; }
});

init();
