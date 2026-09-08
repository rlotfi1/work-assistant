// Work Assistant — a tiny local-first server.
// Serves the SPA and persists one JSON state blob (tasks + meetings) to disk.
// No auth by design: this is a personal, local-first tool (see README). When you
// later deploy it, put it behind auth like the Turbo Dashboard.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3020;

// Resolve a writable data directory (env override, then ./data, then a temp dir).
function pickDataDir() {
    const candidates = [
        process.env.ASSISTANT_DATA_DIR,
        path.join(__dirname, 'data'),
        path.join(os.tmpdir(), 'work-assistant')
    ].filter(Boolean);
    for (const dir of candidates) {
        try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return dir; }
        catch (e) { /* try next */ }
    }
    return null;
}
const DATA_DIR = pickDataDir();
const STATE_FILE = DATA_DIR && path.join(DATA_DIR, 'assistant.json');
const EMPTY = { tasks: [], meetings: [], logs: [], updatedAt: null };

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readState() {
    if (STATE_FILE) { try { const o = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); return Object.assign({}, EMPTY, o); } catch (e) { /* none yet */ } }
    return Object.assign({}, EMPTY);
}
function writeState(state) {
    if (!STATE_FILE) throw new Error('No writable storage location (set ASSISTANT_DATA_DIR).');
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// Whole-state load/save (client-authoritative; fine for a single-user personal tool).
app.get('/api/state', (req, res) => res.json(readState()));

app.put('/api/state', (req, res) => {
    const b = req.body || {};
    const state = {
        tasks: Array.isArray(b.tasks) ? b.tasks : [],
        meetings: Array.isArray(b.meetings) ? b.meetings : [],
        logs: Array.isArray(b.logs) ? b.logs : [],
        updatedAt: new Date().toISOString()
    };
    try { writeState(state); } catch (e) { return res.status(507).json({ error: e.message }); }
    res.json({ ok: true, updatedAt: state.updatedAt, tasks: state.tasks.length, meetings: state.meetings.length, logs: state.logs.length });
});

app.get('/api/health', (req, res) => {
    let exists = false, bytes = 0;
    try { const st = fs.statSync(STATE_FILE); exists = true; bytes = st.size; } catch (e) { /* none */ }
    res.json({ ok: true, dataDir: DATA_DIR, stateFile: STATE_FILE, exists, bytes });
});

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(' Work Assistant');
    console.log('='.repeat(60));
    console.log(' Running at: http://localhost:' + PORT);
    console.log(' Storage:    ' + (STATE_FILE || '(none — set ASSISTANT_DATA_DIR)'));
    console.log('='.repeat(60));
});
