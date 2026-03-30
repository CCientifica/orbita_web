
const pad = n => String(n).padStart(2, "0");
const slug = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const toInt = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const pct = n => Number.isFinite(n) ? (n * 100).toFixed(1) + "%" : "0%";
const pdfSafe = str => String(str).replaceAll("≤", "<=").replaceAll("≥", ">=").replaceAll("•", "-").replaceAll("—", "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

let chart;
function updateChart(a, i, s, t) {
    const canvas = document.getElementById('trendChart'); if (!canvas) return;
    if (chart) chart.destroy();

    // Calcular porcentaje digital real
    const totalDig = a + i + s;
    const gDig = t > 0 ? (totalDig / t) : 0;
    const pVal = (gDig * 100);

    chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: ['M1', 'M2', 'M3', 'PROYECCIÓN'],
            datasets: [{
                data: [pVal * 0.7, pVal * 0.85, pVal * 0.92, pVal],
                borderColor: '#8b5cf6', borderWidth: 4, pointRadius: 0, tension: 0.4, fill: true,
                backgroundColor: 'rgba(139, 92, 246, 0.1)'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: 20 },
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false, suggestedMin: 0, suggestedMax: 100 } }
        }
    });

    setTxt('predictionScore', pVal.toFixed(1) + "%");
    const lbl = document.getElementById('predictionLabel'); if (lbl) {
        lbl.textContent = pVal > 70 ? "LIDERAZGO DIGITAL" : "CRECIMIENTO SOSTENIDO";
        lbl.className = 'px-3 py-1 rounded-full text-[8px] font-black ' + (pVal > 70 ? 'text-violet-400 bg-violet-900' : 'text-blue-400 bg-blue-900');
    }
}

const removedThisSession = new Set();

function attachRowListeners(tr) {
    tr.querySelectorAll('input[type="number"]').forEach(inp => {
        inp.addEventListener("input", () => { recalcRow(tr); recalc(); });
    });
    tr.querySelector('[data-del]')?.addEventListener("click", () => {
        const spec = tr.getAttribute("data-spec")?.trim();
        if (spec && confirm(`¿Eliminar "${spec}" de este mes?`)) {
            removedThisSession.add(spec); tr.remove(); recalc();
        }
    });
}

function getRowValues(tr) {
    const get = k => toInt(tr.querySelector(`input[data-k="${k}"]`)?.value);
    return { spec: (tr.getAttribute("data-spec") || "").trim(), a: get("aigenda"), i: get("isa"), s: get("staff"), h: get("hosvital") };
}

function recalcRow(tr) {
    const { a, i, s, h } = getRowValues(tr);
    const total = a + i + s + h; const dig = total ? (a + i + s) / total : 0;
    tr.querySelector('[data-k="total"]').textContent = total;
    tr.querySelector('[data-k="pdig"]').textContent = pct(dig);
}

function recalc() {
    let A = 0, I = 0, S = 0, H = 0;
    const rows = [...document.getElementById("tbody").querySelectorAll("tr")];
    rows.forEach(tr => {
        const { a, i, s, h } = getRowValues(tr); A += a; I += i; S += s; H += h;
    });
    const T = A + I + S + H;
    setTxt('tAigenda', A); setTxt('tIsa', I); setTxt('tStaff', S); setTxt('tHosvital', H); setTxt('tTotal', T);
    setTxt('tDigital', pct(T ? (A + I + S) / T : 0));
    setTxt('pctAigenda', pct(T ? A / T : 0));
    setTxt('pctIsa', pct(T ? I / T : 0));
    setTxt('pctStaff', pct(T ? S / T : 0));
    setTxt('pctHosvital', pct(T ? H / T : 0));
    setTxt('usoDigital', pct(T ? (A + I + S) / T : 0));

    const pairs = [["Aigenda", A], ["ISA BOT", I], ["Staff", S], ["Hosvital", H]].sort((a, b) => b[1] - a[1]);
    setTxt('dominante', T ? `${pairs[0][0]} (${pairs[0][1]})` : "—");
    updateChart(A, I, S, T);
}

function addRow(spec = "", a = 0, i = 0, s = 0, h = 0) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-spec", spec);
    tr.innerHTML = `
        <td class="!text-slate-900 !text-[12px] uppercase"><strong>${spec}</strong></td>
        <td class="num"><input type="number" min="0" value="${a}" data-k="aigenda" class="input-rcf text-right !text-violet-600"></td>
        <td class="num"><input type="number" min="0" value="${i}" data-k="isa" class="input-rcf text-right !text-indigo-600"></td>
        <td class="num"><input type="number" min="0" value="${s}" data-k="staff" class="input-rcf text-right !text-blue-600"></td>
        <td class="num"><input type="number" min="0" value="${h}" data-k="hosvital" class="input-rcf text-right !text-slate-400"></td>
        <td class="num font-black opacity-60" data-k="total">0</td>
        <td class="num font-black text-violet-600 !text-[14px]" data-k="pdig">0%</td>
        <td class="text-center">
            <button class="btn-del" data-del>🗑️ Eliminar</button>
        </td>
    `;
    attachRowListeners(tr);
    document.getElementById("tbody").appendChild(tr);
    recalcRow(tr); recalc();
}

async function fetchMonthMap(monthStr) {
    if (!window.firebaseInstance) return {};
    const { db } = window.firebaseInstance;
    const { query, collection, where, getDocs } = window.firebaseFirestore;
    const q = query(collection(db, "ecosistema_canales_mensual"), where("month", "==", monthStr));
    const snap = await getDocs(q);
    const map = {};
    snap.forEach(d => { const x = d.data(); const k = (x.especialidad || "").trim(); map[k] = { a: toInt(x.aigenda), i: toInt(x.isa), s: toInt(x.staff), h: toInt(x.hosvital) }; });
    return map;
}

function fillTableFromMap(map) {
    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";
    Object.keys(map).forEach(spec => {
        addRow(spec, map[spec].a, map[spec].i, map[spec].s, map[spec].h);
    });
    recalc();
}

async function loadMonth() {
    const m = document.getElementById("monthInput").value;
    statusMsg("Sincronizando...", "info");
    try {
        const map = await fetchMonthMap(m);
        fillTableFromMap(map);
        statusMsg("Mes cargado: " + m, "success");
    } catch (e) { statusMsg("Error cargando mes", "err"); }
}

function statusMsg(t, type) {
    const s = document.getElementById("status"); if (!s) return;
    s.textContent = t; s.classList.remove("hidden", "text-violet-500", "text-rose-500");
    s.classList.add(type === "success" ? "text-violet-500" : (type === "err" ? "text-rose-500" : "text-slate-500"));
    s.classList.remove("hidden");
    setTimeout(() => s.classList.add("hidden"), 3000);
}

// Event Listeners initialization
export function initCanalesDigitales() {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    const defaultMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const mIn = document.getElementById("monthInput"); if (mIn) mIn.value = defaultMonth;
    const cfIn = document.getElementById("copyFromInput"); if (cfIn) cfIn.value = defaultMonth;

    document.getElementById("saveBtn")?.addEventListener("click", async () => {
        if (!window.firebaseInstance) return;
        const { db } = window.firebaseInstance;
        const { setDoc, doc, deleteDoc, serverTimestamp } = window.firebaseFirestore;
        const month = document.getElementById("monthInput").value;
        if (!confirm("¿Guardar registros de " + month + "?")) return;
        try {
            for (const tr of [...document.getElementById("tbody").querySelectorAll("tr")]) {
                const { spec, a, i, s, h } = getRowValues(tr);
                await setDoc(doc(db, "ecosistema_canales_mensual", `${month}_${slug(spec)}`), {
                    month, especialidad: spec, aigenda: a, isa: i, staff: s, hosvital: h, total: a + i + s + h, digital: a + i + s, updatedAt: serverTimestamp()
                }, { merge: true });
            }
            for (const s of removedThisSession) { await deleteDoc(doc(db, "ecosistema_canales_mensual", `${month}_${slug(s)}`)); }
            removedThisSession.clear();
            statusMsg("Guardado OK", "success"); alert("Guardado exitoso.");
        } catch (e) { statusMsg("Fallo al guardar", "err"); }
    });

    document.getElementById("addSpecBtn")?.addEventListener("click", () => {
        const name = document.getElementById("newSpecInput").value.trim();
        if (!name) return;
        if ([...document.getElementById("tbody").querySelectorAll("tr")].some(tr => tr.getAttribute("data-spec")?.toLowerCase() === name.toLowerCase())) { alert("Ya existe."); return; }
        addRow(name); document.getElementById("newSpecInput").value = "";
    });

    document.getElementById("loadFromBtn")?.addEventListener("click", async () => {
        const src = (document.getElementById("copyFromInput").value || "").trim();
        if (!src) return;
        try { const map = await fetchMonthMap(src); fillTableFromMap(map); statusMsg("Copiado de " + src, "success"); }
        catch (e) { statusMsg("Error copiando", "err"); }
    });

    document.getElementById("quickPrevBtn")?.addEventListener("click", async () => {
        const sel = document.getElementById("monthInput").value;
        const [yy, mm] = sel.split("-").map(Number); const dc = new Date(yy, mm - 2, 1); const prev = `${dc.getFullYear()}-${pad(dc.getMonth() + 1)}`;
        document.getElementById("copyFromInput").value = prev;
        try { const map = await fetchMonthMap(prev); fillTableFromMap(map); statusMsg("Copiado de " + prev, "success"); }
        catch (e) { statusMsg("Error copiando", "err"); }
    });

    document.getElementById("pdfBtn")?.addEventListener("click", async () => {
        const m = document.getElementById("monthInput").value;
        const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const M = 52; let y = 40;
        try {
            const img = new Image(); img.src = '/assets/Logo_Clinica.png'; await img.decode();
            doc.addImage(img, 'PNG', M, y, 180, 60);
        } catch { }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('NUEVA CLÍNICA SAGRADO CORAZÓN', M + 190, y + 26);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('NIT 900408220 - 1', M + 190, y + 46);
        y += 100; doc.line(M, y - 10, 540, y - 10);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Eco Digital — Canales (mensual)', M, y);
        y += 16; doc.text(`Mes: ${m || '—'}`, M, y);
        const body = [...document.getElementById("tbody").querySelectorAll("tr")].map(tr => {
            const { spec, a, i, s, h } = getRowValues(tr); const T = a + i + s + h;
            return [pdfSafe(spec), a, i, s, h, T, pct(T ? (a + i + s) / T : 0)];
        });
        doc.autoTable({ startY: y + 16, head: [['Especialidad', 'Aigenda', 'ISA BOT', 'Staff', 'Hosvital', 'Total', '% digital']], body, theme: 'grid', headStyles: { fillColor: [139, 92, 246] } });
        doc.save(`EcoDigital_${m}.pdf`);
    });

    document.getElementById("xlBtn")?.addEventListener("click", () => {
        const m = document.getElementById("monthInput").value;
        const headers = ["Especialidad", "Aigenda", "ISA BOT", "Staff", "Hosvital", "Total", "% digital"];
        const data = [...document.getElementById("tbody").querySelectorAll("tr")].map(tr => {
            const { spec, a, i, s, h } = getRowValues(tr); const T = a + i + s + h;
            return [spec, a, i, s, h, T, pct(T ? (a + i + s) / T : 0)];
        });
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CanalesDigitales");
        XLSX.writeFile(wb, `CanalesDigitales_${m}.xlsx`);
    });

    document.getElementById("monthInput")?.addEventListener("change", loadMonth);

    window.addEventListener('OrbitaContextReady', loadMonth);
    if (window.OrbitaContext) loadMonth();
    recalc(); // Initial call to show empty state/chart
}
