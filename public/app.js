/* Work Assistant — capture tasks, email follow-ups and meeting action items.
   Local-first vanilla-JS SPA. State is one JSON blob persisted to the server. */
'use strict';

// ── state ───────────────────────────────────────────────────────────────────
let STATE = { tasks: [], meetings: [], logs: [] };
let VIEW = 'today';
let DAY = null;                        // 'My day' tracker — which date is shown (ISO); set at boot
const CAP = { mode: 'task', link: '' };
const FILTER = { q: '', status: '', priority: '', source: '', requestor: '', project: '' };
const OPEN_MTG = new Set();            // expanded meetings
const notified = new Set();            // reminder de-dupe (per session)
let lastDeleted = null;                // for undo

// ── tiny utils ──────────────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const byNew = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

function todayISO(d = new Date()) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d); }
// Local calendar date (YYYY-MM-DD) of a timestamp — bucket by local day, not UTC.
const dayOf = at => (at ? todayISO(new Date(at)) : '');
const hhmm = at => { const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function dueMeta(due) {
    if (!due) return null;
    const today = todayISO();
    const diff = Math.round((new Date(due + 'T00:00') - new Date(today + 'T00:00')) / 86400000);
    let label = due, cls = '';
    if (diff < 0) { cls = 'over'; label = Math.abs(diff) + 'd overdue'; }
    else if (diff === 0) { cls = 'today'; label = 'Today'; }
    else if (diff === 1) label = 'Tomorrow';
    else if (diff <= 6) label = new Date(due + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' });
    else label = new Date(due + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { label, cls, diff };
}
// Parse a due token like today / tmr / fri / +3d / 2026-09-10 / 09/10 → ISO date or ''.
function parseDue(tok) {
    if (!tok) return '';
    tok = tok.toLowerCase();
    const wd = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (/^(today|tod|td)$/.test(tok)) return todayISO();
    if (/^(tomorrow|tmr|tom)$/.test(tok)) return addDays(1);
    let m;
    if ((m = tok.match(/^\+(\d+)d?$/))) return addDays(parseInt(m[1], 10));
    if ((m = tok.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return tok;
    if ((m = tok.match(/^(\d{1,2})\/(\d{1,2})$/))) { const y = new Date().getFullYear(); return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; }
    for (const k in wd) if (tok.startsWith(k)) { const now = new Date(); let diff = (wd[k] - now.getDay() + 7) % 7; if (diff === 0) diff = 7; return addDays(diff); }
    return '';
}

// Natural-language token parse for the quick-add box.
function parseCapture(raw) {
    const out = { title: raw, requestor: '', project: '', priority: 'normal', due: '' };
    const pull = re => { const m = out.title.match(re); if (m) { out.title = out.title.replace(m[0], ' '); return m[1]; } return null; };
    out.requestor = pull(/@\[([^\]]+)\]/) || pull(/@([^\s@]+)/) || '';
    out.project = pull(/#\[([^\]]+)\]/) || pull(/#(\w[\w-]*)/) || '';
    const pri = pull(/!(urgent|high|normal|low|u|h|n|l)\b/i);
    if (pri) out.priority = ({ u: 'urgent', h: 'high', n: 'normal', l: 'low' }[pri.toLowerCase()] || pri.toLowerCase());
    const dueTok = pull(/\^(\S+)/);
    if (dueTok) out.due = parseDue(dueTok);
    out.title = out.title.replace(/\s+/g, ' ').trim();
    return out;
}

// ── icons ───────────────────────────────────────────────────────────────────
const I = {
    today: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4.5" width="14" height="13" rx="2.2"/><path d="M3 8h14M7 3v3M13 3v3" stroke-linecap="round"/><circle cx="10" cy="12.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
    board: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3.5" width="4" height="13" rx="1.4"/><rect x="8.5" y="3.5" width="4" height="9" rx="1.4"/><rect x="14" y="3.5" width="4" height="6" rx="1.4"/></svg>',
    all: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 5.5h10M7 10h10M7 14.5h10"/><path d="M3.4 5.5h.01M3.4 10h.01M3.4 14.5h.01"/></svg>',
    email: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="14" height="10.5" rx="2"/><path d="M3.6 6l6.4 4.6L16.4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    meeting: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7.5" r="2.4"/><path d="M2.8 16c0-2.6 1.9-4.2 4.2-4.2S11.2 13.4 11.2 16" stroke-linecap="round"/><circle cx="13.6" cy="7" r="1.9" opacity=".7"/><path d="M12 15.6c.1-2.1 1.4-3.6 3.4-3.6 1.4 0 2.4.7 2.9 1.8" opacity=".7" stroke-linecap="round"/></svg>',
    req: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.4c0-2.6 2.2-4 5-4s5 1.4 5 4" stroke-linecap="round"/></svg>',
    tag: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8.2 2.5H3.5A1 1 0 0 0 2.5 3.5v4.7a1 1 0 0 0 .3.7l5 5a1 1 0 0 0 1.4 0l4.4-4.4a1 1 0 0 0 0-1.4l-5-5a1 1 0 0 0-.7-.3Z"/><circle cx="6" cy="6" r="1" fill="currentColor" stroke="none"/></svg>',
    clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.4" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3.5 8.5l3 3 6-6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1" stroke-linecap="round"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1" stroke-linecap="round"/></svg>',
    day: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4" stroke-linecap="round"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2.8l2.2 2.2M3 13l-.5 2.5L5 15l8.2-8.2a1.4 1.4 0 0 0 0-2L12 3.6a1.4 1.4 0 0 0-2 0L3 11.8z" stroke-linejoin="round"/></svg>',
    note: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    chat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.8 4.2A1.4 1.4 0 0 1 4.2 2.8h7.6a1.4 1.4 0 0 1 1.4 1.4v4.6a1.4 1.4 0 0 1-1.4 1.4H6.5L3.5 13V10.2h-.7a1.4 1.4 0 0 1-1.4-1.4z" stroke-linejoin="round"/></svg>'
};

// ── persistence ─────────────────────────────────────────────────────────────
let saveTimer = null;
function setSave(state) {
    const f = $('#railFoot'), l = $('#saveLabel');
    f.classList.remove('saving', 'error');
    if (state === 'saving') { f.classList.add('saving'); l.textContent = 'Saving…'; }
    else if (state === 'error') { f.classList.add('error'); l.textContent = 'Save failed'; }
    else l.textContent = 'Saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
let savePending = false;
function save() {
    setSave('saving');
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 350);
}
async function doSave() {
    clearTimeout(saveTimer); savePending = false;
    try {
        const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STATE) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        setSave('saved');
    } catch (e) { console.warn('save failed', e); setSave('error'); }
}
// Flush any pending debounced save when the tab is closing/refreshing so nothing is lost.
function flushSave() {
    if (!savePending) return;
    clearTimeout(saveTimer); savePending = false;
    try { fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STATE), keepalive: true }); } catch (e) { /* best effort */ }
}
async function load() {
    try {
        const r = await fetch('/api/state');
        const j = await r.json();
        STATE.tasks = Array.isArray(j.tasks) ? j.tasks : [];
        STATE.meetings = Array.isArray(j.meetings) ? j.meetings : [];
        STATE.logs = Array.isArray(j.logs) ? j.logs : [];
        setSave('saved');
    } catch (e) { console.warn('load failed', e); }
}

// ── nav ─────────────────────────────────────────────────────────────────────
const NAV = [
    ['today', 'Today', I.today],
    ['day', 'My day', I.day],
    ['board', 'Board', I.board],
    ['all', 'All tasks', I.all],
    ['email', 'Follow-ups', I.email],
    ['meeting', 'Meetings', I.meeting]
];
function counts() {
    const open = STATE.tasks.filter(t => t.status !== 'done');
    const today = todayISO();
    return {
        today: open.filter(t => t.due && t.due <= today).length + open.filter(t => t.status === 'doing').length,
        overdue: open.filter(t => t.due && t.due < today).length,
        day: STATE.logs.filter(l => dayOf(l.at) === today).length + STATE.tasks.filter(t => dayOf(t.doneAt) === today).length,
        board: open.length,
        all: STATE.tasks.length,
        email: STATE.tasks.filter(t => t.source === 'email' && t.status !== 'done').length,
        meeting: STATE.meetings.length
    };
}
function renderNav() {
    const c = counts();
    $('#nav').innerHTML = `<div class="nav-group">Workspace</div>` + NAV.map(([id, label, ico]) => {
        const n = c[id] || 0;
        const alert = id === 'today' && c.overdue > 0;
        return `<div class="nav-item${VIEW === id ? ' active' : ''}" data-view="${id}">
            <span class="ni-ico">${ico}</span><span class="ni-label">${label}</span>
            ${n ? `<span class="ni-count${alert ? ' alert' : ''}">${n}</span>` : ''}</div>`;
    }).join('');
    $('#nav').querySelectorAll('.nav-item').forEach(el => el.onclick = () => { VIEW = el.dataset.view; $('#rail').classList.remove('open'); renderNav(); renderView(); });
}

// ── capture bar ─────────────────────────────────────────────────────────────
function buildCapture() {
    const cap = $('#capture');
    cap.innerHTML = `
        <div class="cap-row">
            <div class="seg" id="capSeg">
                <button data-mode="task" class="on">${I.all} Task</button>
                <button data-mode="email">${I.email} Follow-up</button>
            </div>
            <div class="cap-input-wrap">
                <input class="cap-input" id="capInput" autocomplete="off" placeholder="Add a task…  try  @Alex  #Reporting  !high  ^fri">
            </div>
            <button class="cap-add" id="capAdd">Add</button>
        </div>
        <div class="cap-extra" id="capExtra" style="display:none">
            <input id="capLink" placeholder="Outlook / email link (optional) — paste the message URL">
        </div>
        <div class="cap-hint" id="capHint"></div>`;
    const input = $('#capInput'), extra = $('#capExtra');
    $('#capSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
        CAP.mode = b.dataset.mode;
        $('#capSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        extra.style.display = CAP.mode === 'email' ? 'flex' : 'none';
        input.placeholder = CAP.mode === 'email' ? 'Email follow-up — what to do / the subject…  @Sender  ^tue' : 'Add a task…  try  @Alex  #Reporting  !high  ^fri';
        input.focus();
    });
    input.oninput = () => renderCapHint(input.value);
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submitCapture(); } };
    $('#capLink').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submitCapture(); } };
    $('#capAdd').onclick = submitCapture;
    renderCapHint('');
}
function renderCapHint(val) {
    const p = parseCapture(val || '');
    const chips = [];
    if (p.requestor) chips.push(`<span class="chip req">${I.req} ${esc(p.requestor)}</span>`);
    if (p.project) chips.push(`<span class="chip proj">#${esc(p.project)}</span>`);
    if (p.priority && p.priority !== 'normal') chips.push(`<span class="chip pri-${p.priority}">!${esc(p.priority)}</span>`);
    if (p.due) chips.push(`<span class="chip due">${I.clock} ${esc(dueMeta(p.due).label)}</span>`);
    $('#capHint').innerHTML = chips.length
        ? chips.join('')
        : `<span class="htxt"><b>@</b> requestor &nbsp; <b>#</b> project &nbsp; <b>!</b> urgent/high/low &nbsp; <b>^</b> due (today · fri · +3d · 2026-09-30)</span>`;
}
function submitCapture() {
    const input = $('#capInput');
    const raw = input.value.trim();
    if (!raw) return;
    const p = parseCapture(raw);
    if (!p.title) return;
    const t = newTask({ title: p.title, requestor: p.requestor, project: p.project, priority: p.priority, due: p.due, source: CAP.mode === 'email' ? 'email' : 'task', sourceLink: CAP.mode === 'email' ? ($('#capLink').value.trim()) : '' });
    STATE.tasks.push(t);
    input.value = ''; if ($('#capLink')) $('#capLink').value = '';
    renderCapHint('');
    commit();
    toast('Added' + (CAP.mode === 'email' ? ' follow-up' : ' task'));
    input.focus();
}
function newTask(o) {
    return Object.assign({
        id: uid(), title: '', notes: '', status: 'todo', priority: 'normal',
        requestor: '', source: 'task', sourceRef: '', sourceLink: '', project: '',
        due: '', meetingId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneAt: ''
    }, o);
}

// Persist + refresh everything after a mutation.
function commit() { save(); renderNav(); renderView(); }

// ── task card (shared) ──────────────────────────────────────────────────────
function taskCard(t, opts = {}) {
    const done = t.status === 'done';
    const dm = dueMeta(t.due);
    const tags = [];
    if (t.requestor) tags.push(`<span class="tag req">${I.req}${esc(t.requestor)}</span>`);
    if (t.source === 'email') tags.push(`<span class="tag src-email">${I.email}Email</span>`);
    if (t.source === 'meeting' && t.sourceRef && VIEW !== 'meeting') tags.push(`<span class="tag src-meeting">${I.meeting}${esc(t.sourceRef)}</span>`);
    if (t.project) tags.push(`<span class="tag proj">${I.tag}${esc(t.project)}</span>`);
    if (dm) tags.push(`<span class="tag due ${dm.cls}">${I.clock}${esc(dm.label)}</span>`);
    if (t.sourceLink) tags.push(`<span class="tag link" data-open-link="${esc(t.sourceLink)}">${I.link}Open</span>`);
    const nComments = (t.updates || []).filter(u => u.kind === 'comment').length;
    if (nComments) tags.push(`<span class="tag">${I.chat}${nComments}</span>`);
    const statusPill = opts.noStatus ? '' :
        `<button class="pill ${t.status}" data-cycle="${t.id}" title="Click to advance status">${t.status === 'todo' ? 'To do' : t.status === 'doing' ? 'Doing' : 'Done'}</button>`;
    return `<div class="task pri-${t.priority} ${done ? 'done' : ''}" data-task="${t.id}" ${opts.draggable ? 'draggable="true"' : ''}>
        <div class="check ${done ? 'on' : ''}" data-check="${t.id}" title="Complete">${I.check}</div>
        <div class="t-body">
            <div class="t-title">${esc(t.title)}</div>
            ${tags.length ? `<div class="t-meta">${tags.join('')}</div>` : ''}
        </div>
        <div class="t-status">${statusPill}<button class="t-edit" data-edit="${t.id}" title="Edit task">${I.pencil}</button></div>
    </div>`;
}
// Delegated clicks for any task list.
function wireTasks(root) {
    root.querySelectorAll('[data-check]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleDone(el.dataset.check); });
    root.querySelectorAll('[data-cycle]').forEach(el => el.onclick = e => { e.stopPropagation(); cycleStatus(el.dataset.cycle); });
    root.querySelectorAll('[data-open-link]').forEach(el => el.onclick = e => { e.stopPropagation(); window.open(el.dataset.openLink, '_blank'); });
    root.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => { e.stopPropagation(); openTask(el.dataset.edit); });
    root.querySelectorAll('[data-task]').forEach(el => el.onclick = () => openTask(el.dataset.task));
}
function findTask(id) { return STATE.tasks.find(t => t.id === id); }
const statusLabel = s => (s === 'todo' ? 'To do' : s === 'doing' ? 'Doing' : 'Done');
// Append an entry to a task's activity log. kind: 'comment' (you) or 'system' (auto).
function addUpdate(t, text, kind) {
    if (!Array.isArray(t.updates)) t.updates = [];
    t.updates.push({ id: uid(), at: new Date().toISOString(), text, kind: kind || 'comment' });
}
// Single place that changes status + records the transition in the activity log.
function changeStatus(t, st) {
    if (!t || t.status === st) return;
    const from = t.status;
    t.status = st;
    t.doneAt = st === 'done' ? new Date().toISOString() : '';
    t.updatedAt = new Date().toISOString();
    addUpdate(t, statusLabel(from) + ' → ' + statusLabel(st), 'system');
}
function toggleDone(id) { const t = findTask(id); if (!t) return; changeStatus(t, t.status === 'done' ? 'todo' : 'done'); commit(); }
function cycleStatus(id) { const t = findTask(id); if (!t) return; changeStatus(t, t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo'); commit(); }

// ── views ───────────────────────────────────────────────────────────────────
function renderView() {
    const c = counts();
    const title = { today: 'Today', day: 'My day', board: 'Board', all: 'All tasks', email: 'Email follow-ups', meeting: 'Meetings' }[VIEW];
    $('#viewTitle').textContent = title;
    const openCount = STATE.tasks.filter(t => t.status !== 'done').length;
    const subs = {
        today: `${c.today} to focus on${c.overdue ? ` · <span style="color:var(--urgent);font-weight:600">${c.overdue} overdue</span>` : ''}`,
        day: dayHeading(),
        board: `${openCount} open · ${STATE.tasks.filter(t => t.status === 'done').length} done`,
        all: `${STATE.tasks.length} total`,
        email: `${c.email} awaiting action`,
        meeting: `${STATE.meetings.length} meetings`
    };
    $('#viewSub').innerHTML = subs[VIEW] || '';
    $('#viewActions').innerHTML = viewActions();
    wireViewActions();
    const el = $('#content');
    if (VIEW === 'today') el.innerHTML = renderToday();
    else if (VIEW === 'day') { el.innerHTML = renderDay(); wireDay(el); }
    else if (VIEW === 'board') { el.innerHTML = renderBoard(); wireBoard(el); }
    else if (VIEW === 'all') { el.innerHTML = renderAll(); wireFilters(el); }
    else if (VIEW === 'email') el.innerHTML = renderEmail();
    else if (VIEW === 'meeting') { el.innerHTML = renderMeetings(); wireMeetings(el); return; }
    wireTasks(el);
}
function viewActions() {
    if (VIEW === 'meeting') return `<button class="btn primary" id="newMtg">+ New meeting</button>`;
    if (VIEW === 'day') return `<div class="day-nav">
        <button class="btn sm" id="dayPrev" title="Previous day">‹</button>
        <button class="btn sm" id="dayToday"${DAY === todayISO() ? ' disabled' : ''}>Today</button>
        <button class="btn sm" id="dayNext" title="Next day"${DAY >= todayISO() ? ' disabled' : ''}>›</button>
    </div>`;
    if (VIEW === 'today' && 'Notification' in window && Notification.permission === 'default')
        return `<button class="btn" id="enableRemind"><span class="reminder-cta">🔔 Enable reminders</span></button>`;
    return '';
}
function wireViewActions() {
    const nm = $('#newMtg'); if (nm) nm.onclick = addMeeting;
    const er = $('#enableRemind'); if (er) er.onclick = async () => { await Notification.requestPermission(); renderView(); checkReminders(); };
    const shift = n => { DAY = addDaysFrom(DAY, n); renderView(); };
    const dp = $('#dayPrev'); if (dp) dp.onclick = () => shift(-1);
    const dn = $('#dayNext'); if (dn) dn.onclick = () => shift(1);
    const dt = $('#dayToday'); if (dt) dt.onclick = () => { DAY = todayISO(); renderView(); };
}
function addDaysFrom(iso, n) { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return todayISO(d); }
function dayHeading() {
    if (!DAY) DAY = todayISO();
    const d = new Date(DAY + 'T00:00');
    const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const c = counts();
    const done = STATE.tasks.filter(t => dayOf(t.doneAt) === DAY).length;
    const notes = STATE.logs.filter(l => dayOf(l.at) === DAY).length;
    return `${DAY === todayISO() ? 'Today · ' : ''}${label} &nbsp;·&nbsp; ${done} done · ${notes} logged`;
}
function section(label, items, opts = {}) {
    if (!items.length) return '';
    return `<div class="section-label ${opts.danger ? 'danger' : ''}">${esc(label)}<span class="sl-count">${items.length}</span><span class="sl-line"></span></div>
        <div class="tlist">${items.map(t => taskCard(t, opts)).join('')}</div>`;
}
function renderToday() {
    const open = STATE.tasks.filter(t => t.status !== 'done');
    const today = todayISO();
    const overdue = open.filter(t => t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const dueToday = open.filter(t => t.due === today);
    const doing = open.filter(t => t.status === 'doing' && t.due !== today && !(t.due && t.due < today));
    // Everything else you still owe but haven't scheduled — so captured tasks always show up here.
    const PR = { urgent: 0, high: 1, normal: 2, low: 3 };
    const inbox = open.filter(t => !t.due && t.status !== 'doing').sort((a, b) => (PR[a.priority] - PR[b.priority]) || byNew(a, b));
    const html = section('Overdue', overdue, { danger: true }) + section('Due today', dueToday) + section('In progress', doing) + section('Inbox · no date', inbox);
    if (!html) return emptyState('🌤️', 'All clear', 'Nothing open right now. Capture a task above — it’ll appear here. Add a due date with <b>^today</b> or <b>^fri</b> to schedule it.');
    return html;
}
function renderBoard() {
    const cols = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
    return `<div class="board">` + cols.map(([st, name]) => {
        const items = STATE.tasks.filter(t => t.status === st).sort(byNew);
        return `<div class="col ${st}" data-col="${st}">
            <div class="col-head"><span class="ch-name"><span class="ch-dot"></span>${name}</span><span class="ch-count">${items.length}</span></div>
            <div class="tlist" data-drop="${st}">${items.map(t => taskCard(t, { draggable: true, noStatus: true })).join('') || `<div style="color:var(--ink-4);font-size:.8rem;padding:8px 4px">Drop here</div>`}</div>
        </div>`;
    }).join('') + `</div>`;
}
function renderAll() {
    const reqs = [...new Set(STATE.tasks.map(t => t.requestor).filter(Boolean))].sort();
    const projs = [...new Set(STATE.tasks.map(t => t.project).filter(Boolean))].sort();
    const opt = (v, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(v)}</option>`;
    const bar = `<div class="filters">
        <input type="text" id="fq" placeholder="Search tasks…" value="${esc(FILTER.q)}">
        <select id="fstatus"><option value="">Any status</option>${['todo', 'doing', 'done'].map(s => `<option value="${s}"${FILTER.status === s ? ' selected' : ''}>${s === 'todo' ? 'To do' : s === 'doing' ? 'Doing' : 'Done'}</option>`).join('')}</select>
        <select id="fpriority"><option value="">Any priority</option>${['urgent', 'high', 'normal', 'low'].map(s => `<option value="${s}"${FILTER.priority === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <select id="fsource"><option value="">Any source</option>${['task', 'email', 'meeting'].map(s => `<option value="${s}"${FILTER.source === s ? ' selected' : ''}>${s === 'task' ? 'Manual' : s}</option>`).join('')}</select>
        <select id="frequestor"><option value="">Any requestor</option>${reqs.map(r => opt(r, FILTER.requestor)).join('')}</select>
        ${projs.length ? `<select id="fproject"><option value="">Any project</option>${projs.map(r => opt(r, FILTER.project)).join('')}</select>` : ''}
        <button class="fclear" id="fclear">Clear</button>
    </div>`;
    let list = STATE.tasks.slice();
    const q = FILTER.q.toLowerCase();
    if (q) list = list.filter(t => (t.title + ' ' + t.requestor + ' ' + t.project + ' ' + t.notes + ' ' + t.sourceRef).toLowerCase().includes(q));
    if (FILTER.status) list = list.filter(t => t.status === FILTER.status);
    if (FILTER.priority) list = list.filter(t => t.priority === FILTER.priority);
    if (FILTER.source) list = list.filter(t => t.source === FILTER.source);
    if (FILTER.requestor) list = list.filter(t => t.requestor === FILTER.requestor);
    if (FILTER.project) list = list.filter(t => t.project === FILTER.project);
    const PR = { urgent: 0, high: 1, normal: 2, low: 3 };
    list.sort((a, b) => (a.status === 'done') - (b.status === 'done') || (PR[a.priority] - PR[b.priority]) || (a.due || '9999').localeCompare(b.due || '9999') || byNew(a, b));
    const body = list.length ? `<div class="tlist">${list.map(t => taskCard(t)).join('')}</div>` : emptyState('🔍', 'No matches', 'No tasks fit these filters.');
    return bar + body;
}
function renderEmail() {
    const items = STATE.tasks.filter(t => t.source === 'email');
    const open = items.filter(t => t.status !== 'done').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || byNew(a, b));
    const done = items.filter(t => t.status === 'done').sort(byNew);
    if (!items.length) return emptyState('✉️', 'No follow-ups', 'Switch the capture bar to <b>Follow-up</b> and paste an email subject + link so replies never slip.');
    return section('Awaiting action', open) + section('Done', done, {});
}

// ── My day (daily activity tracker) ─────────────────────────────────────────
// A timeline of what happened on a given day: free-form activity notes you jot
// plus the tasks you completed that day (auto). Great for standups / end-of-day.
function renderDay() {
    if (!DAY) DAY = todayISO();
    const isToday = DAY === todayISO();
    const notes = STATE.logs.filter(l => dayOf(l.at) === DAY).map(l => ({ kind: 'note', at: l.at, id: l.id, text: l.text, mins: l.mins || 0 }));
    const done = STATE.tasks.filter(t => dayOf(t.doneAt) === DAY).map(t => ({ kind: 'done', at: t.doneAt, id: t.id, text: t.title, task: t }));
    const items = [...notes, ...done].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const logger = isToday ? `<div class="day-log">
        <input id="dayInput" class="day-input" autocomplete="off" placeholder="What did you just work on?  e.g. “Reviewed the Q3 report with Alex (30m)”">
        <button class="btn primary" id="dayAdd">${I.plus} Log</button>
    </div>` : `<div class="day-readonly">Reviewing a past day — switch to <b>Today</b> to log activity.</div>`;
    const time = at => { try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    let timeline;
    if (!items.length) {
        timeline = isToday
            ? emptyState('☀️', 'Your day starts here', 'Log what you work on as you go, and completed tasks will drop in automatically — so you always know where the day went.')
            : emptyState('🗒️', 'Nothing logged', 'No activity recorded for this day.');
    } else {
        timeline = `<div class="timeline">` + items.map(it => it.kind === 'done'
            ? `<div class="tl-item done" data-open="${it.id}"><div class="tl-time">${time(it.at)}</div><div class="tl-mark done">${I.check}</div><div class="tl-body"><span class="tl-tag done">Completed</span> ${esc(it.text)}${it.task.requestor ? `<span class="tl-req">for ${esc(it.task.requestor)}</span>` : ''}</div></div>`
            : `<div class="tl-item"><input type="time" class="tl-timeedit" data-timefor="${it.id}" value="${hhmm(it.at)}" title="Edit the time"><div class="tl-mark">${I.note}</div><div class="tl-body">${esc(it.text)}${it.mins ? `<span class="tl-mins">${it.mins}m</span>` : ''}</div><button class="tl-del" data-dellog="${it.id}" title="Remove">×</button></div>`
        ).join('') + `</div>`;
    }
    return logger + timeline;
}
function wireDay(root) {
    const input = root.querySelector('#dayInput');
    const submit = () => { if (input && input.value.trim()) { addLog(input.value.trim()); input.value = ''; input.focus(); } };
    if (input) input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    const add = root.querySelector('#dayAdd'); if (add) add.onclick = submit;
    root.querySelectorAll('[data-dellog]').forEach(el => el.onclick = () => { STATE.logs = STATE.logs.filter(l => l.id !== el.dataset.dellog); commit(); });
    root.querySelectorAll('[data-timefor]').forEach(el => { el.onclick = e => e.stopPropagation(); el.onchange = () => setLogTime(el.dataset.timefor, el.value); });
    root.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openTask(el.dataset.open));
    if (input) setTimeout(() => input.focus(), 40);
}
// Move a log entry to a new time on the day being viewed (keeps the date, re-sorts).
function setLogTime(id, val) {
    const l = STATE.logs.find(x => x.id === id);
    if (!l || !/^\d{2}:\d{2}$/.test(val)) return;
    const [h, m] = val.split(':').map(Number);
    const base = new Date(dayOf(l.at) + 'T00:00');   // local midnight of the entry's day
    base.setHours(h, m, 0, 0);
    l.at = base.toISOString();
    commit();
}
// Pull a trailing "(30m)" / "45 min" duration hint out of a log line, if present.
function addLog(text) {
    let mins = 0;
    const m = text.match(/\(?\b(\d{1,3})\s*(m|min|mins|minutes)\b\)?\s*$/i) || text.match(/\(?\b(\d(?:\.\d)?)\s*(h|hr|hrs|hours)\b\)?\s*$/i);
    if (m) {
        const n = parseFloat(m[1]);
        mins = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
        const stripped = text.slice(0, m.index).replace(/[\s(·\-–—]+$/, '').trim();   // drop the duration (it becomes the badge)
        if (stripped) text = stripped;
    }
    STATE.logs.push({ id: uid(), text, at: new Date().toISOString(), mins });
    commit();
    toast('Logged');
}

// ── meetings ────────────────────────────────────────────────────────────────
function renderMeetings() {
    if (!STATE.meetings.length) return emptyState('🗓️', 'No meetings yet', 'Click <b>+ New meeting</b> before a call, then jot each assigned action item as it comes up — they flow straight into your tasks.');
    return STATE.meetings.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || byNew(a, b)).map(m => {
        const items = STATE.tasks.filter(t => t.meetingId === m.id);
        const openN = items.filter(t => t.status !== 'done').length;
        const expanded = OPEN_MTG.has(m.id);
        return `<div class="mtg" data-mtg="${m.id}">
            <div class="mtg-head" data-toggle="${m.id}">
                <span class="mh-name">${esc(m.name || 'Untitled meeting')}</span>
                <span class="mh-date">${m.date ? esc(new Date(m.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) : ''}</span>
                <span class="mh-count">${openN ? openN + ' open' : items.length + ' items'}</span>
            </div>
            ${expanded ? `<div class="mtg-body">
                <textarea class="mtg-notes" data-notes="${m.id}" placeholder="Meeting notes / context…">${esc(m.notes || '')}</textarea>
                <div class="tlist">${items.sort(byNew).map(t => taskCard(t)).join('') || '<div style="color:var(--ink-4);font-size:.82rem;padding:2px 2px 6px">No action items yet.</div>'}</div>
                <div class="mi-add">
                    <input data-miadd="${m.id}" placeholder="+ Action item…  @Owner  !high  ^fri">
                    <button class="btn primary sm" data-misave="${m.id}">Add</button>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px">
                    <button class="btn sm" data-medit="${m.id}">Rename / date</button>
                    <button class="btn sm danger" data-mdel="${m.id}">Delete meeting</button>
                </div>
            </div>` : ''}
        </div>`;
    }).join('');
}
function wireMeetings(root) {
    root.querySelectorAll('[data-toggle]').forEach(el => el.onclick = () => { const id = el.dataset.toggle; OPEN_MTG.has(id) ? OPEN_MTG.delete(id) : OPEN_MTG.add(id); renderView(); });
    root.querySelectorAll('[data-notes]').forEach(el => { el.onclick = e => e.stopPropagation(); el.onchange = () => { const m = STATE.meetings.find(x => x.id === el.dataset.notes); if (m) { m.notes = el.value; save(); } }; });
    root.querySelectorAll('[data-misave]').forEach(el => el.onclick = () => addActionItem(el.dataset.misave));
    root.querySelectorAll('[data-miadd]').forEach(el => el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addActionItem(el.dataset.miadd); } });
    root.querySelectorAll('[data-medit]').forEach(el => el.onclick = () => editMeeting(el.dataset.medit));
    root.querySelectorAll('[data-mdel]').forEach(el => el.onclick = () => delMeeting(el.dataset.mdel));
    wireTasks(root);
}
function addMeeting() {
    const name = prompt('Meeting name:', ''); if (name === null) return;
    const date = prompt('Date (YYYY-MM-DD, blank = today):', todayISO()) || todayISO();
    const m = { id: uid(), name: name.trim() || 'Untitled meeting', date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO(), notes: '', createdAt: new Date().toISOString() };
    STATE.meetings.push(m); OPEN_MTG.add(m.id);
    commit(); toast('Meeting added');
}
function editMeeting(id) {
    const m = STATE.meetings.find(x => x.id === id); if (!m) return;
    const name = prompt('Meeting name:', m.name); if (name === null) return;
    const date = prompt('Date (YYYY-MM-DD):', m.date || todayISO());
    m.name = name.trim() || m.name;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) m.date = date;
    commit();
}
function delMeeting(id) {
    const m = STATE.meetings.find(x => x.id === id); if (!m) return;
    const items = STATE.tasks.filter(t => t.meetingId === id);
    if (!confirm(`Delete meeting “${m.name}”` + (items.length ? ` and its ${items.length} action item(s)?` : '?'))) return;
    STATE.meetings = STATE.meetings.filter(x => x.id !== id);
    STATE.tasks = STATE.tasks.filter(t => t.meetingId !== id);
    OPEN_MTG.delete(id);
    commit(); toast('Meeting deleted');
}
function addActionItem(mid) {
    const m = STATE.meetings.find(x => x.id === mid); if (!m) return;
    const el = document.querySelector(`[data-miadd="${mid}"]`); if (!el) return;
    const raw = el.value.trim(); if (!raw) return;
    const p = parseCapture(raw);
    STATE.tasks.push(newTask({ title: p.title, requestor: p.requestor, project: p.project, priority: p.priority, due: p.due, source: 'meeting', meetingId: mid, sourceRef: m.name }));
    el.value = '';
    commit();
    // keep meeting open & refocus
    const again = document.querySelector(`[data-miadd="${mid}"]`); if (again) again.focus();
}

// ── board drag & drop ───────────────────────────────────────────────────────
let dragId = null;
function wireBoard(root) {
    root.querySelectorAll('[data-task]').forEach(card => {
        card.ondragstart = e => { dragId = card.dataset.task; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => card.style.opacity = '.4', 0); };
        card.ondragend = () => { card.style.opacity = ''; dragId = null; root.querySelectorAll('.col').forEach(c => c.classList.remove('dragover')); };
    });
    root.querySelectorAll('[data-col]').forEach(col => {
        col.ondragover = e => { e.preventDefault(); col.classList.add('dragover'); };
        col.ondragleave = () => col.classList.remove('dragover');
        col.ondrop = e => {
            e.preventDefault(); col.classList.remove('dragover');
            const t = findTask(dragId); if (!t) return;
            const st = col.dataset.col;
            if (t.status !== st) { changeStatus(t, st); commit(); }
        };
    });
    wireTasks(root);
}

// ── filters ─────────────────────────────────────────────────────────────────
function wireFilters(root) {
    const bind = (id, key, ev = 'change') => { const el = root.querySelector('#' + id); if (el) el[ev === 'input' ? 'oninput' : 'onchange'] = () => { FILTER[key] = el.value; renderPreserveFilter(); }; };
    const q = root.querySelector('#fq');
    if (q) q.oninput = () => { FILTER.q = q.value; renderPreserveFilter(); };
    bind('fstatus', 'status'); bind('fpriority', 'priority'); bind('fsource', 'source'); bind('frequestor', 'requestor'); bind('fproject', 'project');
    const clr = root.querySelector('#fclear'); if (clr) clr.onclick = () => { Object.keys(FILTER).forEach(k => FILTER[k] = ''); renderView(); };
    wireTasks(root);
}
// Re-render the All view but keep focus in the search box.
function renderPreserveFilter(keepFocus) {
    const el = $('#content');
    const active = document.activeElement;
    const wasSearch = active && active.id === 'fq';
    const pos = wasSearch ? active.selectionStart : null;
    el.innerHTML = renderAll();
    wireFilters(el);
    if (wasSearch) { const q = el.querySelector('#fq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
}

// ── task detail modal ───────────────────────────────────────────────────────
function openTask(id) {
    const t = findTask(id); if (!t) return;
    const mtgOpts = STATE.meetings.map(m => `<option value="${m.id}"${t.meetingId === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    $('#modal').innerHTML = `
        <div class="modal-head"><h3>Edit task</h3><button class="modal-x" id="mx">×</button></div>
        <div class="modal-body">
            <div class="field"><label>Task</label><input id="e_title" value="${esc(t.title)}"></div>
            <div class="field"><label>Notes</label><textarea id="e_notes" placeholder="Context, links, sub-steps…">${esc(t.notes)}</textarea></div>
            <div class="field-row">
                <div class="field"><label>Requested by</label><input id="e_req" value="${esc(t.requestor)}" placeholder="Who asked?"></div>
                <div class="field"><label>Project / tag</label><input id="e_proj" value="${esc(t.project)}"></div>
            </div>
            <div class="field-row">
                <div class="field"><label>Priority</label><select id="e_pri">${['urgent', 'high', 'normal', 'low'].map(p => `<option value="${p}"${t.priority === p ? ' selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
                <div class="field"><label>Due date</label><input type="date" id="e_due" value="${esc(t.due)}"></div>
            </div>
            <div class="field-row">
                <div class="field"><label>Status</label><select id="e_status">${[['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']].map(([v, l]) => `<option value="${v}"${t.status === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
                <div class="field"><label>Source</label><select id="e_source">${[['task', 'Manual'], ['email', 'Email follow-up'], ['meeting', 'Meeting']].map(([v, l]) => `<option value="${v}"${t.source === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
            </div>
            <div class="field"><label>Reference (email subject / meeting)</label><input id="e_ref" value="${esc(t.sourceRef)}" placeholder="e.g. RE: Budget approval"></div>
            <div class="field"><label>Link (Outlook / URL)</label><input id="e_link" value="${esc(t.sourceLink)}" placeholder="https://…"></div>
            ${STATE.meetings.length ? `<div class="field"><label>Linked meeting</label><select id="e_mtg"><option value="">— none —</option>${mtgOpts}</select></div>` : ''}
            <div class="field">
                <label>Activity &amp; comments</label>
                <div class="tlog" id="e_log">${renderTaskLog(t)}</div>
                <div class="tlog-add"><input id="e_comment" placeholder="Add a comment / update…  (Enter to post)"><button class="btn primary sm" id="e_addcomment">Comment</button></div>
            </div>
        </div>
        <div class="modal-foot">
            <button class="btn danger" id="e_del">Delete</button>
            <div class="spacer"></div>
            <button class="btn" id="e_cancel">Cancel</button>
            <button class="btn primary" id="e_save">Save</button>
        </div>`;
    $('#overlay').classList.add('open');
    const close = () => { $('#overlay').classList.remove('open'); renderView(); };   // reflect posted comments / status in the background
    $('#mx').onclick = close; $('#e_cancel').onclick = close;
    $('#overlay').onclick = e => { if (e.target === $('#overlay')) close(); };
    $('#e_del').onclick = () => { $('#overlay').classList.remove('open'); deleteTask(id); };
    // Post a comment immediately (persists without needing Save), refresh the log in place.
    const refreshLog = () => { const box = $('#e_log'); if (box) box.innerHTML = renderTaskLog(t); wireTaskLog(t); };
    const postComment = () => {
        const inp = $('#e_comment'); const txt = (inp.value || '').trim(); if (!txt) return;
        addUpdate(t, txt, 'comment'); t.updatedAt = new Date().toISOString();
        inp.value = ''; save(); refreshLog(); inp.focus();
    };
    $('#e_addcomment').onclick = postComment;
    $('#e_comment').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); postComment(); } };
    wireTaskLog(t);
    $('#e_save').onclick = () => {
        const prevStatus = t.status;
        t.title = $('#e_title').value.trim() || t.title;
        t.notes = $('#e_notes').value;
        t.requestor = $('#e_req').value.trim();
        t.project = $('#e_proj').value.trim();
        t.priority = $('#e_pri').value;
        t.due = $('#e_due').value;
        t.source = $('#e_source').value;
        t.sourceRef = $('#e_ref').value.trim();
        t.sourceLink = $('#e_link').value.trim();
        if ($('#e_mtg')) { t.meetingId = $('#e_mtg').value; if (t.meetingId && t.source !== 'meeting') t.source = 'meeting'; }
        const newStatus = $('#e_status').value;
        if (newStatus !== prevStatus) { t.status = newStatus; t.doneAt = newStatus === 'done' ? new Date().toISOString() : ''; addUpdate(t, statusLabel(prevStatus) + ' → ' + statusLabel(newStatus), 'system'); }
        t.updatedAt = new Date().toISOString();
        $('#overlay').classList.remove('open'); commit();
    };
    setTimeout(() => $('#e_title').focus(), 40);
}
// The activity log inside the task editor — comments (you) + system entries (auto).
function renderTaskLog(t) {
    const ups = (t.updates || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));   // oldest → newest
    if (!ups.length) return `<div class="tlog-empty">No activity yet — add a comment as the task progresses. Status changes are logged automatically.</div>`;
    const when = at => { try { const d = new Date(at); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    return ups.map(u => `<div class="tlog-item ${u.kind}">
        <span class="tlog-dot"></span>
        <div class="tlog-main"><div class="tlog-text">${esc(u.text)}</div><div class="tlog-when">${when(u.at)}</div></div>
        <button class="tlog-del" data-delup="${u.id}" title="Remove">×</button>
    </div>`).join('');
}
function wireTaskLog(t) {
    document.querySelectorAll('#e_log [data-delup]').forEach(el => el.onclick = () => {
        t.updates = (t.updates || []).filter(u => u.id !== el.dataset.delup);
        t.updatedAt = new Date().toISOString(); save();
        const box = $('#e_log'); if (box) box.innerHTML = renderTaskLog(t); wireTaskLog(t);
    });
}
function deleteTask(id) {
    const idx = STATE.tasks.findIndex(t => t.id === id); if (idx < 0) return;
    lastDeleted = STATE.tasks[idx];
    STATE.tasks.splice(idx, 1);
    commit();
    toast('Task deleted', () => { if (lastDeleted) { STATE.tasks.push(lastDeleted); lastDeleted = null; commit(); } });
}

// ── toast + reminders ───────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, undo) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (undo ? ' <span class="undo" id="tundo">Undo</span>' : '');
    el.classList.add('show');
    if (undo) $('#tundo').onclick = () => { undo(); el.classList.remove('show'); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 6000 : 2400);
}
function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const today = todayISO();
    STATE.tasks.filter(t => t.status !== 'done' && t.due && t.due <= today && !notified.has(t.id)).forEach(t => {
        notified.add(t.id);
        const over = t.due < today;
        new Notification(over ? '⚠ Overdue task' : '🔔 Due today', { body: t.title + (t.requestor ? ' — for ' + t.requestor : ''), tag: t.id });
    });
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
    $('#menuToggle').onclick = () => $('#rail').classList.toggle('open');
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') $('#overlay').classList.remove('open');
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); $('#capInput').focus(); }
    });
    DAY = todayISO();
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
    buildCapture();
    await load();
    renderNav();
    renderView();
    checkReminders();
    setInterval(checkReminders, 5 * 60 * 1000);
}
function emptyState(emoji, title, body) {
    return `<div class="empty"><div class="e-emoji">${emoji}</div><h3>${title}</h3><div>${body}</div></div>`;
}
boot();
