/* =========================================================
   FamilyFink · Painel — lógica da interface
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const TYPE_META = {
    browser: { label: 'Navegador', emoji: '🌐', color: '#46e0ff' },
    app: { label: 'Aplicativo', emoji: '📱', color: '#ff4d9d' },
    activity: { label: 'Atividade', emoji: '⚡', color: '#ffcf5c' },
};

const FALLBACK_COLORS = ['#8b5cff', '#4dffb0', '#ff9ac7', '#7fd4ff', '#ffa45c'];

const VIEWS = {
    overview: { title: 'Visão geral', sub: 'Tudo o que a família anda aprontando nos dispositivos.' },
    devices: { title: 'Dispositivos', sub: 'Todos os aparelhos que já enviaram relatórios.' },
    records: { title: 'Registros', sub: 'Explore cada evento capturado pelos dispositivos.' },
};

const state = {
    view: 'overview',
    overview: null,
    recent: [],
    records: [],
    recordsTotal: 0,
    recordsSkip: 0,
    filters: { deviceId: '', type: 'all', q: '' },
    deviceQuery: '',
    loadingRecords: false,
    recordsReq: 0,
    modalJson: '',
    lastUpdate: null,
};

const nf = new Intl.NumberFormat('pt-BR');

/* ---------------- utilitários ---------------- */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const fmtN = (n) => nf.format(Number(n) || 0);

function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtFull(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

function relTime(value) {
    if (!value) return '—';
    const t = new Date(value).getTime();
    if (!Number.isFinite(t)) return '—';
    const diff = Date.now() - t;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `há ${days}d`;
    return fmtDate(value);
}

function paletteFor(type) {
    if (TYPE_META[type]) return TYPE_META[type].color;
    let hash = 0;
    for (const ch of String(type || 'outro')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function metaFor(type) {
    const known = TYPE_META[type];
    if (known) return known;
    const label = type ? String(type).charAt(0).toUpperCase() + String(type).slice(1) : 'Outro';
    return { label, emoji: '🧩', color: paletteFor(type) };
}

function shortVal(value, max = 70) {
    if (value === null || value === undefined) return '';
    let out;
    if (Array.isArray(value)) out = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
    else if (typeof value === 'object') out = JSON.stringify(value);
    else out = String(value);
    return out.length > max ? `${out.slice(0, max)}…` : out;
}

const TITLE_KEYS = [
    'title', 'tabTitle', 'appName', 'app_name', 'app', 'name', 'process', 'packageName',
    'package', 'domain', 'host', 'hostname', 'url', 'site', 'website', 'action', 'event', 'activity',
];

function pickTitle(rec) {
    const payload = rec.payload || {};
    for (const key of TITLE_KEYS) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return metaFor(rec.type).label;
}

function pickSub(rec, title) {
    const payload = rec.payload || {};
    for (const key of ['url', 'host', 'domain', 'hostname', 'website', 'site', 'path']) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim() && value.trim() !== title) return value.trim();
    }
    return '';
}

function deviceInitials(deviceId) {
    const clean = String(deviceId || '').replace(/[^a-zA-Z0-9]/g, '');
    return (clean.slice(0, 2) || '?').toUpperCase();
}

function isOnline(lastSeen) {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 60 * 60 * 1000;
}

function debounce(fn, wait = 320) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

async function api(path) {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erro ${res.status}`);
    }
    return res.json();
}

let toastTimer;
function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function setStatus(ok) {
    const dot = $('#statusDot');
    dot.classList.toggle('is-ok', ok);
    dot.classList.toggle('is-err', !ok);
    $('#statusText').textContent = ok ? 'API conectada' : 'Sem conexão';
    $('#statusSub').textContent = ok ? 'dados sincronizados' : 'verifique o servidor';
    $('#updatedAt').textContent = state.lastUpdate
        ? state.lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '—';
}

/* ---------------- navegação ---------------- */

function setView(view) {
    if (!VIEWS[view]) return;
    state.view = view;
    $('#viewTitle').textContent = VIEWS[view].title;
    $('#viewSub').textContent = VIEWS[view].sub;

    $$('.nav-btn').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
    $$('.view').forEach((section) => section.classList.toggle('is-active', section.id === `view-${view}`));

    $('#sidebar').classList.remove('is-open');
    $('#scrim').classList.remove('is-on');

    if (view === 'records' && state.records.length === 0 && !state.loadingRecords) {
        loadRecords(true);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDeviceRecords(deviceId) {
    state.filters.deviceId = deviceId || '';
    const select = $('#filterDevice');
    if (select) select.value = state.filters.deviceId;
    setView('records');
    if (state.records.length || state.loadingRecords) loadRecords(true);
}

/* ---------------- dados ---------------- */

async function loadDashboard() {
    const btn = $('#refreshBtn');
    btn.classList.add('is-spinning');
    try {
        const [overview, recent] = await Promise.all([
            api('/api/dashboard/overview'),
            api('/api/dashboard/records?limit=7'),
        ]);
        state.overview = overview;
        state.recent = recent.items || [];
        state.lastUpdate = new Date();

        renderStats();
        renderDaily();
        renderDonut();
        renderOverviewDevices();
        renderRecent();
        renderDevicesView();
        renderTypeFilters();
        updateDeviceSelect();
        setStatus(true);
    } catch (err) {
        setStatus(false);
        toast(`Falha ao carregar o painel: ${err.message}`);
    } finally {
        setTimeout(() => btn.classList.remove('is-spinning'), 400);
    }
}

async function loadRecords(reset = false) {
    const reqId = ++state.recordsReq;
    state.loadingRecords = true;

    const list = $('#recordsList');
    const moreBtn = $('#loadMoreBtn');

    if (reset) {
        state.records = [];
        state.recordsSkip = 0;
        state.recordsTotal = 0;
        list.innerHTML = skeleton(3);
        moreBtn.hidden = true;
    }

    moreBtn.disabled = true;

    const params = new URLSearchParams({ limit: '20', skip: String(state.recordsSkip) });
    if (state.filters.deviceId) params.set('deviceId', state.filters.deviceId);
    if (state.filters.type && state.filters.type !== 'all') params.set('type', state.filters.type);
    if (state.filters.q) params.set('q', state.filters.q);

    try {
        const data = await api(`/api/dashboard/records?${params.toString()}`);
        if (reqId !== state.recordsReq) return; // resposta antiga: ignora

        state.records = reset ? (data.items || []) : state.records.concat(data.items || []);
        state.recordsTotal = data.total || 0;
        state.recordsSkip = state.records.length;
        renderRecords();
    } catch (err) {
        if (reqId !== state.recordsReq) return;
        toast(`Falha ao carregar registros: ${err.message}`);
        if (reset) {
            list.innerHTML = emptyState('😵', 'Não foi possível carregar', 'Tente atualizar o painel.');
            setStatus(false);
        }
    } finally {
        if (reqId === state.recordsReq) {
            state.loadingRecords = false;
            moreBtn.disabled = false;
            syncLoadMore();
        }
    }
}

/* ---------------- render: números ---------------- */

function renderStats() {
    const totals = state.overview?.totals || {};
    $('#statDevices').textContent = fmtN(totals.devices);
    $('#statReports').textContent = fmtN(totals.reports);
    $('#statRecords').textContent = fmtN(totals.records);
    $('#statLast24').textContent = fmtN(totals.last24h);
    $('#navDevices').textContent = fmtN(totals.devices);
    $('#devicesCount').textContent = fmtN(totals.devices);
}

function renderDaily() {
    const chart = $('#dailyChart');
    const daily = state.overview?.daily || [];
    const map = new Map(daily.map((d) => [d.date, d.count]));

    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
        const date = new Date(end - i * 86400000);
        const key = date.toISOString().slice(0, 10);
        days.push({ key, date, count: map.get(key) || 0 });
    }

    const max = Math.max(1, ...days.map((d) => d.count));

    chart.innerHTML = days.map((d, index) => {
        const height = d.count > 0 ? Math.max(7, Math.round((d.count / max) * 100)) : 2;
        const label = d.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
        const dow = d.date.getUTCDay();
        const classes = [
            'bar-col',
            d.count === 0 ? 'is-zero' : '',
            dow === 0 || dow === 6 ? 'is-weekend' : '',
            index === days.length - 1 ? 'is-today' : '',
        ].filter(Boolean).join(' ');
        const short = d.date.toLocaleDateString('pt-BR', { day: '2-digit', timeZone: 'UTC' });
        return `
            <div class="${classes}" title="${d.count} registro${d.count === 1 ? '' : 's'} em ${label}">
                <div class="bar-track">
                    <div class="bar" style="height:${height}%">
                        <span class="bar-value">${fmtN(d.count)}</span>
                    </div>
                </div>
                <span class="bar-day" data-short="${short}">${label}</span>
            </div>`;
    }).join('');
}

function renderDonut() {
    const types = state.overview?.types || [];
    const total = types.reduce((sum, t) => sum + (t.count || 0), 0);
    const segments = $('#donutSegments');
    const legend = $('#donutLegend');
    const C = 2 * Math.PI * 70;

    $('#donutTotal').textContent = fmtN(total);

    if (!total) {
        segments.innerHTML = '';
        legend.innerHTML = emptyState('🕳️', 'Nada por aqui ainda', 'Aguardando o primeiro relatório.');
        return;
    }

    let acc = 0;
    segments.innerHTML = types.map((t) => {
        const color = paletteFor(t.type);
        const len = (t.count / total) * C;
        const visible = Math.max(len - 4, 0.6);
        const offset = -acc;
        acc += len;
        return `<circle class="donut-seg" cx="100" cy="100" r="70" stroke="${color}"
            stroke-dasharray="${visible} ${C - visible}" stroke-dashoffset="${offset}">
            <title>${esc(metaFor(t.type).label)}: ${t.count}</title>
        </circle>`;
    }).join('');

    legend.innerHTML = types.map((t) => {
        const meta = metaFor(t.type);
        const pct = Math.round((t.count / total) * 100);
        return `
            <div class="legend-row">
                <span class="legend-dot" style="background:${meta.color};color:${meta.color}"></span>
                <span class="legend-name">${esc(meta.label)}</span>
                <span class="legend-val"><b>${fmtN(t.count)}</b> · ${pct}%</span>
            </div>`;
    }).join('');
}

/* ---------------- render: listas ---------------- */

function emptyState(emoji, title, hint) {
    return `<div class="empty"><span>${emoji}</span><strong>${esc(title)}</strong><small>${esc(hint)}</small></div>`;
}

function renderOverviewDevices() {
    const wrap = $('#overviewDevices');
    const devices = (state.overview?.devices || []).slice(0, 5);

    if (!devices.length) {
        wrap.innerHTML = emptyState('📭', 'Nenhum dispositivo ainda', 'Os aparelhos aparecem aqui ao enviar relatórios.');
        return;
    }

    wrap.innerHTML = devices.map((d) => `
        <button class="mini-row" type="button" data-device="${esc(d.deviceId)}">
            <span class="mini-avatar">${esc(deviceInitials(d.deviceId))}</span>
            <span class="mini-main">
                <strong>${esc(d.deviceId)}</strong>
                <small>${fmtN(d.reports)} relatório${d.reports === 1 ? '' : 's'} · ${fmtN(d.records)} registro${d.records === 1 ? '' : 's'}</small>
            </span>
            <span class="mini-side">
                <b>${relTime(d.lastSeen)}</b>
            </span>
        </button>`).join('');
}

function escapeJoin(types) {
    return (types || []).map((t) => esc(metaFor(t).label)).join(' · ') || 'sem dados';
}

function renderRecent() {
    const wrap = $('#recentRecords');
    if (!state.recent.length) {
        wrap.innerHTML = emptyState('🛰️', 'Sem registros recentes', 'Assim que a API receber dados, eles aparecem aqui.');
        return;
    }

    wrap.innerHTML = state.recent.map((rec, idx) => {
        const meta = metaFor(rec.type);
        const title = pickTitle(rec);
        const sub = pickSub(rec, title);
        return `
            <button class="mini-row" type="button" data-recent="${idx}">
                <span class="mini-avatar" style="background:linear-gradient(150deg, ${meta.color}, #4a3486)">${meta.emoji}</span>
                <span class="mini-main">
                    <strong>${esc(title)}</strong>
                    <small>${esc(rec.deviceId || 'sem dispositivo')}${sub ? ` · ${esc(sub)}` : ''}</small>
                </span>
                <span class="mini-side"><b>${relTime(rec.ts)}</b><span>${esc(meta.label)}</span></span>
            </button>`;
    }).join('');
}

function renderDevicesView() {
    const grid = $('#devicesGrid');
    const query = state.deviceQuery.trim().toLowerCase();
    const all = state.overview?.devices || [];
    const devices = query ? all.filter((d) => String(d.deviceId).toLowerCase().includes(query)) : all;

    $('#devicesCount').textContent = fmtN(devices.length);

    if (!devices.length) {
        grid.innerHTML = query
            ? `<div style="grid-column:1/-1">${emptyState('🔍', 'Nenhum dispositivo encontrado', 'Tente outro termo de busca.')}</div>`
            : `<div style="grid-column:1/-1">${emptyState('📭', 'Nenhum dispositivo ainda', 'Os aparelhos aparecem aqui ao enviar relatórios.')}</div>`;
        return;
    }

    grid.innerHTML = devices.map((d) => {
        const online = isOnline(d.lastSeen);
        return `
            <article class="device-card" data-device="${esc(d.deviceId)}">
                <div class="dev-head">
                    <span class="dev-avatar">${esc(deviceInitials(d.deviceId))}</span>
                    <div class="dev-id">
                        <h3 title="${esc(d.deviceId)}">${esc(d.deviceId)}</h3>
                        <small title="${esc((d.types || []).map((t) => metaFor(t).label).join(' · '))}">${escapeJoin(d.types)}</small>
                    </div>
                </div>
                <div class="dev-stats">
                    <div><strong>${fmtN(d.reports)}</strong><span>relatórios</span></div>
                    <div><strong>${fmtN(d.records)}</strong><span>registros</span></div>
                    <div><strong>${d.types?.length || 0}</strong><span>tipos</span></div>
                </div>
                <div class="dev-foot">
                    <div class="dev-seen">
                        <span class="status ${online ? 'on' : 'off'}">${online ? 'ativo' : 'inativo'}</span>
                        <span>visto ${relTime(d.lastSeen)}</span>
                    </div>
                    <button class="btn small" type="button" data-device="${esc(d.deviceId)}">Ver registros →</button>
                </div>
            </article>`;
    }).join('');
}

/* ---------------- render: filtros e registros ---------------- */

function renderTypeFilters() {
    const wrap = $('#typeFilters');
    const types = state.overview?.types || [];
    const total = state.overview?.totals?.records || 0;

    const items = [
        `<button class="type-pill ${state.filters.type === 'all' ? 'is-active' : ''}" data-type="all" type="button">
            ✨ Todos <span class="cnt">${fmtN(total)}</span>
        </button>`,
        ...types.map((t) => {
            const meta = metaFor(t.type);
            return `<button class="type-pill ${state.filters.type === t.type ? 'is-active' : ''}" data-type="${esc(t.type)}" type="button">
                ${meta.emoji} ${esc(meta.label)} <span class="cnt">${fmtN(t.count)}</span>
            </button>`;
        }),
    ];

    wrap.innerHTML = items.join('');
}

function updateDeviceSelect() {
    const select = $('#filterDevice');
    if (!select) return;
    const devices = state.overview?.devices || [];
    const options = ['<option value="">Todos os dispositivos</option>']
        .concat(devices.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.deviceId)} · ${fmtN(d.records)} registros</option>`));

    if (state.filters.deviceId && !devices.some((d) => d.deviceId === state.filters.deviceId)) {
        state.filters.deviceId = '';
    }

    select.innerHTML = options.join('');
    select.value = state.filters.deviceId || '';
}

function recordCard(rec, idx) {
    const meta = metaFor(rec.type);
    const title = pickTitle(rec);
    const sub = pickSub(rec, title);
    const payload = rec.payload || {};
    const chips = Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
        .slice(0, 4)
        .map(([k, v]) => `<span class="rec-chip"><b>${esc(k)}:</b> ${esc(shortVal(v, 46))}</span>`)
        .join('');

    return `
        <article class="rec-card" data-idx="${idx}" style="--c:${meta.color}" tabindex="0" role="button" aria-label="Ver detalhes do registro">
            <span class="rec-icon">${meta.emoji}</span>
            <div class="rec-main">
                <div class="rec-top">
                    <span class="rec-type">${esc(meta.label)}</span>
                    <span class="rec-dev">${esc(rec.deviceId || 'sem dispositivo')}</span>
                    <span class="rec-time" title="${esc(fmtFull(rec.ts))}">${esc(relTime(rec.ts))}</span>
                </div>
                <h4 class="rec-title" title="${esc(title)}">${esc(title)}</h4>
                ${sub ? `<p class="rec-sub">${esc(sub)}</p>` : ''}
                ${chips ? `<div class="rec-chips">${chips}</div>` : ''}
            </div>
        </article>`;
}

function renderRecords() {
    const list = $('#recordsList');
    const summary = $('#recordsSummary');

    if (!state.records.length) {
        list.innerHTML = emptyState('🔎', 'Nenhum registro encontrado', 'Ajuste os filtros ou aguarde novos envios.');
        summary.innerHTML = 'Nenhum registro com esses filtros.';
        syncLoadMore();
        return;
    }

    list.innerHTML = state.records.map((rec, idx) => recordCard(rec, idx)).join('');
    summary.innerHTML = `Mostrando <b>${fmtN(state.records.length)}</b> de <b>${fmtN(state.recordsTotal)}</b> registro${state.recordsTotal === 1 ? '' : 's'}.`;
    syncLoadMore();
}

function syncLoadMore() {
    const btn = $('#loadMoreBtn');
    const remaining = state.recordsTotal - state.records.length;
    btn.hidden = !(remaining > 0 && state.records.length > 0);
    if (remaining > 0) btn.textContent = `Carregar mais (${fmtN(remaining)})`;
}

function skeleton(rows) {
    return Array.from({ length: rows }, () => `
        <div class="rec-card" style="--c:#8b5cff;pointer-events:none;opacity:.5">
            <span class="rec-icon" style="background:rgba(139,92,255,.12)"></span>
            <div class="rec-main">
                <div class="rec-top"><span class="rec-type">carregando…</span></div>
                <h4 class="rec-title">████████ ████ ██████</h4>
                <p class="rec-sub">██████████████████████</p>
            </div>
        </div>`).join('');
}

/* ---------------- modal ---------------- */

function openRecord(rec) {
    if (!rec) return;
    const meta = metaFor(rec.type);
    const title = pickTitle(rec);
    const payload = rec.payload || {};

    $('#modalKind').textContent = meta.label;
    $('#modalKind').style.color = meta.color;
    $('#modalKind').style.borderColor = `${meta.color}55`;
    $('#modalKind').style.background = `${meta.color}1f`;
    $('#modalTitle').textContent = title;
    $('#modalMeta').textContent = `${rec.deviceId || 'sem dispositivo'} · ${fmtFull(rec.ts)}`;

    const kv = [
        ['Dispositivo', rec.deviceId || '—'],
        ['Tipo', meta.label],
        ['Registro', fmtFull(rec.ts)],
        ['Relatório', fmtFull(rec.sentAt)],
    ];

    Object.entries(payload)
        .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
        .slice(0, 8)
        .forEach(([k, v]) => kv.push([k, shortVal(v, 90)]));

    $('#modalKv').innerHTML = kv.map(([k, v]) => `
        <div class="kv"><span>${esc(k)}</span><strong title="${esc(v)}">${esc(v || '—')}</strong></div>
    `).join('');

    state.modalJson = JSON.stringify(payload, null, 2);
    $('#modalJson').textContent = state.modalJson || '{}';

    const modal = $('#modal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
}

/* ---------------- eventos ---------------- */

function bindEvents() {
    $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.goto)));

    $('#refreshBtn').addEventListener('click', async () => {
        await loadDashboard();
        if (state.view === 'records') await loadRecords(true);
    });

    $('#menuBtn').addEventListener('click', () => {
        $('#sidebar').classList.add('is-open');
        $('#scrim').classList.add('is-on');
    });

    $('#scrim').addEventListener('click', () => {
        $('#sidebar').classList.remove('is-open');
        $('#scrim').classList.remove('is-on');
    });

    $('#overviewDevices').addEventListener('click', (event) => {
        const row = event.target.closest('[data-device]');
        if (row) openDeviceRecords(row.dataset.device);
    });

    $('#recentRecords').addEventListener('click', (event) => {
        const row = event.target.closest('[data-recent]');
        if (row) openRecord(state.recent[Number(row.dataset.recent)]);
    });

    $('#devicesGrid').addEventListener('click', (event) => {
        const target = event.target.closest('[data-device]');
        if (target) openDeviceRecords(target.dataset.device);
    });

    $('#recordsList').addEventListener('click', (event) => {
        const card = event.target.closest('[data-idx]');
        if (card) openRecord(state.records[Number(card.dataset.idx)]);
    });

    $('#recordsList').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            const card = event.target.closest('[data-idx]');
            if (card) {
                event.preventDefault();
                openRecord(state.records[Number(card.dataset.idx)]);
            }
        }
    });

    $('#deviceSearch').addEventListener('input', (event) => {
        state.deviceQuery = event.target.value;
        renderDevicesView();
    });

    $('#filterDevice').addEventListener('change', (event) => {
        state.filters.deviceId = event.target.value;
        loadRecords(true);
    });

    $('#typeFilters').addEventListener('click', (event) => {
        const pill = event.target.closest('[data-type]');
        if (!pill) return;
        state.filters.type = pill.dataset.type;
        renderTypeFilters();
        loadRecords(true);
    });

    const search = $('#recordSearch');
    search.addEventListener('input', debounce((event) => {
        state.filters.q = event.target.value.trim();
        loadRecords(true);
    }, 350));

    $('#loadMoreBtn').addEventListener('click', () => loadRecords(false));

    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (event) => {
        if (event.target === $('#modal')) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    $('#copyJson').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(state.modalJson || '{}');
            toast('Payload copiado para a área de transferência.');
        } catch {
            toast('Não foi possível copiar o payload.');
        }
    });
}

/* ---------------- inicialização ---------------- */

function init() {
    bindEvents();
    setView('overview');
    loadDashboard();

    setInterval(() => {
        if (document.hidden) return;
        if (state.view === 'overview') loadDashboard();
    }, 30000);
}

init();
