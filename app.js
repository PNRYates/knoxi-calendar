'use strict';

const state = {
  rawRows: [],
  uniqueNames: [],
  nameMap: {},
};

// ── Navigation ────────────────────────────────────────────────────────────────

function showStep(id) {
  document.querySelectorAll('.step-panel').forEach(el => { el.hidden = true; });
  document.getElementById(id).hidden = false;

  const stepNum = { 'step-upload': 1, 'step-edit': 2, 'step-done': 3 }[id];
  document.querySelectorAll('.step[data-step]').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n <= stepNum);
    el.classList.toggle('current', n === stepNum);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(msg) {
  const el = document.getElementById('upload-error');
  el.textContent = msg;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById('upload-error');
  el.textContent = '';
  el.hidden = true;
}

// ── CSV Parsing ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  // Strip BOM and normalise line endings
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = text.split('\n');
  const headerLine = lines[0];
  if (!headerLine) throw new Error('The CSV file appears to be empty.');

  const headers = parseCSVRow(headerLine);

  const required = ['start_date', 'start_time', 'finish_date', 'finish_time', 'name'];
  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`This doesn't look like a Knoxi CSV — missing column: "${col}". Please export again using the steps above.`);
    }
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVRow(line);
    if (values.every(v => v === '')) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }

  if (rows.length === 0) throw new Error('The CSV file has no data rows.');
  return rows;
}

function parseCSVRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote?
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
  }
  fields.push(field);
  return fields;
}

// ── Name utilities ────────────────────────────────────────────────────────────

function cleanName(original) {
  return original.replace(/^\d+\s+/, '').trim();
}

function extractUniqueNames(rows) {
  const seen = new Set();
  for (const row of rows) {
    const name = row.name?.trim();
    if (name) seen.add(name);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// ── Table rendering ───────────────────────────────────────────────────────────

function renderNamesTable(uniqueNames) {
  const tbody = document.getElementById('names-tbody');
  tbody.innerHTML = '';

  for (const name of uniqueNames) {
    const tr = document.createElement('tr');

    const tdOrig = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'original-name';
    span.textContent = name;
    tdOrig.appendChild(span);

    const tdLabel = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'label-input';
    input.placeholder = cleanName(name);
    input.dataset.original = name;
    input.setAttribute('aria-label', `Label for ${name}`);
    tdLabel.appendChild(input);

    tr.appendChild(tdOrig);
    tr.appendChild(tdLabel);
    tbody.appendChild(tr);
  }
}

// ── Name map ──────────────────────────────────────────────────────────────────

function buildNameMap() {
  state.nameMap = {};
  document.querySelectorAll('#names-tbody .label-input').forEach(input => {
    const original = input.dataset.original;
    const typed = input.value.trim();
    state.nameMap[original] = typed || cleanName(original);
  });
}

// ── Date / time formatting ────────────────────────────────────────────────────

function formatDateTime(date, time) {
  // date: DD/MM/YYYY  time: HH:MM
  const [d, m, y] = date.split('/');
  const t = time.replace(':', '') + '00';
  return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}T${t}`;
}

function formatDate(date) {
  // date: DD/MM/YYYY → YYYYMMDD
  const [d, m, y] = date.split('/');
  return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
}

function addOneDay(dateStr) {
  // YYYYMMDD → YYYYMMDD + 1 day (for all-day event exclusive end)
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10) - 1;
  const d = parseInt(dateStr.slice(6, 8), 10);
  const next = new Date(y, m, d + 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, '0');
  const nd = String(next.getDate()).padStart(2, '0');
  return `${ny}${nm}${nd}`;
}

// ── ICS generation ────────────────────────────────────────────────────────────

function escapeICS(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

function foldLine(line) {
  // ICS spec: fold lines longer than 75 octets with CRLF + SPACE
  if (line.length <= 75) return line + '\r\n';
  let result = '';
  let pos = 0;
  while (pos < line.length) {
    if (pos === 0) {
      result += line.slice(0, 75) + '\r\n';
      pos = 75;
    } else {
      result += ' ' + line.slice(pos, pos + 74) + '\r\n';
      pos += 74;
    }
  }
  return result;
}

function generateUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID() + '@knoxi-calendar';
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + '@knoxi-calendar';
}

function generateICS(rows, nameMap) {
  const lines = [];

  lines.push('BEGIN:VCALENDAR\r\n');
  lines.push('VERSION:2.0\r\n');
  lines.push('PRODID:-//Knoxi Calendar Converter//EN\r\n');
  lines.push('CALSCALE:GREGORIAN\r\n');
  lines.push('METHOD:PUBLISH\r\n');
  lines.push('X-WR-CALNAME:Knoxi Timetable\r\n');

  for (const row of rows) {
    const originalName = row.name?.trim() || 'Untitled Event';
    const summary = escapeICS(nameMap[originalName] || cleanName(originalName));
    const location = row.location?.trim();
    const detail = row.detail?.trim();
    const isAllDay = row.all_day === '1' || row.all_day?.toLowerCase() === 'true';

    lines.push('BEGIN:VEVENT\r\n');
    lines.push(`UID:${generateUID()}\r\n`);

    if (isAllDay) {
      const dtStart = formatDate(row.start_date);
      const dtEnd = addOneDay(formatDate(row.finish_date));
      lines.push(`DTSTART;VALUE=DATE:${dtStart}\r\n`);
      lines.push(`DTEND;VALUE=DATE:${dtEnd}\r\n`);
    } else {
      lines.push(foldLine(`DTSTART:${formatDateTime(row.start_date, row.start_time)}`));
      lines.push(foldLine(`DTEND:${formatDateTime(row.finish_date, row.finish_time)}`));
    }

    lines.push(foldLine(`SUMMARY:${summary}`));
    if (location) lines.push(foldLine(`LOCATION:${escapeICS(location)}`));
    if (detail) lines.push(foldLine(`DESCRIPTION:${escapeICS(detail)}`));

    lines.push('END:VEVENT\r\n');
  }

  lines.push('END:VCALENDAR\r\n');
  return lines.join('');
}

// ── File download ─────────────────────────────────────────────────────────────

function triggerDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── File upload handling ──────────────────────────────────────────────────────

function handleFile(file) {
  if (!file) return;
  clearError();

  const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
  if (!isCSV) {
    showError('Please upload a CSV file (.csv).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const rows = parseCSV(e.target.result);
      state.rawRows = rows;
      state.uniqueNames = extractUniqueNames(rows);
      renderNamesTable(state.uniqueNames);
      showStep('step-edit');
    } catch (err) {
      showError(err.message);
    }
  };
  reader.onerror = () => showError('Could not read the file. Please try again.');
  reader.readAsText(file);
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  showStep('step-upload');

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Click / keyboard on drop zone
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('dragend', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    // Reset so the same file can be re-uploaded
    fileInput.value = '';
  });

  // Step 2 — Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    showStep('step-upload');
  });

  // Step 2 — Download button
  document.getElementById('download-btn').addEventListener('click', () => {
    buildNameMap();
    const ics = generateICS(state.rawRows, state.nameMap);
    triggerDownload(ics, 'knoxi-timetable.ics');
    showStep('step-done');
  });

  // Step 3 — Start over
  document.getElementById('start-over-btn').addEventListener('click', () => {
    state.rawRows = [];
    state.uniqueNames = [];
    state.nameMap = {};
    document.getElementById('names-tbody').innerHTML = '';
    showStep('step-upload');
  });
}

document.addEventListener('DOMContentLoaded', init);
