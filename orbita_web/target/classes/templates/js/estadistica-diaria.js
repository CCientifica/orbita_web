import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocFromServer, setDoc, writeBatch, serverTimestamp,
  collection, getDocs, collectionGroup, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";

// Firebase Initialization & Robust Encapsulation
const firebaseConfig = {
  apiKey: "AIzaSyD-kkAwT7iGI8jJc1wosV--TA4BjOaoH-Q",
  authDomain: "cood-tc.firebaseapp.com",
  projectId: "cood-tc",
  storageBucket: "cood-tc.firebasestorage.app",
  messagingSenderId: "767906346584",
  appId: "1:767906346584:web:59439d16292d3b0ea8bc2d"
};

const app = (window.firebase && window.firebase.apps && window.firebase.apps.length)
  ? window.firebase.app()
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

// ====== UTILITIES & CONSTANTS (Consolidated) ======
const MES_NOMBRES = { "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril", "05": "Mayo", "06": "Junio", "07": "Julio", "08": "Agosto", "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre" };
const DOW_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const mesesMap = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
const KPI_IDS = ["ce", "triages", "urgencias", "camas_hosp", "egresos_hosp", "piso2", "piso3", "piso4", "ocup_hosp", "pde", "camas_uci", "egresos_uci", "ocup_uci", "camas_uce", "egresos_uce", "ocup_uce", "pde_critico", "quirofanos", "proc_quir", "uvr", "fibro", "endoscopia", "colonoscopia", "examenes_ambulatorios", "quimio", "camas_hosp_bloq", "camas_uci_bloq", "camas_uce_bloq", "quirofanos_bloq"];

const pad2 = (n) => String(n).padStart(2, '0');
const pad2b = (n) => String(n).padStart(2, '0');
const isoFromUTCDate = (d) => d.toISOString().slice(0, 10);
const fixedUTC = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const makeUTC = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDaysUTC = (dateUTC, days) => { const d = new Date(dateUTC.getTime()); d.setUTCDate(d.getUTCDate() + days); return d; };
const nextMondayUTC = (dateUTC) => { const day = dateUTC.getUTCDay(); const offset = (8 - day) % 7; return addDaysUTC(dateUTC, offset); };
const fmtISO_UTC = (dtUTC) => `${dtUTC.getUTCFullYear()}-${pad2(dtUTC.getUTCMonth() + 1)}-${pad2(dtUTC.getUTCDate())}`;

function easterSundayUTC(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return fixedUTC(year, month, day);
}
function getColombiaHolidays(year) {
  const y = Number(year), map = new Map(), addHoliday = (dt, name) => { const iso = isoFromUTCDate(dt); map.set(iso, map.has(iso) ? `${map.get(iso)} / ${name}` : name); };
  addHoliday(fixedUTC(y, 1, 1), "Año Nuevo"); addHoliday(fixedUTC(y, 5, 1), "Día del Trabajo"); addHoliday(fixedUTC(y, 7, 20), "Independencia"); addHoliday(fixedUTC(y, 8, 7), "Batalla de Boyacá"); addHoliday(fixedUTC(y, 12, 8), "Inmaculada Concepción"); addHoliday(fixedUTC(y, 12, 25), "Navidad");
  addHoliday(nextMondayUTC(fixedUTC(y, 1, 6)), "Reyes Magos"); addHoliday(nextMondayUTC(fixedUTC(y, 3, 19)), "San José"); addHoliday(nextMondayUTC(fixedUTC(y, 6, 29)), "San Pedro y San Pablo"); addHoliday(nextMondayUTC(fixedUTC(y, 8, 15)), "Asunción de la Virgen"); addHoliday(nextMondayUTC(fixedUTC(y, 10, 12)), "Día de la Raza"); addHoliday(nextMondayUTC(fixedUTC(y, 11, 1)), "Todos los Santos"); addHoliday(nextMondayUTC(fixedUTC(y, 11, 11)), "Independencia de Cartagena");
  const easter = easterSundayUTC(y); addHoliday(addDaysUTC(easter, -3), "Jueves Santo"); addHoliday(addDaysUTC(easter, -2), "Viernes Santo"); addHoliday(nextMondayUTC(addDaysUTC(easter, 39)), "Ascensión del Señor"); addHoliday(nextMondayUTC(addDaysUTC(easter, 60)), "Corpus Christi"); addHoliday(nextMondayUTC(addDaysUTC(easter, 68)), "Sagrado Corazón");
  return map;
}

function parseNumSmart(x) { if (x == null) return 0; const s = String(x).trim(); if (!s) return 0; const norm = s.replace(/%/g, "").replace(/[\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,(?=\d+$)/g, "."); const v = Number(norm); return Number.isFinite(v) ? v : 0; }
const daysInMonth = (y, m) => new Date(Number(y), Number(m), 0).getDate();
const daysInMonthStr = (yyyyMM) => { const [y, m] = yyyyMM.split('-').map(Number); return new Date(y, m, 0).getDate(); };
function distributeInt(total, days) { const base = Math.floor(total / days), rem = total - base * days; const arr = Array.from({ length: days }, () => base); for (let i = 0; i < rem; i++) arr[i] += 1; return arr; }
function readYMDFromInput(el) { const v = (el?.value || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return { y, m, d }; } const m = v.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/); if (m) return { y: +m[3], m: +m[2], d: +m[1] }; return null; }
const isInverseKPI = (k) => k === 'pde' || k === 'pde_critico';
function esKpiPromedio(k) { return (k && (k.startsWith('ocup_') || k === 'pde' || k === 'pde_critico' || k === 'camas_hosp' || k === 'camas_uci' || k === 'camas_uce' || k === 'quirofanos')); }
function updateMetasTitle(anioStr, mesStr) { const t = document.querySelector("#card-metas h3"); if (t) t.textContent = `Metas mensuales (${MES_NOMBRES[mesStr] || mesStr} ${anioStr})`; }
const safeSetText = (el, txt) => { if (el) el.textContent = txt; };
const safeSetHTML = (el, html) => { if (el) el.innerHTML = html; };
const validateImage = (imgData) => { return imgData && imgData.startsWith("data:image/") && imgData.length > 500; };

async function refreshSemaforos() {
  const anio = anioDaily.value, mes = mesDaily.value, dStr = fechaDaily.value.split("-")[2];
  if (!dStr) return;
  const snap = await getDocs(collection(db, "realizados", anio, mes, dStr, "kpi"));
  const data = {}; snap.forEach(d => data[String(d.id).toLowerCase()] = d.data());
  KPI_IDS.forEach(id => {
    const row = data[id.toLowerCase()], val = Number(row?.valor ?? 0), meta = Number(row?.meta ?? 0), stEl = document.getElementById(`st_${id}`);
    if (!stEl) return;
    if (meta <= 0) { stEl.textContent = "—"; stEl.className = "chip"; return; }
    const inv = isInverseKPI(id), ok = inv ? (val <= meta) : (val >= meta), warn = inv ? (val <= meta * 1.1) : (val >= meta * 0.9);
    stEl.textContent = ok ? "OK" : (warn ? "Riesgo" : "Bajo");
    stEl.className = "chip " + (ok ? "chip-ok" : (warn ? "chip-warn" : "chip-bad"));
  });
}

/* ---------- DOM ---------- */

const anioInput = document.getElementById("anioInput");
const estadoChips = document.getElementById("estadoChips");
const estadoChipsClone = document.getElementById("estadoChipsClone");
const btnRefrescar = document.getElementById("btnRefrescar");
const btnBloquear = document.getElementById("btnBloquear");
const btnDesbloquear = document.getElementById("btnDesbloquear");

const xlsxFile = document.getElementById("xlsxFile");
const btnPreviewXLSX = document.getElementById("btnPreviewXLSX");
const btnGuardarTodo = document.getElementById("btnGuardarTodo");
const msgXLSX = document.getElementById("msgXLSX");
const tblPrevCap = document.getElementById("tblPrevCap");
const tblPrevHosp = document.getElementById("tblPrevHosp");
const modal = document.getElementById("modal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCloseModal2 = document.getElementById("btnCloseModal2");
const btnGuardarDesdeModal = document.getElementById("btnGuardarDesdeModal");

const mesInput = document.getElementById("mesInput");
const btnGenerarMetas = document.getElementById("btnGenerarMetas");
const msgMetas = document.getElementById("msgMetas");

/* captura diaria UI */
const anioDaily = document.getElementById("anioDaily");
const mesDaily = document.getElementById("mesDaily");
const fechaDaily = document.getElementById("fechaDaily");
const chkYTD = document.getElementById("chkYTD");
const metasMensuales = document.getElementById("metasMensuales");
const btnPdfDashboard = document.getElementById("btnPdfDashboard");

const btnGuardarReal = document.getElementById("btnGuardarReal");
const msgReal = document.getElementById("msgReal");

/* Vista Mensual */
const btnCargarMensual = document.getElementById("btnCargarMensual");
const btnExportExcelMensual = document.getElementById("btnExportExcelMensual");
const theadMensual = document.getElementById("theadMensual");
const tbodyMensual = document.getElementById("tbodyMensual");
const msgMensual = document.getElementById("msgMensual");
const btnExportPngMensual = document.getElementById("btnExportPngMensual");

/* Histórico */
const histDesde = document.getElementById("histDesde");
const histHasta = document.getElementById("histHasta");
const btnBuscarHist = document.getElementById("btnBuscarHist");
const btnExcelHist = document.getElementById("btnExcelHist");
const btnPdfHist = document.getElementById("btnPdfHist");
const tblHistBody = document.getElementById("tblHist") ? document.getElementById("tblHist").querySelector("tbody") : null;
const histMsg = document.getElementById("histMsg");


/* Auth handled at bottom */


// Utils consolidated at top

/* ---------- Candado ---------- */
function chips(bloq, existe) {
  const html = `<span class="badge ${bloq ? 'lock' : 'ok'}">${bloq ? 'Forecast BLOQUEADO' : 'Forecast DESBLOQUEADO'}</span>
              <span class="badge">${existe ? 'Candado creado' : 'Candado no creado'}</span>`;
  safeSetHTML(estadoChips, html);
  safeSetHTML(estadoChipsClone, html);
}
async function refrescaEstado() {
  const anio = anioInput.value.trim();
  const snap = await getDoc(doc(db, "config_locks", `forecast_${anio}`));
  if (snap.exists()) chips(!!snap.data().bloqueado, true); else chips(false, false);
}
btnRefrescar.addEventListener("click", refrescaEstado);
anioInput.addEventListener("change", refrescaEstado);
// El refresco inicial se maneja dentro de onAuthStateChanged para mayor seguridad.

btnBloquear.addEventListener("click", async () => {
  const anio = anioInput.value.trim();
  await setDoc(doc(db, "config_locks", `forecast_${anio}`), { anio: Number(anio), bloqueado: true, desde: Date.now() }, { merge: true });
  refrescaEstado();
});
btnDesbloquear.addEventListener("click", async () => {
  const anio = anioInput.value.trim();
  await setDoc(doc(db, "config_locks", `forecast_${anio}`), { anio: Number(anio), bloqueado: false }, { merge: true });
  refrescaEstado();
});

/* ---------- XLSX ---------- */
let rowsCap = [], rowsHosp = [];
function renderTable(t, header, rows) {
  const thead = t.querySelector("thead"), tbody = t.querySelector("tbody");
  thead.innerHTML = "<tr>" + header.map(h => `<th>${h}</th>`).join("") + "</tr>";
  tbody.innerHTML = rows.slice(0, 250).map(r => "<tr>" + header.map(h => `<td>${(r[h] ?? "")}</td>`).join("") + "</tr>").join("");
}
async function readXLSX(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: "array" });
  const capSheet = wb.Sheets["capacidad"], hosSheet = wb.Sheets["hospitalizacion"];
  if (!capSheet || !hosSheet) throw new Error("El archivo debe tener hojas 'capacidad' y 'hospitalizacion'.");

  const cap = XLSX.utils.sheet_to_json(capSheet, { defval: "" });
  const reqCap = ["anio", "uidUnidad", "unidadMedida", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic", "estrategiaDistribucion"].map(s => s.toLowerCase());
  rowsCap = cap.map((r, i) => {
    const o = {}; for (const k of Object.keys(r)) o[k.toLowerCase()] = r[k];
    for (const k of reqCap) if (!(k in o)) throw new Error(`capacidad: falta '${k}' (fila ${i + 2})`);
    const mensual = {}; for (const m of Object.keys(mesesMap)) { const v = parseNumSmart(o[m]); if (v < 0) throw new Error(`capacidad: valor inválido en ${m} (fila ${i + 2})`); mensual[m] = v; }
    return { anio: Number(o.anio), uidUnidad: String(o.uidunidad).toLowerCase(), unidadMedida: String(o.unidadmedida), mensual, estrategiaDistribucion: String(o.estrategiadistribucion || "uniforme").toLowerCase() };
  });

  const hos = XLSX.utils.sheet_to_json(hosSheet, { defval: "" });
  const reqHos = ["anio", "kpi", "unidadMedida", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"].map(s => s.toLowerCase());
  rowsHosp = hos.map((r, i) => {
    const o = {}; for (const k of Object.keys(r)) o[k.toLowerCase()] = r[k];
    for (const k of reqHos) if (!(k in o)) throw new Error(`hospitalizacion: falta '${k}' (fila ${i + 2})`);
    const mensual = {}; for (const m in mesesMap) { mensual[mesesMap[m]] = parseNumSmart(o[m]); }
    return { anio: Number(o.anio), kpi: String(o.kpi).toLowerCase(), unidadMedida: String(o.unidadmedida), mensual };
  });
}
const showPreview = async () => {
  msgXLSX.innerHTML = "";
  const f = xlsxFile.files?.[0]; if (!f) throw new Error("Selecciona un archivo XLSX.");
  await readXLSX(f);
  const anioSel = Number(anioInput.value);
  const yearsCap = new Set(rowsCap.map(r => r.anio));
  const yearsHos = new Set(rowsHosp.map(r => r.anio));
  if (yearsCap.size !== 1 || yearsHos.size !== 1 || !yearsCap.has(anioSel) || !yearsHos.has(anioSel)) {
    throw new Error("Ambas hojas deben tener un único año y coincidir con el selector.");
  }
  const headCap = ["uidUnidad", "unidadMedida", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic", "estrategiaDistribucion"];
  const capRows = rowsCap.map(r => ({ uidUnidad: r.uidUnidad, unidadMedida: r.unidadMedida, ...r.mensual, estrategiaDistribucion: r.estrategiaDistribucion }));
  renderTable(tblPrevCap, headCap, capRows);
  const headHos = ["kpi", "unidadMedida", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const hosRows = rowsHosp.map(r => ({ kpi: r.kpi, unidadMedida: r.unidadMedida, ...r.mensual }));
  renderTable(tblPrevHosp, headHos, hosRows);
  msgXLSX.innerHTML = `<span class="ok">OK:</span>&nbsp;Capacidad: ${rowsCap.length} · Hospitalización: ${rowsHosp.length}.`;
  modal.classList.add("open");
};
btnPreviewXLSX.addEventListener("click", async () => { try { await showPreview(); } catch (e) { safeSetHTML(msgXLSX, `<span class="err">Error:</span> ${e.message || e}`); } });
btnCloseModal.addEventListener("click", () => modal.classList.remove("open"));
btnCloseModal2.addEventListener("click", () => modal.classList.remove("open"));
btnGuardarDesdeModal.addEventListener("click", () => btnGuardarTodo.click());
btnBuscarHist.addEventListener("click", buscarHistorico);  // <— ESTA LÍNEA


async function guardarTablas() {
  if (rowsCap.length === 0 && rowsHosp.length === 0) throw new Error("Genera primero la vista previa.");
  const anio = String(anioInput.value);
  const lockRef = doc(db, "config_locks", `forecast_${anio}`);
  const lockSnap = await getDoc(lockRef);
  if (lockSnap.exists() && lockSnap.data().bloqueado) { safeSetHTML(msgXLSX, `<span class="err">El Forecast ${anio} está BLOQUEADO.</span>`); return; }

  let batch = writeBatch(db), ops = 0;
  for (const r of rowsCap) {
    const mensual = { "01": r.mensual.ene, "02": r.mensual.feb, "03": r.mensual.mar, "04": r.mensual.abr, "05": r.mensual.may, "06": r.mensual.jun, "07": r.mensual.jul, "08": r.mensual.ago, "09": r.mensual.sep, "10": r.mensual.oct, "11": r.mensual.nov, "12": r.mensual.dic };
    const ref = doc(db, "forecast", anio, "unidades", r.uidUnidad);
    batch.set(ref, { anio: Number(anio), uidUnidad: r.uidUnidad, nombreUnidad: r.uidUnidad, unidadMedida: r.unidadMedida, mensual, estrategiaDistribucion: r.estrategiaDistribucion, ultimaActualizacion: Date.now() }, { merge: true });
    if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  batch = writeBatch(db); ops = 0;
  for (const r of rowsHosp) {
    const ref = doc(db, "forecast_hosp", anio, "kpis", r.kpi);
    batch.set(ref, { anio: Number(anio), kpi: r.kpi, unidadMedida: r.unidadMedida, mensual: r.mensual, ultimaActualizacion: Date.now() }, { merge: true });
    if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  if (!lockSnap.exists()) { await setDoc(lockRef, { anio: Number(anio), bloqueado: false, desde: Date.now() }); }
  safeSetHTML(msgXLSX, `<span class="ok">Guardado:</span>&nbsp;Capacidad ${rowsCap.length} · Hospitalización ${rowsHosp.length}.`);
  await refrescaEstado();
}
btnGuardarTodo.addEventListener("click", async () => { try { await guardarTablas(); } catch (e) { safeSetHTML(msgXLSX, `<span class="err">Error al guardar:</span> ${e.message || e}`); } });


/* ---------- Generar metas diarias (persistidas) ---------- */
const UNIDADES_DISTRIB = new Set(["urgencias", "consulta_externa", "hospitalizacion", "cirugia", "uci", "ucin"]);
const CONST_DIARIAS = { camas_hosp: 83, camas_uci: 12, camas_uce: 9, ocup_hosp: 98, ocup_uci: 100, ocup_uce: 100, quirofanos: 5, camas_bloquedas: 0, quirofanos_bloquedados: 0 };

// ✅ FIX: evitar NaN en Firestore (si uvR/triages no están definidos aún)

async function generarMetasMes() {
  safeSetText(msgMetas, "Generando...");
  const anio = String(anioInput.value), mes = String(mesInput.value);
  const lockSnap = await getDoc(doc(db, "config_locks", `forecast_${anio}`));
  if (lockSnap.exists() && lockSnap.data().bloqueado) { safeSetHTML(msgMetas, `<span class="err">Forecast ${anio} BLOQUEADO.</span>`); return; }
  const nDias = daysInMonth(anio, mes);

  const capSnap = await getDocs(collection(db, "forecast", anio, "unidades"));
  const capIndex = Object.fromEntries(capSnap.docs.map(d => [String(d.id).toLowerCase(), d.data()]));
  const hospSnap = await getDocs(collection(db, "forecast_hosp", anio, "kpis"));
  const hospIndex = Object.fromEntries(hospSnap.docs.map(d => [String(d.id).toLowerCase(), d.data()]));

  let batch = writeBatch(db), ops = 0;

  // ✅ Metas diarias desde metas anuales configurables (evita NaN)
  const safeInt = (x) => {
    const n = Math.round(Number(x ?? 0));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const readAnualFirst = async (keys) => {
    for (const k of keys) {
      const s = await getDoc(doc(db, "config_anuales", `${k}_${anio}`));
      if (s.exists()) return safeInt(s.data().meta);
    }
    return 0;
  };

  const [uvrA, triA, fibA, endoA, colA, exaA, quiA] = await Promise.all([
    readAnualFirst(["uvr"]),
    readAnualFirst(["triages"]),
    readAnualFirst(["fibrobroncoscopia"]),
    readAnualFirst(["endoscopia"]),
    readAnualFirst(["colonoscopia"]),
    readAnualFirst(["Examenes_ambulatorios", "examenes_ambulatorios", "examenesambulatorios"]),
    readAnualFirst(["quimio"])
  ]);

  const metasMensualesFromAnual = {
    uvr: safeInt(uvrA / 12),
    triages: safeInt(triA / 12),
    fibro: safeInt(fibA / 12),
    endoscopia: safeInt(endoA / 12),
    colonoscopia: safeInt(colA / 12),
    Examenes_ambulatorios: safeInt(exaA / 12),
    quimio: safeInt(quiA / 12)
  };

  const unidadByKpi = (k) => {
    if (k === "triages") return "Ptes";
    if (k === "examenes_ambulatorios") return "Lab";
    if (k === "quimio") return "Quimio";
    if (k === "uvr") return "—";
    return "Proc.";
  };

  for (const [kpi, mensualVal] of Object.entries(metasMensualesFromAnual)) {
    const totalMes = safeInt(mensualVal);
    const arr = distributeInt(totalMes, nDias);

    for (let d = 1; d <= nDias; d++) {
      const dd = String(d).padStart(2, "0");

      batch.set(
        doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", kpi),
        {
          anio: Number(anio),
          mes,
          dia: dd,
          kpi,
          unidadMedida: unidadByKpi(kpi),
          meta: safeInt(arr[d - 1]),
          tipo: "distribuida",
          fuente: "config_anuales"
        },
        { merge: true }
      );

      if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
  }

  // capacidad → metas_diarias
  for (const key of Object.keys(capIndex)) {
    if (!UNIDADES_DISTRIB.has(key)) continue;
    const totalMes = Number(capIndex[key]?.mensual?.[mes] ?? 0);
    const arr = distributeInt(Math.round(totalMes), nDias);
    for (let d = 1; d <= nDias; d++) {
      const dd = String(d).padStart(2, "0");
      batch.set(doc(db, "metas_diarias", anio, mes, dd, "unidades", key),
        { anio: Number(anio), mes, dia: dd, uidUnidad: key, unidadMedida: capIndex[key].unidadMedida, meta: arr[d - 1], tipo: "distribuida", fuente: "forecast.capacidad" }, { merge: true });
      if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
  }

  // constantes diarias
  for (let d = 1; d <= nDias; d++) {
    const dd = String(d).padStart(2, "0");
    const putK = (k, v) => batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", k),
      { anio: Number(anio), mes, dia: dd, kpi: k, meta: v, tipo: "constante", unidadMedida: (k.startsWith("camas") ? "Camas" : k.startsWith("ocup") ? "%" : "—") }, { merge: true });
    putK("camas_hosp", CONST_DIARIAS.camas_hosp);
    putK("camas_uci", CONST_DIARIAS.camas_uci);
    putK("camas_uce", CONST_DIARIAS.camas_uce);
    putK("ocup_hosp", CONST_DIARIAS.ocup_hosp);
    putK("ocup_uci", CONST_DIARIAS.ocup_uci);
    putK("ocup_uce", CONST_DIARIAS.ocup_uce);
    putK("quirofanos", CONST_DIARIAS.quirofanos);
    if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }

  // Egresos por pisos 20/20/20 desde hospitalización (capacidad)
  const egMesCap = Number(capIndex["hospitalizacion"]?.mensual?.[mes] ?? 0);
  const eg2 = Math.round(egMesCap * 0.26), eg3 = Math.round(egMesCap * 0.33), eg4 = Math.round(egMesCap * 0.41);
  const arr2 = distributeInt(eg2, nDias), arr3 = distributeInt(eg3, nDias), arr4 = distributeInt(eg4, nDias);
  for (let d = 1; d <= nDias; d++) {
    const dd = String(d).padStart(2, "0");
    batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", "egresos_piso2"), { anio: Number(anio), mes, dia: dd, kpi: "egresos_piso2", unidadMedida: "Casos", meta: arr2[d - 1], tipo: "distribuida" }, { merge: true });
    batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", "egresos_piso3"), { anio: Number(anio), mes, dia: dd, kpi: "egresos_piso3", unidadMedida: "Casos", meta: arr3[d - 1], tipo: "distribuida" }, { merge: true });
    batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", "egresos_piso4"), { anio: Number(anio), mes, dia: dd, kpi: "egresos_piso4", unidadMedida: "Casos", meta: arr4[d - 1], tipo: "distribuida" }, { merge: true });
    if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }

  // PDE constante
  const pdeMes = Number(hospIndex["dias_promedio_estancia"]?.mensual?.[mes] ?? 0);
  for (let d = 1; d <= nDias; d++) {
    const dd = String(d).padStart(2, "0");
    batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", "pde"),
      { anio: Number(anio), mes, dia: dd, kpi: "pde", unidadMedida: "días", meta: pdeMes, tipo: "constante" }, { merge: true });
    if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }

  // Egresos distribuidos
  const distribCap = async (key, kpiName, unidadMedida = "Casos") => {
    const total = Math.round(Number(capIndex[key]?.mensual?.[mes] ?? 0));
    const arr = distributeInt(total, nDias);
    for (let d = 1; d <= nDias; d++) {
      const dd = String(d).padStart(2, "0");
      batch.set(doc(db, "metas_diarias_hosp", anio, mes, dd, "kpis", kpiName),
        { anio: Number(anio), mes, dia: dd, kpi: kpiName, unidadMedida, meta: arr[d - 1], tipo: "distribuida" }, { merge: true });
      if (++ops % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
  };
  await distribCap("hospitalizacion", "egresos_hosp");
  await distribCap("uci", "egresos_uci");
  await distribCap("ucin", "egresos_uce");

  await batch.commit();
  msgMetas.innerHTML = `<span class="ok">Metas diarias generadas:</span> ${anio}-${mes}.`;
}
btnGenerarMetas.addEventListener("click", async () => { try { await generarMetasMes(); } catch (e) { msgMetas.innerHTML = `<span class="err">Error:</span> ${e.message || e}`; } });

// Se usa el chkYTD central de la barra superior.


/* ===== Utilidades de fecha ===== */
function isLeap(y) { return new Date(y, 2, 0).getDate() === 29; }
function daysInYear(y) { return isLeap(+y) ? 366 : 365; }
function dayOfYear(y, m, d) { // 1..365/366
  const dt = new Date(Date.UTC(+y, 0, 1));
  const cur = new Date(Date.UTC(+y, +m - 1, +d));
  return Math.floor((cur - dt) / (24 * 3600 * 1000)) + 1;
}

/* ===== Forecast helpers ===== */
// Suma metas mensuales enero..mes para una unidad del forecast
function sumMensualHasta(capIndex, uid, mes) {
  const row = capIndex?.[uid];
  if (!row || !row.mensual) return 0;
  let s = 0;
  for (let i = 1; i <= +mes; i++) {
    const MM = String(i).padStart(2, "0");
    s += Number(row.mensual[MM] || 0);
  }
  return s;
}

/* ===== Lectura de realizados ===== */
// Suma y cuenta días con dato hasta la fecha seleccionada.
// Si consolidar=true → desde ENE-01 hasta mes/día seleccionado.
async function cargarAcumuladosHasta(anio, mes, hastaDia, consolidar) {
  const mapa = {}; // { kpiId: { sum: number, days: number } }
  const mesIni = consolidar ? 1 : +mes;
  const mesFin = +mes;

  const promesas = [];
  for (let m = mesIni; m <= mesFin; m++) {
    const MM = String(m).padStart(2, '0');
    const topDay = (m === mesFin) ? hastaDia : daysInMonth(anio, MM);
    for (let d = 1; d <= topDay; d++) {
      const dd = String(d).padStart(2, '0');
      promesas.push(getDocs(collection(db, "realizados", anio, MM, dd, "kpi")));
    }
  }

  const snapshots = await Promise.all(promesas);
  snapshots.forEach(snap => {
    if (snap.empty) return;
    const vistos = new Set();
    snap.forEach(docu => {
      const r = docu.data();
      const k = String(r.kpi || "");
      const v = Number(r.valor || 0);
      if (!mapa[k]) mapa[k] = { sum: 0, days: 0 };
      mapa[k].sum += v;
      if (!vistos.has(k)) { mapa[k].days += 1; vistos.add(k); }
    });
  });
  return mapa;
}

// Valores realizados del día (mapa: kpiId -> valor del día)
async function cargarDelDia(anio, mes, diaDD) {
  const mapa = {};
  const snap = await getDocs(collection(db, "realizados", anio, mes, diaDD, "kpi"));
  snap.forEach(docu => {
    const r = docu.data();
    const k = String(r.kpi || "");
    const v = Number(r.valor || 0);
    mapa[k] = v;
  });
  return mapa;
}

/* ===== Clasificación de KPIs ===== */
function esKpiPromedioTarjeta(kpiId) {
  return (
    kpiId.startsWith('ocup_') ||
    kpiId === 'pde' || kpiId === 'pde_critico' ||
    kpiId === 'camas_hosp' || kpiId === 'camas_uci' || kpiId === 'camas_uce' ||
    kpiId === 'quirofanos'
  );
}

function dailyShare(total, nDias, idx) {
  const arr = distributeInt(Math.round(Number(total || 0)), nDias);
  return arr[idx] || 0;
}

/* ===== Inyectar estilos para 3 columnas por grupo (en pantalla) ===== */
(function injectMetaGridStyles() {
  if (document.getElementById('metaGridStyle3')) return;
  const st = document.createElement('style');
  st.id = 'metaGridStyle3';
  st.textContent = `
    .meta-group { margin: 14px 0 6px; }
    .meta-subtitle{
      font-size: 15px; font-weight: 800; margin: 8px 0 10px; color:#0b365a;
      border-left:4px solid #0aa9a2; padding-left:10px;
    }
    .meta-group .meta-grid{
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
      gap: 12px !important;
      width: 100% !important;
      align-items: stretch;
    }
    .meta-group .meta-grid .meta-mini{ height: 100%; }
  `;
  document.head.appendChild(st);
})();

/* ===== Grupos de tarjetas por servicio ===== */
function ensureGroup(id, title) {
  // Asegura que metasMensuales sea contenedor "en bloque"
  metasMensuales.style.display = 'block';

  let group = metasMensuales.querySelector(`.meta-group[data-id="${id}"]`);
  if (!group) {
    group = document.createElement('section');
    group.className = 'meta-group';
    group.setAttribute('data-id', id);

    const h = document.createElement('h4');
    h.className = 'meta-subtitle';
    safeSetText(h, title);

    const grid = document.createElement('div');
    grid.className = 'meta-grid'; // grilla interna de ese grupo (3 col por CSS inyectado)

    group.appendChild(h);
    group.appendChild(grid);
    if (metasMensuales) metasMensuales.appendChild(group);
  }
  return group.querySelector('.meta-grid');
}

/* ===== Tarjeta “viva” (meta, avance correcto sumas/promedios, HOY, YTD) ===== */
function addMetaCardTo(parentGrid,
  title, metaRef, unit, kpiId,
  acumulados,                         // {sum, days}
  diasTranscurridosRef, diasRefTotal, // mes o año (según modoYTD)
  esPromedio = false,
  hoyVal = 0, hoyMeta = 0,
  modoYTD = false,
  customProgress = null, // Fraction 0-1 of the period that SHOULD be completed
  customTargetAvg = null // Custom average target for promedios (e.g. weighted)
) {
  const metaNum = Number(metaRef || 0);
  const info = acumulados[kpiId] || { sum: 0, days: 0 };
  const sum = Number(info.sum || 0);
  const daysConDato = Number(info.days || 0);

  const expectedProgress = customProgress !== null
    ? customProgress
    : (diasTranscurridosRef / (diasRefTotal || 1));

  const divisorProm = esPromedio
    ? (daysConDato > 0 ? daysConDato : (diasTranscurridosRef || 1))
    : (diasTranscurridosRef || 1);
  const promRef = (divisorProm > 0) ? (sum / divisorProm) : 0;

  let textoMetaLinea = modoYTD
    ? (esPromedio ? 'Meta diaria (YTD)' : 'Meta acumulada (Ene–mes)')
    : (esPromedio ? 'Meta diaria' : 'Meta mensual');

  let avanceValorTxt, avancePctTxt, proyeccionTxt;

  if (!esPromedio) {
    const pctAvance = metaNum ? (sum / metaNum) * 100 : 0;
    const proyectado = (expectedProgress > 0) ? (sum / expectedProgress) : sum;
    avanceValorTxt = sum.toLocaleString("es-CO");
    avancePctTxt = metaNum ? pctAvance.toFixed(2) + '%' : '—';
    proyeccionTxt = Math.round(proyectado).toLocaleString("es-CO");
  } else {
    const pctAvance = metaNum ? (promRef / metaNum) * 100 : 0;
    avanceValorTxt = promRef.toFixed(2);
    avancePctTxt = metaNum ? pctAvance.toFixed(2) + '%' : '—';
    proyeccionTxt = promRef.toFixed(2);
  }

  // Semáforo (Proactivo: Alerta de si se va a cumplir o no meta a cierre)
  const inverse = (kpiId === 'pde' || kpiId === 'pde_critico');
  const metaNumVal = Number(metaNum || 0);
  let semTxt = 'Bajo', semCls = 'chip-bad';

  if (metaNumVal > 0) {
    const targetRef = (customTargetAvg !== null) ? customTargetAvg : metaNumVal;
    const proyectado = esPromedio
      ? (divisorProm > 0 ? (sum / divisorProm) : 0) // Para promedios se mantiene lineal o simple
      : ((expectedProgress > 0) ? (sum / expectedProgress) : sum);

    const r = proyectado / targetRef;

    if (!inverse) {
      if (r >= 1.0) { semTxt = 'OK'; semCls = 'chip-ok'; }
      else if (r >= 0.95) { semTxt = 'Riesgo'; semCls = 'chip-warn'; }
      else { semTxt = 'Bajo'; semCls = 'chip-bad'; }
    } else {
      // Inverso (PDE): menor es mejor
      if (r <= 1.0) { semTxt = 'OK'; semCls = 'chip-ok'; }
      else if (r <= 1.05) { semTxt = 'Riesgo'; semCls = 'chip-warn'; }
      else { semTxt = 'Bajo'; semCls = 'chip-bad'; }
    }
  }

  // HOY
  const dVal = Number(hoyVal || 0);
  const dMeta = Number(hoyMeta || 0);
  let dPctTxt = '—';
  if (dMeta) {
    const p = inverse ? (dMeta / (dVal || Number.MAX_VALUE)) : ((dVal || 0) / dMeta);
    dPctTxt = (p * 100).toFixed(1) + '%';
  }
  const dValTxt = esPromedio ? dVal.toFixed(2) : dVal.toLocaleString("es-CO");
  const dMetaTxt = dMeta ? ` <span class="pill">meta ${esPromedio ? dMeta.toFixed(2) : dMeta.toLocaleString("es-CO")}</span>` : '';

  // Alerta de rendimiento DIARIO (Ayer)
  let dStatusColor = '#0f172a';
  if (dMeta > 0) {
    const dRatio = inverse ? (dMeta / (dVal || 0.001)) : (dVal / dMeta);
    if (dRatio >= 1) dStatusColor = '#10b981';
    else if (dRatio >= 0.85) dStatusColor = '#f59e0b';
    else dStatusColor = '#ef4444';
  }

  // Render

  // ====== MODERN KPI CARD REDESIGN (EXECUTIVE VERSION) ======
  let theme = { color: '#f59e0b', bg: '#fef3c7', svg: '<svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>' };
  const kNorm = kpiId.toLowerCase();
  if (kNorm.includes('urg') || kNorm.includes('ce') || kNorm.includes('triage')) {
    theme = { color: '#ef4444', bg: '#fee2e2', svg: '<svg viewBox="0 0 24 24"><path d="M21 11.5v-1c0-.83-.67-1.5-1.5-1.5H16v-3c0-.83-.67-1.5-1.5-1.5h-5c-.83 0-1.5.67-1.5 1.5v3H4.5C3.67 9 3 9.67 3 10.5v1c0 .83.67 1.5 1.5 1.5H8v3c0 .83.67 1.5 1.5 1.5h5c.83 0 1.5-.67 1.5-1.5v-3h3.5c.83 0 1.5-.67 1.5-1.5z"/></svg>' };
  } else if (kNorm.includes('uci') || kNorm.includes('uce') || kNorm.includes('critico')) {
    theme = { color: '#8b5cf6', bg: '#f3e8ff', svg: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' };
  } else if (kNorm.includes('hosp') || kNorm.includes('piso') || kNorm === 'pde') {
    theme = { color: '#10b981', bg: '#dcfce7', svg: '<svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zM5 11V5H3v14h2v-2h14v2h2v-8H5z"/></svg>' };
  } else if (kNorm.includes('fibro') || kNorm.includes('endo') || kNorm.includes('examen') || kNorm.includes('quimio')) {
    theme = { color: '#0ea5e9', bg: '#e0f2fe', svg: '<svg viewBox="0 0 24 24"><path d="M12 2c-.55 0-1 .45-1 1v13l-4 4v1h10v-1l-4-4V3c0-.55-.45-1-1-1z"/></svg>' };
  }

  let badgeColor = semCls === 'chip-bad' ? '#ef4444' : (semCls === 'chip-warn' ? '#f59e0b' : '#10b981');

  const c = document.createElement("div");
  c.className = `meta-mini modern-card-wrapper ${semCls === 'chip-bad' ? 'status-bajo' : (semCls === 'chip-warn' ? 'status-riesgo' : '')}`;

  c.innerHTML = `
    <div class="mc-top" style="background: ${theme.color}"></div>
    <div class="mc-badge" style="background: ${badgeColor}">${semTxt.toUpperCase()}</div>
    
    <div class="mc-header">
      <div class="mc-icon" style="background: ${theme.bg}; color: ${theme.color}">
        ${theme.svg}
      </div>
      <div class="mc-title-area">
        <div class="mc-title">${title} <span class="u-badge">${unit || ''}</span></div>
        <div class="mc-meta">${textoMetaLinea}: ${(Number(metaRef) || 0).toLocaleString("es-CO")}</div>
      </div>
    </div>
    
    <div class="mc-stats">
      <div class="mc-stat-item">
         <div class="mc-stat-lbl">Logro</div>
         <div class="mc-stat-val">${avanceValorTxt}</div>
      </div>
      <div class="mc-stat-item" style="border-left: 1px solid #e2e8f0;">
         <div class="mc-stat-lbl">Avance</div>
         <div class="mc-stat-val" style="color: ${theme.color}">${avancePctTxt}</div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; font-size:10px; font-weight:700; color:#64748b; padding-top:10px; border-top:1px dashed #e2e8f0;">
       <div style="display:flex; align-items:center; gap:6px;">
          AYER: <span style="color:${dStatusColor}; font-weight:900;">${dValTxt}</span>
          <div style="width:5px; height:5px; border-radius:50%; background:${dStatusColor}"></div>
       </div>
       <div style="background:${dStatusColor}22; padding:2px 6px; border-radius:4px; color:${dStatusColor};">${dPctTxt}</div>
    </div>

    <!-- Hidden strict layout for PNG Exporter (Compatibility with old reporter) -->
    <div style="display:none">
        <div class="t">${title}</div>
        <div class="v">${(Number(metaRef) || 0).toLocaleString("es-CO")}</div>
        <span class="u">${unit || ''}</span>
        <div class="s">${textoMetaLinea}</div>
        <div class="s"><b>Avance acumulado:</b> ${avanceValorTxt} <span class="pill">${avancePctTxt}</span></div>
        <div class="s"><b>Proyección cierre mes:</b> ${proyeccionTxt} <span class="pill">${modoYTD ? 'a cierre año' : 'a cierre'}</span></div>
        <div class="s"><b>Ayer:</b> ${dValTxt} <span class="pill">${dPctTxt}</span>${dMetaTxt}</div>
        <div class="chip ${semCls}">${semTxt}</div>
    </div>
  `;
  parentGrid.appendChild(c);
}

/* ===== Refresh principal (Cálculos en Enteros) ===== */
async function refreshDailyUI() {
  const anio = String(anioDaily.value), mes = String(mesDaily.value);
  const nDiasMes = daysInMonth(anio, mes);

  fechaDaily.min = `${anio}-${mes}-01`;
  fechaDaily.max = `${anio}-${mes}-${String(nDiasMes).padStart(2, "0")}`;
  if (!fechaDaily.value) fechaDaily.value = `${anio}-${mes}-01`;

  const idxDia = Number(fechaDaily.value.split("-")[2]) - 1;
  const diaSel = idxDia + 1;
  const modoYTD = !!chkYTD?.checked;

  const diasTranscurridosRef = modoYTD ? dayOfYear(anio, mes, diaSel) : diaSel;
  const diasReferenciaTotal = modoYTD ? daysInYear(anio) : nDiasMes;

  // Helper para pesos por día (Proyección inteligente)
  function getWeightedProgress(y, m, dMax, totalDays, weights) {
    let currentWeights = 0;
    let totalWeights = 0;
    for (let i = 1; i <= totalDays; i++) {
      const date = new Date(y, m - 1, i);
      const w = weights[date.getDay()] ?? 1;
      totalWeights += w;
      if (i <= dMax) currentWeights += w;
    }
    return totalWeights > 0 ? (currentWeights / totalWeights) : (dMax / totalDays);
  }

  const quiWeights = { 0: 1, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5 }; // Domingo:1, Resto:5
  const quiProgress = getWeightedProgress(anio, mes, diaSel, nDiasMes, quiWeights);

  // Para Quirófanos (Promedio), necesitamos la meta promedio esperada hasta hoy
  let quiWeightSum = 0;
  for (let i = 1; i <= diaSel; i++) {
    const d = new Date(anio, mes - 1, i);
    quiWeightSum += (quiWeights[d.getDay()] ?? 5);
  }
  const quiTargetAvgSoFar = diaSel > 0 ? (quiWeightSum / diaSel) : 5;

  const capSnap = await getDocs(collection(db, "forecast", anio, "unidades"));
  const capIndex = Object.fromEntries(capSnap.docs.map(d => [String(d.id).toLowerCase(), d.data()]));
  const hospSnap = await getDocs(collection(db, "forecast_hosp", anio, "kpis"));
  const hospIndex = Object.fromEntries(hospSnap.docs.map(d => [String(d.id).toLowerCase(), d.data()]));
  const mMes = (row) => Number(row?.mensual?.[mes] ?? 0);

  const acumulados = await cargarAcumuladosHasta(anio, +mes, diaSel, modoYTD);

  const egMes = mMes(capIndex["hospitalizacion"]);
  const egYTD = sumMensualHasta(capIndex, "hospitalizacion", mes);

  const urgMes = mMes(capIndex["urgencias"]);
  const urgYTD = sumMensualHasta(capIndex, "urgencias", mes);

  const cirMes = mMes(capIndex["cirugia"]);
  const cirYTD = sumMensualHasta(capIndex, "cirugia", mes);

  const uciMes = mMes(capIndex["uci"]);
  const uciYTD = sumMensualHasta(capIndex, "uci", mes);

  const uceMes = mMes(capIndex["ucin"]);
  const uceYTD = sumMensualHasta(capIndex, "ucin", mes);

  const ceMes = mMes(capIndex["consulta_externa"]);
  const ceYTD = sumMensualHasta(capIndex, "consulta_externa", mes);

  let uvrAnual = 0, triAnual = 0, fibAnual = 0, endoAnual = 0, colAnual = 0, exaAnual = 0, quiAnual = 0;
  try {
    const keys = ["uvr", "triages", "fibrobroncoscopia", "endoscopia", "colonoscopia", "Examenes_ambulatorios", "quimio"];
    const snaps = await Promise.all(keys.map(k => getDoc(doc(db, "config_anuales", `${k}_${anio}`))));
    if (snaps[0].exists()) uvrAnual = Number(snaps[0].data().meta || 0);
    if (snaps[1].exists()) triAnual = Number(snaps[1].data().meta || 0);
    if (snaps[2].exists()) fibAnual = Number(snaps[2].data().meta || 0);
    if (snaps[3].exists()) endoAnual = Number(snaps[3].data().meta || 0);
    if (snaps[4].exists()) colAnual = Number(snaps[4].data().meta || 0);
    if (snaps[5].exists()) exaAnual = Number(snaps[5].data().meta || 0);
    if (snaps[6].exists()) quiAnual = Number(snaps[6].data().meta || 0);
  } catch (e) { console.warn("Error metas anuales", e); }

  const uvrMes = uvrAnual / 12, triMes = triAnual / 12, fibMes = fibAnual / 12;
  const endMes = endoAnual / 12, colMes = colAnual / 12, exaMes = exaAnual / 12, quiMes = quiAnual / 12;

  const metaDiaMap = {};
  const dailyFromCap = (uid) => dailyShare(Number(capIndex[uid]?.mensual?.[mes] ?? 0), nDiasMes, idxDia);

  // --- Aplicamos Math.round para que las metas del día sean enteras ---
  metaDiaMap["triages"] = Math.round(dailyShare(triMes, nDiasMes, idxDia));
  metaDiaMap["urgencias"] = Math.round(dailyFromCap("urgencias"));
  metaDiaMap["egresos_uce"] = Math.round(dailyFromCap("ucin"));
  metaDiaMap["egresos_uci"] = Math.round(dailyFromCap("uci"));
  metaDiaMap["proc_quir"] = Math.round(dailyFromCap("cirugia"));
  metaDiaMap["uvr"] = Math.round(dailyShare(uvrMes, nDiasMes, idxDia));
  metaDiaMap["fibro"] = Math.round(dailyShare(fibMes, nDiasMes, idxDia));
  metaDiaMap["endoscopia"] = Math.round(dailyShare(endMes, nDiasMes, idxDia));
  metaDiaMap["colonoscopia"] = Math.round(dailyShare(colMes, nDiasMes, idxDia));
  metaDiaMap["egresos_hosp"] = Math.round(dailyShare(egMes, nDiasMes, idxDia));
  metaDiaMap["ce"] = Math.round(dailyFromCap("consulta_externa"));
  metaDiaMap["piso2"] = Math.round(dailyShare(Math.round(egMes * 0.26), nDiasMes, idxDia));
  metaDiaMap["piso3"] = Math.round(dailyShare(Math.round(egMes * 0.33), nDiasMes, idxDia));
  metaDiaMap["piso4"] = Math.round(dailyShare(Math.round(egMes * 0.41), nDiasMes, idxDia));
  // --- Especial: Exámenes Ambulatorios (1000 ene-nov, 500 dic) ---
  const exaMesReal = (Number(mes) <= 11) ? 1000 : 500;
  metaDiaMap["examenes_ambulatorios"] = Math.round(dailyShare(exaMesReal, nDiasMes, idxDia));
  metaDiaMap["quimio"] = Math.round(dailyShare(quiMes, nDiasMes, idxDia));

  metaDiaMap["ocup_uce"] = 100; metaDiaMap["ocup_uci"] = 100; metaDiaMap["ocup_hosp"] = 98; metaDiaMap["pde_critico"] = 5;
  metaDiaMap["pde"] = Math.round(Number(hospIndex["dias_promedio_estancia"]?.mensual?.[mes] ?? 0));

  // Quirófanos dinámico por día
  const selDate = new Date(anio, mes - 1, diaSel);
  const isSunday = selDate.getDay() === 0;
  metaDiaMap["quirofanos"] = isSunday ? 1 : 5;
  metaDiaMap["camas_uce"] = 9; metaDiaMap["camas_uci"] = 12; metaDiaMap["camas_hosp"] = 83;

  metaDiaMap["camas_uce_bloq"] = 0;
  metaDiaMap["camas_uci_bloq"] = 0;
  metaDiaMap["camas_hosp_bloq"] = 0;
  metaDiaMap["quirofanos_bloq"] = 0;


  const realDiaMap = await cargarDelDia(anio, mes, String(diaSel).padStart(2, "0"));

  safeSetHTML(metasMensuales, "");

  // En lugar de crear grupos (ensureGroup), inyectamos todo directo a metasMensuales
  const container = metasMensuales;

  const metaSum = (mesVal, ytdVal) => Math.round(modoYTD ? ytdVal : mesVal);

  // --- INYECCIÓN DE LAS 25 TARJETAS (Sin interrupciones) ---
  // Urgencias
  addMetaCardTo(container, "Triages", metaSum(triMes, triMes * +mes), "", "triages", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["triages"], metaDiaMap["triages"], modoYTD);
  addMetaCardTo(container, "Atenciones Urgencias", metaSum(urgMes, urgYTD), "", "urgencias", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["urgencias"], metaDiaMap["urgencias"], modoYTD);

  // Hospitalización
  addMetaCardTo(container, "Camas Hosp.", 83, "Camas", "camas_hosp", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["camas_hosp"], metaDiaMap["camas_hosp"], modoYTD);
  addMetaCardTo(container, "Egresos Hosp.", metaSum(egMes, egYTD), "Casos", "egresos_hosp", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["egresos_hosp"], metaDiaMap["egresos_hosp"], modoYTD);
  addMetaCardTo(container, "Piso 2", metaSum(Math.round(egMes * 0.26), Math.round(egYTD * 0.26)), "Casos", "piso2", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["piso2"], metaDiaMap["piso2"], modoYTD);
  addMetaCardTo(container, "Piso 3", metaSum(Math.round(egMes * 0.33), Math.round(egYTD * 0.33)), "Casos", "piso3", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["piso3"], metaDiaMap["piso3"], modoYTD);
  addMetaCardTo(container, "Piso 4", metaSum(Math.round(egMes * 0.41), Math.round(egYTD * 0.41)), "Casos", "piso4", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["piso4"], metaDiaMap["piso4"], modoYTD);
  addMetaCardTo(container, "Ocupación Hosp.", 98, "%", "ocup_hosp", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["ocup_hosp"], metaDiaMap["ocup_hosp"], modoYTD);
  addMetaCardTo(container, "PDE", metaDiaMap["pde"], "días", "pde", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["pde"], metaDiaMap["pde"], modoYTD);

  // Cuidado Crítico
  addMetaCardTo(container, "Camas UCE", 9, "Camas", "camas_uce", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["camas_uce"], metaDiaMap["camas_uce"], modoYTD);
  addMetaCardTo(container, "Egresos UCE", metaSum(uceMes, uceYTD), "Casos", "egresos_uce", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["egresos_uce"], metaDiaMap["egresos_uce"], modoYTD);
  addMetaCardTo(container, "Ocupación UCE", 100, "%", "ocup_uce", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["ocup_uce"], metaDiaMap["ocup_uce"], modoYTD);
  addMetaCardTo(container, "Camas UCI", 12, "Camas", "camas_uci", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["camas_uci"], metaDiaMap["camas_uci"], modoYTD);
  addMetaCardTo(container, "Egresos UCI", metaSum(uciMes, uciYTD), "Casos", "egresos_uci", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["egresos_uci"], metaDiaMap["egresos_uci"], modoYTD);
  addMetaCardTo(container, "Ocupación UCI", 100, "%", "ocup_uci", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["ocup_uci"], metaDiaMap["ocup_uci"], modoYTD);
  addMetaCardTo(container, "PDE Crítico", 5, "días", "pde_critico", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["pde_critico"], metaDiaMap["pde_critico"], modoYTD);

  // Cirugía y Ambulatorio (Quirófanos como promedio con meta dinámica de tendencia)
  addMetaCardTo(container, "Quirófanos", 5, "N°", "quirofanos", acumulados, diasTranscurridosRef, diasReferenciaTotal, true, realDiaMap["quirofanos"], metaDiaMap["quirofanos"], modoYTD, null, quiTargetAvgSoFar);
  addMetaCardTo(container, "Proc. Quirúrgicos", metaSum(cirMes, cirYTD), "Proc.", "proc_quir", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["proc_quir"], metaDiaMap["proc_quir"], modoYTD);
  addMetaCardTo(container, "UVR", metaSum(uvrMes, uvrMes * +mes), "", "uvr", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["uvr"], metaDiaMap["uvr"], modoYTD);
  addMetaCardTo(container, "Fibrobroncoscopias", metaSum(fibMes, fibMes * +mes), "Proc.", "fibro", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["fibro"], metaDiaMap["fibro"], modoYTD);
  addMetaCardTo(container, "Endoscopias", metaSum(endMes, endMes * +mes), "Proc.", "endoscopia", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["endoscopia"], metaDiaMap["endoscopia"], modoYTD);
  addMetaCardTo(container, "Colonoscopias", metaSum(colMes, colMes * +mes), "Proc.", "colonoscopia", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["colonoscopia"], metaDiaMap["colonoscopia"], modoYTD);
  addMetaCardTo(container, "Examenes ambulatorios", metaSum(exaMes, exaMes * +mes), "Lab", "examenes_ambulatorios", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["examenes_ambulatorios"], metaDiaMap["examenes_ambulatorios"], modoYTD);
  addMetaCardTo(container, "Quimioterapias", metaSum(quiMes, quiMes * +mes), "Quimio", "quimio", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["quimio"], metaDiaMap["quimio"], modoYTD);

  // Consulta Externa
  addMetaCardTo(container, "Consulta Externa", metaSum(ceMes, ceYTD), "Ptes", "ce", acumulados, diasTranscurridosRef, diasReferenciaTotal, false, realDiaMap["ce"], metaDiaMap["ce"], modoYTD);
  // --- Llenado de Formulario ---
  KPI_IDS.forEach(id => {
    const valReal = realDiaMap[id] ?? 0;
    const valMeta = metaDiaMap[id] ?? 0;

    const rEl = document.getElementById(`real_${id}`);
    if (rEl) rEl.value = valReal;

    const mEl = document.getElementById(`meta_${id}`);
    if (mEl) mEl.value = valMeta;
  });


  updateMetasTitle(anio, mes);
  refreshSemaforos();
}

/* ===== Listeners (Unificados) ===== */
const updateAllDashboard = async () => {
  try {
    await refreshDailyUI();
    await cargarVistaMensual();
  } catch (e) {
    console.warn("Error updating dashboard:", e);
  }
};

[mesDaily, anioDaily, fechaDaily, chkYTD].forEach(el => {
  if (el) el.addEventListener("change", updateAllDashboard);
});

/* ===== Export PNG (8K: 11000x5000 - Paleta por servicio (translúcida), META explícita + AVANCE a la derecha (0%/100% sin decimales), UVR dentro de Cx, oculta colonoscopias, watermark CTC, UVR value smaller + INLINE with gauge, badge bigger, CAPTURE to kill old exporters) ===== */
(function initPNGExporter_8K_ColorPorServicio_V6() {
  const btn = document.getElementById('btnPngMetas');
  if (!btn) return;

  // Evita doble inicialización del MISMO bloque
  if (btn.dataset.pngExporter8kV6 === '1') return;
  btn.dataset.pngExporter8kV6 = '1';

  async function exportMetasAsPNG(ev) {
    // ✅ Mata exportadores viejos enganchados al botón
    if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }

    if (typeof html2canvas !== 'function') {
      alert('Error: html2canvas no detectado.');
      return;
    }

    const originalRoot = document.getElementById('metasMensuales');
    if (!originalRoot) {
      alert('No encontré #metasMensuales.');
      return;
    }

    const originalCards = Array.from(originalRoot.querySelectorAll('.meta-mini'));
    if (originalCards.length === 0) {
      alert('Carga los datos antes de exportar.');
      return;
    }

    const mVal = document.getElementById('mesDaily')?.value || '';
    const aVal = document.getElementById('anioDaily')?.value || '';
    const mesTxt = (typeof MES_NOMBRES !== 'undefined' && MES_NOMBRES[mVal]) ? MES_NOMBRES[mVal] : mVal;

    const W = 11000;
    const H = 5000;
    const PAD_X = 220;
    const PAD_Y = 160;

    const BRAND_PRIMARY = '#2D4B72';
    const TITLE_COLOR = '#0B365A';

    // Tamaños base
    const VALUE_FONT_DEFAULT = 230; // números grandes normales
    const VALUE_FONT_PROC = 220; // proc quirúrgicos
    const GAUGE_SIZE_DEFAULT = 250;
    const GAUGE_SIZE_UVR = 235; // un poquito menor para que UVR quede INLINE perfecto

    const stage = document.createElement('div');
    Object.assign(stage.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: `${W}px`,
      height: `${H}px`,
      padding: `${PAD_Y}px ${PAD_X}px`,
      boxSizing: 'border-box',
      overflow: 'hidden',
      background: '#FFFFFF',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: '120px'
    });

    const title = document.createElement('div');
    title.textContent = `INFORME DE CUMPLIMIENTO DE METAS - ${String(mesTxt).toUpperCase()} ${aVal}`;
    Object.assign(title.style, {
      fontSize: '175px',
      fontWeight: '900',
      color: TITLE_COLOR,
      letterSpacing: '2px',
      lineHeight: '1.03',
      textAlign: 'center'
    });

    header.appendChild(title);
    stage.appendChild(header);

    // ✅ Watermark (CTC) - esquina inferior derecha
    const watermark = document.createElement('div');
    watermark.innerHTML = `
      <div style="font-weight:950; letter-spacing:1px;">Coordinación Técnico Científica</div>
      <div style="font-weight:800; opacity:.95;">Clínica Sagrado Corazón</div>
      <div style="font-weight:700; opacity:.85;">${String(mesTxt).toUpperCase()} ${aVal}</div>
    `;
    Object.assign(watermark.style, {
      position: 'absolute',
      right: '190px',
      bottom: '140px',
      textAlign: 'right',
      fontSize: '64px',
      lineHeight: '1.18',
      color: 'rgba(11,54,90,0.38)',
      textShadow: '0 2px 8px rgba(0,0,0,0.05)',
      padding: '26px 34px',
      borderRadius: '28px',
      border: '2px solid rgba(11,54,90,0.12)',
      background: 'rgba(255,255,255,0.35)',
      backdropFilter: 'blur(2px)',
      pointerEvents: 'none',
      zIndex: '9999'
    });
    stage.appendChild(watermark);

    const n = originalCards.length;
    const colsIdeal = Math.ceil(n / 3);
    const cols = Math.max(6, Math.min(9, colsIdeal));

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      width: '100%',
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: '95px',
      alignContent: 'start'
    });

    // Helpers
    const normalize = (s) => (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const hexToRgba = (hex, a) => {
      const h = (hex || '').replace('#', '').trim();
      const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    const pctToNumber = (pctStr) => {
      if (!pctStr) return 0;
      const s = String(pctStr).replace('%', '').replace(',', '.').trim();
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };

    const formatPctDisplay = (pctStr) => {
      const n = pctToNumber(pctStr);
      if (n <= 0.0005) return '0%';
      if (n >= 99.9995) return '100%';
      return pctStr;
    };

    // Paleta por servicio
    const PALETTE = {
      urgencias: { hex: '#1D4ED8' },
      hospitalizacion: { hex: '#0EA5A4' },
      critico: { hex: '#4F46E5' },
      cirugia: { hex: '#F59E0B' },
      consulta: { hex: '#2563EB' },
      ambulatorio: { hex: '#06B6D4' },
      neutral: { hex: '#64748B' }
    };

    // ✅ UVR dentro de Cx
    const getCategoriaPorTitulo = (tNorm) => {
      if (tNorm.includes('uvr')) return 'cirugia';
      if (tNorm.includes('quirof') || tNorm.includes('quirurg')) return 'cirugia';

      if (tNorm.includes('triage') || tNorm.includes('urgencia')) return 'urgencias';
      if (tNorm.includes('uci') || tNorm.includes('uce') || tNorm.includes('critico')) return 'critico';

      if (tNorm.includes('hosp') || tNorm.includes('piso') || tNorm.includes('ocupacion hosp') || (tNorm.startsWith('pde') && !tNorm.includes('critico'))) {
        return 'hospitalizacion';
      }

      if (tNorm.includes('consulta externa')) return 'consulta';
      if (tNorm.includes('fibro') || tNorm.includes('endoscop') || tNorm.includes('colonoscop') || tNorm.includes('examen') || tNorm.includes('quimio')) return 'ambulatorio';

    };

    const toneByBadge = (txt) => {
      const t = normalize(txt);
      if (t.includes('ok')) return { bg: '#E7F8EF', fg: '#067647', bd: '#B7E4C7' };
      if (t.includes('riesgo')) return { bg: '#FFF3E0', fg: '#B45309', bd: '#FED7AA' };
      if (t.includes('bajo')) return { bg: '#FDECEC', fg: '#B42318', bd: '#FECACA' };
      return { bg: '#EEF2FF', fg: '#3730A3', bd: '#C7D2FE' };
    };

    const pill = (text, tone) => {
      const t = tone || { bg: '#F1F5F9', fg: '#334155', bd: '#E2E8F0' };
      const el = document.createElement('span');
      el.textContent = text;
      Object.assign(el.style, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px 24px',
        borderRadius: '999px',
        fontSize: '48px',
        fontWeight: '850',
        background: t.bg,
        color: t.fg,
        border: `2px solid ${t.bd}`,
        whiteSpace: 'nowrap',
        lineHeight: '1'
      });
      return el;
    };

    function parseLine(line) {
      const raw = (line || '').replace(/\s+/g, ' ').trim();
      if (!raw) return null;

      const idx = raw.indexOf(':');
      let label = '', rest = raw;
      if (idx !== -1) {
        label = raw.slice(0, idx).trim();
        rest = raw.slice(idx + 1).trim();
      } else {
        label = raw.trim();
        rest = '';
      }

      const pctMatch = rest.match(/(\d+(?:[.,]\d+)?%)/);
      const pct = pctMatch ? pctMatch[1] : '';
      if (pct) rest = rest.replace(pct, '').replace(/\s+/g, ' ').trim();

      let hasCierre = false;
      if (/a\s+cierre/i.test(rest)) {
        hasCierre = true;
        rest = rest.replace(/a\s+cierre/i, '').replace(/\s+/g, ' ').trim();
      }

      const metaMatch = rest.match(/\bmeta\s+\d+(?:[.,]\d+)?\b/i);
      const metaTxt = metaMatch ? metaMatch[0] : '';
      if (metaTxt) rest = rest.replace(metaTxt, '').replace(/\s+/g, ' ').trim();

      const value = rest;
      return { label, value, pct, hasCierre, metaTxt };
    }

    function rowUI(parsed) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        flexWrap: 'wrap',
        marginTop: '12px'
      });

      const lab = document.createElement('span');
      lab.textContent = `${parsed.label}:`;
      Object.assign(lab.style, {
        fontSize: '52px',
        fontWeight: '900',
        color: '#334155',
        whiteSpace: 'nowrap'
      });

      const val = document.createElement('span');
      val.textContent = parsed.value;
      Object.assign(val.style, {
        fontSize: '52px',
        fontWeight: '900',
        color: '#0F172A',
        whiteSpace: 'nowrap'
      });

      const pillsWrap = document.createElement('span');
      Object.assign(pillsWrap.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '14px',
        flexWrap: 'wrap'
      });

      if (parsed.pct) {
        pillsWrap.appendChild(pill(parsed.pct, { bg: '#E8F1FF', fg: '#1D4ED8', bd: '#BFD8FF' }));
      }
      if (parsed.hasCierre) {
        pillsWrap.appendChild(pill('a cierre', { bg: '#F1F5F9', fg: '#334155', bd: '#E2E8F0' }));
      }
      if (parsed.metaTxt) {
        pillsWrap.appendChild(pill(normalize(parsed.metaTxt), { bg: '#F8FAFC', fg: '#475569', bd: '#E2E8F0' }));
      }

      row.appendChild(lab);
      if (parsed.value) row.appendChild(val);
      if (pillsWrap.childNodes.length) row.appendChild(pillsWrap);

      return row;
    }

    function buildGauge({ accent, avancePct, avancePctStr, size = 250 }) {
      const gauge = document.createElement('div');
      Object.assign(gauge.style, {
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '999px',
        border: `6px solid ${hexToRgba(accent, 0.35)}`,
        background: hexToRgba(accent, 0.08),
        position: 'relative',
        overflow: 'hidden',
        boxShadow: `0 12px 24px ${hexToRgba(accent, 0.10)}`,
        flex: '0 0 auto'
      });

      const fill = document.createElement('div');
      Object.assign(fill.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        bottom: '0',
        height: `${avancePct}%`,
        background: `linear-gradient(180deg, ${hexToRgba(accent, 0.62)} 0%, ${hexToRgba(accent, 0.28)} 100%)`
      });

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'absolute',
        inset: '0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        zIndex: '2',
        padding: '10px',
        boxSizing: 'border-box'
      });

      const label = document.createElement('div');
      label.textContent = 'AVANCE';
      Object.assign(label.style, {
        fontSize: '40px',
        fontWeight: '950',
        color: '#0F172A',
        letterSpacing: '2px',
        background: 'rgba(255,255,255,0.80)',
        border: `2px solid rgba(15,23,42,0.08)`,
        padding: '8px 16px',
        borderRadius: '999px',
        whiteSpace: 'nowrap'
      });

      const pct = document.createElement('div');
      pct.textContent = formatPctDisplay(avancePctStr);
      Object.assign(pct.style, {
        fontSize: '58px',
        fontWeight: '950',
        color: '#0F172A',
        background: 'rgba(255,255,255,0.80)',
        border: `2px solid rgba(15,23,42,0.08)`,
        padding: '8px 14px',
        borderRadius: '22px',
        lineHeight: '1',
        whiteSpace: 'nowrap',
        maxWidth: '92%',
        boxSizing: 'border-box'
      });

      overlay.appendChild(label);
      overlay.appendChild(pct);
      gauge.appendChild(fill);
      gauge.appendChild(overlay);

      return gauge;
    }

    // Tarjetas
    originalCards.forEach((card) => {
      const t = card.querySelector('.t')?.textContent?.trim() || '';
      const tNorm = normalize(t);

      const isUVR = tNorm.includes('uvr');
      const isProc = tNorm.includes('proc') && tNorm.includes('quirurg');

      const cat = getCategoriaPorTitulo(tNorm);
      const theme = PALETTE[cat] || PALETTE.neutral;
      const accent = theme.hex;

      const v = card.querySelector('.v')?.textContent?.trim() || '';
      let sList = Array.from(card.querySelectorAll('.s'))
        .map(x => x.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      // Periodo (Meta)
      let periodo = 'MENSUAL';
      const idxMeta = sList.findIndex(x => /^meta\s+/i.test(x));
      if (idxMeta !== -1) {
        const m = normalize(sList[idxMeta]);
        if (m.includes('diaria')) periodo = 'DIARIA';
        else if (m.includes('anual')) periodo = 'ANUAL';
        else if (m.includes('mensual')) periodo = 'MENSUAL';
        sList.splice(idxMeta, 1);
      }

      // % avance acumulado
      let avancePctStr = '0%';
      for (const line of sList) {
        const p = parseLine(line);
        if (p && normalize(p.label).includes('avance acumulado') && p.pct) {
          avancePctStr = p.pct;
          break;
        }
      }
      const avancePct = Math.max(0, Math.min(100, pctToNumber(avancePctStr)));

      const lastChip = Array.from(card.querySelectorAll('.chip, .pill')).pop();
      const badgeText = lastChip?.textContent?.trim() || '';

      const outer = document.createElement('div');
      Object.assign(outer.style, {
        background: '#FFFFFF',
        borderRadius: '74px',
        border: `4px solid ${hexToRgba(accent, 0.35)}`,
        boxShadow: `0 22px 60px rgba(15, 23, 42, 0.06), 0 16px 42px ${hexToRgba(accent, 0.10)}`,
        overflow: 'hidden',
        position: 'relative'
      });

      const topBar = document.createElement('div');
      Object.assign(topBar.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        top: '0',
        height: '26px',
        background: hexToRgba(accent, 0.35),
        zIndex: '1'
      });

      const c = document.createElement('div');
      Object.assign(c.style, {
        borderRadius: '74px',
        padding: '92px 86px',
        minHeight: '1320px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        position: 'relative',
        zIndex: '2',
        background: `linear-gradient(180deg, ${hexToRgba(accent, 0.10)} 0%, rgba(255,255,255,1) 46%)`
      });

      const innerOutline = document.createElement('div');
      Object.assign(innerOutline.style, {
        position: 'absolute',
        inset: '16px',
        borderRadius: '62px',
        border: `2px solid ${hexToRgba(accent, 0.10)}`,
        pointerEvents: 'none',
        zIndex: '3'
      });

      const tt = document.createElement('div');
      tt.textContent = t;
      Object.assign(tt.style, {
        fontSize: '92px',
        fontWeight: '900',
        color: '#0F172A',
        lineHeight: '1.1',
        marginBottom: '20px'
      });

      const metaTag = document.createElement('div');
      metaTag.textContent = `META ${periodo}`;
      Object.assign(metaTag.style, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px 38px',
        borderRadius: '999px',
        fontSize: '52px',
        fontWeight: '950',
        letterSpacing: '1px',
        color: '#0F172A',
        background: hexToRgba(accent, 0.14),
        border: `3px solid ${hexToRgba(accent, 0.28)}`,
        marginBottom: '18px'
      });

      const rowsWrap = document.createElement('div');
      Object.assign(rowsWrap.style, {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        marginTop: '6px'
      });

      sList.forEach(line => {
        const parsed = parseLine(line);
        if (parsed) rowsWrap.appendChild(rowUI(parsed));
      });

      const gaugeSize = isUVR ? GAUGE_SIZE_UVR : GAUGE_SIZE_DEFAULT;
      const gauge = buildGauge({ accent, avancePct, avancePctStr, size: gaugeSize });

      // ====== VALUE (número grande) ======
      const vv = document.createElement('div');
      vv.textContent = v;

      // Tamaño del valor: UVR dinámico por dígitos + !important
      const digits = String(v).replace(/[^\d]/g, '').length; // 158.333 => 6
      let valueFont = VALUE_FONT_DEFAULT;
      if (isProc) valueFont = VALUE_FONT_PROC;
      if (isUVR) valueFont = (digits >= 6) ? 155 : 175;

      vv.style.setProperty('font-size', `${valueFont}px`, 'important');
      vv.style.setProperty('font-weight', '950', 'important');
      vv.style.setProperty('color', BRAND_PRIMARY, 'important');
      vv.style.setProperty('line-height', '1', 'important');
      vv.style.setProperty('margin', '0', 'important');
      vv.style.setProperty('max-width', '100%', 'important');
      vv.style.setProperty('white-space', 'nowrap', 'important');

      if (isUVR) {
        vv.style.setProperty('letter-spacing', '-2px', 'important');
        vv.style.setProperty('transform', 'scale(0.98)', 'important');
        vv.style.setProperty('transform-origin', 'center center', 'important');
      }

      // ✅ HeadRow SIEMPRE: número a la izquierda + AVANCE a la derecha (UVR incluido)
      const headRow = document.createElement('div');
      Object.assign(headRow.style, {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isUVR ? '34px' : '46px',
        margin: '8px 0 18px 0',
        flexWrap: 'nowrap'
      });

      headRow.appendChild(vv);
      headRow.appendChild(gauge);

      c.appendChild(tt);
      c.appendChild(metaTag);
      c.appendChild(headRow);

      // Badge final MÁS GRANDE
      let badgeEl = null;
      if (badgeText) {
        const tone = toneByBadge(badgeText);
        badgeEl = document.createElement('div');
        badgeEl.textContent = badgeText;
        Object.assign(badgeEl.style, {
          marginTop: '44px',
          padding: '28px 96px',
          borderRadius: '999px',
          fontSize: '86px',
          fontWeight: '1000',
          background: tone.bg,
          color: tone.fg,
          border: `3px solid ${tone.bd}`,
          boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
          display: 'inline-flex',
          justifyContent: 'center',
          alignItems: 'center',
          lineHeight: '1',
          letterSpacing: '0.5px'
        });
      }

      c.appendChild(rowsWrap);
      if (badgeEl) c.appendChild(badgeEl);

      outer.appendChild(topBar);
      outer.appendChild(c);
      outer.appendChild(innerOutline);

      grid.appendChild(outer);
    });

    stage.appendChild(grid);
    document.body.appendChild(stage);

    try {
      const canvas = await html2canvas(stage, {
        scale: 1,
        useCORS: true,
        backgroundColor: '#FFFFFF',
        width: W,
        height: H,
        windowWidth: W,
        windowHeight: H,
        scrollX: 0,
        scrollY: 0
      });

      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      out.getContext('2d').drawImage(canvas, 0, 0, W, H);

      const link = document.createElement('a');
      link.download = `Reporte_Metas_Diarias_${mesTxt}_${aVal}.png`;
      link.href = out.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Error exportando PNG:', e);
      alert('Error exportando PNG. Revisa consola.');
    } finally {
      document.body.removeChild(stage);
    }
  }

  // ✅ Captura primero: bloquea exportadores anteriores
  btn.addEventListener('click', exportMetasAsPNG, { capture: true });
})();

/* ---------- Semáforos (PDE invertido) ---------- */

function paintStatus(id) {
  const real = Number(document.getElementById(`real_${id}`).value || 0);
  const meta = Number(document.getElementById(`meta_${id}`).value || 0);
  const st = document.getElementById(`st_${id}`);
  if (!meta) { st.className = "chip"; st.textContent = "—"; return; }

  let ok = false, warn = false;
  if (id === "pde" || id === "pde_critico") {
    if (real <= meta) { ok = true; }
    else if (real <= meta * 1.10) { warn = true; }
  } else {
    if (real >= meta) { ok = true; }
    else if (real >= meta * 0.90) { warn = true; }
  }

  if (ok) { st.className = "chip chip-ok"; st.textContent = "OK"; }
  else if (warn) { st.className = "chip chip-warn"; st.textContent = "Riesgo"; }
  else { st.className = "chip chip-bad"; st.textContent = "Bajo"; }
}

KPI_IDS.forEach(id => {
  const el = document.getElementById(`real_${id}`);
  if (el) el.addEventListener("input", () => paintStatus(id));
});

/* ---------- Guardar realizados ---------- */
if (btnGuardarReal) btnGuardarReal.addEventListener("click", async (e) => {
  // 👇 si el botón está dentro de un <form>, esto evita el submit/recarga
  e?.preventDefault?.();

  msgReal.textContent = "";
  try {
    // 👇 evita “anon” y te muestra el error real si no hay sesión
    if (!auth.currentUser) throw new Error("No hay sesión iniciada. Inicia sesión y vuelve a guardar.");

    const f = (fechaDaily.value || "").trim();
    if (!f) throw new Error("Selecciona fecha.");

    const [yyyy, MM, dd] = f.split("-");
    const anio = String(yyyy);
    const mes = String(MM);   // queda "02" desde <input type="date">
    const dia = String(dd);

    const batch = writeBatch(db);

    KPI_IDS.forEach((idRaw) => {
      const id = String(idRaw);
      const realEl = document.getElementById(`real_${id}`);
      const metaEl = document.getElementById(`meta_${id}`);

      const val = Number(realEl?.value || 0);
      const meta = Number(metaEl?.value || 0);

      batch.set(
        doc(db, "realizados", anio, mes, dia, "kpi", id),
        {
          fecha: f,
          anio: Number(anio),
          mes,
          dia,
          kpi: id,
          valor: val,
          meta: meta,
          usuario: auth.currentUser.email,
          ts: serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
    await refreshSemaforos(); // 👈 ponlo con await

    msgReal.innerHTML = `<span class="ok">OK:</span> Registrado ${f}.`;
  } catch (e2) {
    console.error(e2);
    msgReal.innerHTML = `<span class="err">Error:</span> ${e2.message || e2}`;
  }
});

/* ---------- Histórico: buscar y exportar ---------- */




function renderChart(historicoRows) {
  const destroy = (id) => { if (window[id]) window[id].destroy(); };
  destroy('chartObjDemanda'); destroy('chartObjOcupacion'); destroy('chartObjCirugia');

  const agg = {};
  historicoRows.forEach(r => {
    const f = r.fecha;
    if (!f) return;
    if (!agg[f]) agg[f] = { tri: 0, urg: 0, oUci: 0, oUce: 0, oHosp: 0, proc: 0, uvr: 0 };
    const k = String(r.kpi || "").toLowerCase();
    const v = Number(r.valor || 0);
    if (k === 'triages') agg[f].tri = v;
    if (k === 'urgencias') agg[f].urg = v;
    if (k === 'ocup_uci') agg[f].oUci = v;
    if (k === 'ocup_uce') agg[f].oUce = v;
    if (k === 'ocup_hosp') agg[f].oHosp = v;
    if (k === 'proc_quir') agg[f].proc = v;
    if (k === 'uvr') agg[f].uvr = v;
  });

  let sortedKeys = Object.keys(agg).sort();
  if (sortedKeys.length === 0) return;

  const firstStr = sortedKeys[0];
  const lastStr = sortedKeys[sortedKeys.length - 1];
  const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  const continuousLabels = [];
  let [y, mo, da] = firstStr.split("-").map(Number);
  let curr = new Date(y, mo - 1, da);
  let [y2, mo2, da2] = lastStr.split("-").map(Number);
  const stop = new Date(y2, mo2 - 1, da2);

  while (curr <= stop) {
    continuousLabels.push(fmt(curr));
    curr.setDate(curr.getDate() + 1);
  }

  const dayLabels = continuousLabels.map(d => d.slice(-2));
  const getVal = (d, key) => (agg[d] ? agg[d][key] : 0);

  // --- 📈 ANALITICAL CALCULATIONS ---
  const totals = { tri: 0, urg: 0, oUci: 0, oUce: 0, oHosp: 0, proc: 0, uvr: 0, count: continuousLabels.length };
  continuousLabels.forEach(d => {
    totals.tri += getVal(d, 'tri');
    totals.urg += getVal(d, 'urg');
    totals.oUci += getVal(d, 'oUci');
    totals.oUce += getVal(d, 'oUce');
    totals.oHosp += getVal(d, 'oHosp');
    totals.proc += getVal(d, 'proc');
    totals.uvr += getVal(d, 'uvr');
  });

  const avgConv = totals.tri > 0 ? (totals.urg / totals.tri * 100) : 0;
  const avgOcupCr = (totals.oUci + totals.oUce) / (2 * totals.count);
  const avgUvrProc = totals.proc > 0 ? (totals.uvr / totals.proc) : 0;

  // Update insight boxes
  const boxDemanda = document.getElementById('insight-demanda');
  if (boxDemanda) {
    boxDemanda.innerHTML = `
      <span class="insight-tag">Análisis Operativo</span>
      <p>Tasa de conversión Triages-Urgencias: <strong>${avgConv.toFixed(1)}%</strong>. 
      ${avgConv > 70 ? '🟢 Alta efectividad en el direccionamiento.' : '🟡 Se recomienda revisar criterios de clasificación.'}
      Pico de demanda registrado: <strong>${Math.max(...continuousLabels.map(d => getVal(d, 'tri')))}</strong> triages.</p>`;
  }

  const boxOcupacion = document.getElementById('insight-ocupacion');
  if (boxOcupacion) {
    boxOcupacion.innerHTML = `
      <span class="insight-tag">Eficiencia de Camas</span>
      <p>Ocupación crítica promedio (UCI+UCE): <strong>${avgOcupCr.toFixed(1)}%</strong>. 
      ${avgOcupCr > 90 ? '🔴 Saturación crítica detectada en áreas cerradas.' : '🟢 Capacidad de respuesta estable.'}
      Presión hospitalaria: <strong>${(totals.oHosp / totals.count).toFixed(1)}%</strong>.</p>`;
  }

  const boxCirugia = document.getElementById('insight-cirugia');
  if (boxCirugia) {
    boxCirugia.innerHTML = `
      <span class="insight-tag">Generación de Valor</span>
      <p>Producción promedio: <strong>${avgUvrProc.toFixed(0)} UVR</strong> por intervención. 
      Total procedimientos: <strong>${totals.proc}</strong>. 
      ${totals.proc > 20 ? '🟢 Ritmo quirúrgico vigoroso.' : '🟡 Oportunidad de mejora en rotación quirúrgica.'}</p>`;
  }

  // --- 📊 CHART RENDERING ---
  const commonOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10, weight: '700' }, color: '#475569' } },
      tooltip: { backgroundColor: '#1e293b', titleFont: { size: 12 }, bodyFont: { size: 12 }, padding: 12, borderRadius: 10 }
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#94a3b8' }, border: { display: false } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)', borderDash: [5, 5] }, ticks: { font: { size: 10, weight: '600' }, color: '#94a3b8' }, border: { display: false } }
    }
  };

  // 1. Demanda: Triages vs Urgencias
  const ctxD = document.getElementById('chartDemanda')?.getContext('2d');
  if (ctxD) window.chartObjDemanda = new Chart(ctxD, {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [
        { label: 'Triages', data: continuousLabels.map(d => getVal(d, 'tri')), backgroundColor: '#3b82f6', borderRadius: 8 },
        { label: 'Urgencias', data: continuousLabels.map(d => getVal(d, 'urg')), backgroundColor: '#94a3b8', borderRadius: 8 }
      ]
    },
    options: commonOpts
  });

  // 2. Ocupación de Camas (%)
  const ctxO = document.getElementById('chartOcupacion')?.getContext('2d');
  if (ctxO) window.chartObjOcupacion = new Chart(ctxO, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [
        { label: '% UCI', data: continuousLabels.map(d => getVal(d, 'oUci')), borderColor: '#8b5cf6', backgroundColor: '#8b5cf611', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4 },
        { label: '% UCE', data: continuousLabels.map(d => getVal(d, 'oUce')), borderColor: '#0ea5e9', backgroundColor: '#0ea5e911', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4 },
        { label: '% Hosp', data: continuousLabels.map(d => getVal(d, 'oHosp')), borderColor: '#10b981', backgroundColor: '#10b98111', fill: true, tension: 0.4, borderWidth: 3, pointRadius: 4 }
      ]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, max: 110 } } }
  });

  // 3. Actividad Quirúrgica & UVR
  const ctxC = document.getElementById('chartCirugia')?.getContext('2d');
  if (ctxC) window.chartObjCirugia = new Chart(ctxC, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [
        { label: 'Proc. Quirúr.', data: continuousLabels.map(d => getVal(d, 'proc')), borderColor: '#6366f1', borderWidth: 3, tension: 0.4, pointRadius: 5 },
        { label: 'UVR (Escalado)', data: continuousLabels.map(d => getVal(d, 'uvr') / 10), borderColor: '#f43f5e', borderWidth: 2, borderDash: [5, 5], tension: 0.4, pointRadius: 0 }
      ]
    },
    options: commonOpts
  });
}

// (2) Buscar histórico por rango (con plan B día a día)
async function buscarHistorico() {
  histMsg.textContent = "Buscando...";

  const d1 = readYMDFromInput(histDesde);
  const d2 = readYMDFromInput(histHasta);
  if (!d1 || !d2) { histMsg.textContent = "Selecciona rango de fechas válido."; return; }

  // Normaliza orden
  let startUTC = makeUTC(d1.y, d1.m, d1.d);
  let endUTC = makeUTC(d2.y, d2.m, d2.d);
  if (startUTC > endUTC) { const t = startUTC; startUTC = endUTC; endUTC = t; }

  // Recorre día a día en UTC (sumando 86.400.000 ms)
  const rows = [];
  const dayMs = 24 * 60 * 60 * 1000;

  const promises = [];
  for (let ts = startUTC.getTime(); ts <= endUTC.getTime(); ts += dayMs) {
    const dt = new Date(ts); // UTC date
    const y = String(dt.getUTCFullYear());
    const MM = pad2(dt.getUTCMonth() + 1);
    const dd = pad2(dt.getUTCDate());
    promises.push(getDocs(collection(db, "realizados", y, MM, dd, "kpi")).then(snap => {
      snap.forEach(doc => {
        const r = doc.data();
        if (!r.fecha) r.fecha = `${y}-${MM}-${dd}`; // por si acaso
        rows.push(r);
      });
    }));
  }
  await Promise.all(promises);

  rows.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.kpi || "").localeCompare(b.kpi || ""));
  renderHist(rows);

  histMsg.textContent = `${rows.length} registros (${fmtISO_UTC(startUTC)} a ${fmtISO_UTC(endUTC)})`;
}

// (3) Pintar EXACTAMENTE 7 columnas como tu <thead>
// Fecha | KPI | Valor | Meta | % Cumpl | Semáforo | Tendencia
function renderHist(rows) {
  try { renderChart(rows); } catch (e) { console.error("Error charting", e); }
  rows.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.kpi || "").localeCompare(b.kpi || ""));

  // Acumulador por KPI|yyyy-MM para proyectar “Tendencia”
  // Guardamos: suma, set de días con dato, metaDia (última vista) y días del mes
  const acc = {}; // key => { sum:number, days:Set<string>, metaDia:number, diasMes:number }

  // Utilidad: yyyy-MM-dd -> yyyy-MM
  const ym = (iso) => String(iso || "").slice(0, 7);
  const dOnly = (iso) => String(iso || "").slice(8, 10);

  function tendenciaTexto(row) {
    const kpi = String(row.kpi || "");
    const fecha = String(row.fecha || "");
    const yyyyMM = ym(fecha);
    const diaStr = dOnly(fecha) || "01";
    const key = `${kpi}|${yyyyMM}`;

    if (!acc[key]) {
      acc[key] = {
        sum: 0,
        days: new Set(),         // días con dato para este KPI en este mes
        metaDia: Number(row.meta || 0),
        diasMes: daysInMonthStr(yyyyMM)
      };
    }
    const a = acc[key];
    a.sum += Number(row.valor || 0);
    a.days.add(diaStr);
    // si cambió la meta diaria en el tiempo, tomamos la última vista
    a.metaDia = Number(row.meta || a.metaDia || 0);

    const esProm = esKpiPromedio(kpi);
    const inverse = isInverseKPI(kpi);
    const diasConDato = a.days.size || 1;

    // Ritmo / promedio YTD real (no depende del “último día”, sino de días que sí tienen registro)
    const promYTD = a.sum / diasConDato;

    // Objetivo del mes:
    // - sumables: metaDia * diasMes
    // - promedios: metaDia (¡no multiplicar!)
    const objetivoMes = esProm ? a.metaDia : (a.metaDia * a.diasMes);

    // Proyección a cierre:
    // - sumables: (promYTD * diasMes)
    // - promedios: (promYTD)
    const proyectado = esProm ? (promYTD) : (promYTD * a.diasMes);

    // Clasificación
    let txt = 'No cumplirá', cls = 'bad';
    if (esProm) {
      if (inverse) {
        if (proyectado <= objetivoMes) { txt = 'Cumplirá'; cls = 'ok'; }
        else if (proyectado <= objetivoMes * 1.10) { txt = 'Riesgo'; cls = 'warn'; }
      } else {
        const p = objetivoMes ? (proyectado / objetivoMes) : 0;
        if (p >= 1) { txt = 'Cumplirá'; cls = 'ok'; }
        else if (p >= 0.90) { txt = 'Riesgo'; cls = 'warn'; }
      }
    } else {
      const p = objetivoMes ? (proyectado / objetivoMes) : 0;
      if (p >= 1) { txt = 'Cumplirá'; cls = 'ok'; }
      else if (p >= 0.90) { txt = 'Riesgo'; cls = 'warn'; }
    }

    // Texto detalle al lado del chip
    const info = esProm
      ? ` (prom ${proyectado.toFixed(2)} / meta ${a.metaDia || 0})`
      : ` (${Math.round(proyectado).toLocaleString('es')} / ${Math.round(objetivoMes || 0).toLocaleString('es')})`;

    return `<span class="chip-mini ${cls}">${txt}</span><span class="hint">${info}</span>`;
  }

  const tbody = tblHistBody;
  tbody.innerHTML = rows.map(r => {
    const kpi = String(r.kpi || "");
    const val = Number(r.valor || 0);
    const metaD = Number(r.meta || 0);
    const inverse = isInverseKPI(kpi);

    // % Cumpl (del día) — sigue siendo diaria (val vs metaD)
    let pct = 0;
    if (metaD) {
      pct = inverse ? (metaD / (val || Number.MAX_VALUE)) : ((val || 0) / metaD);
    }
    const pctTxt = metaD ? (pct * 100).toFixed(1) + "%" : "—";

    // Semáforo (del día) — igual que antes
    let sem = '<span class="chip-mini">—</span>';
    if (metaD) {
      if (inverse) {
        if (val <= metaD) sem = '<span class="chip-mini ok">OK</span>';
        else if (val <= metaD * 1.10) sem = '<span class="chip-mini warn">Riesgo</span>';
        else sem = '<span class="chip-mini bad">Bajo</span>';
      } else {
        if (val >= metaD) sem = '<span class="chip-mini ok">OK</span>';
        else if (val >= metaD * 0.90) sem = '<span class="chip-mini warn">Riesgo</span>';
        else sem = '<span class="chip-mini bad">Bajo</span>';
      }
    }

    const tend = tendenciaTexto(r);

    return `<tr>
      <td>${String(r.fecha || "")}</td>
      <td>${kpi}</td>
      <td>${val}</td>
      <td>${metaD || 0}</td>
      <td>${pctTxt}</td>
      <td>${sem}</td>
      <td>${tend}</td>
    </tr>`;
  }).join("");
}

if (btnBuscarHist) btnBuscarHist.addEventListener("click", buscarHistorico);

// Excel (7 columnas limpias, semáforo y tendencia sin HTML)
if (btnExcelHist) btnExcelHist.addEventListener("click", () => {
  const rows = [];
  const trs = tblHist.querySelectorAll("tr");

  trs.forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (!tds.length) return;

    // Texto plano de cada celda
    const fecha = tds[0]?.textContent.trim() || "";
    const kpi = tds[1]?.textContent.trim() || "";
    const valor = tds[2]?.textContent.trim() || "";
    const meta = tds[3]?.textContent.trim() || "";
    const pct = tds[4]?.textContent.trim() || "";

    // Semáforo: toma solo el chip (OK/Riesgo/Bajo)
    const semChip = (tds[5]?.querySelector(".chip-mini")?.textContent || tds[5]?.textContent || "").trim();

    // Tendencia: chip + detalle (si existe)
    const tendChip = (tds[6]?.querySelector(".chip-mini")?.textContent || "").trim();
    const tendHint = (tds[6]?.querySelector(".hint")?.textContent || "").trim();
    const tendencia = tendHint ? `${tendChip} ${tendHint}` : tendChip;

    rows.push({
      "Fecha": fecha,
      "KPI": kpi,
      "Valor": valor,
      "Meta": meta,
      "% Cumpl": pct,
      "Semáforo": semChip,
      "Tendencia": tendencia
    });
  });

  if (rows.length === 0) {
    histMsg.textContent = "No hay datos para exportar.";
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  // Ancho de columnas para que se lea bien
  ws['!cols'] = [
    { wch: 12 }, // Fecha
    { wch: 22 }, // KPI
    { wch: 10 }, // Valor
    { wch: 10 }, // Meta
    { wch: 10 }, // % Cumpl
    { wch: 12 }, // Semáforo
    { wch: 28 }  // Tendencia
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Realizados");
  XLSX.writeFile(wb, "realizados_historico.xlsx");
});

// PDF (bonito, con logo, encabezados, semáforo y proporciones + decimales OK)
if (btnPdfHist) btnPdfHist.addEventListener("click", async () => {
  if (typeof window.jspdf === 'undefined') {
    histMsg.textContent = "Cargando jsPDF...";
    await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  }
  const { jsPDF } = window.jspdf;

  // === 1) Leer filas visibles de la tabla ===
  const bodyRows = [];
  const parseFlexible = (s) => {
    if (!s) return 0;
    s = String(s).trim();
    const only = s.replace(/[^\d.,-]/g, "");
    const lastComma = only.lastIndexOf(",");
    const lastDot = only.lastIndexOf(".");
    let decSep = null;
    if (lastComma > -1 && lastDot > -1) decSep = lastComma > lastDot ? "," : ".";
    else if (lastComma > -1) decSep = ",";
    else if (lastDot > -1) decSep = ".";
    let norm;
    if (decSep === ",") norm = only.replace(/\./g, "").replace(",", ".");       // 1.234,56 -> 1234.56
    else if (decSep === ".") norm = only.replace(/,/g, "");                     // 1,234.56 -> 1234.56
    else norm = only.replace(/[.,]/g, "");                                   // solo miles -> entero
    const n = Number(norm);
    return Number.isFinite(n) ? n : 0;
  };
  const decPlaces = (s) => {
    const m = String(s || "").match(/[.,](\d+)/);
    return Math.min(2, m ? m[1].length : 0); // hasta 2 decimales
  };
  const trs = tblHist.querySelectorAll("tbody tr");
  trs.forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (tds.length === 7) {
      const c = Array.from(tds).map(t => t.textContent.trim());
      const fecha = c[0], kpi = c[1];
      const valorRaw = c[2], metaRaw = c[3];
      const valor = parseFlexible(valorRaw);
      const meta = parseFlexible(metaRaw);
      const valDecs = decPlaces(valorRaw);
      const metaDecs = decPlaces(metaRaw);
      const pctTxt = c[4], semTxt = c[5], tendencia = c[6];
      bodyRows.push({ fecha, kpi, valor, meta, valDecs, metaDecs, pctTxt, semTxt, tendencia });
    }
  });
  if (bodyRows.length === 0) { histMsg.textContent = "No hay datos para exportar."; return; }

  // === 2) Documento ===
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40; let y = M;

  // === 3) Encabezado con LOGO, nombre y NIT ===
  const headerH = 48;
  let textX = M;
  try {
    const res = await fetch('assets/Logo_Clinica.png', { cache: 'no-store' });
    const blob = await res.blob();
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    const img = new Image(); img.src = dataUrl; await img.decode();
    const W = Math.min(headerH * (img.width / img.height || 3), 230);
    doc.addImage(dataUrl, 'PNG', M, y, W, headerH);
    textX = M + W + 18;
  } catch { textX = M; }
  doc.setFont('helvetica', 'bold').setFontSize(18);
  doc.text('CLÍNICA SAGRADO CORAZÓN', textX, y + 28);
  doc.setFont('helvetica', 'normal').setFontSize(12);
  doc.text('NIT 900408220 - 1', textX, y + 48);
  y += headerH + 22; doc.setDrawColor(220); doc.line(M, y - 10, pageW - M, y - 10);

  // === 4) Título + rango ===
  const desde = histDesde.value || '';
  const hasta = histHasta.value || '';
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('Histórico de realizados', M, y);
  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(`Rango: ${desde} a ${hasta}`, M, y + 16);
  y += 28;

  // === 5) Tabla ===
  const colTitles = ['Fecha', 'KPI', 'Valor', 'Meta', '% Cumpl', 'Semáforo', 'Tendencia'];
  // Anchos: ensanchamos KPI y “Tendencia” para que quepa todo
  const colW = [70, 80, 45, 45, 50, 100, pageW - (M * 2) - (70 + 80 + 45 + 45 + 50 + 100)];
  const rowH = 20;
  const headerFill = { r: 11, g: 54, b: 90 };
  const gridColor = { r: 230, g: 232, b: 236 };
  const okC = { r: 5, g: 150, b: 105 }, warnC = { r: 245, g: 158, b: 11 }, badC = { r: 220, g: 38, b: 38 };
  const textGray = { r: 55, g: 65, b: 81 };
  const fmt = (n, decs) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: decs, maximumFractionDigits: decs }).format(n);

  function drawHeader() {
    doc.setFillColor(headerFill.r, headerFill.g, headerFill.b);
    doc.setDrawColor(headerFill.r, headerFill.g, headerFill.b);
    doc.rect(M, y, pageW - M * 2, rowH, 'F');
    let x = M + 6;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold').setFontSize(10);
    colTitles.forEach((t, i) => { doc.text(t, x, y + 13, { baseline: 'middle' }); x += colW[i]; });
    y += rowH;
    doc.setTextColor(textGray.r, textGray.g, textGray.b);
    doc.setDrawColor(gridColor.r, gridColor.g, gridColor.b);
  }
  function ensureSpace() {
    if (y + rowH > pageH - M) { doc.addPage(); y = M; drawHeader(); }
  }
  function drawRow(r) {
    ensureSpace();
    doc.setDrawColor(gridColor.r, gridColor.g, gridColor.b);
    doc.rect(M, y, pageW - M * 2, rowH);
    doc.setFont('helvetica', 'normal').setFontSize(9);
    let x = M + 6;
    const cells = [
      r.fecha,
      r.kpi,
      fmt(r.valor, r.valDecs),
      fmt(r.meta, r.metaDecs),
      r.pctTxt,
      '', // semáforo
      r.tendencia
    ];
    // Semáforo (misma lógica que en la tabla)
    const isInverse = (r.kpi === 'pde' || r.kpi === 'pde_critico');
    let semTxt = 'Bajo', color = badC;
    if (r.meta > 0) {
      if (isInverse) {
        if (r.valor <= r.meta) { semTxt = 'OK'; color = okC; }
        else if (r.valor <= r.meta * 1.10) { semTxt = 'Riesgo'; color = warnC; }
      } else {
        if (r.valor >= r.meta) { semTxt = 'OK'; color = okC; }
        else if (r.valor >= r.meta * 0.90) { semTxt = 'Riesgo'; color = warnC; }
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (i === 5) {
        const cx = x + 6, cy = y + rowH / 2;
        doc.setFillColor(color.r, color.g, color.b);
        doc.circle(cx, cy, 4, 'F');
        doc.setTextColor(textGray.r, textGray.g, textGray.b);
        doc.text(semTxt, x + 14, y + rowH / 2 + 1, { baseline: 'middle' });
      } else {
        const alignRight = (i === 2 || i === 3 || i === 4);
        const tx = alignRight ? (x + colW[i] - 6) : x;
        doc.text(String(cells[i] ?? ''), tx, y + rowH / 2 + 1, { baseline: 'middle', align: alignRight ? 'right' : 'left' });
      }
      x += colW[i];
    }
    y += rowH;
  }

  drawHeader();
  bodyRows.forEach(drawRow);

  // === 6) Footer ===
  const when = new Date().toLocaleString('es-CO');
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(`Generado: ${when}`, M, pageH - M / 2);
    doc.text(`Página ${i} / ${pages}`, pageW - M, pageH - M / 2, { align: 'right' });
  }

  doc.save("realizados_historico.pdf");
});

// (4) Valores por defecto y búsqueda inicial

function setDefaultHistRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  histDesde.value = `${y}-${m}-01`;
  histHasta.value = `${y}-${m}-${d}`;
}
setDefaultHistRange();
buscarHistorico();

/* ========== METAS ANUALES CONFIGURABLES ========== */
const anioAnuales = document.getElementById("anioAnuales");
const metaAnualUVR = document.getElementById("metaAnualUVR");
const metaAnualTriages = document.getElementById("metaAnualTriages");
// Asegúrate de que estos IDs existan en tu HTML:
const metaAnualFibro = document.getElementById("metaAnualFibro");
const metaAnualEndoscopia = document.getElementById("metaAnualEndoscopia");
const metaAnualColonoscopia = document.getElementById("metaAnualColonoscopia");
const metaAnualExamenes = document.getElementById("metaAnualExamenes");
const metaAnualQuimio = document.getElementById("metaAnualQuimio");

const btnRefrescarAnuales = document.getElementById("btnRefrescarAnuales");
const btnGuardarAnuales = document.getElementById("btnGuardarAnuales");
const msgAnuales = document.getElementById("msgAnuales");
const estadoAnuales = document.getElementById("estadoAnuales");

// Sincronizar año
if (anioAnuales && typeof anioDaily !== 'undefined') {
  anioAnuales.value = anioDaily.value || "2026";
  anioDaily.addEventListener("change", () => {
    anioAnuales.value = anioDaily.value;
    refrescarMetasAnuales();
  });
}
if (anioAnuales) anioAnuales.addEventListener("change", refrescarMetasAnuales);

async function refrescarMetasAnuales() {
  const anio = anioAnuales?.value.trim();
  if (!anio) return;

  let uvr = 0, tri = 0, fibro = 0, endo = 0, colo = 0, exa = 0, qui = 0;
  let msgParts = [];

  const leerMeta = async (docId, label) => {
    try {
      const snap = await getDoc(doc(db, "config_anuales", `${docId}_${anio}`));
      if (snap.exists()) {
        const val = Number(snap.data().meta || 0);
        msgParts.push(`${label}: ${val.toLocaleString("es-CO")}`);
        return val;
      }
      return 0;
    } catch (e) { return 0; }
  };

  uvr = await leerMeta("uvr", "UVR");
  tri = await leerMeta("triages", "Triages");
  fibro = await leerMeta("fibrobroncoscopia", "Fibro");
  endo = await leerMeta("endoscopia", "Endoscopia");
  colo = await leerMeta("colonoscopia", "Colonoscopia");
  exa = await leerMeta("Examenes_ambulatorios", "examenes_ambulatorios", "examenesambulatorios"); // Asegúrate que en Firebase sea abulatorios o corregirlo a ambulatorios
  qui = await leerMeta("quimio", "Quimio");

  if (metaAnualUVR) metaAnualUVR.value = uvr;
  if (metaAnualTriages) metaAnualTriages.value = tri;
  if (metaAnualFibro) metaAnualFibro.value = fibro;
  if (document.getElementById("metaAnualEndo")) document.getElementById("metaAnualEndo").value = endo;
  if (document.getElementById("metaAnualColono")) document.getElementById("metaAnualColono").value = colo;
  if (document.getElementById("metaAnualAmb")) document.getElementById("metaAnualAmb").value = exa;
  if (metaAnualQuimio) metaAnualQuimio.value = qui;

  if (msgAnuales) msgAnuales.innerHTML = `<span class="ok">Cargadas:</span> ${msgParts.join(" | ")}`;
}
if (btnRefrescarAnuales) btnRefrescarAnuales.addEventListener("click", refrescarMetasAnuales);

if (btnGuardarAnuales) {
  btnGuardarAnuales.addEventListener("click", async () => {
    const anio = anioAnuales?.value.trim();
    if (!anio) return;

    try {
      const batch = writeBatch(db);
      // Obtenemos los valores directamente de los elementos del DOM
      const items = [
        { id: "uvr", val: Number(document.getElementById("metaAnualUVR")?.value || 0) },
        { id: "triages", val: Number(document.getElementById("metaAnualTriages")?.value || 0) },
        { id: "fibrobroncoscopia", val: Number(document.getElementById("metaAnualFibro")?.value || 0) },
        { id: "endoscopia", val: Number(document.getElementById("metaAnualEndo")?.value || 0) },
        { id: "colonoscopia", val: Number(document.getElementById("metaAnualColono")?.value || 0) },
        { id: "Examenes_ambulatorios", val: Number(document.getElementById("metaAnualAmb")?.value || 0) },
        { id: "quimio", val: Number(document.getElementById("metaAnualQuimio")?.value || 0) }
      ];

      items.forEach(item => {
        batch.set(doc(db, "config_anuales", `${item.id}_${anio}`), {
          anio: Number(anio),
          meta: item.val,
          ultimaActualizacion: serverTimestamp(),
          usuario: auth.currentUser?.email || "desconocido"
        });
      });

      await batch.commit();
      if (msgAnuales) msgAnuales.innerHTML = `<span class="ok">Guardado correctamente</span>`;
      refrescarMetasAnuales();
    } catch (e) {
      console.error(e);
      if (msgAnuales) msgAnuales.innerHTML = `<span class="err">Error al guardar</span>`;
    }
  });
}
// Cargar al iniciar
refrescarMetasAnuales();

/* inicializar UI */
await refreshDailyUI();

/* ========== LÓGICA MODAL CARGA + GRÁFICAS READONLY ========== */
function inicializarVistaSegunRol() {
  const user = window.orbitaUser || window.currentUser || window.userData;
  if (!user || (!user.role && !user.rol)) {
    setTimeout(inicializarVistaSegunRol, 500);
    return;
  }

  const rawRole = user.role || user.rol || '';
  const normalizedRol = String(rawRole)
    .toLowerCase()
    .replace(/^role_/, '')
    .replace(/_/g, ' ')
    .trim();

  const puedeCargar = normalizedRol === 'master admin' || normalizedRol === 'super admin';
  const btnAbrir = document.getElementById('btnAbrirCarga');
  const modalCarga = document.getElementById('modalCargaDatos');
  const btnCerrar = document.getElementById('cerrarModalCarga');

  if (puedeCargar) {
    if (btnAbrir) btnAbrir.style.display = 'flex';
    if (btnAbrir && modalCarga) {
      btnAbrir.addEventListener('click', () => {
        modalCarga.classList.add('is-open');
        if (window.lucide) lucide.createIcons();
      });
    }
    if (btnCerrar && modalCarga) {
      btnCerrar.addEventListener('click', () => modalCarga.classList.remove('is-open'));
    }
    if (modalCarga) {
      modalCarga.addEventListener('click', (e) => {
        if (e.target === modalCarga) modalCarga.classList.remove('is-open');
      });
    }

    const btnEnviar = document.getElementById('btnEnviarReporte');
    if (btnEnviar) {
      btnEnviar.style.display = 'flex';
      btnEnviar.addEventListener('click', async () => {
        try {
          btnEnviar.disabled = true;
          btnEnviar.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;"></i> <span>Generando...</span>';
          lucide.createIcons();

          const mes = MES_NOMBRES[mesDaily.value] || mesDaily.value;
          const anio = anioDaily.value;
          const fecha = fechaDaily.value
            ? fechaDaily.value.split('-').reverse().join('/')
            : new Date().toLocaleDateString('es-CO');

          const canvas1 = await html2canvas(document.getElementById('metasMensuales'),
            { scale: 2, backgroundColor: '#fff', useCORS: true });
          const png1 = canvas1.toDataURL('image/png');

          const canvas2 = await html2canvas(document.getElementById('tblMensual'),
            { scale: 1, backgroundColor: '#fff', useCORS: true, windowWidth: 2800 });
          const png2 = canvas2.toDataURL('image/png');

          btnEnviar.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;"></i> <span>Enviando...</span>';
          lucide.createIcons();

          const resp = await fetch('/api/email/enviar-reporte', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mes, anio, fecha, png1, png2 })
          });
          const result = await resp.json();

          if (result.status === 'ok') {
            btnEnviar.innerHTML = '<i data-lucide="check" style="width:16px;height:16px;"></i> <span>Enviado</span>';
            btnEnviar.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            setTimeout(() => {
              btnEnviar.disabled = false;
              btnEnviar.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> <span>Enviar Reporte</span>';
              btnEnviar.style.background = 'linear-gradient(135deg, #0b365a 0%, #1e4b7a 100%)';
              lucide.createIcons();
            }, 3000);
          } else {
            alert('Error al enviar: ' + result.mensaje);
            btnEnviar.disabled = false;
            btnEnviar.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> <span>Enviar Reporte</span>';
            lucide.createIcons();
          }
        } catch (e) {
          alert('Error: ' + e.message);
          const b = document.getElementById('btnEnviarReporte');
          if (b) {
            b.disabled = false;
            b.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> <span>Enviar Reporte</span>';
            lucide.createIcons();
          }
        }
      });
    }
  } else {
    if (btnAbrir) btnAbrir.style.display = 'none';
  }

  // Renderizar las 6 gráficas extra para todos
  renderGraficasReadOnly();
}

function renderGraficasReadOnly() {
  // Esperar a que haya datos en los acumulados del mes actual
  const anio = anioDaily.value, mes = mesDaily.value;
  const nDias = daysInMonth(anio, mes);

  getDocs(collection(db, "realizados", anio, mes,
    String(new Date().getDate()).padStart(2, '0'), "kpi"))
    .then(() => {
      // Leer todos los días del mes para construir las series
      const promises = [];
      const seriesData = {};
      const kpisRO = ['triages', 'urgencias', 'ocup_uci', 'ocup_uce', 'ocup_hosp',
        'piso2', 'piso3', 'piso4', 'proc_quir', 'uvr',
        'egresos_hosp', 'egresos_uci', 'egresos_uce',
        'endoscopia', 'colonoscopia', 'fibro', 'examenes_ambulatorios', 'quimio'];
      kpisRO.forEach(k => seriesData[k] = Array(nDias).fill(null));

      for (let d = 1; d <= nDias; d++) {
        const dd = String(d).padStart(2, '0');
        promises.push(
          getDocs(collection(db, "realizados", anio, mes, dd, "kpi"))
            .then(snap => {
              snap.forEach(doc => {
                const r = doc.data();
                const k = String(r.kpi || '').toLowerCase();
                if (seriesData[k] !== undefined) seriesData[k][d - 1] = Number(r.valor || 0);
              });
            })
        );
      }

      Promise.all(promises).then(() => {
        const labels = Array.from({ length: nDias }, (_, i) => String(i + 1));
        const chartOpts = (extra = {}) => ({
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10, weight: '700' }, color: '#475569' } },
            tooltip: { backgroundColor: '#1e293b' }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } },
            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } }
          },
          ...extra
        });

        // 1. Ocupación
        const ctxOc = document.getElementById('chartOcupacionRO')?.getContext('2d');
        if (ctxOc) new Chart(ctxOc, {
          type: 'line', data: {
            labels, datasets: [
              { label: '% UCI', data: seriesData['ocup_uci'], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2 },
              { label: '% UCE', data: seriesData['ocup_uce'], borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2 },
              { label: '% Hosp', data: seriesData['ocup_hosp'], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2 },
            ]
          }, options: chartOpts({ scales: { ...chartOpts().scales, y: { min: 0, max: 110, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } } } })
        });

        // 2. Realizados vs Meta (Triages y Urgencias)
        const ctxVM = document.getElementById('chartVsMetaRO')?.getContext('2d');
        if (ctxVM) new Chart(ctxVM, {
          type: 'bar', data: {
            labels, datasets: [
              { label: 'Triages', data: seriesData['triages'], backgroundColor: 'rgba(56,189,248,0.75)', borderRadius: 4, borderSkipped: false },
              { label: 'Urgencias', data: seriesData['urgencias'], backgroundColor: 'rgba(99,102,241,0.65)', borderRadius: 4, borderSkipped: false },
            ]
          }, options: chartOpts()
        });

        // 3. Egresos por piso
        const ctxEP = document.getElementById('chartEgresosPisoRO')?.getContext('2d');
        if (ctxEP) new Chart(ctxEP, {
          type: 'bar', data: {
            labels, datasets: [
              { label: 'Piso 2', data: seriesData['piso2'], backgroundColor: 'rgba(56,189,248,0.7)', borderRadius: 4, borderSkipped: false },
              { label: 'Piso 3', data: seriesData['piso3'], backgroundColor: 'rgba(99,102,241,0.65)', borderRadius: 4, borderSkipped: false },
              { label: 'Piso 4', data: seriesData['piso4'], backgroundColor: 'rgba(16,185,129,0.65)', borderRadius: 4, borderSkipped: false },
            ]
          }, options: chartOpts()
        });

        // 4. Quirúrgicos & UVR
        const ctxCx = document.getElementById('chartCirugiaRO')?.getContext('2d');
        if (ctxCx) new Chart(ctxCx, {
          type: 'bar', data: {
            labels, datasets: [
              { label: 'Proc. Quirúr.', type: 'bar', data: seriesData['proc_quir'], backgroundColor: 'rgba(56,189,248,0.7)', borderRadius: 4, yAxisID: 'y' },
              { label: 'UVR', type: 'line', data: seriesData['uvr'], borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 2, yAxisID: 'y1' },
            ]
          }, options: chartOpts({
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } },
              y: { beginAtZero: true, position: 'left', grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } },
              y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 9 }, color: '#94a3b8' }, border: { display: false } }
            }
          })
        });

        // 5. Egresos Hospitalización & UCI & UCE
        const ctxEg = document.getElementById('chartEgresosRO')?.getContext('2d');
        if (ctxEg) new Chart(ctxEg, {
          type: 'bar', data: {
            labels, datasets: [
              { label: 'Egresos Hosp.', data: seriesData['egresos_hosp'], backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, borderSkipped: false },
              { label: 'Egresos UCI', data: seriesData['egresos_uci'], backgroundColor: 'rgba(139,92,246,0.65)', borderRadius: 4, borderSkipped: false },
              { label: 'Egresos UCE', data: seriesData['egresos_uce'], backgroundColor: 'rgba(56,189,248,0.65)', borderRadius: 4, borderSkipped: false },
            ]
          }, options: chartOpts()
        });

        // 6. Procedimientos Ambulatorios
        const ctxAmb = document.getElementById('chartAmbRO')?.getContext('2d');
        if (ctxAmb) new Chart(ctxAmb, {
          type: 'bar', data: {
            labels, datasets: [
              { label: 'Endoscopias', data: seriesData['endoscopia'], backgroundColor: 'rgba(56,189,248,0.75)', borderRadius: 4, borderSkipped: false },
              { label: 'Colonoscopias', data: seriesData['colonoscopia'], backgroundColor: 'rgba(99,102,241,0.65)', borderRadius: 4, borderSkipped: false },
              { label: 'Fibro.', data: seriesData['fibro'], backgroundColor: 'rgba(245,158,11,0.65)', borderRadius: 4, borderSkipped: false },
              { label: 'Labs Amb.', data: seriesData['examenes_ambulatorios'], backgroundColor: 'rgba(16,185,129,0.55)', borderRadius: 4, borderSkipped: false },
              { label: 'Quimio', data: seriesData['quimio'], backgroundColor: 'rgba(239,68,68,0.55)', borderRadius: 4, borderSkipped: false },
            ]
          }, options: chartOpts()
        });
      });
    });
}

// Inicializar con retry por si OrbitaContext no está listo aún
setTimeout(inicializarVistaSegunRol, 600);


// Holiday helpers moved to top

// Sincronización Global de Filtros (Movida al bloque de Listeners principal)

// --- PDF Export Logic (Refined Branding & Aspect Ratio) ---
async function exportDashboardPDF() {
  try {
    const { jsPDF } = window.jspdf ? window.jspdf : await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    const pdf = new jsPDF('p', 'mm', 'a4');

    const logoUrl = "/assets/Logo_Clinica.png";
    const loadImgWhite = (url) => new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) { // If not transparent
              data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        } catch (e) { console.warn("Logo invert failed:", e); }
        resolve({ data: canvas.toDataURL("image/png"), w: img.width, h: img.height });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });

    const logoInfo = await loadImgWhite(logoUrl);
    const margin = 15;
    const navy = [37, 61, 91];

    const addHeader = (p, title) => {
      const pW = p.internal.pageSize.getWidth();
      p.setFillColor(...navy);
      p.rect(0, 0, pW, 35, 'F');
      if (logoInfo) {
        const lW = 20; const lH = (logoInfo.h * lW) / logoInfo.w;
        p.addImage(logoInfo.data, 'PNG', margin, (35 - lH) / 2, lW, lH);
      }
      p.setTextColor(255, 255, 255);
      p.setFont("helvetica", "bold");
      p.setFontSize(18);
      p.text(title, margin + 25, 20);
      p.setFontSize(10);
      p.setFont("helvetica", "normal");
      p.text(`Clínica Sagrado Corazón · ${MES_NOMBRES[mesDaily.value]} ${anioDaily.value}`, margin + 25, 27);
    };

    const addFooter = (p) => {
      const pNum = p.internal.getNumberOfPages();
      const pW = p.internal.pageSize.getWidth();
      const pH = p.internal.pageSize.getHeight();
      p.setFontSize(8);
      p.setTextColor(150, 150, 150);
      p.text(`© 2026 Orbita Clínica · Ecosistema Técnico-Científico Unificado`, margin, pH - 8);
      p.text(`Página ${pNum}`, pW - margin - 15, pH - 8);
    };

    // Page 1: Resumen
    addHeader(pdf, "REPORTE DE METAS DIARIAS");
    let currentY = 45;
    pdf.setTextColor(...navy);
    pdf.setFontSize(14);
    pdf.text("Resumen de Metas Mensuales", margin, currentY);
    currentY += 8;

    const metasSnap = await html2canvas(document.getElementById("metasMensuales"), { scale: 3 });
    const metasImg = metasSnap.toDataURL("image/png");
    if (validateImage(metasImg)) {
      const pW = pdf.internal.pageSize.getWidth();
      const mW = pW - 2 * margin;
      const mH = (metasSnap.height * mW) / metasSnap.width;
      pdf.addImage(metasImg, 'PNG', margin, currentY, mW, mH);
      currentY += mH + 10;
    }
    addFooter(pdf);

    // Page 2: Tendencias
    pdf.addPage();
    addHeader(pdf, "ANÁLISIS DE TENDENCIAS");
    currentY = 45;

    const charts = [
      { id: "chartDemanda", title: "Carga de Urgencias" },
      { id: "chartOcupacion", title: "Ocupación de Camas" },
      { id: "chartCirugia", title: "Actividad Quirúrgica" }
    ];

    for (const cObj of charts) {
      const canvas = document.getElementById(cObj.id);
      if (canvas) {
        // Use native canvas toDataURL for perfect sharpness instead of html2canvas
        const imgD = canvas.toDataURL("image/png", 1.0);
        if (validateImage(imgD)) {
          const pW = pdf.internal.pageSize.getWidth();
          const pH = pdf.internal.pageSize.getHeight();

          let cW = pW - 2 * margin;
          let cH = (canvas.height * cW) / canvas.width;

          // Prevent charts from taking too much vertical space and causing layout breaks
          if (cH > 75) {
            cH = 75;
            cW = (canvas.width * cH) / canvas.height;
          }
          const xPos = margin + ((pW - 2 * margin) - cW) / 2;

          if (currentY + cH + 15 > pH - margin) {
            addFooter(pdf);
            pdf.addPage();
            addHeader(pdf, "ANÁLISIS DE TENDENCIAS (Cont.)");
            currentY = 45;
          }
          pdf.setTextColor(...navy);
          pdf.setFontSize(11);
          pdf.text(cObj.title, margin, currentY);
          currentY += 5;

          // Fill white background for transparent charts
          pdf.setFillColor(255, 255, 255);
          pdf.rect(xPos, currentY, cW, cH, 'F');
          pdf.addImage(imgD, 'PNG', xPos, currentY, cW, cH);

          currentY += cH + 12;
        }
      }
    }
    addFooter(pdf);

    // Page 3: Detalle Mensual (FORCE LANDSCAPE)
    pdf.addPage([297, 210], "landscape");
    const lP = pdf.internal.pageSize;
    const lW = 297; // A4 landscape width mm
    const lH = 210;

    // Ensure header bar covers the full landscape width
    addHeader(pdf, "DETALLE MENSUAL CONSOLIDADO");

    const table = document.getElementById("tblMensual");
    if (table) {
      window.scrollTo(0, 0);
      const temp = document.createElement("div");
      Object.assign(temp.style, {
        position: "absolute", left: "-20000px", top: "0",
        width: "2800px", background: "white", padding: "50px"
      });

      const title = document.createElement("h1");
      title.textContent = "DETALLE MENSUAL CONSOLIDADO - " + MES_NOMBRES[mesDaily.value] + " " + anioDaily.value;
      title.style.color = "#0b365a";
      title.style.textAlign = "center";
      title.style.marginBottom = "30px";
      temp.appendChild(title);

      const clone = table.cloneNode(true);
      clone.style.fontSize = "12px";
      clone.style.width = "100%";
      clone.style.borderCollapse = "collapse";

      // Force layout stability in the clone for html2canvas
      const thead = clone.querySelector("thead");
      if (thead) thead.style.setProperty("display", "table-header-group", "important");

      clone.querySelectorAll("th, td").forEach(c => {
        c.style.setProperty("padding", "10px 8px", "important");
        c.style.setProperty("border", "1px solid #cbd5e1", "important");
        c.style.setProperty("position", "static", "important");
        c.style.setProperty("left", "auto", "important");
      });
      temp.appendChild(clone);
      document.body.appendChild(temp);

      const tSnap = await html2canvas(temp, {
        scale: 1,
        useCORS: true,
        logging: false,
        windowWidth: 2800
      });
      const tImg = tSnap.toDataURL("image/png");
      if (validateImage(tImg)) {
        const pdfW = 297;
        const pdfH = 210;
        const margin = 10;
        const targetW = pdfW - 2 * margin;
        const targetH = (tSnap.height * targetW) / tSnap.width;
        pdf.addImage(tImg, 'PNG', margin, 30, targetW, targetH);
      }
      document.body.removeChild(temp);
    }
    addFooter(pdf);

    pdf.save(`Dashboard_${MES_NOMBRES[mesDaily.value]}_${anioDaily.value}.pdf`);
  } catch (err) {
    console.error("PDF Error:", err);
    alert("Error al generar PDF.");
  }
}


if (btnPdfDashboard) {
  btnPdfDashboard.addEventListener("click", async () => {
    try {
      safeSetHTML(btnPdfDashboard, '<i data-lucide="loader" class="spin"></i> Generando...');
      lucide.createIcons();
      await exportDashboardPDF();
      safeSetHTML(btnPdfDashboard, '<i data-lucide="file-text"></i> Reporte PDF');
      lucide.createIcons();
    } catch (e) {
      console.error(e);
      alert("Error al generar PDF: " + e.message);
      safeSetHTML(btnPdfDashboard, '<i data-lucide="file-text"></i> Reporte PDF');
      lucide.createIcons();
    }
  });
}


/* ========== VISTA MENSUAL CONSOLIDADA (LÓGICA MEJORADA) ========== */

// Ya declarados al inicio del script para evitar errores de scope



// Lista de KPIs en el orden deseado para la tabla
const KPI_ORDER = [
  "ce",
  "triages", "urgencias",
  "camas_hosp", "egresos_hosp", "piso2", "piso3", "piso4", "ocup_hosp", "pde",
  "camas_uci", "egresos_uci", "ocup_uci",
  "camas_uce", "egresos_uce", "ocup_uce", "pde_critico",
  "quirofanos", "proc_quir", "uvr",
  "fibro", "endoscopia", "colonoscopia", "examenes_ambulatorios", "quimio"
];

// Etiquetas para la columna "Item a evaluar"
const KPI_NOMBRES = {
  "ce": "Consulta Externa",
  "triages": "Triages",
  "urgencias": "Atenciones Urgencias",
  "camas_hosp": "Camas Hospitalización",
  "egresos_hosp": "Egresos hospitalización",
  "piso2": "2 piso (26%)",
  "piso3": "3 piso (33%)",
  "piso4": "4 piso (41%)",
  "ocup_hosp": "% ocupacion",
  "pde": "PDE",
  "pde_critico": "PDE Cuidado crítico",
  "camas_uci": "Camas UCI",
  "egresos_uci": "Egresos UCI",
  "ocup_uci": "% ocupacion UCI",
  "camas_uce": "Camas UCE",
  "egresos_uce": "Egresos UCE",
  "ocup_uce": "% ocupacion UCE",
  "quirofanos": "No quirófanos",
  "proc_quir": "Procedimientos quirúrgicos",
  "uvr": "UVR",
  "fibro": "Fibrobroncoscopias",
  "endoscopia": "Endoscopias",
  "colonoscopia": "Colonoscopias",
  "examenes_ambulatorios": "Exámenes Ambulatorios",
  "quimio": "Quimioterapias",
};

async function cargarVistaMensual() {
  try {
    if (!tbodyMensual || !theadMensual || !msgMensual) {
      console.error("Critical: Monthly table containers missing.");
      return;
    }
    console.log("Loading Monthly View...");
    safeSetHTML(tbodyMensual, '<tr><td colspan="40" style="text-align:center; padding:40px; color:#94a3b8;"><i data-lucide="loader" class="spin"></i> Procesando registros de Firestore...</td></tr>');
    safeSetHTML(msgMensual, '<span class="loading-spinner"></span> Sincronizando datos mensuales...');
    safeSetHTML(theadMensual, "");
    lucide.createIcons();





    const anio = anioDaily.value.trim();
    const mes = mesDaily.value;

    if (!anio || !mes) {
      safeSetText(msgMensual, "Selecciona año y mes");
      return;
    }

    const nDias = daysInMonth(anio, mes);
    const dias = Array.from({ length: nDias }, (_, i) => i + 1);

    const festivosCO = getColombiaHolidays(Number(anio));
    const dayInfo = dias.map(d => {
      const dt = new Date(Date.UTC(Number(anio), Number(mes) - 1, d));
      const iso = `${anio}-${pad2b(mes)}-${pad2b(d)}`;
      const dow = dt.getUTCDay();
      const festivoName = festivosCO.get(iso) || "";
      const isWeekend = dow === 0 || dow === 6;
      return { d, iso, dow, isWeekend, isHoliday: !!festivoName, title: festivoName || DOW_FULL[dow] };
    });

    let headerHTML = `<tr>
    <th rowspan="2" style="background:#0b365a !important; color: white !important;">Item a evaluar</th>
    <th rowspan="2" style="background:#0b365a !important; color: white !important;">Meta Mensual</th>
    <th rowspan="2" style="background:#0b365a !important; color: white !important;">Meta Diaria</th>
    <th colspan="${nDias}" style="background:#0f766e !important; color: white !important;">Ejecución diaria</th>
    <th colspan="3" style="background:#064e3b !important; color: white !important;">Logro a fecha (mes)</th>
    <th colspan="2" style="background:#7c2d12 !important; color: white !important;">Proyección Cierre de mes</th>
  </tr><tr>`;

    dias.forEach((d, idx) => {
      const info = dayInfo[idx];
      const cls = info.isHoliday ? "festivo" : info.isWeekend ? "wknd" : "";
      headerHTML += `<th class="${cls}" title="${info.title}" style="min-width:30px; padding:8px 4px; background:#134e4a !important; color:white !important;">${d}</th>`;
    });

    headerHTML += `<th style="background:#065f46; color: white !important;">Logro</th>
                       <th style="background:#065f46; color: white !important;">% Cumpl</th>
                       <th style="background:#065f46; color: white !important;">Falta para la meta</th>
                       <th style="background:#9a3412; color: white !important;">Proyección</th>
                       <th style="background:#9a3412; color: white !important;">% Cumpl</th>`;

    headerHTML += `</tr>`;
    safeSetHTML(theadMensual, headerHTML);




    const dataMes = {};
    const allRows = [];
    const promises = [];
    for (let d = 1; d <= nDias; d++) {
      const dd = String(d).padStart(2, "0");
      promises.push(getDocs(collection(db, "realizados", anio, mes, dd, "kpi")).then(snap => {
        snap.forEach(doc => {
          const r = doc.data();
          // Asegurar que tenga fecha y día para las gráficas
          if (!r.fecha) r.fecha = `${anio}-${mes}-${dd}`;
          if (!r.dia) r.dia = dd;
          allRows.push(r);
          const kpiKey = (r.kpi || "").toLowerCase(); // Case-insensitive
          if (!dataMes[kpiKey]) dataMes[kpiKey] = Array(nDias).fill(0);
          dataMes[kpiKey][d - 1] = Number(r.valor || 0);
        });
      }).catch(e => console.error(`Error fetching day ${dd}:`, e)));
    }
    await Promise.all(promises);

    // Actualizar gráficas con la tendencia mensual filtrada por la fecha seleccionada
    try {
      const selDay = Number(fechaDaily.value.split("-")[2]) || nDias;
      const chartRows = allRows.filter(r => {
        const d = Number(r.dia || r.fecha?.split("-")[2] || 0);
        return d <= selDay;
      });
      renderChart(chartRows);
    } catch (e) { console.warn("Error updating charts:", e); }


    let ultimoDiaConDato = 0;
    for (let d = nDias; d >= 1; d--) {
      const dd = String(d).padStart(2, "0");
      const snap = await getDocs(collection(db, "realizados", anio, mes, dd, "kpi"));
      if (!snap.empty) { ultimoDiaConDato = d; break; }
    }
    if (ultimoDiaConDato === 0) ultimoDiaConDato = 1;

    const capSnap = await getDocs(collection(db, "forecast", anio, "unidades"));
    const capIndex = {};
    capSnap.forEach(d => {
      const idLower = d.id.trim().toLowerCase();
      capIndex[idLower] = d.data();
    });
    console.log("Forecast Units Found:", Object.keys(capIndex));

    const hospSnap = await getDocs(collection(db, "forecast_hosp", anio, "kpis"));
    const hospIndex = {};
    hospSnap.forEach(d => { hospIndex[d.id.toLowerCase()] = d.data(); });

    const mMes = (row) => Number(row?.mensual?.[mes] ?? 0);


    // --- CORRECCIÓN DE METAS ANUALES ---
    let metasAnualesMap = {};
    // Mapeo: [ID en DB] -> [ID en KPI_ORDER] al ser case-insensitive
    const dbToKpiMap = {
      "uvr": "uvr",
      "triages": "triages",
      "fibrobroncoscopia": "fibro",
      "endoscopia": "endoscopia",
      "colonoscopia": "colonoscopia",
      "examenes_ambulatorios": "examenes_ambulatorios",
      "quimio": "quimio"
    };


    for (const [dbKey, kpiKey] of Object.entries(dbToKpiMap)) {
      const snap = await getDoc(doc(db, "config_anuales", `${dbKey}_${anio}`));
      if (snap.exists()) {
        metasAnualesMap[kpiKey] = Number(snap.data().meta || 0);
      }
    }

    safeSetHTML(tbodyMensual, ""); // Limpiar el "Cargando..." antes de empezar a añadir filas
    for (const kpi of KPI_ORDER) {

      const nombre = KPI_NOMBRES[kpi] || kpi;
      const valores = dataMes[kpi] || Array(nDias).fill(0);
      const esPromedio = esKpiPromedio(kpi);
      const esInverso = (kpi === "pde" || kpi === "pde_critico");

      let metaMensual = 0;
      const kpiLower = kpi.toLowerCase();

      // 1. Especial: Exámenes Ambulatorios (Regla específica Jan-Nov=1000, Dec=500)
      if (kpi === "examenes_ambulatorios") {
        const m = Number(mes);
        metaMensual = (m <= 11) ? 1000 : 500;
      }
      // 2. Prioridad: Metas configurables (config_anuales) para otros KPIs
      else if (metasAnualesMap[kpi] !== undefined && metasAnualesMap[kpi] > 0) {
        metaMensual = metasAnualesMap[kpi] / 12;
      }
      // 2. Fallback: Metas de forecast (Búsqueda Genérica con Mapeos manuales)
      else {
        // Mapeos manuales para forecast
        const manualMap = {
          "ce": "consulta_externa",
          "egresos_hosp": "hospitalizacion",
          "egresos_uce": "ucin",
          "egresos_uci": "uci",
          "proc_quir": "cirugia"
        };
        const targetKey = manualMap[kpiLower] || kpiLower;
        let forecastDoc = capIndex[targetKey];

        if (!forecastDoc) {
          const invMap = Object.entries(dbToKpiMap).find(([dbK, kpiK]) => kpiK === kpiLower);
          if (invMap) forecastDoc = capIndex[invMap[0]];
        }

        if (forecastDoc) {
          metaMensual = mMes(forecastDoc);
        } else {
          // Casos especiales cableados
          if (kpi === "pde") metaMensual = mMes(hospIndex["dias_promedio_estancia"]);
          else if (kpi === "pde_critico") metaMensual = 5;
          else if (["piso2", "piso3", "piso4"].includes(kpi)) {
            const pct = kpi === "piso2" ? 0.26 : kpi === "piso3" ? 0.33 : 0.41;
            const hRow = capIndex["hospitalizacion"] || capIndex["egresos_hosp"];
            metaMensual = mMes(hRow) * pct;
          } else if (esPromedio) {
            const constDiarias = { camas_hosp: 83, camas_uci: 12, camas_uce: 9, ocup_hosp: 98, ocup_uci: 100, ocup_uce: 100, quirofanos: 5 };
            metaMensual = constDiarias[kpi] || 0;
          }
        }
      }

      const metaDiaria = esPromedio ? metaMensual : (metaMensual / nDias);

      let diasConDatos = 0;
      for (let i = nDias - 1; i >= 0; i--) { if (valores[i] > 0) { diasConDatos = i + 1; break; } }
      if (diasConDatos === 0) diasConDatos = ultimoDiaConDato || 1;

      const vSuma = valores.slice(0, diasConDatos).reduce((a, b) => a + b, 0);
      const logroAFecha = esPromedio ? (vSuma / (valores.slice(0, diasConDatos).filter(v => v > 0).length || 1)) : vSuma;

      let rowHTML = `<tr>
      <td style="text-align:left !important;"><b>${nombre}</b></td>
      <td style="background:#f8fafc;">${Math.round(metaMensual).toLocaleString()}</td>
      <td style="background:#f0f9ff; font-weight:bold; color:#0369a1;">${metaDiaria.toFixed(1)}</td>`;

      valores.forEach((v, idx) => {
        const d = idx + 1;
        let cellClass = "";
        if (d <= ultimoDiaConDato) {
          if (v === 0) { cellClass = "err"; }
          else {
            if (esInverso) {
              cellClass = v <= metaDiaria ? "ok" : v <= metaDiaria * 1.1 ? "warn" : "err";
            } else {
              cellClass = v >= metaDiaria ? "ok" : v >= metaDiaria * 0.9 ? "warn" : "err";
            }
          }
        }
        rowHTML += `<td class="${cellClass}">${esPromedio ? (v ? v.toFixed(1) : "") : (v || "")}</td>`;
      });

      const pctCumpl = metaMensual > 0 ? (esInverso ? (metaMensual / logroAFecha) * 100 : (logroAFecha / metaMensual) * 100) : 0;
      const faltante = esInverso ? 0 : (metaMensual - logroAFecha);
      const proy = esPromedio ? logroAFecha : (logroAFecha / diasConDatos) * nDias;
      const pctProy = metaMensual > 0 ? (esInverso ? (metaMensual / proy) * 100 : (proy / metaMensual) * 100) : 0;

      rowHTML += `<td class="ok" style="background:#ecfdf5 !important; font-weight:800;">${esPromedio ? Number(logroAFecha).toFixed(1) : Math.round(logroAFecha).toLocaleString()}</td>
      <td class="ok" style="background:#ecfdf5 !important">${pctCumpl.toFixed(1)}%</td>
      <td style="background:#f0fdfa; color:#0d9488; font-weight:700">${esPromedio ? "-" : (faltante > 0 ? Math.round(faltante).toLocaleString() : "CUMPLIDA")}</td>
      <td class="warn" style="background:#fffbeb !important; font-weight:800;">${esPromedio ? Number(proy).toFixed(1) : Math.round(proy).toLocaleString()}</td>
      <td class="warn" style="background:#fffbeb !important">${pctProy.toFixed(1)}%</td>`;

      rowHTML += `</tr>`;
      if (tbodyMensual) tbodyMensual.innerHTML += rowHTML;
    }
    safeSetHTML(msgMensual, `<span class="ok">Vista mensual cargada: ${MES_NOMBRES[mes]} ${anio}</span>`);
    lucide.createIcons();
  } catch (err) {
    console.error("Error in cargarVistaMensual:", err);
    safeSetHTML(msgMensual, `<span style="color:#ef4444">Error al cargar datos: ${err.message}</span>`);
    safeSetHTML(tbodyMensual, `<tr><td colspan="40" style="text-align:center; padding:40px; color:#ef4444;">Error de sincronización: ${err.message}</td></tr>`);
  }
}


btnCargarMensual.addEventListener("click", cargarVistaMensual);
// ✅ Note: Listeners for anioDaily/mesDaily are already in the DOMContentLoaded block

// Exportación a Excel
btnExportExcelMensual.addEventListener("click", () => {
  const table = document.getElementById("tblMensual");
  if (!table || table.rows.length < 2) {
    alert("No hay datos para exportar.");
    return;
  }
  // table_to_sheet respeta colspans y rowspans del DOM
  const ws = XLSX.utils.table_to_sheet(table, { raw: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mensual");
  XLSX.writeFile(wb, `vista_mensual_${anioDaily.value}-${mesDaily.value}.xlsx`);

});

// Exportación a PNG (Imagen - Diseño mejorado con Columnas Reordenadas)
btnExportPngMensual.addEventListener("click", async () => {
  if (typeof html2canvas === "undefined") {
    alert("Error: html2canvas no está cargado.");
    return;
  }
  msgMensual.textContent = "Generando imagen...";
  const table = document.querySelector("#tblMensual");
  if (!table || table.rows.length === 0) {
    msgMensual.textContent = "No hay datos en la tabla.";
    return;
  }

  const container = document.createElement("div");
  container.style.padding = "50px";
  container.style.background = "#f1f5f9";
  container.style.display = "inline-block";
  container.style.minWidth = "2800px";

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#fff",
    padding: "40px",
    borderRadius: "20px",
    boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "30px",
    borderBottom: "3px solid #0b365a",
    paddingBottom: "20px"
  });

  const titlePart = document.createElement("div");
  titlePart.innerHTML = `<h1 style="color:#0b365a; margin:0; font-size:36px; font-weight:800;">DETALLE MENSUAL CONSOLIDADO</h1>
                             <p style="color:#64748b; margin:5px 0 0; font-size:20px;">Clínica Sagrado Corazón - ${MES_NOMBRES[mesDaily.value]} ${anioDaily.value}</p>`;

  const logoImg = document.createElement("img");
  logoImg.src = "/assets/Logo_Clinica.png";
  logoImg.style.height = "70px";

  header.appendChild(titlePart);
  header.appendChild(logoImg);
  card.appendChild(header);

  const clone = table.cloneNode(true);
  clone.style.background = "#fff";
  clone.style.fontSize = "14px";
  clone.style.borderCollapse = "collapse";
  clone.style.width = "100%";

  // Critical fix: Ensure headers render at the top by forcing table-header-group
  const thead = clone.querySelector("thead");
  if (thead) thead.style.setProperty("display", "table-header-group", "important");

  clone.querySelectorAll("td, th").forEach(cell => {
    cell.style.setProperty("position", "static", "important");
    cell.style.setProperty("left", "auto", "important");
    cell.style.setProperty("padding", "12px 10px", "important");
    cell.style.setProperty("border", "1px solid #cbd5e1", "important");
    cell.style.setProperty("box-shadow", "none", "important");

    // Preservar colores de semáforo en el clon (con !important para ganarle al CSS base)
    if (cell.classList.contains("ok")) {
      cell.style.setProperty("background-color", "#ecfdf5", "important");
      cell.style.setProperty("color", "#065f46", "important");
    }
    else if (cell.classList.contains("warn")) {
      cell.style.setProperty("background-color", "#fffbeb", "important");
      cell.style.setProperty("color", "#92400e", "important");
    }
    else if (cell.classList.contains("err")) {
      cell.style.setProperty("background-color", "#fef2f2", "important");
      cell.style.setProperty("color", "#991b1b", "important");
    }
    if (cell.classList.contains("wknd")) {
      cell.style.setProperty("background-color", "#dde3ea", "important");
      cell.style.setProperty("color", "#374151", "important");
    }
    if (cell.classList.contains("festivo")) {
      cell.style.setProperty("background-color", "#fde8c8", "important");
      cell.style.setProperty("color", "#92400e", "important");
    }
  });

  card.appendChild(clone);
  container.appendChild(card);

  container.style.position = "absolute";
  container.style.left = "-30000px";
  container.style.top = "0";
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 1,
      useCORS: true,
      logging: false,
      backgroundColor: "#f1f5f9",
      windowWidth: 2800
    });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `vista_mensual_${anioDaily.value}-${mesDaily.value}.png`;
    a.click();
    msgMensual.innerHTML = `<span class="ok">PNG exportado con éxito</span>`;
  } catch (e) {
    console.error(e);
    msgMensual.textContent = "Error al generar PNG.";
  } finally {
    document.body.removeChild(container);
  }
});

/* ========== ALERTA DATOS PENDIENTES ========== */
async function verificarDatosPendientes() {
  try {
    const ahora = new Date();
    const horaActual = ahora.getHours() + ahora.getMinutes() / 60;
    const diaSemanaHoy = ahora.getDay(); // 0=Dom, 6=Sab

    // Solo verificar lunes a viernes
    if (diaSemanaHoy === 0 || diaSemanaHoy === 6) return;

    // Solo mostrar alerta a partir de las 12:00
    if (horaActual < 12) return;

    // Calcular el día hábil anterior
    const festivos = getColombiaHolidays(ahora.getFullYear());

    function diaHabilAnterior(fecha) {
      let d = new Date(fecha);
      do {
        d.setDate(d.getDate() - 1);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dow = d.getDay();
        const esFestivo = festivos.has(iso);
        if (dow !== 0 && dow !== 6 && !esFestivo) return d;
      } while (true);
    }

    const diaObjetivo = diaHabilAnterior(ahora);
    const anioObj = String(diaObjetivo.getFullYear());
    const mesObj = String(diaObjetivo.getMonth() + 1).padStart(2, '0');
    const diaObj = String(diaObjetivo.getDate()).padStart(2, '0');
    const fechaObjISO = `${anioObj}-${mesObj}-${diaObj}`;

    // Verificar si hay datos en Firestore para ese día
    const snap = await getDocs(collection(db, "realizados", anioObj, mesObj, diaObj, "kpi"));
    const tieneDatos = !snap.empty;

    const contenedor = document.getElementById("alertaDatosPendientes");
    if (!contenedor) return;

    // Nombre del día objetivo
    const nombresDia = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const nombreMes = MES_NOMBRES[mesObj] || mesObj;
    const nombreDia = nombresDia[diaObjetivo.getDay()];

    if (tieneDatos) {
      contenedor.style.display = "block";
      contenedor.innerHTML = `
            <div style="
              display:flex; align-items:center; gap:14px;
              background: #ecfdf5;
              border-left: 5px solid #10b981;
              padding: 13px 40px;
              font-size: 13px; font-weight: 700; color: #065f46;
              font-family: inherit;
            ">
              <div style="width:9px; height:9px; border-radius:50%; background:#10b981;
                box-shadow:0 0 0 3px rgba(16,185,129,0.2); flex-shrink:0;
                animation: alertaPunto 2s ease-in-out infinite;"></div>
              <span style="font-weight:600; color:#065f46;">
                Datos del <strong style="font-weight:800;">${nombreDia} ${diaObj} de ${nombreMes}</strong>
                cargados correctamente en la plataforma.
              </span>
              <button onclick="this.parentElement.parentElement.style.display='none'"
                style="margin-left:auto; background:none; border:none; cursor:pointer;
                color:#10b981; font-size:18px; line-height:1; padding:0 4px; font-weight:300;">×</button>
            </div>`;
    } else {
      contenedor.style.display = "block";
      contenedor.innerHTML = `
            <div style="
              display:flex; align-items:center; gap:14px;
              background: #fef2f2;
              border-left: 5px solid #ef4444;
              padding: 13px 40px;
              font-size: 13px; font-weight: 600; color: #991b1b;
              font-family: inherit;
              animation: alertaPendiente 2s ease-in-out infinite;
            ">
              <div style="width:9px; height:9px; border-radius:50%; background:#ef4444;
                box-shadow:0 0 0 3px rgba(239,68,68,0.2); flex-shrink:0;
                animation: alertaPunto 1s ease-in-out infinite;"></div>
              <span>
                <strong style="font-weight:800;">Datos pendientes:</strong>
                No se han registrado los realizados del
                <strong style="font-weight:800;">${nombreDia} ${diaObj} de ${nombreMes}</strong>.
                Por favor cárguelos a la brevedad.
              </span>
              <button onclick="this.parentElement.parentElement.style.display='none'"
                style="margin-left:auto; background:none; border:none; cursor:pointer;
                color:#ef4444; font-size:18px; line-height:1; padding:0 4px; font-weight:300;">×</button>
            </div>`;
    }
  } catch (e) {
    console.warn("Error verificando datos pendientes:", e);
  }
}

/* ---------- Auth ---------- */
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "/"; return; }

  [btnDesbloquear, btnBloquear, btnGuardarTodo, btnGenerarMetas, btnPreviewXLSX,
    btnGuardarDesdeModal, btnGuardarReal, btnBuscarHist, btnExcelHist, btnPdfHist]
    .forEach(b => { if (b) b.removeAttribute("disabled"); });

  if (!fechaDaily.dataset.initialized) {
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    const y = ayer.getFullYear(),
      m = String(ayer.getMonth() + 1).padStart(2, '0'),
      d = String(ayer.getDate()).padStart(2, '0');
    anioDaily.value = y; mesDaily.value = m; fechaDaily.value = `${y}-${m}-${d}`;
    fechaDaily.dataset.initialized = 'true';
  }

  refrescaEstado().catch(() => { });
  verificarDatosPendientes().catch(() => { });

  Promise.all([refreshDailyUI(), cargarVistaMensual()])
    .catch(e => console.warn("Background load error:", e));
});

window.openForecastModal = function () {
  const modal = document.getElementById("forecastModal");
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
};

window.closeForecastModal = function () {
  const modal = document.getElementById("forecastModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
};

document.addEventListener("DOMContentLoaded", () => {
  // Asegurar que lucide renderiza el botón reubicado
  if (window.lucide) lucide.createIcons();
  const close1 = document.getElementById("closeForecast");
  const close2 = document.getElementById("closeForecast2");
  const modal = document.getElementById("forecastModal");

  close1 && close1.addEventListener("click", closeForecastModal);
  close2 && close2.addEventListener("click", closeForecastModal);

  modal && modal.addEventListener("click", (e) => {
    if (e.target === modal) closeForecastModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeForecastModal();
  });

  window.abrirAnalisisIA = async function () {
    const aiModal = document.getElementById("aiModal");
    const aiContent = document.getElementById("aiContent");
    if (!aiModal || !aiContent) { alert("Modal no encontrado"); return; }

    aiModal.classList.add("is-open");
    aiContent.innerHTML = `
    <div class="ai-loading">
      <i data-lucide="loader-2" class="spin" style="width:40px;height:40px;color:#3b82f6"></i>
      <div style="width:100%">
        <div class="ai-shimmer"></div>
        <div class="ai-shimmer" style="width:80%"></div>
        <div class="ai-shimmer" style="width:90%"></div>
      </div>
      <p style="font-weight:600;color:#64748b">Recopilando datos y consultando a Gemini...</p>
    </div>`;
    if (window.lucide) lucide.createIcons();

    let statsData = "";
    document.querySelectorAll(".metas-grid > div").forEach(card => {
      const allText = card.innerText.split("\n").map(t => t.trim()).filter(Boolean);
      if (allText.length >= 2) statsData += `${allText[0]} | ${allText.slice(1).join(" ")}\n`;
    });
    const tbl = document.getElementById("tblMensual");
    if (tbl) {
      statsData += "\n--- VISTA MENSUAL ---\n";
      tbl.querySelectorAll("tbody tr").forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 10)
          statsData += `${cells[0].innerText.trim()} | Meta: ${cells[1].innerText.trim()} | Logro: ${cells[cells.length - 5].innerText.trim()} | %: ${cells[cells.length - 4].innerText.trim()}\n`;
      });
    }
    if (!statsData.trim()) {
      aiContent.innerHTML = "<p style='color:#ef4444;padding:20px'>Carga los datos antes de analizar.</p>";
      return;
    }

    const mesEl = document.getElementById("mesDaily");
    const mes = mesEl ? mesEl.options[mesEl.selectedIndex].text : "";
    const anio = document.getElementById("anioDaily")?.value || "";

    try {
      const resp = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: mes, year: anio, stats: statsData,
          systemPrompt: "Eres analista clínico experto de la Clínica Sagrado Corazón. Analiza los datos. Usa ## para títulos, ### para secciones, 🔴🟡🟢 para KPIs. No inventes datos. Sé ejecutivo y profesional."
        })
      });
      if (resp.ok) {
        const result = await resp.json();
        const raw = result.candidates[0].content.parts[0].text;
        const html = raw
          .replace(/^### (.*$)/gm, '<h3 style="color:#1e293b;margin-top:1.2rem">$1</h3>')
          .replace(/^## (.*$)/gm, '<h2 style="color:#0b365a;border-bottom:2px solid #e2e8f0;padding-bottom:8px">$1</h2>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/---/g, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">')
          .replace(/^([🔴🟡🟢].*)$/gm, '<div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:10px 14px;margin:8px 0;border-radius:0 8px 8px 0">$1</div>')
          .replace(/\n\n/g, '<br>');
        aiContent.innerHTML = `<div class="ai-response-content" style="padding:8px">${html}</div>`;
      } else {
        aiContent.innerHTML = `<p style="color:#ef4444;padding:20px">Error: ${await resp.text()}</p>`;
      }
    } catch (err) {
      aiContent.innerHTML = `<p style="color:#ef4444;padding:20px">Error de red: ${err.message}</p>`;
    }
    if (window.lucide) lucide.createIcons();
  };

  // Copiar análisis
  const btnCopy = document.getElementById("btnCopyAi");
  if (btnCopy) {
    btnCopy.onclick = async () => {
      const text = document.getElementById("aiContent")?.innerText || "";
      try {
        await navigator.clipboard.writeText(text);
        btnCopy.textContent = "Copiado";
        setTimeout(() => {
          btnCopy.innerHTML = '<i data-lucide="copy" style="width:18px;height:18px;margin-right:8px"></i>Copiar Análisis';
          if (window.lucide) lucide.createIcons();
        }, 2000);
      } catch (e) { alert("No se pudo copiar"); }
    };
  }
});

/* =================== NÚCLEO DE INTELIGENCIA Y PROYECCIONES DIARIAS =================== */

async function runInteligenciaDiaria() {
  console.log("Iniciando motor de inteligencia gerencial diaria...");
  const intelContainer = document.getElementById('intel-container');
  const intelDateBadge = document.getElementById('intel-date-badge');
  const intelRanking = document.getElementById('intel-ranking');
  const intelAlerts = document.getElementById('intel-alerts');
  const intelPerfMatrix = document.getElementById('intel-perf-matrix');

  if (!intelContainer) return;

  const anio = document.getElementById('anioDaily').value;
  const mes = document.getElementById('mesDaily').value;
  const fechaActual = document.getElementById('fechaDaily').value; // yyyy-mm-dd

  if (!fechaActual) {
    intelContainer.innerHTML = "<p style='padding:40px; text-align:center;'>Seleccione una fecha para activar el análisis.</p>";
    return;
  }

  const [y, m, d] = fechaActual.split("-").map(Number);
  const mPad = String(m).padStart(2, '0');
  const dPad = String(d).padStart(2, '0');
  const mesNombre = MES_NOMBRES[mPad];

  if (intelDateBadge) intelDateBadge.textContent = `${dPad} ${mesNombre} ${y}`;

  // 1. Definición de Indicadores Estratégicos (Métrica extendida para alertas/ranking)
  const indicators = [
    { label: "Triages", id: "triages", unit: "pac", metaKey: "triages" },
    { label: "Urgencias", id: "urgencias", unit: "atenc", metaKey: "urgencias" },
    { label: "Proc. Quirúrgicos", id: "proc_quir", unit: "proc", metaKey: "proc_quir" },
    { label: "Producción UVR", id: "uvr", unit: "UVR", metaKey: "uvr" },
    { label: "Egresos Hosp.", id: "egresos_hosp", unit: "egr", metaKey: "egresos_hosp" },
    { label: "Ocupación Hosp.", id: "ocup_hosp", unit: "%", isPct: true, metaKey: "ocup_hosp", target: 98 },
    { label: "Egresos UCI", id: "egresos_uci", unit: "egr", metaKey: "egresos_uci" },
    { label: "Ocupación UCI", id: "ocup_uci", unit: "%", isPct: true, metaKey: "ocup_uci", target: 90 },
    { label: "Egresos UCE", id: "egresos_uce", unit: "egr", metaKey: "egresos_uce" },
    { label: "Ocupación UCE", id: "ocup_uce", unit: "%", isPct: true, metaKey: "ocup_uce", target: 90 },
    { label: "Consulta Ext.", id: "ce", unit: "cons", metaKey: "consulta_externa" },
    { label: "Quimioterapias", id: "quimio", unit: "ses", metaKey: "quimio" },
    { label: "Prom. Estancia", id: "pde", unit: "días", metaKey: "pde", target: 3.5 }
  ];

  // Whitelist para el Monitor de Desempeño Predictivo (#intel-container)
  const MONITOR_KPI_IDS = ["triages", "urgencias", "egresos_hosp", "egresos_uci", "egresos_uce", "proc_quir", "uvr", "ce"];

  try {
    // 2. Recopilación de Datos (Mes actual completo hasta hoy)
    const daysInCurrentMonth = daysInMonth(y, m);
    const dailyData = {}; // dia -> { kpi: val }
    const promises = [];

    // Traemos datos de todo el mes hasta el día seleccionado
    for (let i = 1; i <= d; i++) {
      const diStr = String(i).padStart(2, '0');
      promises.push(
        getDocs(collection(db, "realizados", String(y), mPad, diStr, "kpi")).then(snap => {
          dailyData[i] = {};
          snap.forEach(doc => {
            dailyData[i][doc.id] = Number(doc.data().valor || 0);
          });
        })
      );
    }

    // Traemos datos del mismo día la semana pasada (WoW)
    const dWeekAgo = new Date(y, m - 1, d - 7);
    const yW = dWeekAgo.getFullYear();
    const mW = String(dWeekAgo.getMonth() + 1).padStart(2, '0');
    const dW = String(dWeekAgo.getDate()).padStart(2, '0');
    let dataWeekAgo = {};
    promises.push(
      getDocs(collection(db, "realizados", String(yW), mW, dW, "kpi")).then(snap => {
        snap.forEach(doc => dataWeekAgo[doc.id] = Number(doc.data().valor || 0));
      })
    );

    // [NUEVO] Carga de índices de forecast para metas mensuales específicas
    const capSnap = await getDocs(collection(db, "forecast", String(y), "unidades"));
    const capIndex = Object.fromEntries(capSnap.docs.map(d => [d.id.toLowerCase(), d.data()]));
    const hospSnap = await getDocs(collection(db, "forecast_hosp", String(y), "kpis"));
    const hospIndex = Object.fromEntries(hospSnap.docs.map(d => [d.id, d.data()]));
    const mMes = (row) => Number(row?.mensual?.[mPad] ?? 0);

    // Metas Anuales (config_anuales) para el resto
    const metaValues = {};
    const metaPromises = indicators.map(async ind => {
      const snap = await getDoc(doc(db, "config_anuales", `${ind.metaKey}_${y}`));
      if (snap.exists()) metaValues[ind.id] = Number(snap.data().meta || 0);
      else metaValues[ind.id] = ind.target || 0;
    });

    await Promise.all([...promises, ...metaPromises]);

    function resolveMetaMensual(ind) {
      const annual = Number(metaValues[ind.id] || 0);

      if (ind.id === "ce") return mMes(capIndex["consulta_externa"]);
      if (ind.id === "urgencias") return mMes(capIndex["urgencias"]);
      if (ind.id === "proc_quir") return mMes(capIndex["cirugia"]);
      if (ind.id === "egresos_hosp") return mMes(capIndex["hospitalizacion"]);
      if (ind.id === "egresos_uci") return mMes(capIndex["uci"]);
      if (ind.id === "egresos_uce") return mMes(capIndex["ucin"]);
      if (ind.id === "pde") return mMes(hospIndex["dias_promedio_estancia"]);

      if (ind.id === "ocup_hosp") return ind.target || 98;
      if (ind.id === "ocup_uci") return ind.target || 90;
      if (ind.id === "ocup_uce") return ind.target || 90;

      if (annual > 0) return annual / 12;
      return ind.target || 0;
    }

    // 3. Procesamiento Analítico
    let htmlTiles = "";
    let htmlMatrix = "";
    const alerts = [];
    const ranking = [];

    indicators.forEach(ind => {
      const valHoy = (dailyData[d] && dailyData[d][ind.id]) || 0;
      const valAyer = d > 1 ? (dailyData[d - 1] && dailyData[d - 1][ind.id] || 0) : 0;
      const valWow = dataWeekAgo[ind.id] || 0;

      // Variaciones
      const deltaDoD = valAyer > 0 ? ((valHoy - valAyer) * 100 / valAyer) : 0;
      const deltaWoW = valWow > 0 ? ((valHoy - valWow) * 100 / valWow) : 0;

      // month so far
      let sumSoFar = 0;
      let countSoFar = 0;
      for (let i = 1; i <= d; i++) {
        if (dailyData[i] && dailyData[i][ind.id] != null) {
          sumSoFar += dailyData[i][ind.id];
          countSoFar++;
        }
      }

      const isProm = esKpiPromedio(ind.id);
      const avgSoFar = countSoFar > 0 ? (sumSoFar / countSoFar) : 0;

      let metaMensual = resolveMetaMensual(ind);

      // Proyección al cierre del mes
      const proyectadoMes = isProm ? avgSoFar : (avgSoFar * daysInCurrentMonth);
      const pctCumplimiento = metaMensual > 0 ? (proyectadoMes * 100 / metaMensual) : 0;

      console.log("RIESGO KPI", ind.id, { metaMensual, proyectadoMes, pctCumplimiento });

      // Estado
      let status = "Estable";
      let color = "var(--ok)";
      const inv = isInverseKPI(ind.id);

      if (inv) {
        if (pctCumplimiento > 110) { status = "Crítico"; color = "var(--err)"; }
        else if (pctCumplimiento > 105) { status = "Riesgo"; color = "#f97316"; }
      } else {
        if (pctCumplimiento < 85) { status = "Crítico"; color = "var(--err)"; }
        else if (pctCumplimiento < 95) { status = "Riesgo"; color = "#f97316"; }
      }

      if (status === "Crítico" || status === "Riesgo") {
        alerts.push({
          type: status === "Crítico" ? "err" : "warn",
          text: `<strong>${ind.label}</strong>: Desviación detectada. Proyección a cierre de mes: <strong>${pctCumplimiento.toFixed(1)}%</strong>.`
        });
      }

      ranking.push({ label: ind.label, pct: pctCumplimiento });

      // [FILTRO] Render Tiles SOLO para whitelisted Monitor de Desempeño Predictivo
      if (MONITOR_KPI_IDS.includes(ind.id)) {
        htmlTiles += `
                <div class="intel-card" style="background:#fff; border-radius:20px; padding:24px; border:1px solid #e2e8f0; border-left:6px solid ${color}; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); transition:all 0.2s ease;">
                    <div class="intel-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:15px;">
                        <div class="intel-title" style="font-weight:900; color:#1e293b; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:8px;">
                           <i data-lucide="activity" style="width:16px; height:16px; color:${color}"></i> ${ind.label}
                        </div>
                        <div class="badge-intel" style="background:${color}15; color:${color}; border:1px solid ${color}30; padding:4px 10px; border-radius:8px; font-size:10px; font-weight:900;">${status.toUpperCase()}</div>
                    </div>
                    <div style="font-size: 2.2rem; font-weight: 1000; color: #0f172a; line-height:1; margin-bottom: 8px; letter-spacing:-1px;">
                        ${ind.isPct ? valHoy.toFixed(1) : valHoy.toLocaleString()}<span style="font-size:0.9rem; opacity:0.5; font-weight:800; margin-left:8px; letter-spacing:0;">${ind.unit} hoy</span>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px;">
                       <div class="proy-container" style="flex:1; height:8px; background:#f1f5f9; border-radius:10px; overflow:hidden;">
                          <div class="proy-bar" style="width:${Math.min(100, pctCumplimiento)}%; height:100%; background:${color}; border-radius:10px;"></div>
                       </div>
                       <div style="font-weight:900; font-size:12px; color:${color}">${pctCumplimiento.toFixed(0)}%</div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f8fafc; padding:12px; border-radius:12px; border:1px solid #f1f5f9;">
                        <div style="font-size:0.7rem;"><span style="display:block; color:#94a3b8; font-weight:800; text-transform:uppercase; margin-bottom:2px;">Cierre Mes</span><span style="font-weight:900; color:#1e293b; font-size:0.95rem;">${ind.isPct ? proyectadoMes.toFixed(1) : Math.round(proyectadoMes).toLocaleString()}</span></div>
                        <div style="font-size:0.7rem; text-align:right;"><span style="display:block; color:#94a3b8; font-weight:800; text-transform:uppercase; margin-bottom:2px;">Variación</span><span style="font-weight:900; color:${deltaDoD >= 0 ? (inv ? '#ef4444' : '#10b981') : (inv ? '#10b981' : '#ef4444')}; font-size:0.95rem;">${deltaDoD >= 0 ? '+' : ''}${deltaDoD.toFixed(1)}%</span></div>
                    </div>
                </div>`;
      }

      // Render Matrix Row (Scorecard completo)
      htmlMatrix += `
                <div style="display:grid; grid-template-columns: 120px 1fr; gap:15px; align-items:center; padding:12px 0; border-bottom:1px solid #f1f5f9;">
                    <div style="font-weight:900; font-size:0.8rem; color:#475569; line-height:1.2; text-transform:uppercase;">${ind.label}</div>
                    <div class="perf-matrix" style="display:flex; gap:10px;">
                        <div class="perf-cell" style="flex:1; background:#f8fafc; border:1px solid #f1f5f9; padding:6px 10px; border-radius:10px; display:flex; flex-direction:column; align-items:center;">
                           <span class="p-label" style="font-size:9px; color:#94a3b8; font-weight:800; text-transform:uppercase;">Cumpl.</span>
                           <span class="p-val" style="color:${color}; font-weight:900; font-size:13px;">${pctCumplimiento.toFixed(0)}%</span>
                        </div>
                        <div class="perf-cell" style="flex:1; background:#f8fafc; border:1px solid #f1f5f9; padding:6px 10px; border-radius:10px; display:flex; flex-direction:column; align-items:center;">
                           <span class="p-label" style="font-size:9px; color:#94a3b8; font-weight:800; text-transform:uppercase;">vs Ayer</span>
                           <span class="p-val" style="color:${deltaDoD >= 0 ? (inv ? '#ef4444' : '#10b981') : (inv ? '#10b981' : '#ef4444')}; font-weight:900; font-size:13px;">${deltaDoD >= 0 ? '↑' : '↓'} ${Math.abs(deltaDoD).toFixed(0)}%</span>
                        </div>
                        <div class="perf-cell" style="flex:1; background:#f8fafc; border:1px solid #f1f5f9; padding:6px 10px; border-radius:10px; display:flex; flex-direction:column; align-items:center;">
                           <span class="p-label" style="font-size:9px; color:#94a3b8; font-weight:800; text-transform:uppercase;">WoW</span>
                           <span class="p-val" style="color:${deltaWoW >= 0 ? (inv ? '#ef4444' : '#10b981') : (inv ? '#10b981' : '#ef4444')}; font-weight:900; font-size:13px;">${deltaWoW >= 0 ? '↑' : '↓'} ${Math.abs(deltaWoW).toFixed(0)}%</span>
                        </div>
                    </div>
                </div>`;
    });

    intelContainer.innerHTML = htmlTiles;
    if (intelPerfMatrix) intelPerfMatrix.innerHTML = htmlMatrix;

    // 4. Render Alertas
    if (intelAlerts) {
      if (alerts.length === 0) {
        intelAlerts.innerHTML = `
                    <div class="alert-item" style="border-left:5px solid #10b981; color:#065f46; background:#f0fdf4; padding:20px; border-radius:16px; display:flex; align-items:center; gap:15px;">
                       <i data-lucide="check-circle" style="color:#10b981; width:32px; height:32px;"></i>
                       <div>
                          <strong style="font-size:1rem; display:block;">Metas bajo control</strong>
                          <p style="margin:2px 0 0 0; font-size:0.85rem; font-weight:600; opacity:0.8;">El ritmo operativo actual es coherente con los objetivos estratégicos establecidos para el mes.</p>
                       </div>
                    </div>`;
      } else {
        intelAlerts.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:10px;">
                       ${alerts.map(a => `
                          <div class="alert-item" style="border-left:5px solid ${a.type === 'err' ? '#ef4444' : '#f59e0b'}; color:${a.type === 'err' ? '#991b1b' : '#92400e'}; background:${a.type === 'err' ? '#fef2f2' : '#fffbeb'}; padding:15px; border-radius:12px; display:flex; align-items:center; gap:12px; font-size:0.85rem; font-weight:700;">
                             <i data-lucide="${a.type === 'err' ? 'alert-octagon' : 'alert-triangle'}" style="width:20px; height:20px;"></i>
                             <span>${a.text}</span>
                          </div>`).join('')}
                    </div>`;
      }
    }

    // 5. Render Ranking
    if (intelRanking) {
      const sorted = [...ranking].sort((a, b) => b.pct - a.pct);
      intelRanking.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:8px;">
                   ${sorted.map((r, i) => `
                      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-radius:12px; background:${i < 2 ? '#ecfdf5' : '#f8fafc'}; border:1px solid ${i < 2 ? '#10b98133' : '#f1f5f9'}">
                          <div style="display:flex; align-items:center; gap:12px">
                              <span style="background:#1e293b; color:white; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:100%; font-size:0.75rem; font-weight:900;">${i + 1}</span>
                              <span style="font-weight:800; font-size:0.85rem; color:#1e293b;">${r.label}</span>
                          </div>
                          <span style="font-weight:1000; font-size:0.95rem; color:${i < 2 ? '#059669' : '#1e40af'};">${r.pct.toFixed(1)}%</span>
                      </div>`).join('')}
                </div>`;
    }

    // 6. Chart Tendencia
    const ctxTrend = document.getElementById('chart-intel-trend');
    if (ctxTrend) {
      if (window._intelChart) window._intelChart.destroy();
      const tLabels = Array.from({ length: d }, (_, i) => String(i + 1));
      const tValues = Array.from({ length: d }, (_, i) => (dailyData[i + 1] && dailyData[i + 1].urgencias) || 0);
      window._intelChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
          labels: tLabels,
          datasets: [{
            label: 'Atenciones Urgencias',
            data: tValues,
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79, 70, 229, 0.1)',
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#4f46e5',
            pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              padding: 12,
              titleFont: { size: 14, weight: 'bold' },
              bodyFont: { size: 13 },
              displayColors: false
            }
          },
          scales: {
            y: {
              beginAtZero: false,
              grid: { color: 'rgba(0,0,0,0.04)', borderDash: [5, 5] },
              ticks: { font: { weight: '600' }, color: '#94a3b8' }
            },
            x: {
              grid: { display: false },
              title: { display: true, text: 'DÍA DEL MES', font: { size: 10, weight: '900' }, color: '#94a3b8' },
              ticks: { font: { weight: '600' }, color: '#94a3b8' }
            }
          }
        }
      });
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (err) {
    console.error("Error en runInteligenciaDiaria:", err);
    intelContainer.innerHTML = "<p style='color:red; padding:20px;'>⚠️ Error al procesar inteligencia analítica.</p>";
  }
}

// Hook al cambio de fecha y al refrescar
if (typeof fechaDaily !== 'undefined' && fechaDaily) fechaDaily.addEventListener("change", runInteligenciaDiaria);
if (typeof btnRefrescar !== 'undefined' && btnRefrescar) btnRefrescar.addEventListener("click", runInteligenciaDiaria);

// Llamada inicial después de que firebase cargue (o al final del script)
setTimeout(runInteligenciaDiaria, 2000);
