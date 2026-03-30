/* ==========================================================================
   INTERFACES DE FIREBASE (Desde Layout)
   ========================================================================== */
const { db, auth } = window.firebaseInstance || {};
const { collection, getDocs, query, orderBy } = window.firebaseFirestore || {};

/* ==========================================================================
   CONSTANTES Y CONFIGURACIÓN
   ========================================================================== */
const ESPECIALIDADES = [
    "ANESTESIOLOGIA Y REANIMACION", "CIRUGIA GENERAL", "CIRUGIA MAXILOFACIAL", "CIRUGIA VASCULAR",
    "GINECOLOGIA Y OBSTETRICIA", "HEMATO ONCOLOGIA", "HEMATOLOGIA", "MEDICINA INTERNA",
    "NEUROCIRUGIA", "NEUROLOGIA", "ORTOPEDIA Y TRAUMATOLOGIA", "OTORRINOLARINGOLOGIA",
    "PEDIATRIA", "PSICOLOGIA", "PSIQUIATRIA", "UROLOGIA"
];

let CHARTS = { main: null, mix: null, concentration: null, fails: null };

const el = (id) => document.getElementById(id);
const n = (v) => Number(v) || 0;
const fmtNum = (num) => new Intl.NumberFormat('es-CO').format(num || 0);
const fmtPct = (p) => ((p || 0) * 100).toFixed(1) + '%';

/* ==========================================================================
   LÓGICA DE DATOS Y RENDERIZADO
   ========================================================================== */
async function loadData() {
    if (!db) {
        console.warn("Firebase no inicializado correctamente.");
        return;
    }

    try {
        const mCheck = Array.from(el('mesList').querySelectorAll('input:checked')).map(i => i.value);
        const eCheck = Array.from(el('espList').querySelectorAll('input:checked')).map(i => i.value);
        const ds = el('desde').value;
        const hs = el('hasta').value;

        let filterMeses = mCheck;
        if (ds) {
            filterMeses = [];
            const start = new Date(ds + "-01");
            const end = hs ? new Date(hs + "-01") : new Date();
            for (let dt = new Date(start); dt <= end; dt.setMonth(dt.getMonth() + 1)) {
                filterMeses.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
            }
        }

        const snap = await getDocs(query(collection(db, 'estadistica_ce'), orderBy('mes')));
        const rows = [];
        snap.forEach(d => {
            const r = d.data();
            if (filterMeses.length && !filterMeses.includes(r.mes)) return;
            if (eCheck.length && !eCheck.includes(r.especialidad)) return;
            rows.push({
                ...r,
                t: n(r.totalConsultas),
                cx: n(r.ordenesCx),
                img: n(r.ordenesImgTotal),
                inc: n(r.citasIncumplidas),
                canc: n(r.citasCanceladas),
                pv: n(r.consultasPrimeraVez),
                ctrl: n(r.consultasControl),
                pop: n(r.consultasPOP)
            });
        });

        render(rows);
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function render(rows) {
    const sum = rows.reduce((acc, r) => {
        acc.t += r.t; acc.cx += r.cx; acc.inc += r.inc; acc.canc += r.canc;
        acc.pop += r.pop; acc.img += r.img; acc.pv += r.pv; acc.ctrl += r.ctrl;
        return acc;
    }, { t: 0, cx: 0, inc: 0, canc: 0, pop: 0, img: 0, pv: 0, ctrl: 0 });

    const k_total = el('k_total'); if (k_total) k_total.innerText = fmtNum(sum.t);
    const k_cx = el('k_cx'); if (k_cx) k_cx.innerText = fmtPct(sum.t > 0 ? sum.cx / sum.t : 0);
    const k_inc = el('k_inc'); if (k_inc) k_inc.innerText = fmtNum(sum.inc);
    const k_img = el('k_img'); if (k_img) k_img.innerText = fmtNum(sum.img);

    const tbody = el('tbody');
    if (tbody) {
        tbody.innerHTML = rows.sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 30).map(r => `
            <tr>
                <td>${r.mes}</td><td>${r.especialidad}</td>
                <td class="text-r">${fmtNum(r.t)}</td>
                <td class="text-r">${fmtPct(r.t > 0 ? r.inc / r.t : 0)}</td>
                <td class="text-r">${fmtPct(r.t > 0 ? r.canc / r.t : 0)}</td>
                <td class="text-r">${fmtPct(r.t > 0 ? r.cx / r.t : 0)}</td>
                <td class="text-r">${fmtPct(r.t > 0 ? r.img / r.t : 0)}</td>
                <td class="text-r">${r.pop}</td>
            </tr>
        `).join('') || '<tr><td colspan="8" style="text-align:center;">Sin datos aplicables.</td></tr>';
    }

    renderGraphics(rows, sum);
}

function renderGraphics(rows, sum) {
    if (typeof Chart === 'undefined') return;

    const byM = {};
    rows.forEach(r => {
        if (!byM[r.mes]) byM[r.mes] = { t: 0, cx: 0, inc: 0, canc: 0 };
        byM[r.mes].t += r.t; byM[r.mes].cx += r.cx; byM[r.mes].inc += r.inc; byM[r.mes].canc += r.canc;
    });
    const months = Object.keys(byM).sort();

    const chartMainEl = el('chartMain');
    if (chartMainEl) {
        const cMain = chartMainEl.getContext('2d');
        const g1 = cMain.createLinearGradient(0, 0, 0, 320);
        g1.addColorStop(0, 'rgba(78, 108, 159, 0.4)');
        g1.addColorStop(1, 'rgba(78, 108, 159, 0)');

        if (CHARTS.main) CHARTS.main.destroy();
        CHARTS.main = new Chart(cMain, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    { label: 'Citas', data: months.map(m => byM[m].t), borderColor: '#4e6c9f', backgroundColor: g1, fill: true, tension: 0.4 },
                    { label: 'Cirugías', data: months.map(m => byM[m].cx), borderColor: '#1aa3ac', tension: 0.4 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5] } }, x: { grid: { display: false } } } }
        });
    }

    const chartMixEl = el('chartMix');
    if (chartMixEl) {
        if (CHARTS.mix) CHARTS.mix.destroy();
        CHARTS.mix = new Chart(chartMixEl, {
            type: 'doughnut',
            data: { labels: ['1ra Vez', 'Control'], datasets: [{ data: [sum.pv, sum.ctrl], backgroundColor: ['#4e6c9f', '#e2e8f0'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%' }
        });
    }

    const byE = {};
    rows.forEach(r => { if (!byE[r.especialidad]) byE[r.especialidad] = 0; byE[r.especialidad] += r.t; });
    const topE = Object.entries(byE).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const chartConcentrationEl = el('chartConcentration');
    if (chartConcentrationEl) {
        if (CHARTS.concentration) CHARTS.concentration.destroy();
        CHARTS.concentration = new Chart(chartConcentrationEl, {
            type: 'bar',
            data: { labels: topE.map(e => e[0].substring(0, 15)), datasets: [{ data: topE.map(e => e[1]), backgroundColor: '#1aa3ac' }] },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }

    const chartFailsEl = el('chartFails');
    if (chartFailsEl) {
        if (CHARTS.fails) CHARTS.fails.destroy();
        CHARTS.fails = new Chart(chartFailsEl, {
            type: 'bar',
            data: {
                labels: months.slice(-6),
                datasets: [
                    { label: '% Inasist.', data: months.slice(-6).map(m => (byM[m].t > 0 ? (byM[m].inc / byM[m].t) * 100 : 0)), backgroundColor: '#ef4444' },
                    { label: '% Cancel.', data: months.slice(-6).map(m => (byM[m].t > 0 ? (byM[m].canc / byM[m].t) * 100 : 0)), backgroundColor: '#f59e0b' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => v + '%' } } } }
        });
    }

    const list = el('insight_list');
    if (list) {
        const news = [];
        news.push({ title: 'Diagnóstico Operativo', text: `Rendimiento de ${fmtNum(sum.t)} atenciones con tracción quirúrgica del ${fmtPct(sum.t > 0 ? sum.cx / sum.t : 0)}.`, cls: '' });
        const loss = sum.t > 0 ? (sum.inc + sum.canc) / sum.t : 0;
        if (loss > 0.15) news.push({ title: 'Fuga Crítica', text: `Pérdida del ${fmtPct(loss)} de oportunidad por fallos de asistencia.`, cls: 'crit' });
        list.innerHTML = news.map(i => `<div class="insight-card ${i.cls}"><h4>${i.title}</h4><p>${i.text}</p></div>`).join('');
    }
}

/* ==========================================================================
   INICIALIZACIÓN UI
   ========================================================================== */
function initUI() {
    const mesList = el('mesList');
    if (mesList) {
        mesList.innerHTML = '';
        const now = new Date();
        for (let i = 0; i < 24; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const dv = document.createElement('div');
            dv.innerHTML = `<label style="display:flex;gap:10px;padding:6px;font-size:12px;cursor:pointer;font-weight:600;"><input type="checkbox" value="${v}" ${i < 6 ? 'checked' : ''}> ${v}</label>`;
            mesList.appendChild(dv);
        }
    }

    const espList = el('espList');
    if (espList) {
        espList.innerHTML = '';
        ESPECIALIDADES.forEach(s => {
            const dv = document.createElement('div');
            dv.innerHTML = `<label style="display:flex;gap:10px;padding:5px;font-size:11px;cursor:pointer;font-weight:600;"><input type="checkbox" value="${s}"> ${s}</label>`;
            espList.appendChild(dv);
        });
    }

    document.querySelectorAll('.picker-u-trigger').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); btn.parentElement.classList.toggle('picker-u-open'); };
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.picker-u').forEach(p => p.classList.remove('picker-u-open'));
    });

    const panels = [el('mesPanel'), el('espPanel')];
    panels.forEach(p => { if (p) p.onclick = (e) => e.stopPropagation(); });

    function syncLabels() {
        const mc = el('mesList')?.querySelectorAll('input:checked').length || 0;
        const mesBtnSpan = el('mesBtn')?.querySelector('span');
        if (mesBtnSpan) {
            mesBtnSpan.innerText = mc === 0 ? "Meses" : (mc === 1 ? el('mesList').querySelector('input:checked').value : `${mc} meses`);
        }

        const ec = el('espList')?.querySelectorAll('input:checked').length || 0;
        const espBtnSpan = el('espBtn')?.querySelector('span');
        if (espBtnSpan) {
            espBtnSpan.innerText = ec === 0 ? "Líneas" : (ec === 1 ? el('espList').querySelector('input:checked').value : `${ec} selecc.`);
        }
    }

    const mesOk = el('mesOk'); if (mesOk) mesOk.onclick = () => { syncLabels(); loadData(); };
    const espOk = el('espOk'); if (espOk) espOk.onclick = () => { syncLabels(); loadData(); };
    const aplicar = el('aplicar'); if (aplicar) aplicar.onclick = loadData;

    syncLabels();
    loadData();
}

// Arrancar cuando el contexto esté listo o el DOM cargado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}

window.addEventListener('OrbitaContextReady', () => {
    loadData();
});
