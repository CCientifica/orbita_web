// Acumulado_mensual.js - Integración con Firebase Shim (v10.13.2)
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";

// Acceso robusto a Firebase mediante el puente unificado (Shim)
let db, auth, fs;

const ensureFirebase = () => {
  if (window.firebaseFirestore && window.firebaseInstance && window.firebaseAuth) {
    db = window.firebaseInstance.db;
    auth = window.firebaseInstance.auth;
    fs = window.firebaseFirestore;
    return true;
  }
  return false;
};

// Proxies de funciones del SDK para evitar errores de carga/versión
const collection = (...args) => { ensureFirebase(); return fs.collection(...args); };
const doc = (...args) => { ensureFirebase(); return fs.doc(...args); };
const getDoc = (...args) => { ensureFirebase(); return fs.getDoc(...args); };
const getDocs = (...args) => { ensureFirebase(); return fs.getDocs(...args); };
const setDoc = (...args) => { ensureFirebase(); return fs.setDoc(...args); };
const query = (...args) => { ensureFirebase(); return fs.query(...args); };
const where = (...args) => { ensureFirebase(); return fs.where(...args); };
const orderBy = (...args) => { ensureFirebase(); return fs.orderBy(...args); };
const writeBatch = (...args) => { ensureFirebase(); return fs.writeBatch(...args); };
const serverTimestamp = (...args) => { ensureFirebase(); return fs.serverTimestamp(...args); };

// Auth Proxies
const polonAuthStateChanged = (...args) => { ensureFirebase(); return window.firebaseAuth.onAuthStateChanged(...args); };
const polsignInAnonymously = (...args) => { ensureFirebase(); return window.firebaseAuth.signInAnonymously(...args); };

// Sobreescribir las funciones locales para el polleo
const onAuthStateChanged = polonAuthStateChanged;
const signInAnonymously = polsignInAnonymously;

// Ejecución inicial
ensureFirebase();

function monthPathVariants(year, month0) {
  const y = String(year).padStart(4, '0');
  const mmPad = String(month0 + 1).padStart(2, '0'); // "09"
  const mmBare = String(month0 + 1);                // "9"
  return { y, list: [mmPad, mmBare] };
}

/* =================== EXPORTACIÓN MAESTRA (COLOR EN TODA LA FILA DE TÍTULOS) =================== */

let isExporting = false;

const BRAND = {
  pri: "#0056b3",
  white: "#FFFFFF",
  border: "#d1d5db",
  headerBg: "#0056b3", // Azul institucional para toda la fila
  ink: "#111827"
};

const CAP_COLLECTION = "cap";

const ALIGNMENT_CAP_MAP = [
  { key: "urgencias", label: "Urgencias", capMatch: "urgencias" },
  { key: "hospitalizacion", label: "Hospitalización", capMatch: "hospitalizacion" },
  { key: "uci", label: "UCI", capMatch: "uci" },
  { key: "uce", label: "UCE", capMatch: "uce" },
  { key: "cirugia", label: "Cirugía", capMatch: "cirugia" },
  { key: "consultaExterna", label: "Consulta Externa", capMatch: "consulta externa" },
  { key: "laboratorio", label: "Laboratorio", capMatch: "laboratorio" },
  { key: "imagenes", label: "Imágenes Diagnósticas (Total)", capMatch: "estudios imagenes" },
  { key: "imagenesTac", label: "· Tomografías (TAC)", capMatch: "tomograf" },
  { key: "imagenesRx", label: "· Rayos X", capMatch: "Cantidad de rayos X mes" },
  { key: "imagenesEco", label: "· Ecografías", capMatch: "Cantidad de Ecografias mes" }
];

const KPI_PALETTE = {
  ok: { fill: [236, 253, 245], stroke: [209, 250, 229], text: [6, 95, 70], label: 'cumple meta' },
  warn: { fill: [255, 251, 235], stroke: [254, 243, 199], text: [146, 64, 14], label: 'casi' },
  err: { fill: [254, 242, 242], stroke: [252, 165, 165], text: [127, 29, 29], label: 'no cumple' }
};

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const n = parseInt(m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 1. CAPTURA DE DATOS TOTAL (Incluye tfoot de Cirugía y mapeo de laboratorio)
function tableToData(sel) {
  const root = document.querySelector(sel);
  if (!root) return null;
  const t = root.querySelector('table');
  if (!t) return null;

  const data = [];
  let headers = ["Variable", "Total"];

  if (sel === '#tbl-cx-esp') {
    headers = ["Especialidad", "Pacientes", "Procs", "U.V.R."];
    t.querySelectorAll('tbody tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 4) data.push(Array.from(tds).map(td => td.querySelector('input')?.value || td.textContent.trim()));
    });
    t.querySelectorAll('tfoot tr').forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 2) data.push([tds[0].textContent.trim(), tds[1].textContent.trim(), tds[2]?.textContent.trim() || "", tds[3]?.textContent.trim() || ""]);
    });
    return { head: headers, rows: data };
  }

  if (sel === '#tbl-lab') {
    headers = ["Fuente", "Total"];
    const ths = t.querySelectorAll('thead th span');
    const tds = t.querySelectorAll('tbody td');
    ths.forEach((span, i) => {
      const label = span.textContent.trim();
      const td = tds[i + 1];
      if (label && td) data.push([label, td.querySelector('input')?.value || td.textContent.trim()]);
    });
    return { head: headers, rows: data };
  }

  t.querySelectorAll('tbody tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) return;
    const label = tds[0].textContent.trim();
    // Limpiamos etiquetas de estado (CUMPLE META, etc) del valor
    const rawVal = tds[1].querySelector('input')?.value || tds[1].textContent.trim();
    const val = rawVal.split(/cumple|meta|casi/i)[0].trim();
    data.push([label, val]);
  });
  return { head: headers, rows: data };
}

// 2. MOTOR DE DIBUJO (Aplica fondo azul y letra blanca a TODA la cabecera)
function drawTable2(doc, data, M, y) {
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - 2 * M;
  const colCount = data.head.length;
  let colWidths = (colCount === 4) ? [maxW * 0.4, maxW * 0.2, maxW * 0.2, maxW * 0.2] : [maxW * 0.75, maxW * 0.25];

  const drawTHead = (curY) => {
    let curX = M;
    // ✅ RECORREMOS CADA COLUMNA PARA PINTAR EL FONDO
    data.head.forEach((h, i) => {
      const w = Number(colWidths[i]) || 10;
      // Dibujar rectángulo azul con relleno (FD = Fill and Draw)
      doc.setFillColor(...hexToRgb(BRAND.headerBg)).setDrawColor(...hexToRgb(BRAND.border));
      doc.rect(curX, curY, w, 7, 'FD');

      // ✅ PONER TEXTO EN BLANCO DENTRO DE ESA CELDA
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(255, 255, 255);
      doc.text(String(h), curX + 2, curY + 4.8);
      curX += w;
    });

    doc.setTextColor(...hexToRgb(BRAND.ink)); // Regresar a negro para el contenido
    return curY + 7;
  };

  y = drawTHead(y);

  data.rows.forEach(row => {
    const labelLines = doc.splitTextToSize(String(row[0] || ''), colWidths[0] - 4);
    const rowH = Math.max(labelLines.length * 4.5 + 2, 6);

    if (y + rowH > 260) { doc.addPage(); y = 20; y = drawTHead(y); }

    let curX = M;
    doc.setFont('helvetica', 'normal').setFontSize(8);
    row.forEach((cell, i) => {
      if (i >= colWidths.length) return;
      const w = Number(colWidths[i]) || 10;
      doc.setDrawColor(...hexToRgb(BRAND.border)).rect(curX, y, w, rowH, 'S');

      if (i === 0) { doc.text(labelLines, curX + 2, y + 4.2); }
      else { doc.text(String(cell || ''), curX + 2, y + 4.2); }
      curX += w;
    });
    y += rowH;
  });
  return y;
}

// 3. FUNCIÓN EXPORTAR PDF (LOGO, NIT, TABLAS, DASHBOARD Y COLORES INSTITUCIONALES)
async function exportPDF() {
  if (isExporting) return;
  isExporting = true;
  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) { btnPdf.disabled = true; btnPdf.textContent = "Generando..."; }

  try {
    let doc;
    if (window.jspdf && window.jspdf.jsPDF) {
      doc = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'letter' });
    } else {
      doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter' });
    }

    // Definición de colores institucionales para PDF (RGB)
    const colOscuro = [37, 61, 91];  // #253D5B
    const colMedio = [78, 108, 159];  // #4E6C9F
    const colGris = [182, 181, 175];  // #B6B5AF

    const M = 14;
    let y = 20;

    // --- CABECERA: LOGO Y NIT ---
    const logoImg = document.getElementById('logo-clinica');
    if (logoImg && logoImg.src) {
      try {
        doc.addImage(logoImg, 'PNG', M, y - 5, 25, 25);
      } catch (e) { console.warn("Logo no cargado"); }
    }

    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(colOscuro[0], colOscuro[1], colOscuro[2]).text('NUEVA CLÍNICA SAGRADO CORAZÓN', M + 28, y + 5);
    y += 12;
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0, 0, 0).text('NIT 900408220 - 1', M + 28, y);
    y += 15;

    const monthId = document.querySelector('#month')?.value || 'Reporte';
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(colMedio[0], colMedio[1], colMedio[2]).text(`REPORTE ESTADÍSTICO MENSUAL · ${monthId}`, M, y);
    y += 10;

    // --- 1. TABLAS MENSUALES (VERTICAL) ---
    const SECTIONS = [
      ['1. URGENCIAS', '#tbl-urg'],
      ['2. CIRUGÍA · Ingresos', '#tbl-cx-ing'],
      ['2. CIRUGÍA · Egresos', '#tbl-cx-egr'],
      ['3. CIRUGÍA POR ESPECIALIDAD', '#tbl-cx-esp'],
      ['4. HOSPITALIZACIÓN', '#tbl-hosp'],
      ['4. UCI ADULTOS', '#tbl-uci'],
      ['4. UCE ADULTOS', '#tbl-uce'],
      ['4.1 GRAN TOTAL INSTITUCIONAL', '#tbl-inst'],
      ['5. CONSULTA EXTERNA', '#tbl-ce'],
      ['6. HEMATO-ONCOLOGÍA', '#tbl-hemo-onco'],
      ['7. HEMOCOMPONENTES', '#tbl-hemo-comp'],
      ['8. SERVICIO DE ENDOSCOPIA', '#tbl-endo'],
      ['9. IMÁGENES DIAGNÓSTICAS', '#tbl-img-tot'],
      ['10. LABORATORIO CLÍNICO', '#tbl-lab'],
      ['11. ESTADÍSTICAS INSTITUCIONALES', '#tbl-est']
    ];

    for (const [title, sel] of SECTIONS) {
      const data = tableToData(sel);
      if (!data || !data.rows.length) continue;
      if (y > 230) { doc.addPage(); y = 20; }

      // Estilo de encabezado de sección: Fondo Oscuro #253D5B
      doc.setFillColor(colOscuro[0], colOscuro[1], colOscuro[2]).roundedRect(M, y, 188, 7, 1, 1, 'F');
      doc.setTextColor(255, 255, 255).setFontSize(10).setFont('helvetica', 'bold').text(title, M + 3, y + 5);

      // La función drawTable2 debe estar configurada para usar colMedio en sus cabeceras
      y = drawTable2(doc, data, M, y + 9) + 8;
    }

    // --- 2. DASHBOARD (VERTICAL) ---
    doc.addPage();
    y = 20;
    doc.setFontSize(14).setTextColor(colOscuro[0], colOscuro[1], colOscuro[2]).text("DASHBOARD DE INDICADORES ANUALES", M, y);
    y += 12;

    const charts = document.querySelectorAll('.chart-card');
    for (let i = 0; i < charts.length; i++) {
      const card = charts[i];
      const canvas = card.querySelector('canvas');
      if (!canvas) continue;
      const title = card.querySelector('h3')?.textContent || "Indicador";
      const imgData = canvas.toDataURL('image/png', 1.0);
      const col = i % 2;
      const posX = M + (col * 95);
      if (col === 0 && y > 230) { doc.addPage(); y = 20; }
      doc.setFontSize(9).setTextColor(colMedio[0], colMedio[1], colMedio[2]).text(title, posX, y - 2);
      doc.addImage(imgData, 'PNG', posX, y, 85, 45);
      if (col === 1) y += 58;
    }

    // --- 3. CONSOLIDADO HISTÓRICO MENSUAL (HORIZONTAL) ---
    const histContainer = document.getElementById('consolidado-historico');
    if (histContainer) {
      const tables = histContainer.querySelectorAll('table');
      const titulosAnuales = [
        "1. CONSOLIDADO ANUAL URGENCIAS", "2. CONSOLIDADO ANUAL HOSPITALIZACIÓN",
        "3. CONSOLIDADO ANUAL CIRUGÍA", "4. CONSOLIDADO ANUAL ESPECIALIDADES",
        "5. CONSOLIDADO ANUAL CONSULTA EXTERNA", "6. CONSOLIDADO ANUAL HEMATO-ONCOLOGÍA",
        "7. CONSOLIDADO ANUAL HEMOCOMPONENTES", "8. CONSOLIDADO ANUAL ENDOSCOPIA",
        "9. CONSOLIDADO ANUAL IMÁGENES", "10. CONSOLIDADO ANUAL LABORATORIO",
        "11. CONSOLIDADO ANUAL ESTADÍSTICAS"
      ];

      for (let i = 0; i < tables.length; i++) {
        doc.addPage('a4', 'l');
        // Título principal en Oscuro
        doc.setFontSize(14).setTextColor(colOscuro[0], colOscuro[1], colOscuro[2]).text("CONSOLIDADO HISTÓRICO MENSUAL (ENERO - DICIEMBRE)", 10, 15);
        // Subtítulo de tabla en Medio
        doc.setFontSize(11).setTextColor(colMedio[0], colMedio[1], colMedio[2]).text(titulosAnuales[i] || "Tabla de Consolidado", 10, 22);

        // Optimizamos html2canvas para capturar el ancho total de la tabla
        const canvas = await html2canvas(tables[i], {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: tables[i].scrollWidth,
          height: tables[i].scrollHeight,
          windowWidth: tables[i].scrollWidth + 100
        });
        const imgData = canvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 10, 25, 277, 0);
      }
    }

    doc.save(`Acumulado_Completo_${monthId}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Error al generar PDF: " + err.message);
  } finally {
    isExporting = false;
    if (btnPdf) { btnPdf.disabled = false; btnPdf.textContent = "Exportar PDF"; }
  }
}

// 4. FUNCIÓN EXPORTAR EXCEL (REPORTE MENSUAL Y CONSOLIDADO ANUAL CON PALETA DE COLORES)
function exportExcel() {
  try {
    // Usar la referencia de la librería que admite estilos
    const excelLib = window.XLSX;
    if (!excelLib) {
      alert("Error: La librería de Excel no está cargada correctamente.");
      return;
    }

    const wb = excelLib.utils.book_new();
    const monthId = document.querySelector('#month')?.value || 'Reporte';

    // COLORES INSTITUCIONALES
    const colorOscuro = "253D5B";
    const colorMedio = "4E6C9F";
    const colorGris = "BCB5AF";

    // --- HOJA 1: REPORTE MENSUAL (UNA TABLA TRAS OTRA) ---
    let dataMensual = [];
    const SELECCIONES_MENSUALES = [
      ['1. URGENCIAS', '#tbl-urg'], ['2. CIRUGÍA · Ingresos', '#tbl-cx-ing'], ['2. CIRUGÍA · Egresos', '#tbl-cx-egr'],
      ['3. CIRUGÍA POR ESPECIALIDAD', '#tbl-cx-esp'], ['4. HOSPITALIZACIÓN', '#tbl-hosp'], ['4. UCI ADULTOS', '#tbl-uci'],
      ['4. UCE ADULTOS', '#tbl-uce'], ['4.1 GRAN TOTAL INSTITUCIONAL', '#tbl-inst'], ['5. CONSULTA EXTERNA', '#tbl-ce'],
      ['6. HEMATO-ONCOLOGÍA', '#tbl-hemo-onco'], ['7. HEMOCOMPONENTES', '#tbl-hemo-comp'], ['8. SERVICIO DE ENDOSCOPIA', '#tbl-endo'],
      ['9. IMÁGENES DIAGNÓSTICAS', '#tbl-img-tot'], ['10. LABORATORIO CLÍNICO', '#tbl-lab'], ['11. ESTADÍSTICAS INSTITUCIONALES', '#tbl-est']
    ];

    SELECCIONES_MENSUALES.forEach(([titulo, sel]) => {
      const data = tableToData(sel);
      if (data && data.rows.length > 0) {
        // Título Sección (#253D5B)
        dataMensual.push([{
          v: titulo,
          s: { fill: { fgColor: { rgb: colorOscuro } }, font: { color: { rgb: "FFFFFF" }, bold: true }, alignment: { horizontal: "center" } }
        }]);

        // Encabezados (#4E6C9F)
        dataMensual.push(data.head.map(h => ({
          v: h,
          s: { fill: { fgColor: { rgb: colorMedio } }, font: { color: { rgb: "FFFFFF" }, bold: true } }
        })));

        // Datos y Metas (#B6B5AF)
        data.rows.forEach(row => {
          const txt = row[0] ? row[0].toString().toLowerCase() : "";
          const esResaltado = txt.includes("meta") || txt.includes("total") || txt.includes("presupuesto") || txt.includes("proyección");
          dataMensual.push(row.map(cell => ({
            v: cell,
            s: esResaltado ? { fill: { fgColor: { rgb: colorGris } }, font: { bold: true } } : {}
          })));
        });
        dataMensual.push([]); // Espacio
      }
    });

    const wsMensual = excelLib.utils.aoa_to_sheet(dataMensual);
    // Ajuste de anchos para Reporte Mensual
    wsMensual["!cols"] = [{ wch: 45 }, { wch: 15 }];
    excelLib.utils.book_append_sheet(wb, wsMensual, "REPORTE_MENSUAL");

    // --- HOJA 2: CONSOLIDADO ANUAL (HISTÓRICO ENERO-DICIEMBRE) ---
    let dataAnualFinal = [
      [{
        v: "CONSOLIDADO HISTÓRICO ANUAL (ENERO - DICIEMBRE)",
        s: { font: { bold: true, size: 14, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: colorOscuro } }, alignment: { horizontal: "center" } }
      }],
      []
    ];

    // Intentar encontrar todas las tablas históricas disponibles en el DOM
    const allTables = document.querySelectorAll('#consolidado-historico table');

    if (allTables && allTables.length > 0) {
      const titulosAnuales = [
        "1. CONSOLIDADO ANUAL URGENCIAS", "2. CONSOLIDADO ANUAL HOSPITALIZACIÓN",
        "3. CONSOLIDADO ANUAL CIRUGÍA", "4. CONSOLIDADO ANUAL ESPECIALIDADES",
        "5. CONSOLIDADO ANUAL CONSULTA EXTERNA", "6. CONSOLIDADO ANUAL HEMATO-ONCOLOGÍA",
        "7. CONSOLIDADO ANUAL HEMOCOMPONENTES", "8. CONSOLIDADO ANUAL ENDOSCOPIA",
        "9. CONSOLIDADO ANUAL IMÁGENES", "10. CONSOLIDADO ANUAL LABORATORIO",
        "11. CONSOLIDADO ANUAL ESTADÍSTICAS"
      ];

      allTables.forEach((table, i) => {
        // Título de sección (#253D5B)
        dataAnualFinal.push([{
          v: titulosAnuales[i] || "CONSOLIDADO ANUAL",
          s: { fill: { fgColor: { rgb: colorOscuro } }, font: { color: { rgb: "FFFFFF" }, bold: true }, alignment: { horizontal: "center" } }
        }]);

        // Scraper robusto que maneja celdas fusionadas (rowspan/colspan)
        const tableGrid = [];
        const rows = Array.from(table.rows);

        rows.forEach((tr, rIdx) => {
          if (!tableGrid[rIdx]) tableGrid[rIdx] = [];
          let cIdx = 0;

          Array.from(tr.cells).forEach(cell => {
            while (tableGrid[rIdx][cIdx] !== undefined) cIdx++;

            const val = cell.innerText.trim().replace(/\n/g, ' ');
            const rs = cell.rowSpan || 1;
            const cs = cell.colSpan || 1;

            // Determinar estilo de la celda
            const lowerVal = val.toLowerCase();
            const esHeader = tr.parentElement.tagName.toLowerCase() === 'thead' || rIdx === 0;
            const esResaltado = lowerVal.includes("meta") || lowerVal.includes("total") || lowerVal.includes("proyección");

            let st = {
              fill: { fgColor: { rgb: "FFFFFF" } },
              border: {
                top: { style: 'thin', color: { rgb: "E2E8F0" } },
                bottom: { style: 'thin', color: { rgb: "E2E8F0" } },
                left: { style: 'thin', color: { rgb: "E2E8F0" } },
                right: { style: 'thin', color: { rgb: "E2E8F0" } }
              },
              font: { color: { rgb: "000000" }, size: 9 },
              alignment: { vertical: "center" }
            };

            if (esHeader) {
              st.fill.fgColor.rgb = colorMedio;
              st.font = { color: { rgb: "FFFFFF" }, bold: true, size: 10 };
              st.alignment.horizontal = "center";
            } else if (esResaltado) {
              st.fill.fgColor.rgb = colorGris;
              st.font.bold = true;
            }

            for (let i = 0; i < rs; i++) {
              for (let j = 0; j < cs; j++) {
                const trgR = rIdx + i;
                const trgC = cIdx + j;
                if (!tableGrid[trgR]) tableGrid[trgR] = [];
                tableGrid[trgR][trgC] = { v: (i === 0 && j === 0) ? val : "", s: st };
              }
            }
          });
        });

        tableGrid.forEach(row => dataAnualFinal.push(row));
        dataAnualFinal.push([]); // Salto de línea entre tablas
      });
    } else {
      dataAnualFinal.push([{ v: "Nota: No se encontraron tablas históricas cargadas. Por favor asegúrese de que el Consolidado Histórico sea visible en pantalla.", s: { font: { italic: true } } }]);
    }

    if (dataAnualFinal.length > 0) {
      const wsAnual = excelLib.utils.aoa_to_sheet(dataAnualFinal);
      // Ajuste de anchos: A (Grupo, 10), B (Métrica, 45), C (Promedio, 15), D (Meta, 15), Resto (Meses, 10)
      const colWidthsAnual = [
        { wch: 10 }, { wch: 45 }, { wch: 15 }, { wch: 12 }
      ];
      for (let k = 0; k < 20; k++) colWidthsAnual.push({ wch: 10 });
      wsAnual["!cols"] = colWidthsAnual;
      excelLib.utils.book_append_sheet(wb, wsAnual, "CONSOLIDADO_ANUAL");
    }

    // Descarga del archivo
    excelLib.writeFile(wb, `Reporte_General_SagradoCorazon_${monthId}.xlsx`);

  } catch (e) {
    console.error("Error al exportar Excel:", e);
    alert("Error al generar el Excel con colores: " + e.message);
  }
}

/* -------------------- INIT UI -------------------- */
window.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const ym = today.toISOString().slice(0, 7);
  const monthEl = $("#month");
  if (monthEl) {
    monthEl.value = ym;
    monthEl.addEventListener("change", () => runLoad());
  }

  // --- Listeners de Botones con protección contra errores ---
  const btnLoad = document.getElementById('btnLoad');
  if (btnLoad) {
    btnLoad.onclick = null; // Limpia cualquier evento anterior
    btnLoad.onclick = () => runLoad(); // Asigna la orden de forma limpia
  }

  const btnSave = document.getElementById('btnSave');
  if (btnSave) {
    btnSave.onclick = null;
    btnSave.onclick = () => runSave();
  }
  const btnShowMeta = document.getElementById('btnShowMeta');
  if (btnShowMeta) btnShowMeta.addEventListener("click", showForecastMeta);

  const btnPdf = document.getElementById('btnPdf');
  if (btnPdf) btnPdf.onclick = exportPDF;

  const btnXlsx = document.getElementById('btnXlsx');
  if (btnXlsx) btnXlsx.onclick = exportExcel;

  // --- Otros elementos de la interfaz ---
  const closeMeta = document.getElementById('closeMeta');
  if (closeMeta) closeMeta.addEventListener("click", () => $("#metaModal").style.display = 'none');

  const toggleEdit = document.getElementById('toggleEdit');
  if (toggleEdit) {
    toggleEdit.addEventListener("change", (e) => {
      EDIT_MODE = e.target.checked;
      if (LAST_AGG) paintAll(LAST_AGG, LAST_META || {});
    });
  }

  const clearManual = document.getElementById('clearManual');
  if (clearManual) {
    clearManual.addEventListener("click", () => {
      if (confirm("¿Borrar valores manuales del mes cargado?")) {
        MANUAL_OVERRIDES = {};
        paintAll(LAST_AGG || newAgg(), LAST_META || {});
      }
    });
  }

  // --- Autenticación y Carga Inicial ---
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.info("Usuario autenticado:", user.uid);
      const userEmail = document.getElementById('userEmail');
      if (userEmail) userEmail.textContent = user.email || "Usuario GTC";

      // Inicia la carga automática de datos
      runLoad();
    }
  });
});

/* ===== UTILIDADES ======================================================= */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmtInt = n => (n ?? 0).toLocaleString('es-CO');
const fmtDec1 = n => (n ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtRaw = n => (n === '' || n == null) ? ''
  : Number(n).toLocaleString('es-CO', { useGrouping: true, maximumFractionDigits: 20 });
const pct = (a, b) => b > 0 ? (a * 100 / b) : 0;
const safeDiv = (a, b) => b > 0 ? (a / b) : 0;
const startOfMonth = (y, m) => new Date(y, m, 1, 0, 0, 0, 0);
const endOfMonth = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999);
const slug = s => (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-\.]/g, '');

function kpiClass(val, meta) { if (meta == null) return ""; if (val >= meta) return "ok"; if (val >= meta * 0.9) return "warn"; return "err"; }

// Devuelve el doc para guardar/cargar el consolidado mensual dentro de realizados/{YYYY}/{MM}/_mensual
function monthDocRef(monthId) {
  const [yy, mm] = monthId.split("-");          // p.ej. "2025-09"
  const y = String(yy).padStart(4, '0');
  const m2 = String(mm).padStart(2, '0');
  return doc(db, CFG.coleccionDiaria, y, m2, "_mensual");
}

/* ===== COLECCIONES ====================================================== */
const CFG = {
  coleccionDiaria: "realizados",
  coleccionMensual: "realizados",
  coleccionForecast: "forecast"
};

/* ====== LECTOR DIRECTO DE FORECAST (dos rutas posibles) ================= */
async function fetchForecastDocRaw(monthId) {
  // intenta forecast/{YYYY-MM}
  try {
    const snap1 = await getDoc(doc(db, 'forecast', monthId));
    if (snap1.exists()) {
      return { path: `forecast/${monthId}`, data: snap1.data() || {} };
    }
  } catch (_) { }

  // intenta forecast/{YYYY}/unidades/{YYYY-MM}
  try {
    const [yy] = monthId.split('-');
    const snap2 = await getDoc(doc(db, 'forecast', String(yy), 'unidades', monthId));
    if (snap2.exists()) {
      return { path: `forecast/${yy}/unidades/${monthId}`, data: snap2.data() || {} };
    }
  } catch (_) { }

  return { path: null, data: null };
}

/* ====== construye una tablita HTML simple con las metas ================= */
function renderMetaPreview(metas, whereStr) {
  const rows = [
    ['Urgencias · Total meta', metas?.urgenciasMeta ?? '—'],
    ['Cirugía · Procedimientos (meta)', metas?.cxMetaProced ?? '—'],
    ['Cirugía · UVR (meta)', metas?.uvrMeta ?? '—'],
    ['Hosp. · Egresos (meta)', metas?.hospMetaEgresos ?? '—'],
    ['UCI · Egresos (meta)', metas?.uciMetaEgresos ?? '—'],
    ['UCE · Egresos (meta)', metas?.uceMetaEgresos ?? '—'],
    ['Consulta Externa · Consultas (meta)', metas?.ceMetaConsultas ?? '—'],
    ['Imágenes · Exámenes (meta)', metas?.imgMetaExamenes ?? '—'],
  ];
  const t = document.createElement('table'); t.className = 'table';
  t.innerHTML = `<thead><tr><th>Variable</th><th>Valor</th></tr></thead>`;
  const tb = document.createElement('tbody');
  rows.forEach(([k, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${k}</td><td class="mono">${(typeof v === 'number') ? fmtRaw(v) : v}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  $("#metaTable").innerHTML = '';
  $("#metaTable").appendChild(t);
  $("#metaInfo").textContent = whereStr || '';
}

/* ====== botón: Ver metas (lee SIEMPRE de forecast/{yyyy}/unidades …) ====== */
/* =================== GESTIÓN DE METAS INSTITUCIONALES =================== */

async function showForecastMeta() {
  const monthId = CURRENT_MONTH_ID || document.getElementById("month").value;
  if (!monthId) { alert("Selecciona un mes primero."); return; }

  const [yyyy, mm] = monthId.split('-');
  $("#metaInfo").textContent = `Editando objetivos para el periodo: ${monthId}`;
  $("#metaModal").style.display = 'flex';

  // Lista de metas solicitadas
  const metasDef = [
    { key: "urgenciasMeta", label: "Urgencias (Meta presupuesto)" },
    { key: "cxMetaProced", label: "Cirugía (Meta procedimientos)" },
    { key: "uvrMeta", label: "Cirugía (Meta UVR)" },
    { key: "hospMetaEgresos", label: "Hospitalización (Meta egresos)" },
    { key: "uciMetaEgresos", label: "UCI Adultos (Meta egresos)" },
    { key: "uceMetaEgresos", label: "UCE Adultos (Meta egresos)" },
    { key: "instMetaEgresos", label: "Consolidado Hosp + UCE (Meta egresos)" },
    { key: "globalMetaEgresos", label: "Hospitalización Global (Total Hosp+UCE+UCI)" },
    { key: "ceMetaConsultas", label: "Consulta Externa (Metas consultas)" },
    { key: "imgMetaExamenes", label: "Imágenes Diagnósticas (Meta exámenes)" },
    { key: "labMetaPruebas", label: "Laboratorio (Meta pruebas)" },
    { key: "endoMetaTotal", label: "Endoscopia (Meta servicios)" },
    { key: "hemoCompMeta", label: "Hemocomponentes (Meta unidades)" },
    { key: "hemoOncoMeta", label: "Hemato-Oncología (Meta tratamientos)" }
  ];

  // Intentar cargar metas existentes de Firebase
  let metasActuales = await loadForecastMeta(monthId) || {};

  let html = `<div style="display:grid; grid-template-columns: 1fr 150px; gap:10px; align-items:center;">`;
  metasDef.forEach(m => {
    const val = metasActuales[m.key] || "";
    html += `
            <label style="font-size:0.9rem; font-weight:600; color:var(--text-main);">${m.label}</label>
            <input type="number" class="cell meta-input" data-key="${m.key}" value="${val}" style="width:100%; text-align:right;">
        `;
  });
  html += `</div>`;
  $("#metaTableContainer").innerHTML = html;

  // Configurar botón de guardado dentro del modal
  document.getElementById("btnSaveMeta").onclick = async () => {
    const btn = document.getElementById("btnSaveMeta");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    const nuevasMetas = {};
    document.querySelectorAll(".meta-input").forEach(input => {
      nuevasMetas[input.dataset.key] = Number(input.value) || 0;
    });

    try {
      // Guardamos en la ruta maestra de forecast para que sea global
      const [yy, mm] = monthId.split("-");
      const metaRef = doc(db, 'forecast', yy, 'unidades', monthId);
      await setDoc(metaRef, nuevasMetas, { merge: true });

      // Actualizamos la memoria local para que los semáforos cambien de inmediato
      LAST_META = nuevasMetas;
      paintAll(LAST_AGG, LAST_META);

      alert("Metas actualizadas correctamente.");
      $("#metaModal").style.display = 'none';
    } catch (e) {
      console.error(e);
      alert("Error al guardar metas.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar Metas de este Mes";
    }
  };
}

/* ----------------------------------------------------------------------- */
/*                LECTOR FLEXIBLE DE CAMPOS (clave “estricta” o alias)     */
/* ----------------------------------------------------------------------- */
function pick(obj, candidates) {
  for (const p of candidates) {
    const v = pathRead(obj, p);
    if (v != null) return v;
  }
  return null;
}
function pathRead(obj, path) {
  if (!obj || !path) return null;
  // soporta notación a.b.c y claves con espacios mediante ["..."]
  try {
    const parts = [];
    path.split('.').forEach(seg => {
      const m = seg.match(/(.+)\[(.+)\]/); // no usado en esta versión
      parts.push(seg);
    });
    let cur = obj;
    for (const seg of parts) {
      if (seg.includes('["')) { // si ya viene con ["..."]
        const key = seg.match(/^\["(.+)"\]$/)?.[1];
        cur = (key != null) ? cur?.[key] : cur?.[seg];
      } else {
        // probar seg tal cual, Capitalizado, y variantes típicas
        const variants = [seg, seg.toLowerCase(), seg.toUpperCase(), title(seg)];
        let found = null;
        for (const k of Object.keys(cur || {})) {
          if (variants.includes(k) || variants.includes(k.replace(/\s+/g, ' '))) {
            found = k; break;
          }
        }
        cur = (found != null) ? cur[found] : cur?.[seg];
      }
      if (cur == null) return null;
    }
    return cur;
  } catch { return null; }
}
function title(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ====== ESTADO ========================================================== */
let CURRENT_MONTH_ID = null;
let LAST_AGG = null;
let LAST_META = null;
let LAST_CAP_ROWS = [];
let LAST_ALIGNMENT_MODEL = [];
let EDIT_MODE = false;
let MANUAL_OVERRIDES = {}; // { "SECCION|variable-slug": number }
let GLOBAL_YEARLY_DATASET = null;
let GLOBAL_YEARLY_LABELS = [];

// === Helpers SOLO para meses numéricos ===
// mm viene como "09", "3", etc.
const sumArr = a => Array.isArray(a) ? a.reduce((s, n) => s + (+n || 0), 0) : null;

// Lee el valor del mes desde objetos/arrays con claves 1..12 o "01".."12"
function pickMonthValueNum(any, yyyy, mm) {
  if (any == null) return null;

  // número directo
  if (typeof any === 'number') return +any;

  // array de 12 (enero..dic) → índice mes-1
  if (Array.isArray(any)) {
    if (any.length === 12) return +any[Number(mm) - 1] || 0;
    // arrays de días → suma
    return sumArr(any);
  }

  // objeto con claves 1..12, "1".."12" o "01".."12"
  if (typeof any === 'object') {
    const keys = [Number(mm), String(Number(mm)), mm]; // 9, "9", "09"
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(any, k)) {
        const v = any[k];
        if (typeof v === 'number') return +v;
        if (Array.isArray(v)) return sumArr(v);
        if (typeof v === 'object') return pickMonthValueNum(v, yyyy, mm);
      }
    }
    // subcampo común: { mensual: { "09": 123 } }
    for (const alias of ['mensual', 'mensuales', 'monthly', 'meses']) {
      if (any[alias] != null) {
        const v = pickMonthValueNum(any[alias], yyyy, mm);
        if (v != null) return v;
      }
    }
  }
  return null;
}

// Igual que antes, pero usa pickMonthValueNum
function readMonthly(data, paths, yyyy, mm) {
  for (const p of paths) {
    const v = pathRead(data, p);     // (ya la tienes en tu código)
    const n = pickMonthValueNum(v, yyyy, mm);
    if (n != null) return +n;
  }
  return null;
}

// Busca una clave concreta dentro del doc (ignorando mayúsculas/tildes) y lee su mensual
function pickMonthUnderKey(obj, key, m1, m2) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = Object.keys(obj);
  const hit = keys.find(k => k.toLowerCase() === key.toLowerCase());
  if (!hit) return null;

  const any = obj[hit];
  function pickMonth(any) {
    if (any == null) return null;
    if (typeof any === 'number') return +any;
    if (Array.isArray(any)) return any.reduce((s, n) => s + (+n || 0), 0);
    if (typeof any === 'object') {
      if (any.mensual && (any.mensual[m1] != null || any.mensual[m2] != null)) {
        return Number(any.mensual[m1] ?? any.mensual[m2]);
      }
      if (any[m1] != null || any[m2] != null) {
        const v = any[m1] ?? any[m2];
        if (typeof v === 'number') return +v;
        if (Array.isArray(v)) return v.reduce((s, n) => s + (+n || 0), 0);
        if (typeof v === 'object') return pickMonth(v);
      }
    }
    return null;
  }
  return pickMonth(any);
}

// Lectura estricta de UVR en forecast_hosp/{yyyy}/kpis/{alias}
async function readHospUVR(yyyy, aliases, m1, m2) {
  for (const id of aliases) {
    try {
      const snap = await getDoc(doc(db, 'forecast_hosp', yyyy, 'kpis', id));
      if (snap.exists()) {
        const data = snap.data() || {};
        const tryKeys = ['uvr', 'UVR', 'uvr_meta', 'meta_uvr'];
        for (const k of tryKeys) {
          const v = pickMonthUnderKey(data, k, m1, m2);
          if (v != null) return v;
        }
      }
    } catch (_) { }
  }
  return null;
}

// Lectura estricta de UVR en forecast/{yyyy}/unidades/{alias}
async function readUnidadUVR(yyyy, aliases, m1, m2) {
  for (const id of aliases) {
    try {
      const snap = await getDoc(doc(db, 'forecast', yyyy, 'unidades', id));
      if (snap.exists()) {
        const data = snap.data() || {};
        const v = pickMonthUnderKey(data, 'uvr', m1, m2);
        if (v != null) return v;
      }
    } catch (_) { }
  }
  return null;
}

/* ====== metas desde forecast + UVR anual hardcodeada por año ====== */
async function loadForecastMeta(monthId) {
  const [yyyy, mmRaw] = String(monthId || '').split('-');
  const yearNum = Number(yyyy);
  const m1 = String(Number(mmRaw));
  const m2 = String(mmRaw).padStart(2, '0');

  // ────────────────────────────────────────────────────────────────
  //     METAS ANUALES DE UVR (VALORES HARDCODEADOS - ACTUALIZAR AQUÍ)
  // ────────────────────────────────────────────────────────────────
  const UVR_ANUAL_POR_AÑO = {
    2024: 1800000,    // ejemplo - poner valor real si lo tienes
    2025: 1899996,
    2026: 1899996,    // ← mismo valor que 2025 (puedes cambiarlo cuando haya nueva meta)
    // 2027: 1950000,  // descomentar y actualizar cuando llegue el momento
    // etc...
  };

  // Buscamos el valor del año actual, si no existe → el más reciente anterior
  let uvrAnual = null;
  for (let y = yearNum; y >= 2020; y--) {  // buscamos hacia atrás máximo hasta 2020
    if (UVR_ANUAL_POR_AÑO[y] !== undefined) {
      uvrAnual = Number(UVR_ANUAL_POR_AÑO[y]);
      console.log(`→ Usando meta UVR ANUAL del año ${y}: ${uvrAnual}`);
      break;
    }
  }

  // Meta mensual teórica = anual / 12 (redondeamos al entero más cercano)
  const uvrMetaMensual = uvrAnual !== null && uvrAnual > 0
    ? Math.round(uvrAnual / 12)
    : null;

  // ────────────────────────────────────────────────────────────────
  //  Funciones auxiliares de lectura de forecast (mantener como estaban)
  // ────────────────────────────────────────────────────────────────

  function pickMonth(any) {
    if (any == null) return null;
    if (typeof any === 'number') return +any;
    if (Array.isArray(any)) return any.reduce((s, n) => s + (+n || 0), 0);
    if (typeof any === 'object') {
      if (any.mensual && (any.mensual[m1] != null || any.mensual[m2] != null)) {
        return Number(any.mensual[m1] ?? any.mensual[m2]);
      }
      if (any[m1] != null || any[m2] != null) {
        const v = any[m1] ?? any[m2];
        if (typeof v === 'number') return +v;
        if (Array.isArray(v)) return v.reduce((s, n) => s + (+n || 0), 0);
        if (typeof v === 'object') return pickMonth(v);
      }
    }
    return null;
  }

  function pickMonthFromKnownKeys(row) {
    if (!row || typeof row !== 'object') return null;
    const KEYS = ['total', 'egresos', 'procedimientos', 'consultas', 'examenes', 'uvr', 'atenciones', 'meta'];
    for (const k of KEYS) {
      if (row[k] != null) {
        const v = pickMonth(row[k]);
        if (v != null) return v;
      }
    }
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === 'object' && (v.mensual || v[m1] != null || v[m2] != null)) {
        const n = pickMonth(v);
        if (n != null) return n;
      }
    }
    return null;
  }

  // 1. INTENTO DE CARGA DESDE DOCUMENTO MENSUAL (Estructura moderna unificada)
  try {
    const snapMensual = await getDoc(doc(db, 'forecast', yyyy, 'unidades', monthId));
    if (snapMensual.exists()) {
      const mData = snapMensual.data() || {};
      // Agregamos la meta UVR hardcodeada si no viene en el doc
      if (!mData.uvrMeta) mData.uvrMeta = uvrMetaMensual;
      return mData;
    }
  } catch (e) {
    console.warn("No se pudo cargar meta mensual desde la ruta unificada:", e);
  }

  // Fallback a lectura por unidad (Estructura antigua/fragmentada)
  async function readUnidad(aliases) {
    for (const id of aliases) {
      try {
        const snap = await getDoc(doc(db, 'forecast', yyyy, 'unidades', id));
        if (snap.exists()) {
          const data = snap.data() || {};
          let val = pickMonth(data);
          if (val == null) val = pickMonthFromKnownKeys(data);
          if (val != null) return val;
        }
      } catch (_) { }
    }
    return null;
  }

  async function readHosp(aliases) {
    for (const id of aliases) {
      try {
        const snap = await getDoc(doc(db, 'forecast_hosp', yyyy, 'kpis', id));
        if (snap.exists()) {
          const data = snap.data() || {};
          let val = pickMonth(data);
          if (val == null) val = pickMonthFromKnownKeys(data);
          if (val != null) return val;
        }
      } catch (_) { }
    }
    return null;
  }

  // Helpers para UVR (compatibilidad con código anterior)
  async function readHospUVR() { return null; }     // ya no lo necesitamos
  async function readUnidadUVR() { return null; }   // ya no lo necesitamos

  // ────────────────────────────────────────────────────────────────
  //                Lectura de las otras metas
  // ────────────────────────────────────────────────────────────────
  const metas = {
    urgenciasMeta: await readUnidad(['urgencias', 'urg', 'emergencias']),
    cxMetaProced: await readUnidad(['cirugia', 'cirugía', 'qx', 'procedimientos']),

    // ← Aquí va la UVR mensual calculada del valor anual hardcodeado
    uvrMeta: uvrMetaMensual,

    hospMetaEgresos: await readUnidad(['hospitalizacion', 'hospitalización', 'hosp']),
    uciMetaEgresos: await readUnidad(['uci', 'uci_adultos', 'uci adultos']),
    uceMetaEgresos: await readUnidad(['uce', 'ucin', 'uce_adultos', 'uce adultos']),
    ceMetaConsultas: await readUnidad(['consulta_externa', 'consulta externa', 'ce']),
    imgMetaExamenes: await readUnidad(['apoyo_diagnostico', 'apoyo diagnóstico', 'imagenes', 'imágenes', 'imagenes_diagnosticas', 'imagenologia']),
    labMetaPruebas: await readUnidad(['laboratorio', 'lab', 'pruebas', 'pruebas_laboratorio'])
  };

  // Depuración (puedes quitar después)
  console.log(`Mes ${monthId} → Meta UVR mensual usada: ${metas.uvrMeta}  (anual usada: ${uvrAnual})`);

  return metas;
}

/* -------------------- UTILIDADES DE CARGA CAP -------------------- */
function excelDateToISO(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString();
  }
  return value ?? null;
}

function normalizeSheetAOA(aoa) {
  return aoa.map(row =>
    (row || []).map(cell => excelDateToISO(cell))
  );
}

async function uploadCapSheetAsIs(file) {
  if (!file) return;

  const statusEl = document.getElementById("capUploadStatus");
  if (statusEl) {
    statusEl.textContent = "Cargando CAP...";
    statusEl.style.color = "";
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true
  });

  const capSheetName =
    workbook.SheetNames.find(n => String(n).trim().toLowerCase() === "cap") ||
    workbook.SheetNames[0];

  if (!capSheetName) {
    throw new Error("No se encontró la hoja CAP.");
  }

  const ws = workbook.Sheets[capSheetName];
  if (!ws) {
    throw new Error("No se encontró la hoja CAP en el archivo.");
  }

  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: null
  });

  const normalizedRows = normalizeSheetAOA(aoa);

  const merges = (ws["!merges"] || []).map(m => ({
    s: { r: m.s.r, c: m.s.c },
    e: { r: m.e.r, c: m.e.c }
  }));

  const selectedYear =
    Number(document.getElementById("month")?.value?.split("-")[0]) ||
    new Date().getFullYear();

  // 1. Documento principal: cap/{anio}
  const metaRef = doc(db, CAP_COLLECTION, String(selectedYear));
  await setDoc(metaRef, {
    year: selectedYear,
    source: "excel_cap",
    fileName: file.name,
    sheetName: capSheetName,
    totalRows: normalizedRows.length,
    totalCols: Math.max(...normalizedRows.map(r => r.length), 0),
    merges,
    uploadedAt: serverTimestamp()
  }, { merge: true });

  // 2. Filas: cap/{anio}/rows/{rowId}
  for (let i = 0; i < normalizedRows.length; i++) {
    const rowRef = doc(db, CAP_COLLECTION, String(selectedYear), "rows", String(i + 1));
    await setDoc(rowRef, {
      rowIndex: i + 1,
      values: normalizedRows[i]
    }, { merge: true });
  }

  if (statusEl) {
    statusEl.textContent = `CAP cargado correctamente: ${file.name}`;
    statusEl.style.color = "#16a34a";
  }

  alert("Hoja CAP cargada y guardada en base de datos.");
}

async function loadCap(year) {
  const metaSnap = await getDoc(doc(db, "cap", String(year)));
  const rowsSnap = await getDocs(collection(db, "cap", String(year), "rows"));

  const meta = metaSnap.exists() ? metaSnap.data() : null;
  const rows = [];

  rowsSnap.forEach(d => {
    rows.push(d.data());
  });

  rows.sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));

  return {
    meta,
    rows
  };
}

async function loadCapRows(year) {
  const rowsRef = collection(db, "cap", String(year), "rows");
  const snap = await getDocs(rowsRef);

  const rows = [];
  snap.forEach(docSnap => {
    rows.push(docSnap.data());
  });

  rows.sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));
  return rows.map(r => r.values || []);
}

function getNumericFromRenderedTable(tableId, textMatches) {
  const matches = Array.isArray(textMatches) ? textMatches : [textMatches];
  const t = document.querySelector(tableId);
  if (!t) return 0;

  const rows = Array.from(t.querySelectorAll('tbody tr, tfoot tr'));
  const row = rows.find(r => {
    const first = (r.cells?.[0]?.textContent || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return matches.some(t => first.includes(String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()));
  });

  if (!row) return 0;

  // Buscar el valor numérico recorriendo las celdas de derecha a izquierda (el Real siempre es el último/penúltimo)
  for (let i = row.cells.length - 1; i >= 1; i--) {
    const cell = row.cells[i];
    const raw = cell.querySelector("input")?.value || cell.textContent || "";
    const txt = String(raw).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "").trim();
    const n = Number(txt);
    if (txt !== "" && Number.isFinite(n) && n !== 0) return n;
  }

  return 0;
}

function getSumNumericFromRenderedTable(tableId, textMatches) {
  const matches = Array.isArray(textMatches) ? textMatches : [textMatches];
  const t = document.querySelector(tableId);
  if (!t) return 0;

  const rows = Array.from(t.querySelectorAll('tbody tr, tfoot tr'));
  let total = 0;

  const targetRows = rows.filter(r => {
    const first = (r.cells?.[0]?.textContent || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const search = String(matches[0]).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    // Usamos .includes para ser más robustos frente a espacios o prefijos/sufijos
    return first.includes(search);
  });

  for (const row of targetRows) {
    for (let i = row.cells.length - 1; i >= 1; i--) {
      const cell = row.cells[i];
      const raw = cell.querySelector("input")?.value || cell.textContent || "";
      const txt = String(raw).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "").trim();
      const n = Number(txt);
      if (txt !== "" && Number.isFinite(n) && n !== 0) {
        total += n;
        break; // Pasamos a la siguiente fila una vez encontrado el real de esta
      }
    }
  }
  return total;
}

function getLaboratorioTotalFromRenderedTable() {
  const root = document.querySelector('#tbl-lab');
  if (!root) return 0;

  const t = root.querySelector('table');
  if (!t) return 0;

  // 1. Intentar encontrar una fila explícita de total
  const rows = Array.from(t.querySelectorAll('tbody tr, tfoot tr'));
  for (const tr of rows) {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 2) {
      const label = (tds[0].textContent || "").toLowerCase().trim();
      if (label.includes('total') || label.includes('sumatoria')) {
        const raw = tds[1].querySelector('input')?.value || tds[1].textContent || "0";
        const txt = String(raw)
          .replace(/\./g, "")
          .replace(",", ".")
          .replace(/[^\d.-]/g, "")
          .trim();
        const n = Number(txt);
        // ✅ NOTA: El total en la tabla ya viene dividido entre 2 por paintAll, lo devolvemos tal cual
        return Number.isFinite(n) ? Math.round(n) : 0;
      }
    }
  }

  // 2. Si no existe fila total, usar la misma lógica especial que ya usas en tableToData('#tbl-lab')
  const ths = t.querySelectorAll('thead th span');
  const tds = t.querySelectorAll('tbody td');

  let total = 0;
  ths.forEach((span, i) => {
    const label = (span.textContent || "").trim().toLowerCase();
    if (!label || label.includes('total')) return; // Evitar sumar la columna de TOTAL ya dividida

    const td = tds[i + 1];
    if (!td) return;

    const raw = td.querySelector('input')?.value || td.textContent || "0";
    const txt = String(raw)
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
      .trim();

    const n = Number(txt);
    if (Number.isFinite(n)) total += n;
  });

  // ✅ REGLA ACTUALIZADA: Se elimina la división por 2 a solicitud del usuario. El valor real es el doble.
  return Math.round(total);
}

function buildRealAlignmentDataFromTables() {
  const sumImg =
    getNumericFromRenderedTable('#tbl-img-tot', 'Imágenes (Total)') +
    getNumericFromRenderedTable('#tbl-img-tot', 'Pacientes (Total)') +
    getNumericFromRenderedTable('#tbl-img-tot', 'Procedimientos guiados (Total)');

  return {
    urgencias: getNumericFromRenderedTable('#tbl-urg', 'triages + ortopedia'),
    hospitalizacion: getNumericFromRenderedTable('#tbl-hosp', 'egresos'),
    uci: getNumericFromRenderedTable('#tbl-uci', 'egresos'),
    uce: getNumericFromRenderedTable('#tbl-uce', 'egresos'),
    cirugia: getNumericFromRenderedTable('#tbl-cx-ing', 'procedimientos (ingresos)'),
    consultaExterna: getNumericFromRenderedTable('#tbl-ce', 'total'),
    laboratorio: getLaboratorioTotalFromRenderedTable(),
    imagenes: sumImg,
    imagenesTac: getSumNumericFromRenderedTable('#tbl-img-tot', 'Tomografías'),
    imagenesRx: getSumNumericFromRenderedTable('#tbl-img-tot', 'Rayos X'),
    imagenesEco: getSumNumericFromRenderedTable('#tbl-img-tot', 'Ecografías')
  };
}

const STRATEGIC_WEIGHT = {
  urgencias: "Alto",
  hospitalizacion: "Alto",
  uci: "Alto",
  uce: "Medio",
  cirugia: "Alto",
  consultaExterna: "Medio",
  laboratorio: "Alto",
  imagenes: "Medio",
  imagenesTac: "Alto",
  imagenesRx: "Alto",
  imagenesEco: "Medio"
};

const STRATEGIC_WEIGHT_VAL = { "Alto": 3, "Medio": 2, "Bajo": 1 };

function classifyEstado(cumplimiento) {
  if (cumplimiento < 80) return "Crítica";
  if (cumplimiento < 90) return "Alta";
  if (cumplimiento < 100) return "Media";
  if (cumplimiento <= 110) return "Cumple";
  return "Sobrecumple";
}

function classifyPrioridad(estado, impacto) {
  if (estado === "Crítica" && impacto === "Alto") return "Intervención inmediata";
  if (estado === "Crítica" && impacto === "Medio") return "Acción prioritaria";
  if (estado === "Alta" && impacto === "Alto") return "Acción prioritaria";
  if (estado === "Alta") return "Seguimiento directivo";
  if (estado === "Media") return "Vigilancia";
  if (estado === "Sobrecumple" && impacto === "Alto") return "Analizar sobreproducción";
  return "Estable";
}

function buildStrategicAlignmentModel({ capMeta, capRows }) {
  const realData = buildRealAlignmentDataFromTables();
  const entries = [];
  const rows = capRows || [];

  for (const item of ALIGNMENT_CAP_MAP) {
    let real = Number(realData[item.key] || 0);
    let meta = Number(capMeta?.[item.key]?.metaMes || 0);

    // BÚSQUEDA DINÁMICA DE META EN FILAS DEL CAP (Firebase)
    if (rows.length > 0 && item.capMatch) {
      if (["imagenesRx", "imagenesEco"].includes(item.key)) meta = 0;

      const clean = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[´'"]/g, "").trim();
      const monthNum = Number(document.getElementById("month")?.value?.split('-')[1]) || 1;

      const isRx = item.key === "imagenesRx";
      const isEco = item.key === "imagenesEco";
      const isTac = item.key === "imagenesTac";

      const candidateRows = rows.map(r => {
        const rowAllValues = Object.values(r.values || {});
        const rowValsClean = rowAllValues.map(v => clean(v));
        
        let belongs = false;
        if (isRx && rowValsClean.some(v => v.includes("rayo") || v.includes("rx"))) belongs = true;
        if (isEco && rowValsClean.some(v => v.includes("eco") || v.includes("ecogra"))) belongs = true;
        if (isTac && rowValsClean.some(v => v.includes("tac") || v.includes("tomograf"))) belongs = true;

        if (!belongs) return null;

        let penalty = rowValsClean.some(v => v.includes("equi") || v.includes("dispo") || v.includes("tecnic")) ? -1000 : 0;

        // Extraemos todos los números disponibles en la fila
        const nums = rowAllValues
          .map(v => String(v || "").replace(/\./g, "").replace(",", "."))
          .filter(v => v !== "" && !isNaN(parseFloat(v)))
          .map(v => ({ val: v, num: parseFloat(v) }));
        
        const sumMonths = nums.reduce((acc, curr) => acc + curr.num, 0);
        return { row: r, nums, sumMonths, penalty };
      }).filter(x => x && x.nums.length >= 1);

      const isSubImg = ["imagenesTac", "imagenesRx", "imagenesEco"].includes(item.key);
      const finalists = isSubImg ? candidateRows.filter(c => c.sumMonths > 10) : candidateRows;

      const bestMatch = finalists.sort((a, b) => (b.penalty - a.penalty) || (b.sumMonths - a.sumMonths))[0];
      if (bestMatch) {
        const n = bestMatch.nums;
        if (isSubImg) {
           if (n.length === 1) meta = n[0].num; 
           else if (n.length >= 12) meta = n[n.length - (13 - monthNum)]?.num || n[monthNum - 1]?.num || 0;
           else meta = n[n.length - 1]?.num || 0;
        } else if (meta === 0) {
           meta = n[n.length >= 12 ? monthNum - 1 : n.length - 1]?.num || 0;
        }
      }
    }


    const brecha = real - meta;
    const cumplimiento = meta > 0 ? (real / meta) * 100 : 0;
    const esIncumplimiento = brecha < 0;

    const impacto = STRATEGIC_WEIGHT[item.key] || "Medio";
    const estado = classifyEstado(cumplimiento);
    const prioridad = classifyPrioridad(estado, impacto);

    // --- Métrica Avanzada: Tendencias ---
    let mesAnterior = 0, promHist = 0, variacionMes = 0;
    if (GLOBAL_YEARLY_DATASET) {
      const activeIdx = (Number(document.getElementById("month")?.value?.split('-')[1]) || 1) - 1;
      const dsKeyMap = {
        urgencias: "triages", hospitalizacion: "hosp", uci: "uci", uce: "uce",
        cirugia: "procs", consultaExterna: "ce", laboratorio: "laboratorio", imagenes: "img",
        imagenesTac: "tac", imagenesRx: "rx", imagenesEco: "eco"
      };
      const dsKey = dsKeyMap[item.key];
      if (dsKey && GLOBAL_YEARLY_DATASET[dsKey]) {
        const history = GLOBAL_YEARLY_DATASET[dsKey].real || [];
        mesAnterior = activeIdx > 0 ? history[activeIdx - 1] : 0;
        const validMonths = history.filter((v, idx) => v > 0 && idx <= activeIdx);
        promHist = validMonths.length > 0 ? validMonths.reduce((a, b) => a + b, 0) / validMonths.length : real;
        variacionMes = mesAnterior > 0 ? ((real / mesAnterior) - 1) * 100 : 0;
      }
    }

    entries.push({
      key: item.key,
      linea: item.label,
      real,
      meta,
      brecha,
      cumplimiento,
      impacto,
      estado,
      prioridad,
      esIncumplimiento,
      mesAnterior,
      promHist,
      variacionMes,
      pesoVal: STRATEGIC_WEIGHT_VAL[impacto] || 1
    });
  }

  const totalWeight = entries.reduce((s, e) => s + e.pesoVal, 0);
  entries.forEach(e => {
    e.scoreImpacto = (e.brecha / (e.meta || 1)) * (e.pesoVal / totalWeight) * 100;

    // Cálculos de variación MoM y Histórica
    e.varMoM = e.mesAnterior > 0 ? ((e.real - e.mesAnterior) / e.mesAnterior) * 100 : 0;
    e.varHist = e.promHist > 0 ? ((e.real - e.promHist) / e.promHist) * 100 : 0;
  });

  const order = {
    "Intervención inmediata": 6,
    "Acción prioritaria": 5,
    "Seguimiento directivo": 4,
    "Vigilancia": 3,
    "Analizar sobreproducción": 2,
    "Estable": 1
  };

  return entries.sort((a, b) => (order[b.prioridad] || 0) - (order[a.prioridad] || 0));
}

function renderAlineacionEstrategica(model, monthId) {
  const badge = document.getElementById("align-date-badge");
  const summary = document.getElementById("align-summary-cards");
  const alertBox = document.getElementById("align-main-alert");
  const ranking = document.getElementById("align-ranking");
  const matrix = document.getElementById("align-matrix");
  const mix = document.getElementById("align-mix");
  const insights = document.getElementById("align-insights");

  if (badge) badge.textContent = monthId;

  const criticas = model.filter(x => x.estado === "Crítica").length;
  const altas = model.filter(x => x.estado === "Alta").length;
  const alertasMax = model.filter(x => x.prioridad === "Intervención inmediata" || x.prioridad === "Acción prioritaria").length;

  const mejorCumple = [...model].sort((a, b) => b.cumplimiento - a.cumplimiento)[0];
  const mayorBrechaNeg = model.filter(x => x.esIncumplimiento).sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha))[0];

  if (badge) badge.textContent = monthId;

  // --- CARDS PARA LA DIRECTORA MÉDICA (BALANCE SIMPLE) ---
  if (summary) {
    summary.innerHTML = `
      <div class="kpi-card"><span class="kpi-title">Estados Críticos</span><span class="kpi-value">${criticas}</span></div>
      <div class="kpi-card"><span class="kpi-title">Seguimiento Alto</span><span class="kpi-value">${altas}</span></div>
      <div class="kpi-card"><span class="kpi-title">Alertas de Acción</span><span class="kpi-value" style="color:#ef4444;">${alertasMax}</span></div>
      <div class="kpi-card"><span class="kpi-title">Mejor Cumplimiento</span><span class="kpi-value">${mejorCumple?.linea || '--'}</span></div>
    `;
  }

  // --- GUÍA DE INTERPRETACIÓN ESTRATÉGICA (PROTOCOLO NEUTRAL) ---
  const mainExplanation = document.getElementById("align-intel-explanation");
  if (mainExplanation) {
    mainExplanation.innerHTML = `
      <div style="margin-bottom:24px; padding:20px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; border-left: 8px solid var(--pri); box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
        <h4 style="margin:0 0 10px 0; color:var(--pri-dark); font-size:1.1rem; display:flex; align-items:center; gap:10px; text-transform:uppercase; letter-spacing:0.5px;">
          <i data-lucide="info" style="width:20px; height:20px; color:var(--pri);"></i>
          Guía de Interpretación Estratégica
        </h4>
        <p style="margin:0 0 15px 0; font-size:0.85rem; color:var(--text-muted); font-style:italic;">
          Protocolo estandarizado para la revisión ágil de desviaciones operativas y toma de decisiones.
        </p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:15px;">
          <div style="background:white; padding:15px; border-radius:10px; border:1px solid #e2e8f0;">
            <strong style="color:var(--pri); display:block; margin-bottom:5px; font-size:0.85rem;">1. Detección de Alertas</strong>
            <p style="margin:0; font-size:0.8rem; color:var(--text-main); line-height:1.4;">Identifique el número de <strong>Alertas de Acción</strong> en el panel superior. Indica la cantidad de servicios con desviaciones críticas que requieren intervención inmediata.</p>
          </div>
          <div style="background:white; padding:15px; border-radius:10px; border:1px solid #e2e8f0;">
            <strong style="color:var(--pri); display:block; margin-bottom:5px; font-size:0.85rem;">2. Análisis de Brecha</strong>
            <p style="margin:0; font-size:0.8rem; color:var(--text-main); line-height:1.4;">En el <strong>Ranking</strong>, la columna "Brecha" refleja <strong>la diferencia</strong> neta entre el volumen real y la meta CAP. Un valor negativo indica producción pendiente, mientras uno positivo indica excedente operativo.</p>
          </div>
          <div style="background:white; padding:15px; border-radius:10px; border:1px solid #e2e8f0;">
            <strong style="color:var(--pri); display:block; margin-bottom:5px; font-size:0.85rem;">3. Evaluación de Compensación</strong>
            <p style="margin:0; font-size:0.8rem; color:var(--text-main); line-height:1.4;">El <strong>Diagnóstico de Atribución</strong> diferencia los servicios que frenan el resultado institucional de aquellos que están compensando el déficit activamente.</p>
          </div>
        </div>
      </div>
    `;
  }

  if (alertBox) {
    alertBox.innerHTML = mayorBrechaNeg ? `
      <div class="alert-item">
        <i data-lucide="siren" style="color:#ef4444;"></i>
        <div>
          <strong>${mayorBrechaNeg.linea} (${mayorBrechaNeg.prioridad})</strong><br>
          Faltante: ${Math.abs(mayorBrechaNeg.brecha).toLocaleString('es-CO')} · Estado: ${mayorBrechaNeg.estado}
        </div>
      </div>
    ` : `<div class="alert-item"><i data-lucide="check-circle" style="color:#10b981;"></i><div><strong>Operación Alineada</strong><br>No se detectan intervenciones inmediatas pendientes.</div></div>`;
  }

  if (ranking) {
    ranking.innerHTML = `
      <div style="margin-bottom:15px; padding:12px; background:#f8fafc; border-left:5px solid var(--pri); border-radius:8px; font-size:0.85rem; color:var(--text-main);">
        <p style="margin:0 0 8px 0;"><strong>ANÁLISIS ESTRATÉGICO:</strong> Las líneas al inicio de la tabla (Críticas) son el origen del déficit institucional.</p>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; font-size:0.75rem;">
          <div style="background:white; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
            <strong style="color:#ef4444;">ALERTA:</strong> Si la <strong>Brecha</strong> es negativa y la <strong>Tendencia</strong> baja (↓), se requiere intervención en procesos asistenciales de inmediato.
          </div>
          <div style="background:white; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
            <strong style="color:#10b981;">OPORTUNIDAD:</strong> Si hay <strong>Brecha</strong> negativa pero la <strong>Tendencia</strong> es alta (↑), el servicio está en fase de recuperación operativa.
          </div>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Línea</th>
            <th>Real</th>
            <th>Meta CAP</th>
            <th>Brecha (La diferencia)</th>
            <th>% Cumpl.</th>
            <th>Tendencia</th>
            <th>vs Hist.</th>
            <th>Estado</th>
            <th>Prioridad</th>
          </tr>
        </thead>
        <tbody>
          ${model.map(x => {
      const estadoClass =
        x.estado === 'Crítica' ? 'err' :
          x.estado === 'Alta' ? 'warn' :
            x.estado === 'Media' ? 'warn' :
              'ok';

      const momIcon = x.varMoM > 0 ? '↑' : (x.varMoM < 0 ? '↓' : '→');
      const momColor = x.varMoM > 0 ? '#10b981' : (x.varMoM < 0 ? '#ef4444' : '#64748b');
      const histColor = x.varHist > 0 ? '#10b981' : (x.varHist < 0 ? '#ef4444' : '#64748b');

      return `
              <tr>
                <td style="font-weight:700;">${x.linea}</td>
                <td>${x.real.toLocaleString('es-CO')}</td>
                <td>${x.meta.toLocaleString('es-CO')}</td>
                <td style="color:${x.brecha < 0 ? '#ef4444' : '#10b981'}; font-weight:700;">${x.brecha.toLocaleString('es-CO')}</td>
                <td style="font-weight:700;">${x.cumplimiento.toFixed(1)}%</td>
                <td style="color:${momColor}; font-weight:700;">${momIcon} ${Math.abs(x.varMoM).toFixed(1)}%</td>
                <td style="color:${histColor}; opacity:0.8;">${x.varHist > 0 ? '+' : ''}${x.varHist.toFixed(1)}%</td>
                <td><span class="kpi ${estadoClass}">${x.estado}</span></td>
                <td style="font-size:0.75rem;">${x.prioridad}</td>
              </tr>
            `;
    }).join('')}
        </tbody>
      </table>
    `;
  }

  if (matrix) {
    matrix.innerHTML = `
      <div class="perf-matrix">
        ${model.map(x => `
          <div class="perf-cell" style="border-left: 4px solid ${x.esIncumplimiento ? '#ef4444' : '#10b981'}">
            <span class="p-label">${x.linea}</span>
            <div class="p-val">${x.impacto} / ${x.estado}</div>
            <small style="opacity:0.7;">${x.prioridad}</small>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (mix) {
    const frenos = model.filter(x => x.esIncumplimiento).sort((a, b) => a.brecha - b.brecha);
    const sosten = model.filter(x => !x.esIncumplimiento).sort((a, b) => b.brecha - a.brecha);

    let htmlFrenos = frenos.map(x => `
      <div style="margin-bottom:10px; padding:12px; border-radius:8px; border-left:5px solid #ef4444; background:#fef2f2; border:1px solid #fee2e2; border-left-width:5px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; color:#b91c1c; font-size:0.9rem;">${x.linea} (FRENO)</span>
          <span style="font-weight:900; color:#ef4444;">-${Math.abs(x.brecha).toLocaleString('es-CO')} serv.</span>
        </div>
        <p style="margin:5px 0 0 0; font-size:0.8rem; color:#7f1d1d;">
          Esta línea es la que más está <b>restando</b> tracción al cumplimiento global. Representa una alerta de tipo: <strong>${x.prioridad}</strong>.
        </p>
      </div>
    `).join('');

    let htmlSosten = sosten.map(x => `
      <div style="margin-bottom:10px; padding:12px; border-radius:8px; border-left:5px solid #10b981; background:#f0fdf4; border:1px solid #dcfce7; border-left-width:5px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; color:#166534; font-size:0.9rem;">${x.linea} (SOSTÉN)</span>
          <span style="font-weight:900; color:#10b981;">+${x.brecha.toLocaleString('es-CO')} serv.</span>
        </div>
        <p style="margin:5px 0 0 0; font-size:0.8rem; color:#14532d;">
          Esta línea está <b>impulsando</b> el cierre y compensando el déficit de otras áreas. Operación estable.
        </p>
      </div>
    `).join('');

    mix.innerHTML = `
      <div class="insight-box" style="background:#fff; border-top: 4px solid var(--pri);">
        <p style="margin:0 0 15px 0; font-size:1rem; font-weight:800; color:var(--pri-dark);">
          DIAGNÓSTICO DE ATRIBUCIÓN Y DINÁMICA OPERATIVA
        </p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
          <div>
            <h5 style="margin:0 0 10px 0; font-size:0.75rem; color:#ef4444; letter-spacing:1px; text-transform:uppercase;">🚫 Servicios que frenan el cumplimiento</h5>
            ${htmlFrenos || '<p style="font-size:0.8rem; color:var(--text-muted);">No se detectan líneas con Diferencia negativa.</p>'}
          </div>
          <div>
            <h5 style="margin:0 0 10px 0; font-size:0.75rem; color:#10b981; letter-spacing:1px; text-transform:uppercase;">🚀 Servicios que sostienen el resultado</h5>
            ${htmlSosten || '<p style="font-size:0.8rem; color:var(--text-muted);">No hay líneas operando por encima de la meta.</p>'}
          </div>
        </div>
        <div style="margin-top:20px; padding:12px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0; font-size:0.85rem;">
          <strong>Acción Sugerida:</strong> El foco directivo debe estar en los servicios marcados como <b>FRENO</b> para recuperar la Diferencia de ${frenos.length} líneas críticas.
        </div>
      </div>
    `;
  }

  if (insights) {
    const totalReal = model.reduce((s, x) => s + x.real, 0);
    const totalMeta = model.reduce((s, x) => s + x.meta, 0);
    const totalCumple = ((totalReal / (totalMeta || 1)) * 100).toFixed(1);

    // Segmentación
    const asistenciales = model.filter(x => ['Hospitalización', 'UCI', 'Urgencias', 'Cirugía', 'UCE'].includes(x.linea));
    const apoyo = model.filter(x => ['Laboratorio', 'Imágenes Diagnósticas', 'Consulta Externa'].includes(x.linea));

    const criticas = model.filter(x => x.esIncumplimiento).sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha));
    const motores = model.filter(x => !x.esIncumplimiento && x.cumplimiento > 105).sort((a, b) => b.brecha - a.brecha);
    const malasTendencias = model.filter(x => x.varMoM < -5 && x.esIncumplimiento);

    insights.innerHTML = `
      <div style="line-height:1.7; color:var(--text-main); font-size:0.95rem; background:#fff; padding:20px; border-radius:12px; border:1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="margin-bottom:20px; border-bottom:2px solid #f1f5f9; padding-bottom:15px;">
          <h4 style="margin:0 0 10px 0; color:var(--pri-dark); font-size:1rem; text-transform:uppercase; letter-spacing:1px;">1. BALANCE INSTITUCIONAL</h4>
          <p style="margin:0;">
            Durante el mes de <b>${monthId}</b>, la institución ejecutó un volumen de <b>${totalReal.toLocaleString('es-CO')}</b> servicios frente a una meta CAP de <b>${totalMeta.toLocaleString('es-CO')}</b>, alcanzando un cumplimiento global del <strong>${totalCumple}%</strong>. 
            ${totalCumple >= 100 ? '<span style="color:#10b981; font-weight:700;">El periodo cierra con superávit operativo.</span>' : `Se registra un déficit consolidado de <b>${Math.abs(totalReal - totalMeta).toLocaleString('es-CO')}</b> servicios pendientes.`}
          </p>
        </div>
        
        <div style="margin-bottom:20px;">
          <h4 style="margin:0 0 10px 0; color:var(--pri-dark); font-size:0.9rem;">2. DESEMPEÑO POR SEGMENTO OPERATIVO</h4>
          <p style="margin:0 0 10px 0;">
            • <b>Bloque Asistencial:</b> El comportamiento está liderado por <b>${asistenciales.sort((a, b) => b.cumplimiento - a.cumplimiento)[0]?.linea || 'N/A'}</b> (${asistenciales.sort((a, b) => b.cumplimiento - a.cumplimiento)[0]?.cumplimiento.toFixed(1)}%). 
          </p>
          <p style="margin:0;">
            • <b>Apoyo y Diagnóstico:</b> Se observa una ${apoyo.every(x => x.cumplimiento >= 95) ? 'tracción positiva' : 'desviación controlada'}, destacando a <b>${apoyo.sort((a, b) => b.cumplimiento - a.cumplimiento)[0]?.linea}</b> como principal motor de este segmento.
          </p>
        </div>

        <div style="margin-bottom:20px; background:#f8fafc; padding:15px; border-radius:10px; border-left:4px solid var(--pri);">
          <h4 style="margin:0 0 10px 0; color:var(--pri-dark); font-size:0.9rem;">3. DINÁMICA DE COMPENSACIÓN</h4>
          <p style="margin:0;">
            La Diferencia más crítica se localiza en <b>${criticas[0]?.linea || 'Ninguno'}</b> con un faltante de ${Math.abs(criticas[0]?.brecha || 0).toLocaleString('es-CO')} servicios. 
            Esta desviación está siendo compensada activamente por el sobrecumplimiento en <b>${motores.map(x => x.linea).join(', ') || 'ninguna línea adicional'}</b>, que aportan un volumen extra de ${motores.reduce((s, x) => s + x.brecha, 0).toLocaleString('es-CO')} servicios para sostener el balance final.
          </p>
        </div>

        <div style="padding:15px; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; border-left:4px solid #ef4444;">
          <h4 style="margin:0 0 10px 0; color:#dc2626; font-size:0.9rem; font-weight:800;">4. RIESGOS ESTRATÉGICOS Y TENDENCIA</h4>
          ${malasTendencias.length > 0
        ? `Se identifica un riesgo de <b>Debilitamiento de Tendencia</b> en <b>${malasTendencias.map(x => x.linea).join(', ')}</b>. Estos servicios, además del incumplimiento, muestran una caída mayor al 5% respecto al mes previo, lo que indica un deterioro progresivo de la capacidad instalada.`
        : 'No se identifican servicios con indicadores de alerta simultánea en cumplimiento y tendencia MoM.'}
        </div>
      </div>
    `;
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function normalizeCapText(txt) {
  return String(txt || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toCapNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;

  const raw = String(value).trim();

  // Si viene como 3,82 o 35,942 y NO tiene punto,
  // en CAP lo interpretamos como separador de miles, no decimal.
  if (/^\d+,\d{1,3}$/.test(raw) && !raw.includes('.')) {
    const parts = raw.split(',');
    const entero = parts[0];
    const frac = parts[1];

    if (frac.length === 1) return Number(entero + frac + "00");
    if (frac.length === 2) return Number(entero + frac + "0");
    if (frac.length === 3) return Number(entero + frac);
  }

  const txt = raw
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "")
    .trim();

  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
}

function findCapHeaderRow(capRows) {
  return capRows.findIndex(row =>
    row.some(cell => {
      const txt = String(cell || "").toLowerCase();
      // Buscamos algo que parezca una fecha (ene-26, 2026-03, etc.)
      return /ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic/.test(txt) ||
        (/^\d{4}-\d{2}/.test(txt)); // Formato ISO 2026-03...
    })
  );
}

function getCapMonthColumn(headerRow, monthId) {
  if (!headerRow) return -1;
  const [yyyy, mm] = monthId.split("-"); // "2026", "03"

  const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const labelShort = `${monthNames[parseInt(mm) - 1]}-${yyyy.slice(2)}`; // "mar-26"

  return headerRow.findIndex(cell => {
    if (!cell) return false;
    const txt = String(cell).toLowerCase();

    // Opción A: Match exacto (mar-26)
    if (txt.includes(labelShort)) return true;

    // Opción B: Si viene como fecha ISO (2026-03-01...)
    if (txt.startsWith(`${yyyy}-${mm}`)) return true;

    return false;
  });
}

function extractStrategicCapMeta(capRows, monthId) {
  const headerIdx = findCapHeaderRow(capRows);
  if (headerIdx < 0) throw new Error("No se encontró encabezado mensual en CAP.");

  const headerRow = capRows[headerIdx];
  const monthCol = getCapMonthColumn(headerRow, monthId);
  if (monthCol < 0) {
    console.warn(`No se encontró columna CAP para ${monthId}. Se usará búsqueda dinámica.`);
    return {};
  }

  const metas = {};

  for (const item of ALIGNMENT_CAP_MAP) {
    const row = capRows.find(r => {
      const c0 = normalizeCapText(r[0]);
      const c1 = normalizeCapText(r[1]);
      const c2 = normalizeCapText(r[2]);
      return c0.includes(item.capMatch) || c1.includes(item.capMatch) || c2.includes(item.capMatch);
    });

    if (!row) {
      metas[item.key] = {
        label: item.label,
        metaMes: 0,
        rawLabel: ""
      };
      continue;
    }

    metas[item.key] = {
      label: item.label,
      metaMes: toCapNumber(row[monthCol]),
      rawLabel: row[1] || row[2] || row[0] || ""
    };
  }

  return metas;
}

async function renderCapPreview() {
  const monthVal = document.getElementById("month")?.value;
  if (!monthVal) { alert("Selecciona un mes para determinar el año."); return; }
  const year = monthVal.split("-")[0];

  const capModal = document.getElementById("capModal");
  const capContent = document.getElementById("capPreviewContent");
  const capMetaInfo = document.getElementById("capMetaInfo");

  if (!capModal || !capContent) return;

  capModal.style.display = "flex";
  capContent.innerHTML = '<p style="text-align:center; padding:40px; color:#64748b;">Consultando base de datos...</p>';

  try {
    const data = await loadCap(year);
    if (!data.meta) {
      capContent.innerHTML = '<p style="text-align:center; padding:40px; color:#dc2626; font-weight:700;">No hay CAP cargado para el año ' + year + '</p>';
      return;
    }

    capMetaInfo.textContent = `Archivo: ${data.meta.fileName} | Subido: ${data.meta.uploadedAt?.toDate ? data.meta.uploadedAt.toDate().toLocaleString() : 'Recientemente'}`;

    // Construir tabla HTML
    let html = '<table style="width:100%; border-collapse:collapse; font-size:0.8rem; background:white;">';
    data.rows.forEach(row => {
      html += '<tr>';
      (row.values || []).forEach(cell => {
        html += `<td style="border:1px solid #e2e8f0; padding:4px; min-width:80px;">${cell ?? ''}</td>`;
      });
      html += '</tr>';
    });
    html += '</table>';

    capContent.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (err) {
    console.error(err);
    capContent.innerHTML = `<p style="text-align:center; padding:40px; color:#dc2626;">Error al cargar vista: ${err.message}</p>`;
  }
}

/* ----------------------------------------------------------------------- */
/*  ESTADÍSTICAS DIARIAS  (anidado + plano por prefijo + plano por fecha)  */
/* ----------------------------------------------------------------------- */
async function fetchDailyDocs(year, month0) {
  const y = String(year).padStart(4, '0');
  const mmPad = String(month0 + 1).padStart(2, '0'); // "09"
  const mmBare = String(month0 + 1);                 // "9"
  const monthList = [mmPad, mmBare];

  const dias = [];

  const mergeUnidad = (diario, snap) => {
    snap.forEach(du => {
      const nombre = (du.id || 'UNIDAD').toString();
      const key = nombre.toUpperCase();
      diario[key] = Object.assign({}, diario[key] || {}, (du.data() || {}));
    });
  };

  // ---------- A) Estructura anidada: realizados/{y}/{mm}/{dd}/(kpi|unidades)
  for (const mm of monthList) {
    try {
      const monthCol = collection(db, CFG.coleccionDiaria, y, mm);
      const daysSnap = await getDocs(monthCol);
      if (daysSnap.empty) { console.info(`[Diarias] vacío: ${y}/${mm}`); continue; }

      let found = false;
      for (const dayDoc of daysSnap.docs) {
        const dd = dayDoc.id;
        if (!/^\d{1,2}$/.test(dd)) continue; // 1..31 o 01..31

        const diario = { fecha: Timestamp.fromDate(new Date(Number(y), Number(mm) - 1, Number(dd))) };

        try {
          const kpiSnap = await getDocs(collection(db, dayDoc.ref, 'kpi'));
          kpiSnap.forEach(dk => Object.assign(diario, dk.data() || {}));
        } catch (_) { }

        try {
          const uniSnap = await getDocs(collection(db, dayDoc.ref, 'unidades'));
          mergeUnidad(diario, uniSnap);
        } catch (_) { }

        if (Object.keys(diario).length > 1) { dias.push(diario); found = true; }
      }

      if (found) {
        console.info(`[Diarias] OK anidado realizados/${y}/${mm} -> ${dias.length} días`);
        return dias;
      }
    } catch (e) {
      console.warn(`[Diarias] error en ${y}/${mm}:`, e?.code, e?.message);
    }
  }

  // ---------- B) Colección PLANA por prefijo de ID (2025-09-, 202509, etc.)
  try {
    const raiz = collection(db, CFG.coleccionDiaria);
    const all = await getDocs(raiz);

    const pref = [
      `${y}-${mmPad}-`, `${y}-${mmBare}-`, // 2025-09- | 2025-9-
      `${y}${mmPad}`, `${y}${mmBare}`    // 202509   | 20259
    ];

    all.forEach(d => {
      if (pref.some(p => d.id.startsWith(p))) {
        const diario = { fecha: Timestamp.fromDate(new Date(year, month0, 1)) };
        Object.assign(diario, d.data() || {});
        dias.push(diario);
      }
    });

    if (dias.length) {
      console.info(`[Diarias] OK plano por ID -> ${dias.length} días`);
      return dias;
    }
  } catch (e) {
    console.warn('[Diarias] plano por ID falló:', e?.code, e?.message);
  }

  // ---------- C) Colección PLANA filtrando por campos de fecha ----------
  try {
    const raiz = collection(db, CFG.coleccionDiaria);
    const all = await getDocs(raiz);
    all.forEach(d => {
      const data = d.data() || {};
      const fTs = data.fecha || data.Fecha;
      const fIso = data.fechaISO || data.fechaStr || data['fecha'];
      const fNum = data.fechaNum || data.FechaNum;

      let dt = null;
      if (fTs && fTs.toDate) dt = fTs.toDate();
      else if (typeof fIso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fIso)) dt = new Date(fIso);
      else if (typeof fNum === 'number') {
        const s = String(fNum);
        const yy = Number(s.slice(0, 4)), mm = Number(s.slice(4, 6)) - 1, dd = Number(s.slice(6, 8));
        dt = new Date(yy, mm, dd || 1);
      }

      if (dt && dt.getFullYear() == year && dt.getMonth() == month0) {
        dias.push(Object.assign({ fecha: Timestamp.fromDate(dt) }, data));
      }
    });

    if (dias.length) {
      console.info(`[Diarias] OK plano por campos de fecha -> ${dias.length} días`);
      return dias;
    }
  } catch (e) {
    console.error(`[Diarias] Plano por campos falló:`, e?.code, e?.message);
  }

  console.warn('[Diarias] No se encontró información para ese mes.');
  return [];
}

/* === LISTAS OBLIGATORIAS (etiquetas exactas) =========================== */
const HEMO_LINEAS = [
  // Aplicaciones
  "APLICACION DE LA UNIDAD DE GLOBULOS ROJOS O ERITROCITOS",
  "APLICACION DE LA UNIDAD DE PLAQUETAS TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO",
  "APLICACION DE PLASMA FRESCO O CONGELADO",
  "APLICACION DE LA UNIDAD DE CRIOPRECIPITADO TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO",
  // Unidades
  "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS (ESTANDAR)",
  "UNIDAD DE CONCENTRADO DE PLAQUETAS POR AFERESIS O PLAQUETOFERESIS TARIFA HASTA 6 UNIDADES POR SISTEMA ABIERTO O CERRADO",
  "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS DESLEUCOCITADOS APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%",
  "UNIDAD DE PLASMA FRESCO",
  "UNIDAD DE CRIOPRECIPITADO",
  "UNIDAD DE SANGRE TOTAL",
  "UNIDAD DE CONCENTRADO DE PLAQUETAS DELEUCOCITADOS (ESTANDAR) APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%",
  "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS IRRADIADOS",
  "UNIDAD DE CONCENTRADO DE LEUCOCITOS POR AFERESIS O LEUCOFERESIS",
  "UNIDAD DE CONCENTRADO DE PLAQUETAS (ESTANDAR)",
  "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS LAVADOS",
];

const LAB_HOSP_KEYS = [
  "INSTITUCIONAL", "Microbiologia", "PRIME", "SUESCUN", "COLCAN", "ANTIOQUIA",
  "CENTRO DE REFERENCIA", "LIME", "SYNLAB", "ICMT", "CIB", "UNILAB"
];

/* ----------------------------------------------------------------------- */
/*                         AGREGADOR (solo automáticos)                     */
/* ----------------------------------------------------------------------- */
function newAgg() {
  // Prefill mapas Hemocomponentes con todas las filas en 0
  const hemoApps = {}, hemoUnid = {};
  for (const etiqueta of HEMO_LINEAS) {
    if (etiqueta.startsWith("APLICACION")) hemoApps[etiqueta] = 0;
    else hemoUnid[etiqueta] = 0;
  }
  // Prefill Laboratorio hospitalario
  const labHosp = {}; LAB_HOSP_KEYS.forEach(k => labHosp[k] = 0);

  return {
    urg: { mg: 0, op: 0, totalUrg: 0, triNoAt: 0, totalTri: 0, ingresos: 0, traslados: 0, obsCMI: 0, egresosAt: 0, mas24h: 0 },
    cx: {
      ing: { ptesElect: 0, procElect: 0, ptesUrg: 0, procUrg: 0, ptesTotal: 0, procTotal: 0 },
      egr: { ptesHosp: 0, procHosp: 0, ptesAmb: 0, procAmb: 0, ptesTotal: 0, procTotal: 0 },
      uvrTotal: 0
    },
    cxEsp: {
      "CX. GENERAL": { ptes: 0, procs: 0, uvr: 0 },
      "ORTOPEDIA": { ptes: 0, procs: 0, uvr: 0 },
      "GINECOLOGIA": { ptes: 0, procs: 0, uvr: 0 },
      "UROLOGIA": { ptes: 0, procs: 0, uvr: 0 },
      "OTORRINO": { ptes: 0, procs: 0, uvr: 0 },
      "NEUROCIRUGIA": { ptes: 0, procs: 0, uvr: 0 },
      "MAXILOFACIAL": { ptes: 0, procs: 0, uvr: 0 },
      "BARIATRICA": { ptes: 0, procs: 0, uvr: 0 },
      "CX. GASTRICA": { ptes: 0, procs: 0, uvr: 0 },
      "CX. VASCULAR": { ptes: 0, procs: 0, uvr: 0 },
      "HEMATOLOGICA - ONCOLOGIA": { ptes: 0, procs: 0, uvr: 0 },
      "GINECO + CX GNAL": { ptes: 0, procs: 0, uvr: 0 },
      "OTROS": { ptes: 0, procs: 0, uvr: 0 }
    },
    hosp: { egresos: 0, diasO: 0, diasD: 0, pdeSum: 0, pdeN: 0, camasSum: 0, camasN: 0, pctSum: 0, pctN: 0 },
    uci: { egresos: 0, diasO: 0, diasD: 0, pdeSum: 0, pdeN: 0, pctSum: 0, pctN: 0 },
    uce: { egresos: 0, diasO: 0, diasD: 0, pdeSum: 0, pdeN: 0, pctSum: 0, pctN: 0 },
    ce: {
      "ANESTESIOLOGIA Y REANIMACION": 0, "CIRUGIA GENERAL": 0, "CIRUGIA MAXILOFACIAL": 0, "CIRUGIA VASCULAR": 0,
      "GINECOLOGIA Y OBSTETRICIA": 0, "HEMATO - ONCOLOGIA": 0, "GRUPO BARIATRICO": 0, "NEUROCIRUGIA": 0,
      "ORTOPEDIA Y TRAUMATOLOGIA": 0, "OTORRINOLARINGOLOGIA": 0, "UROLOGIA": 0, "OTROS": 0
    },
    hemoOnco: {
      quimioAmb: { unidades: 0, pacientes: 0 },
      quimioHosp: { oportunidadOk: 0, total: 0 },
      quimioAmbOport: { oportunidadOk: 0, total: 0 },
      aspiradoMO: { amb: 0, hosp: 0, oportunidadOk: 0, total: 0 },
      transfusiones: { pacientes: 0, unidades: 0 },
      flebotomia: 0, intratecales: 0, curacionPICC: 0
    },
    hemoComp: { aplicaciones: hemoApps, unidades: hemoUnid, pacientes: 0 },
    endo: { endoscopia: 0, colonoscopia: 0, fibrobroncospia: 0, cpre: 0, gastrostomia: 0, rectosig: 0, otros: 0, total: 0, ambulatorios: 0 },
    img: { hosp: { tac: 0, rx: 0, eco: 0, guiadosTac: 0, guiadosEco: 0 }, amb: { tac: 0, rx: 0, eco: 0, guiadosTac: 0, guiadosEco: 0 } },
    lab: { hosp: labHosp, part: { muestras: 0 } },
    est: { admisiones: 0, egresosAt: 0 }
  };
}

function reduceDailyToAgg(arr) {
  const A = newAgg();
  for (const d of arr) {
    /* ------------------- URGENCIAS ------------------- */
    const urg = d.urg || d.URGENCIAS || {};
    A.urg.mg += +(pick(urg, ['consultasMG', 'Medicina General', 'mg']) || 0);
    A.urg.op += +(pick(urg, ['consultasOP', 'Ortopedia y Pediatría', 'op']) || 0);
    A.urg.totalUrg += +(pick(urg, ['totalAtendidos', 'Atenciones', 'Total atenciones']) || 0);
    A.urg.triNoAt += +(pick(urg, ['triagesNoAt', 'Triages no atendidos']) || 0);
    A.urg.totalTri += +(pick(urg, ['totalTriages', 'Total triages', 'Triages']) || 0);
    A.urg.ingresos += +(pick(urg, ['totalIngresos', 'Ingresos']) || 0);
    A.urg.traslados += +(pick(urg, ['trasladosOtrosServ', 'Traslados']) || 0);
    A.urg.mas24h += +(pick(urg, ['mayor24h', '>=24h']) || 0);
    A.urg.obsCMI += +(pick(urg, ['observacionCMI', 'Obs CMI']) || 0);
    A.urg.egresosAt += +(pick(urg, ['egresosAtendidos', 'Egresos atendidos']) || 0);

    /* ------------------- CIRUGÍA GLOBAL ------------------- */
    const cx = d.cx || d.CIRUGIA || {};
    const ing = cx.ingresos || cx.Ingresos || {};
    const egr = cx.egresos || cx.Egresos || {};
    const procQxDia = +(pick(cx, ['procedimientosQuirurgicos', 'Procedimientos quirúrgicos']) || 0);

    A.cx.ing.ptesElect += +(pick(ing, ['ptesElectivos', 'Pacientes electivos']) || 0);
    A.cx.ing.procElect += +(pick(ing, ['procElectivos', 'Procedimientos electivos']) || 0);
    A.cx.ing.ptesUrg += +(pick(ing, ['ptesUrgentes', 'Pacientes urgentes']) || 0);
    A.cx.ing.procUrg += +(pick(ing, ['procUrgentes', 'Procedimientos urgentes']) || 0);
    A.cx.ing.ptesTotal += +(pick(ing, ['ptesTotal', 'Pacientes total']) || 0);
    A.cx.ing.procTotal += +(pick(ing, ['procTotal', 'procedimientosQuirurgicos']) ?? procQxDia ?? 0);

    A.cx.egr.ptesHosp += +(pick(egr, ['ptesHospitalizados', 'Pacientes hospitalizados']) || 0);
    A.cx.egr.procHosp += +(pick(egr, ['procHospitalizados', 'Procedimientos hospitalizados']) || 0);
    A.cx.egr.ptesAmb += +(pick(egr, ['ptesAmbulatorios', 'Pacientes ambulatorios']) || 0);
    A.cx.egr.procAmb += +(pick(egr, ['procAmbulatorios', 'Procedimientos ambulatorios']) || 0);
    A.cx.egr.ptesTotal += +(pick(egr, ['ptesTotal', 'Pacientes total']) || 0);
    A.cx.egr.procTotal += +(pick(egr, ['procTotal', 'procedimientosQuirurgicos']) ?? procQxDia ?? 0);

    A.cx.uvrTotal += +(pick(cx, ['uvrTotal', 'UVR total', 'uvr']) || 0);

    /* ------------------- CIRUGÍA POR ESPECIALIDAD (Agregador) ------------------- */
    const esps = d.cxEsp || d['cirugiaPorEspecialidad'] || d['CIRUGIA_ESP'] || {};
    // Normalizar llaves del doc actual
    const espsNorm = {};
    for (const [ek, ev] of Object.entries(esps)) { espsNorm[ek.toLowerCase()] = ev; }

    for (const k in A.cxEsp) {
      const e = espsNorm[k.toLowerCase()] || {};
      A.cxEsp[k].ptes += +(pick(e, ['ptes', 'Pacientes']) || 0);
      A.cxEsp[k].procs += +(pick(e, ['procs', 'Procedimientos']) || 0);
      A.cxEsp[k].uvr += +(pick(e, ['uvr', 'UVR', 'U.V.R.']) || 0);
    }

    /* ------------------- HOSP ------------------- */
    const hosp = d.hosp?.pisos || d.hosp || d.HOSPITALIZACION || {};
    A.hosp.egresos += +(pick(hosp, ['egresos', 'Egresos']) || 0);
    A.hosp.diasO += +(pick(hosp, ['diasOcup', 'Días camas ocupadas']) || 0);
    A.hosp.diasD += +(pick(hosp, ['diasDisp', 'Días camas disponibles']) || 0);
    const pdeH = pick(hosp, ['pde', 'PDE', 'PDE (Prom. Día Estancia)']);
    const camasH = pick(hosp, ['camasHosp', 'Camas Hospitalización']);
    const pctH = pick(hosp, ['pctOcup', '% Ocupación Hosp.', '% Ocupación']);
    if (pdeH != null) { A.hosp.pdeSum += +pdeH; A.hosp.pdeN++; }
    if (camasH != null) { A.hosp.camasSum += +camasH; A.hosp.camasN++; }
    if (pctH != null) { A.hosp.pctSum += +pctH; A.hosp.pctN++; }

    /* ------------------- UCI ------------------- */
    const uci = d.uci || d.UCI || {};
    A.uci.egresos += +(pick(uci, ['egresos', 'Egresos']) || 0);
    A.uci.diasO += +(pick(uci, ['diasOcup', 'Días camas ocupadas']) || 0);
    A.uci.diasD += +(pick(uci, ['diasDisp', 'Días camas disponibles']) || 0);
    const pdeUci = pick(uci, ['pde', 'PDE', 'Promedio día estancia']);
    const pctUci = pick(uci, ['pctOcup', '% Ocupación']);
    if (pdeUci != null) { A.uci.pdeSum += +pdeUci; A.uci.pdeN++; }
    if (pctUci != null) { A.uci.pctSum += +pctUci; A.uci.pctN++; }

    /* ------------------- UCE ------------------- */
    const uce = d.uce || d.UCE || {};
    A.uce.egresos += +(pick(uce, ['egresos', 'Egresos']) || 0);
    A.uce.diasO += +(pick(uce, ['diasOcup', 'Días camas ocupadas']) || 0);
    A.uce.diasD += +(pick(uce, ['diasDisp', 'Días camas disponibles']) || 0);
    const pdeUce = pick(uce, ['pde', 'PDE', 'Promedio día estancia']);
    const pctUce = pick(uce, ['pctOcup', '% Ocupación']);
    if (pdeUce != null) { A.uce.pdeSum += +pdeUce; A.uce.pdeN++; }
    if (pctUce != null) { A.uce.pctSum += +pctUce; A.uce.pctN++; }

    /* ------------------- CONSULTA EXTERNA ------------------- */
    const ce = d.ce?.especialidades || d.ce || d['CONSULTA EXTERNA'] || {};
    for (const esp in A.ce) {
      A.ce[esp] += +(pick(ce[esp] || {}, ['consultas', 'Consultas', 'total']) ?? ce[esp] ?? 0);
    }

    /* ------------------- HEMATO-ONCO ------------------- */
    const ho = d.hemoOnco || d['HEMATO-ONCO'] || {};
    A.hemoOnco.quimioAmb.unidades += +(pick(ho.quimioAmb || {}, ['unidades', 'Unidades']) || 0);
    A.hemoOnco.quimioAmb.pacientes += +(pick(ho.quimioAmb || {}, ['pacientes', 'Pacientes']) || 0);
    A.hemoOnco.quimioHosp.oportunidadOk += +(pick(ho.quimioHosp || {}, ['oportunidadOk', 'Ok']) || 0);
    A.hemoOnco.quimioHosp.total += +(pick(ho.quimioHosp || {}, ['total', 'Total']) || 0);
    A.hemoOnco.quimioAmbOport.oportunidadOk += +(pick(ho.quimioAmbOport || {}, ['oportunidadOk', 'Ok']) || 0);
    A.hemoOnco.quimioAmbOport.total += +(pick(ho.quimioAmbOport || {}, ['total', 'Total']) || 0);
    A.hemoOnco.aspiradoMO.amb += +(pick(ho.aspiradoMO || {}, ['amb', 'Amb']) || 0);
    A.hemoOnco.aspiradoMO.hosp += +(pick(ho.aspiradoMO || {}, ['hosp', 'Hosp']) || 0);
    A.hemoOnco.aspiradoMO.oportunidadOk += +(pick(ho.aspiradoMO || {}, ['oportunidadOk', 'Ok']) || 0);
    A.hemoOnco.aspiradoMO.total += +(pick(ho.aspiradoMO || {}, ['total', 'Total']) || 0);
    A.hemoOnco.transfusiones.pacientes += +(pick(ho.transfusiones || {}, ['pacientes', 'Pacientes']) || 0);
    A.hemoOnco.transfusiones.unidades += +(pick(ho.transfusiones || {}, ['unidades', 'Unidades']) || 0);
    A.hemoOnco.flebotomia += +(pick(ho, ['flebotomia', 'Flebotomía']) || 0);
    A.hemoOnco.intratecales += +(pick(ho, ['intratecales', 'Intratecales']) || 0);
    A.hemoOnco.curacionPICC += +(pick(ho, ['curacionPICC', 'Curación PICC']) || 0);

    /* ------------------- HEMOCOMPONENTES ------------------- */
    const hc = d.hemoComp || d['HEMOCOMPONENTES'] || {};
    const apps = hc.aplicaciones || hc['Aplicaciones'] || {};
    const unid = hc.unidades || hc['Unidades'] || {};

    // Mapeo robusto de aplicaciones
    for (const [dk, dv] of Object.entries(apps)) {
      const match = Object.keys(A.hemoComp.aplicaciones).find(ak => ak.toLowerCase() === dk.toLowerCase());
      if (match) A.hemoComp.aplicaciones[match] += +(dv || 0);
    }
    // Mapeo robusto de unidades
    for (const [dk, dv] of Object.entries(unid)) {
      const match = Object.keys(A.hemoComp.unidades).find(uk => uk.toLowerCase() === dk.toLowerCase());
      if (match) A.hemoComp.unidades[match] += +(dv || 0);
    }
    A.hemoComp.pacientes += +(pick(hc, ['pacientes', 'Pacientes']) || 0);

    /* ------------------- ENDOSCOPIA ------------------- */
    const en = d.endo || d.ENDOSCOPIA || {};
    A.endo.endoscopia += +(pick(en, ['endoscopia', 'Endoscopia']) || 0);
    A.endo.colonoscopia += +(pick(en, ['colonoscopia', 'Colonoscopia']) || 0);
    A.endo.fibrobroncospia += +(pick(en, ['fibrobroncospia', 'fibrobroncoscopia', 'Fibrobroncoscopia', 'Fibrobroncoscopía']) || 0);
    A.endo.cpre += +(pick(en, ['cpre', 'CPRE']) || 0);
    A.endo.gastrostomia += +(pick(en, ['gastrostomia', 'Gastrostomía']) || 0);
    A.endo.rectosig += +(pick(en, ['rectosig', 'Rectosigmoidoscopia']) || 0);
    A.endo.otros += +(pick(en, ['otros', 'Otros']) || 0);
    A.endo.ambulatorios += +(pick(en, ['ambulatorios', 'Ambulatorios']) || 0);

    /* ------------------- IMÁGENES ------------------- */
    const img = d.img || d['IMAGENES'] || {};
    const ih = img.hosp || img.Hospitalario || {};
    const ia = img.amb || img.Ambulatorio || {};
    A.img.hosp.tac += +(pick(ih, ['tac', 'TAC']) || 0);
    A.img.hosp.rx += +(pick(ih, ['rx', 'Rayos X']) || 0);
    A.img.hosp.eco += +(pick(ih, ['eco', 'Ecografías', 'Ecografias']) || 0);
    A.img.hosp.guiadosTac += +(pick(ih, ['guiadosTac', 'Guiados TAC']) || 0);
    A.img.hosp.guiadosEco += +(pick(ih, ['guiadosEco', 'Guiados ECO']) || 0);
    A.img.amb.tac += +(pick(ia, ['tac', 'TAC']) || 0);
    A.img.amb.rx += +(pick(ia, ['rx', 'Rayos X']) || 0);
    A.img.amb.eco += +(pick(ia, ['eco', 'Ecografías', 'Ecografias']) || 0);
    A.img.amb.guiadosTac += +(pick(ia, ['guiadosTac', 'Guiados TAC']) || 0);
    A.img.amb.guiadosEco += +(pick(ia, ['guiadosEco', 'Guiados ECO']) || 0);

    /* ------------------- LABORATORIO ------------------- */
    const lab = d.lab || d['LABORATORIO'] || {};
    const lh = lab.hosp || lab.Hospitalario || {};
    const lp = lab.part || lab.Particulares || {};

    // Normalizar llaves del laboratorio cargado
    const lhNorm = {};
    for (const [lk, lv] of Object.entries(lh)) { lhNorm[lk.toLowerCase()] = lv; }

    for (const k in A.lab.hosp) {
      A.lab.hosp[k] += +(lhNorm[k.toLowerCase()] || 0);
    }
    A.lab.part.muestras += +(pick(lp, ['muestras', 'Muestras']) || 0);

    /* ------------------- ESTADÍSTICA INSTITUCIONAL ------------------- */
    const es = d.est || d['ESTADISTICA'] || {};
    A.est.admisiones += +(pick(es, ['admisiones', 'Admisiones']) || 0);
    // Nota: egresosAt no lo sumamos aquí porque lo calcularemos dinámicamente
  }

  // ✅ Total de endoscopia incluyendo explícitamente la fibrobroncoscopia
  A.endo.total = (A.endo.endoscopia || 0) +
    (A.endo.colonoscopia || 0) +
    (A.endo.fibrobroncospia || 0) +
    (A.endo.cpre || 0) +
    (A.endo.gastrostomia || 0) +
    (A.endo.rectosig || 0) +
    (A.endo.otros || 0);
  return A;
}

/* -------------------- OVERRIDES (manual) -------------------- */
const keyify = s => (s || '')
  .toString()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, '-')
  .replace(/[^\w\-\.]/g, '');

function k(section, label) { return `${keyify(section)}|${keyify(label)}`; }

function getOverride(section, label) {
  if (!MANUAL_OVERRIDES) return null;
  const sec = section.toUpperCase();

  // 1. Intentar con prefijo exacto (Ej: URG|Total triages)
  const fullKey = `${sec}|${label}`;
  if (MANUAL_OVERRIDES[fullKey] !== undefined && MANUAL_OVERRIDES[fullKey] !== null) {
    return MANUAL_OVERRIDES[fullKey];
  }

  // 2. Intentar con la etiqueta sola (para datos viejos)
  if (MANUAL_OVERRIDES[label] !== undefined && MANUAL_OVERRIDES[label] !== null) {
    return MANUAL_OVERRIDES[label];
  }

  // 3. Fallback para Cirugía por Especialidad
  if (sec === "CIRUGIA_ESP") {
    const altKey = `CIRUGIA_ESP|${label}`;
    if (MANUAL_OVERRIDES[altKey] !== undefined) return MANUAL_OVERRIDES[altKey];
  }

  return null;
}

/* -------------------- RENDER TABLA INTEGRAL (TODOS LOS CÁLCULOS) ------------------------------ */
function renderTable(sectionId, rows, targetSel) {
  const el = $(targetSel); if (!el) return;

  const eff = rows.map(r => {
    const labelOriginal = r.label;

    // ✅ BUSQUEDA: Intenta recuperar el dato guardado (nuevo o viejo)
    const valRecuperado = getOverride(sectionId, labelOriginal);

    // Si hay dato en la DB lo usa, si no, usa el valor automático (agg)
    const val = (valRecuperado !== null) ? valRecuperado : (r.value ?? 0);

    return { ...r, _ovKey: labelOriginal, _val: val };
  });

  const byLabel = {};
  eff.forEach(r => byLabel[r.label] = Number(r._val || 0));
  const num = (label) => Number(byLabel[label] || 0);

  const computed = {};

  // --- 1. URGENCIAS ---
  if (sectionId === 'URGENCIAS') {
    computed['Total pacientes urgencias'] = num('Consultas medicina general') + num('Consultas ortopedia y pediatria');
    computed['Total triages'] = num('Consultas medicina general') + num('Triages no atendidos');
    computed['Total ingresos a urgencias (triages + ortopedia)'] = computed['Total pacientes urgencias'] + num('Triages no atendidos');
    computed['% pacientes que se trasladan a otros servicios'] = safeDiv(num('Ptes trasladados a otros servicios') * 100, computed['Total pacientes urgencias']);
    computed['Egresos atendidos urgencias'] = computed['Total pacientes urgencias'] - num('Ptes trasladados a otros servicios');
    computed['%Pacientes atendidos en urgencias'] = safeDiv(computed['Total pacientes urgencias'] * 100, computed['Total ingresos a urgencias (triages + ortopedia)']);
  }

  // --- 2. CIRUGÍA (INGRESOS Y EGRESOS) ---
  if (sectionId === 'CIRUGIA_ING') {
    computed['Total ingresos de pacientes'] = num('Pacientes urgentes (ingresos)') + num('Pacientes electivos (ingresos)');
    computed['Total procedimientos (ingresos)'] = num('Total procedimientos urgentes') + num('Total procedimientos electivos');
  }
  if (sectionId === 'CIRUGIA_EGR') {
    computed['Total egresos de pacientes'] = num('Pacientes hospitalizados') + num('Pacientes ambulatorios');
    computed['Total procedimientos (egresos)'] = num('Total procedimientos hospitalarios') + num('Total procedimientos ambulatorios');
  }

  // --- 4. HOSPITALIZACIÓN / UCI / UCE ---
  if (['HOSP', 'UCI', 'UCE'].includes(sectionId)) {
    computed['Promedio día estancia'] = safeDiv(num('Dias Camas Ocupadas'), num(sectionId === 'HOSP' ? 'EGRESOS HOSP. PUESTOS 2, 3 y 4' : (sectionId === 'UCI' ? 'EGRESOS DE UCI ADULTOS' : 'EGRESOS DE UCE ADULTOS')));
    computed['% OCUPACION'] = safeDiv(num('Dias Camas Ocupadas') * 100, num('Dias Camas Disponibles'));
    computed['% DE OCUPACION'] = computed['% OCUPACION']; // alias para UCI/UCE
  }

  // --- 4. CONSOLIDADO HOSP+UCE (INST) ---
  if (sectionId === 'INST') {
    computed['Promedio día estancia'] = safeDiv(num('Dias Camas Ocupadas'), num('EGRESOS UCE ADULTOS + HOSPITALIZACIÓN'));
    computed['% DE OCUPACION INSTITUCIONAL'] = safeDiv(num('TOTAL DIAS CAMAS OCUPADAS INSTITUCIONAL') * 100, num('TOTAL DIAS CAMAS DISPONIBLES INSTITUCIONAL'));
  }

  // --- 5. CONSULTA EXTERNA ---
  if (sectionId === 'CE') {
    let ceTotal = 0;
    eff.forEach(r => { if (r.label !== 'TOTAL') ceTotal += Number(r._val || 0); });
    computed['TOTAL'] = ceTotal;
  }

  // --- 7. HEMOCOMPONENTES ---
  if (sectionId === 'HEMOCOMP') {
    const apps = eff.filter(r => r.label.startsWith('APLICACION')).reduce((s, r) => s + Number(r._val || 0), 0);
    const unids = eff.filter(r => r.label.startsWith('UNIDAD')).reduce((s, r) => s + Number(r._val || 0), 0);
    computed['Total Aplicaciones'] = apps;
    computed['Total Unidades'] = unids;
    computed['TOTAL HEMOCOMPONENTES'] = apps + unids;
  }

  // --- 8. ENDOSCOPIA ---
  if (sectionId === 'ENDOS') {
    const labelsEndo = ['Endoscopia', 'Colonoscopia', 'Fibrobroncoscopia', 'CPRE', 'Gastrostomía', 'Rectosigmoidoscopia', 'Otros'];
    computed['TOTAL'] = labelsEndo.reduce((s, lab) => s + num(lab), 0);
  }

  // --- 9. IMÁGENES (CORRECCIÓN DEFINITIVA DE AUTOCÁLCULOS) ---
  if (sectionId === 'IMG') {
    // 1. Cálculos Hospitalarios
    const hTac = num('Tomografías (Hosp)');
    const hRx = num('Rayos X (Hosp)');
    const hEco = num('Ecografías (Hosp)');
    const hGTac = num('Procedimientos guiados por tomografías (Hosp)');
    const hGEco = num('Procedimientos guiados por ecografías (Hosp)');
    const hPac = num('Total pacientes (Hosp)'); // Este se deja manual para que el usuario lo digite

    const hTotalGui = hGTac + hGEco;
    const hTotalImg = hTac + hRx + hEco;

    computed['Total Procedimientos guiados (Hosp)'] = hTotalGui;
    computed['Total imágenes (Hosp)'] = hTotalImg;
    computed['Promedio exámenes por paciente (Hosp)'] = safeDiv(hTotalImg, hPac);

    // 2. Cálculos Ambulatorios
    const aTac = num('Tomografías (Amb)');
    const aRx = num('Rayos X (Amb)');
    const aEco = num('Ecografías (Amb)');
    const aGTac = num('Procedimientos guiados por tomografías (Amb)');
    const aGEco = num('Procedimientos guiados por ecografías (Amb)');
    const aPac = num('Total pacientes (Amb)'); // Este se deja manual

    const aTotalGui = aGTac + aGEco;
    const aTotalImg = aTac + aRx + aEco;

    computed['Total Procedimientos guiados (Amb)'] = aTotalGui;
    computed['Total imágenes (Amb)'] = aTotalImg;
    computed['Promedio exámenes por paciente (Amb)'] = safeDiv(aTotalImg, aPac);

    // 3. Cálculos Gran Total (Sección TOTAL)
    computed['Imágenes (Total)'] = hTotalImg + aTotalImg;
    computed['Pacientes (Total)'] = hPac + aPac;
    computed['Procedimientos guiados (Total)'] = hTotalGui + aTotalGui;
  }

  // --- 11. ESTADÍSTICAS INSTITUCIONALES ---
  if (sectionId === 'EST') {
    computed['% Atenciones efectivas'] = safeDiv(num('Atenciones efectivas (Egresos atendidos)') * 100, num('Total admisiones'));
  }

  // 3) RENDERIZADO DE LA TABLA
  const t = document.createElement('table');
  t.className = "table";
  t.innerHTML = `<thead><tr><th>Variable</th><th>Valor</th></tr></thead>`;
  const tb = document.createElement('tbody');

  eff.forEach(r => {
    const isComputed = Object.prototype.hasOwnProperty.call(computed, r.label);
    const value = isComputed ? computed[r.label] : r._val;
    const isHeader = (sectionId === 'IMG') && ["HOSPITALARIO", "AMBULATORIO", "TOTAL"].includes(r.label);

    // ✅ LÓGICA DE SEMÁFORO: Si la fila tiene meta, calculamos el indicador
    let kpiBadge = "";
    if (r.meta && r.meta > 0) {
      const cls = kpiClass(value, r.meta);
      const labelKpi = cls === 'ok' ? 'CUMPLE META' : cls === 'warn' ? 'CASI META' : 'NO CUMPLE';
      kpiBadge = `<span class="kpi ${cls}">${labelKpi}</span>`;
    }

    const tr = document.createElement('tr');
    if (isHeader) {
      tr.innerHTML = `<td colspan="2" style="background:#f1f5f9; font-weight:800; color:var(--pri-dark); text-align:center; padding:8px;">${r.label}</td>`;
    } else {
      const valTxt = (value === '' || value == null) ? '0' : (r.format === 'dec1' ? fmtDec1(value) : fmtInt(value));
      const rowStyle = isComputed ? 'style="font-weight:bold; background:#f8fafc; color:var(--pri-dark)"' : '';

      let valueCell = `
        <td class="mono" ${rowStyle}>
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <span>${valTxt}</span>
            ${kpiBadge}
          </div>
        </td>`;

      if (EDIT_MODE && !isComputed) {
        valueCell = `
          <td>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <input class="cell" type="number" value="${value}" data-section="${sectionId}" data-label="${r._ovKey}" style="width:80px"/>
              ${kpiBadge}
            </div>
          </td>`;
      }
      tr.innerHTML = `<td ${rowStyle}>${r.label}</td>${valueCell}`;
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  el.innerHTML = "";
  el.appendChild(t);

  // 4) Eventos
  if (EDIT_MODE) {
    el.querySelectorAll('input.cell').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const label = e.target.getAttribute('data-label');
        const section = e.target.getAttribute('data-section');
        const val = Number(e.target.value);

        // Guardamos con la llave exacta que espera el motor de Firebase y gráficas
        const fullKey = `${section.toUpperCase()}|${label}`;

        // Actualizamos MANUAL_OVERRIDES (la memoria de la página)
        MANUAL_OVERRIDES[label] = val;
        MANUAL_OVERRIDES[fullKey] = val;

        // Re-pintamos para actualizar totales automáticos
        paintAll(LAST_AGG, LAST_META);
      });
    });
  }
}

/* -------------------- PINTADO DE SECCIONES -------------------- */
function paintAll(agg, meta) {
  // ✅ Cálculo al inicio para que todas las tablas (Hosp, UCI, UCE) funcionen
  const [yearPart, monthPart] = CURRENT_MONTH_ID.split('-').map(Number);
  const diasMesCargado = new Date(yearPart, monthPart, 0).getDate();

  // ================= URGENCIAS ==========
  const pctAtendidos = pct(agg.urg.totalUrg, Math.max(1, agg.urg.totalUrg + agg.urg.triNoAt));
  const pctTraslados = pct(agg.urg.traslados, Math.max(1, agg.urg.totalUrg));

  // Capturamos el total de ingresos y la meta para el semáforo
  const totalIngresosCalculado = agg.urg.mg + agg.urg.op + agg.urg.triNoAt;
  const metaUrg = meta.urgenciasMeta ?? 0;

  const urgRows = [
    { label: "Consultas medicina general", value: agg.urg.mg },
    { label: "Consultas ortopedia y pediatria", value: agg.urg.op },
    { label: "Total pacientes urgencias", value: agg.urg.totalUrg },
    { label: "%Pacientes atendidos en urgencias", value: pctAtendidos, format: "dec1" },
    { label: "Triages no atendidos", value: agg.urg.triNoAt },
    { label: "Total triages", value: agg.urg.totalTri },
    // ✅ AQUÍ SE ACTIVA EL SEMÁFORO: vinculamos valor con meta
    { label: "Total ingresos a urgencias (triages + ortopedia)", value: totalIngresosCalculado, meta: metaUrg },
    { label: "Ptes trasladados a otros servicios", value: agg.urg.traslados },
    { label: "Urgencias = > 24 horas", value: agg.urg.mas24h },
    { label: "% pacientes que se trasladan a otros servicios", value: pctTraslados, format: "dec1" },
    { label: "Pacientes en observación CMI", value: agg.urg.obsCMI },
    { label: "Egresos atendidos urgencias", value: agg.urg.egresosAt },
    { label: "Meta presupuesto", value: metaUrg },
  ];
  renderTable("URGENCIAS", urgRows, "#tbl-urg");

  // ============= CIRUGÍA · Ingresos ========================
  const cxRowsIng = [
    { label: "Pacientes urgentes (ingresos)", value: 0 },
    { label: "Pacientes electivos (ingresos)", value: 0 },

    { label: "Total ingresos de pacientes", value: 0 },

    { label: "Total procedimientos urgentes", value: 0 },
    { label: "Total procedimientos electivos", value: 0 },

    { label: "Total procedimientos (ingresos)", value: 0, meta: meta.cxMetaProced ?? null }
  ];
  renderTable("CIRUGIA_ING", cxRowsIng, "#tbl-cx-ing");

  // ============= CIRUGÍA · Egresos =========================
  const cxRowsEgr = [
    { label: "Pacientes hospitalizados", value: 0 },
    { label: "Pacientes ambulatorios", value: 0 },

    { label: "Total egresos de pacientes", value: 0 },

    { label: "Total procedimientos hospitalarios", value: 0 },
    { label: "Total procedimientos ambulatorios", value: 0 },

    { label: "Total procedimientos (egresos)", value: 0, meta: meta.cxMetaProced ?? null }
  ];
  renderTable("CIRUGIA_EGR", cxRowsEgr, "#tbl-cx-egr");

  // ============= CIRUGÍA · Metas (solo mostrar números; sin semáforo) =====
  const cxRowsMeta = [
    { label: "Meta UVR mensual (Forecast)", value: meta.uvrMeta ?? 0, format: "raw" },
    { label: "Meta total de procedimientos (Forecast)", value: meta.cxMetaProced ?? 0 }
  ];
  renderTable("CIRUGIA_METAS", cxRowsMeta, "#tbl-cx-meta");

  // ============= 3. CIRUGÍA POR ESPECIALIDAD (TABLA 4 COLUMNAS) =============
  // --- 1. DEFINICIÓN DE ESTRUCTURA ---
  const ESPECIALIDADES_LISTA = [
    { id: "CX. GENERAL", label: "CX. GENERAL" },
    { id: "ORTOPEDIA", label: "ORTOPEDIA" },
    { id: "GINECOLOGIA", label: "GINECOLOGÍA" },
    { id: "UROLOGIA", label: "UROLOGÍA" },
    { id: "OTORRINO", label: "OTORRINO" },
    { id: "NEUROCIRUGIA", label: "NEUROCIRUGÍA" },
    { id: "MAXILOFACIAL", label: "MAXILOFACIAL" },
    { id: "BARIATRICA", label: "BARIÁTRICA" },
    { id: "CX. GASTRICA", label: "CX. GÁSTRICA (ONCOLÓGICA)" },
    { id: "CX. VASCULAR", label: "CX. VASCULAR" },
    { id: "HEMATOLOGICA - ONCOLOGIA", label: "HEMATO - ONCOLOGÍA" },
    { id: "GINECO + CX GNAL", label: "GINECO + CX GNAL" },
    { id: "OTROS", label: "OTROS" }
  ];

  // ============= 3. CIRUGÍA POR ESPECIALIDAD (ESTRUCTURA DE GUARDADO ÚNICA) =============
  const containerEsp = $("#tbl-cx-esp");
  containerEsp.innerHTML = `
    <table class="table-spec">
        <thead>
            <tr>
                <th style="width: 40%; text-align: left; padding-left: 15px;">Especialidad</th>
                <th style="width: 20%;">Pacientes</th>
                <th style="width: 20%;">Procedimientos</th>
                <th style="width: 20%;">U.V.R.</th>
            </tr>
        </thead>
        <tbody id="body-cx-esp"></tbody>
        <tfoot id="foot-cx-esp"></tfoot>
    </table>
`;

  let tPac = 0, tProc = 0, tUvr = 0;

  ESPECIALIDADES_LISTA.forEach(esp => {
    // Definimos los nombres de las llaves EXACTAS según tu requerimiento para identificación adecuada
    const keyPac = `${esp.label} - TOTAL PACIENTES`;
    const keyProc = `${esp.label} - TOTAL PROCEDIMIENTOS`;
    const keyUvr = `${esp.label} - TOTAL U.V.R`;

    // Función interna para leer de la base de datos limpiando formatos de miles
    const getValDB = (label) => {
      let v = getOverride("CX-ESP", label);
      if (v === null || v === undefined) return 0;

      // Limpiamos puntos de miles si vienen como string para que JS pueda sumar
      if (typeof v === 'string') return Number(v.replace(/\./g, '').replace(',', '.')) || 0;
      return Number(v);
    };

    const p = getValDB(keyPac);
    const pr = getValDB(keyProc);
    const u = getValDB(keyUvr);

    tPac += p; tProc += pr; tUvr += u;

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${esp.label}</td>
        <td><input class="cell" type="number" value="${p}" data-section="CX-ESP" data-label="${keyPac}"></td>
        <td><input class="cell" type="number" value="${pr}" data-section="CX-ESP" data-label="${keyProc}"></td>
        <td><input class="cell" type="number" value="${u}" data-section="CX-ESP" data-label="${keyUvr}"></td>
    `;
    $("#body-cx-esp").appendChild(tr);
  });

  // --- CÁLCULOS DE TOTALES ---
  const promedioFinal = safeDiv(tProc, tPac);

  // Guardamos los totales calculados con la identificación adecuada en la memoria global
  if (typeof MANUAL_OVERRIDES !== 'undefined') {
    MANUAL_OVERRIDES["CX-ESP|Total de cirugias por especialidad"] = tPac;
    MANUAL_OVERRIDES["CX-ESP|Total de procedimientos quirúrgicos y no quirurgicos"] = tProc;
    MANUAL_OVERRIDES["CX-ESP|Total de U.V.R"] = tUvr;
    MANUAL_OVERRIDES["CX-ESP|Promedio de Cx por paciente"] = promedioFinal;
  }

  const footEsp = $("#foot-cx-esp");
  footEsp.innerHTML = `
    <tr style="background: #f1f5f9; font-weight: bold; border-top: 2px solid var(--pri);">
        <td style="text-align: right; padding-right: 15px;">Total de cirugias por especialidad:</td>
        <td style="text-align: center;">${fmtInt(tPac)}</td>
        <td colspan="2"></td>
    </tr>
    <tr style="background: #f1f5f9; font-weight: bold;">
        <td style="text-align: right; padding-right: 15px;">Total de procedimientos quirúrgicos y no quirurgicos:</td>
        <td></td>
        <td style="text-align: center;">${fmtInt(tProc)}</td>
        <td></td>
    </tr>
    <tr style="background: #e6f6f5; font-weight: 800; color: var(--pri-dark);">
        <td style="text-align: right; padding-right: 15px;">Promedio de Cx por paciente:</td>
        <td colspan="3" style="text-align: center;">${fmtDec1(promedioFinal)}</td>
    </tr>
    <tr style="background: #f1f5f9; font-weight: bold;">
        <td style="text-align: right; padding-right: 15px;">Total de U.V.R:</td>
        <td colspan="2"></td>
        <td data-label="Total de U.V.R" style="text-align: center;">${fmtRaw(tUvr)}</td>
    </tr>
`;

  // Re-asignación de listeners corregida
  containerEsp.querySelectorAll('input.cell').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const label = e.target.getAttribute('data-label');
      const section = e.target.getAttribute('data-section');
      const val = Number(e.target.value);

      // Actualizamos con la llave completa para que snapshotAutoCalculados la capture
      MANUAL_OVERRIDES[`${section}|${label}`] = val;

      // RE-PINTAMOS para que las sumas se actualicen al instante
      paintAll(LAST_AGG, LAST_META);
    });
  });
  // ================= 4. HOSPITALIZACIÓN (BLOQUEO DE EDICIÓN EN CÁLCULOS) =======================
  const hEg = Number(getOverride("HOSP", "EGRESOS HOSP. PUESTOS 2, 3 y 4") ?? agg.hosp.egresos ?? 0);
  const hDO = Number(getOverride("HOSP", "Dias Camas Ocupadas") ?? agg.hosp.diasO ?? 0);
  const hDD = Number(getOverride("HOSP", "Dias Camas Disponibles") ?? agg.hosp.diasD ?? 0);

  const hPromCama = safeDiv(hDD, diasMesCargado);
  const hGiro = safeDiv(hEg, hPromCama);
  const hPDE = safeDiv(hDO, hEg);
  const hPct = safeDiv(hDO * 100, hDD);

  // PERSISTENCIA PARA AUTOSUMA Y GRÁFICAS
  if (typeof MANUAL_OVERRIDES !== 'undefined') {
    MANUAL_OVERRIDES["HOSP|Promedio día estancia"] = hPDE;
    MANUAL_OVERRIDES["HOSP|Promedio cama disponible"] = hPromCama;
    MANUAL_OVERRIDES["HOSP|Giro Camas"] = hGiro;
    MANUAL_OVERRIDES["HOSP|% OCUPACION"] = hPct;
  }

  const containerHosp = $("#tbl-hosp");
  const rowsHosp = [
    { label: "EGRESOS HOSP. PUESTOS 2, 3 y 4", val: hEg, manual: true },
    { label: "Dias Camas Ocupadas", val: hDO, manual: true },
    { label: "Dias Camas Disponibles", val: hDD, manual: true },
    { label: "Promedio día estancia", val: hPDE, manual: false, fmt: "dec1" },
    { label: "Promedio cama disponible", val: hPromCama, manual: false, fmt: "dec1" },
    { label: "Giro Camas", val: hGiro, manual: false, fmt: "dec1" },
    { label: "% OCUPACION", val: hPct, manual: false, fmt: "dec1" }
  ];

  let htmlHosp = `<table class="table"><thead><tr><th>Variable</th><th>Valor</th></tr></thead><tbody>`;
  rowsHosp.forEach(r => {
    const displayVal = r.fmt === "dec1" ? fmtDec1(r.val) : fmtInt(r.val);
    const rowStyle = !r.manual ? 'style="background:#f1f5f9; font-weight:bold; color:var(--pri-dark);"' : '';
    htmlHosp += `<tr><td ${rowStyle}>${r.label}</td><td ${rowStyle} class="mono">
        ${(EDIT_MODE && r.manual) ? `<input class="cell" type="number" value="${r.val}" data-section="HOSP" data-label="${r.label}">` : displayVal}
    </td></tr>`;
  });
  containerHosp.innerHTML = htmlHosp + `</tbody></table>`;

  // ================= 4. UCI ADULTOS (BLOQUEO DE EDICIÓN Y CÁLCULOS PROPIOS) =======================
  const uciEg = Number(getOverride("UCI", "EGRESOS DE UCI ADULTOS") ?? agg.uci.egresos ?? 0);
  const uciDO = Number(getOverride("UCI", "Dias Camas Ocupadas") ?? agg.uci.diasO ?? 0);
  const uciDD = Number(getOverride("UCI", "Dias Camas Disponibles") ?? agg.uci.diasD ?? 0);

  const uciPromCama = safeDiv(uciDD, diasMesCargado);
  const uciGiro = safeDiv(uciEg, uciPromCama);
  const uciPDE = safeDiv(uciDO, uciEg);
  const uciPct = safeDiv(uciDO * 100, uciDD);

  if (typeof MANUAL_OVERRIDES !== 'undefined') {
    MANUAL_OVERRIDES["UCI|Promedio día estancia"] = uciPDE;
    MANUAL_OVERRIDES["UCI|Promedio cama disponible"] = uciPromCama;
    MANUAL_OVERRIDES["UCI|Giro Camas"] = uciGiro;
    MANUAL_OVERRIDES["UCI|% DE OCUPACION"] = uciPct;
  }

  const containerUci = $("#tbl-uci");
  const rowsUci = [
    { label: "EGRESOS DE UCI ADULTOS", val: uciEg, manual: true },
    { label: "Dias Camas Ocupadas", val: uciDO, manual: true },
    { label: "Dias Camas Disponibles", val: uciDD, manual: true },
    { label: "Promedio día estancia", val: uciPDE, manual: false, fmt: "dec1" },
    { label: "Promedio cama disponible", val: uciPromCama, manual: false, fmt: "dec1" },
    { label: "Giro Camas", val: uciGiro, manual: false, fmt: "dec1" },
    { label: "% DE OCUPACION", val: uciPct, manual: false, fmt: "dec1" }
  ];

  let htmlUci = `<table class="table"><thead><tr><th>Variable</th><th>Valor</th></tr></thead><tbody>`;
  rowsUci.forEach(r => {
    const displayVal = r.fmt === "dec1" ? fmtDec1(r.val) : fmtInt(r.val);
    const rowStyle = !r.manual ? 'style="background:#f1f5f9; font-weight:bold; color:var(--pri-dark);"' : '';
    htmlUci += `<tr><td ${rowStyle}>${r.label}</td><td ${rowStyle} class="mono">
        ${(EDIT_MODE && r.manual) ? `<input class="cell" type="number" value="${r.val}" data-section="UCI" data-label="${r.label}">` : displayVal}
    </td></tr>`;
  });
  containerUci.innerHTML = htmlUci + `</tbody></table>`;

  // ================= 4. UCE ADULTOS (CORRECCIÓN DE ETIQUETAS Y PERSISTENCIA) =======================
  // ✅ CORRECCIÓN: Se eliminan prefijos duplicados en getOverride para evitar que vuelva a cero
  const uceEg = Number(getOverride("UCE", "EGRESOS DE UCE ADULTOS") ?? agg.uce.egresos ?? 0);
  const uceDO = Number(getOverride("UCE", "Dias Camas Ocupadas") ?? agg.uce.diasO ?? 0);
  const uceDD = Number(getOverride("UCE", "Dias Camas Disponibles") ?? agg.uce.diasD ?? 0);

  const ucePromCama = safeDiv(uceDD, diasMesCargado);
  const uceGiro = safeDiv(uceEg, ucePromCama);
  const ucePDE = safeDiv(uceDO, uceEg);
  const ucePct = safeDiv(uceDO * 100, uceDD);

  if (typeof MANUAL_OVERRIDES !== 'undefined') {
    MANUAL_OVERRIDES["UCE|Promedio día estancia"] = ucePDE;
    MANUAL_OVERRIDES["UCE|Promedio cama disponible"] = ucePromCama;
    MANUAL_OVERRIDES["UCE|Giro Camas"] = uceGiro;
    MANUAL_OVERRIDES["UCE|% DE OCUPACION"] = ucePct;
  }

  const containerUce = $("#tbl-uce");
  const rowsUce = [
    { label: "EGRESOS DE UCE ADULTOS", val: uceEg, manual: true },
    { label: "Dias Camas Ocupadas", val: uceDO, manual: true },
    { label: "Dias Camas Disponibles", val: uceDD, manual: true },
    { label: "Promedio día estancia", val: ucePDE, manual: false, fmt: "dec1" },
    { label: "Promedio cama disponible", val: ucePromCama, manual: false, fmt: "dec1" },
    { label: "Giro Camas", val: uceGiro, manual: false, fmt: "dec1" },
    { label: "% DE OCUPACION", val: ucePct, manual: false, fmt: "dec1" }
  ];

  let htmlUce = `<table class="table"><thead><tr><th>Variable</th><th>Valor</th></tr></thead><tbody>`;
  rowsUce.forEach(r => {
    const displayVal = r.fmt === "dec1" ? fmtDec1(r.val) : fmtInt(r.val);
    const rowStyle = !r.manual ? 'style="background:#f1f5f9; font-weight:bold; color:var(--pri-dark);"' : '';
    htmlUce += `<tr><td ${rowStyle}>${r.label}</td><td ${rowStyle} class="mono">
        ${(EDIT_MODE && r.manual) ? `<input class="cell" type="number" value="${r.val}" data-section="UCE" data-label="${r.label}">` : displayVal}
    </td></tr>`;
  });
  containerUce.innerHTML = htmlUce + `</tbody></table>`;

  // ================= 4. CONSOLIDADO HOSP+UCE & 4.1 GENERAL (CÁLCULOS FINALES) =======================
  const instEg = hEg + uceEg;
  const instDO = hDO + uceDO;
  const instDD = hDD + uceDD;
  const instPDE = safeDiv(instDO, instEg);
  const instPct = safeDiv(instDO * 100, instDD);
  const instPromCama = safeDiv(instDD, diasMesCargado);
  const instGiro = safeDiv(instEg, instPromCama);

  const totalEgHosp = hEg + uciEg + uceEg;
  const totalDOHosp = hDO + uciDO + uceDO;
  const totalDDHosp = hDD + uciDD + uceDD;
  const generalPDE = safeDiv(totalDOHosp, totalEgHosp);
  const generalPct = safeDiv(totalDOHosp * 100, totalDDHosp);
  const generalPromCama = safeDiv(totalDDHosp, diasMesCargado);
  const generalGiro = safeDiv(totalEgHosp, generalPromCama);

  if (typeof MANUAL_OVERRIDES !== 'undefined') {
    MANUAL_OVERRIDES["INST|Promedio día estancia (Hosp+Uce)"] = instPDE;
    MANUAL_OVERRIDES["INST|Giro Cama (Hosp+Uce)"] = instGiro;
    MANUAL_OVERRIDES["INST|% DE OCUPACIÓN (Hosp+Uce)"] = instPct;
    MANUAL_OVERRIDES["INST|PROMEDIO DÍA ESTANCIA GENERAL"] = generalPDE;
    MANUAL_OVERRIDES["INST|GIRO CAMA INSTITUCIONAL"] = generalGiro;
    MANUAL_OVERRIDES["INST|% DE OCUPACIÓN INSTITUCIONAL"] = generalPct;
  }

  // ✅ ACTIVADOR DE EVENTOS: Asegura que el cambio se guarde y recalcule todo
  [containerHosp, containerUci, containerUce].forEach(container => {
    container.querySelectorAll('input.cell').forEach(inp => {
      inp.addEventListener('change', (e) => {
        const sec = e.target.dataset.section;
        const lbl = e.target.dataset.label;
        const val = Number(e.target.value);
        // Registramos el cambio con el formato exacto que espera getOverride
        MANUAL_OVERRIDES[`${sec}|${lbl}`] = val;
        paintAll(LAST_AGG, LAST_META);
      });
    });
  });

  const containerInst = $("#tbl-inst");
  containerInst.innerHTML = `
    <div style="margin-bottom: 25px;">
        <table class="table">
            <thead>
                <tr><th colspan="2" style="background: var(--pri-light); color: var(--pri-dark); text-align: center;">4. CONSOLIDADO HOSP+UCE</th></tr>
            </thead>
            <tbody>
                <tr><td>EGRESOS UCE ADULTOS + HOSPITALIZACIÓN</td><td class="mono text-center"><b>${fmtInt(instEg)}</b></td></tr>
                <tr><td>Días Camas Ocupadas</td><td class="mono text-center">${fmtInt(instDO)}</td></tr>
                <tr><td>Días Camas Disponibles</td><td class="mono text-center">${fmtInt(instDD)}</td></tr>
                <tr style="background: #f8fafc;"><td>Promedio día estancia (Hosp+Uce)</td><td class="mono text-center"><b>${fmtDec1(instPDE)}</b></td></tr>
                <tr style="background: #f8fafc;"><td>Giro Cama (Hosp+Uce)</td><td class="mono text-center"><b>${fmtDec1(instGiro)}</b></td></tr>
                <tr style="background: #f8fafc;"><td>% DE OCUPACIÓN (Hosp+Uce)</td><td class="mono text-center"><b>${fmtDec1(instPct)}%</b></td></tr>
            </tbody>
        </table>
    </div>

    <div>
        <table class="table">
            <thead>
                <tr><th colspan="2" style="background: var(--pri); color: white; text-align: center; font-size: 1rem;">4.1 GRAN TOTAL INSTITUCIONAL (Hosp + Uce + Uci)</th></tr>
            </thead>
            <tbody>
                <tr><td style="font-weight: bold;">TOTAL EGRESOS HOSPITALARIOS</td><td class="mono text-center"><b>${fmtInt(totalEgHosp)}</b></td></tr>
                <tr><td>TOTAL DÍAS CAMAS OCUPADAS</td><td class="mono text-center">${fmtInt(totalDOHosp)}</td></tr>
                <tr><td>TOTAL DÍAS CAMAS DISPONIBLES</td><td class="mono text-center">${fmtInt(totalDDHosp)}</td></tr>
                <tr style="background: #e6f6f5;"><td>PROMEDIO DÍA ESTANCIA GENERAL</td><td class="mono text-center"><b>${fmtDec1(generalPDE)}</b></td></tr>
                <tr style="background: #e6f6f5;"><td>GIRO CAMA INSTITUCIONAL</td><td class="mono text-center"><b>${fmtDec1(generalGiro)}</b></td></tr>
                <tr style="background: #e6f6f5;"><td>% DE OCUPACIÓN INSTITUCIONAL</td><td class="mono text-center"><b>${fmtDec1(generalPct)}%</b></td></tr>
            </tbody>
        </table>
    </div>
  `;
  // ================== CONSULTA EXTERNA (igual que tienes) ================
  const ceRows = []; let ceTotal = 0;
  for (const esp in agg.ce) { ceRows.push({ label: esp, value: agg.ce[esp] }); ceTotal += agg.ce[esp]; }
  ceRows.push({ label: "TOTAL", value: ceTotal, meta: meta.ceMetaConsultas ?? null });
  renderTable("CE", ceRows, "#tbl-ce");

  // ================== HEMATO-ONCO (igual que tienes) =====================
  const hoRows = [
    { label: "Total quimio administrados amb", value: agg.hemoOnco.quimioAmb.unidades },
    { label: "Total pacientes de quimio", value: agg.hemoOnco.quimioAmb.pacientes },
    { label: "Aspirados MO (Ambulatorio)", value: agg.hemoOnco.aspiradoMO.amb },
    { label: "Aspirados MO (Hospitalario)", value: agg.hemoOnco.aspiradoMO.hosp },
    { label: "Pacientes transfundidos (Amb)", value: agg.hemoOnco.transfusiones.pacientes },
    { label: "Unidades transfundidas (Amb)", value: agg.hemoOnco.transfusiones.unidades },
    { label: "Flebotomía", value: agg.hemoOnco.flebotomia },
    { label: "Quimioterapia intratecales", value: agg.hemoOnco.intratecales },
    { label: "Curaciones PICC", value: agg.hemoOnco.curacionPICC },
    { label: "Oportunidad quimio hospitalaria", value: pct(agg.hemoOnco.quimioHosp.oportunidadOk, Math.max(1, agg.hemoOnco.quimioHosp.total)), format: 'dec1' },
    { label: "Oportunidad quimio ambulatoria", value: pct(agg.hemoOnco.quimioAmbOport.oportunidadOk, Math.max(1, agg.hemoOnco.quimioAmbOport.total)), format: 'dec1' },
    { label: "Oportunidad aspirados MO", value: pct(agg.hemoOnco.aspiradoMO.oportunidadOk, Math.max(1, agg.hemoOnco.aspiradoMO.total)), format: 'dec1' }
  ];
  renderTable("HEMO_ONCO", hoRows, "#tbl-hemo-onco");

  // ================== HEMOCOMPONENTES (obligatorio) ======================
  const hcRows = []; let appsTotal = 0, unidTotal = 0;
  for (const etiqueta of HEMO_LINEAS) {
    if (etiqueta.startsWith("APLICACION")) {
      const v = agg.hemoComp.aplicaciones[etiqueta] || 0;
      appsTotal += v;
      hcRows.push({ label: etiqueta, value: v });
    } else {
      const v = agg.hemoComp.unidades[etiqueta] || 0;
      unidTotal += v;
      hcRows.push({ label: etiqueta, value: v });
    }
  }

  // Filas de resumen
  hcRows.push({ label: "Total Aplicaciones", value: appsTotal });
  hcRows.push({ label: "Total Unidades", value: unidTotal });

  // ✅ ADICIONADO: Fila del gran total con su nombre
  hcRows.push({ label: "TOTAL HEMOCOMPONENTES", value: appsTotal + unidTotal });

  hcRows.push({ label: "Total de pacientes", value: agg.hemoComp.pacientes });
  renderTable("HEMOCOMP", hcRows, "#tbl-hemo-comp");

  // ================== ENDOS (Sincronizado) ===========================
  const enRows = [
    { label: "Endoscopia", value: agg.endo.endoscopia },
    { label: "Colonoscopia", value: agg.endo.colonoscopia },
    { label: "Fibrobroncoscopia", value: agg.endo.fibrobroncospia }, // Etiqueta corregida
    { label: "CPRE", value: agg.endo.cpre },
    { label: "Gastrostomía", value: agg.endo.gastrostomia },
    { label: "Rectosigmoidoscopia", value: agg.endo.rectosig },
    { label: "Otros", value: agg.endo.otros },
    { label: "TOTAL", value: agg.endo.total }, // Se sobreescribe automáticamente en renderTable
    { label: "Ambulatorios", value: agg.endo.ambulatorios }
  ];
  renderTable("ENDOS", enRows, "#tbl-endo");

  // ================== 9. IMÁGENES DIAGNÓSTICAS (ESTRUCTURA DETALLADA) ==================
  const imgRows = [
    { label: "HOSPITALARIO" },
    { label: "Tomografías (Hosp)", value: agg.img.hosp.tac },
    { label: "Rayos X (Hosp)", value: agg.img.hosp.rx },
    { label: "Ecografías (Hosp)", value: agg.img.hosp.eco },
    { label: "Procedimientos guiados por tomografías (Hosp)", value: agg.img.hosp.guiadosTac },
    { label: "Procedimientos guiados por ecografías (Hosp)", value: agg.img.hosp.guiadosEco },
    { label: "Total Procedimientos guiados (Hosp)", value: 0 },
    { label: "Total imágenes (Hosp)", value: 0 },
    { label: "Total pacientes (Hosp)", value: 0 },
    { label: "Promedio exámenes por paciente (Hosp)", value: 0, format: "dec1" },

    { label: "AMBULATORIO" },
    { label: "Tomografías (Amb)", value: agg.img.amb.tac },
    { label: "Rayos X (Amb)", value: agg.img.amb.rx },
    { label: "Ecografías (Amb)", value: agg.img.amb.eco },
    { label: "Procedimientos guiados por tomografías (Amb)", value: agg.img.amb.guiadosTac },
    { label: "Procedimientos guiados por ecografías (Amb)", value: agg.img.amb.guiadosEco },
    { label: "Total Procedimientos guiados (Amb)", value: 0 },
    { label: "Total imágenes (Amb)", value: 0 },
    { label: "Total pacientes (Amb)", value: 0 },
    { label: "Promedio exámenes por paciente (Amb)", value: 0, format: "dec1" },

    { label: "TOTAL" },
    { label: "Imágenes (Total)", value: 0, meta: meta.imgMetaExamenes ?? null },
    { label: "Pacientes (Total)", value: 0 },
    { label: "Procedimientos guiados (Total)", value: 0 }
  ];

  renderTable("IMG", imgRows, "#tbl-img-tot");

  // ================== 10. LABORATORIO CLÍNICO (AJUSTE DE IDENTIFICACIÓN) ==================
  const containerLab = $("#tbl-lab");
  if (containerLab) {
    const ALL_KEYS = [...LAB_HOSP_KEYS, "Muestras particulares"];

    let sumaTotalLab = 0;
    const labValues = ALL_KEYS.map(k => {
      // ✅ CLAVE: Buscamos el dato en la base de datos usando getOverride para que la información se deje ver
      // Intentamos con el prefijo "LAB" que es el que usa snapshotAutoCalculados
      const valRecuperado = getOverride("LAB", k);

      // Si no hay nada en la base de datos (overrides), usamos el valor automático (agg)
      const val = (valRecuperado !== null) ? valRecuperado : (k === "Muestras particulares" ? agg.lab.part.muestras : agg.lab.hosp[k]) ?? 0;

      sumaTotalLab += Number(val);
      return { key: k, value: val };
    });

    containerLab.innerHTML = `
      <table class="table-lab-h">
        <thead>
          <tr>
            <th style="width: 80px; vertical-align: middle; background: #fff;"></th>
            ${ALL_KEYS.map(k => `<th><span>${k}</span></th>`).join('')}
            <th style="background: #e2e8f0; border-bottom: 3px solid var(--pri);"><span>TOTAL</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight: bold; color: var(--text-muted); font-size: 0.7rem; text-align: center;">VALOR</td>
            ${labValues.map(item => `
                <td>
                    ${EDIT_MODE
        ? `<input class="cell" style="width: 100%; border:none; background:transparent; text-align:center; font-weight:bold;" 
                         type="number" value="${item.value}" data-section="LAB" data-label="${item.key}">`
        : `<span class="mono">${fmtInt(item.value)}</span>`}
                </td>
            `).join('')}
            <td data-label="TOTAL" style="background: #f8fafc; font-weight: bold; color: var(--pri-dark); font-family: monospace;">${fmtInt(Math.round(sumaTotalLab))}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Listener para que la edición manual se guarde con la identificación LAB|nombre
    if (EDIT_MODE) {
      containerLab.querySelectorAll('input.cell').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const label = e.target.getAttribute('data-label');
          const val = Number(e.target.value);
          // Registramos en MANUAL_OVERRIDES para que snapshotAutoCalculados lo vea
          MANUAL_OVERRIDES[`LAB|${label}`] = val;
          MANUAL_OVERRIDES[label] = val;

          paintAll(LAST_AGG, LAST_META);
        });
      });
    }
  }

  // ================== ESTADÍSTICA INSTITUCIONAL (Campos manuales) ==================
  const estRows = [
    { label: "Total admisiones", value: agg.est.admisiones || 0 },
    { label: "Atenciones efectivas (Egresos atendidos)", value: agg.est.egresosAt || 0 },
    { label: "% Atenciones efectivas", value: 0, format: 'dec1' } // Se calcula automático arriba
  ];

  renderTable("EST", estRows, "#tbl-est");
}
function buildAutoCalc(agg) {
  const adm = Number(agg?.est?.admisiones ?? 0);
  const ate = Number(agg?.est?.egresosAt ?? 0);

  const pctAtencionesEfectivas = (adm > 0) ? (ate / adm) * 100 : 0;

  return {
    est: {
      admisiones: adm,
      atencionesEfectivas: ate,
      pctAtencionesEfectivas: Number(pctAtencionesEfectivas.toFixed(2))
    }
  };
}

/* -------------------- GUARDAR/LEER CONSOLIDADO -------------------- */
async function saveMonthly(monthId, agg, metas, autoCalc) {
  const ref = monthDocRef(monthId);

  const payload = {
    monthId,
    agg: agg || {},
    metas: metas || {},
    overrides: MANUAL_OVERRIDES || {},
    autoCalc: autoCalc || {},
    savedAt: serverTimestamp()
  };

  await setDoc(ref, payload, { merge: true });
}

async function loadMonthlyOverrides(monthId) {
  MANUAL_OVERRIDES = {};
  try {
    const ref = monthDocRef(monthId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      MANUAL_OVERRIDES = snap.data()?.overrides || {};
    }
  } catch (e) {
    console.warn("No se pudieron leer overrides:", e);
  }
}

function sumTriagesInObject(obj) {
  let total = 0;
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && /triage/i.test(k)) total += v;
      else if (typeof v === 'object') walk(v);
    }
  }
  walk(obj);
  return total;
}

/* Suma todos los números de un objeto (recursivo) - DECLARACIÓN ÚNICA */
function sumAllNumbers(obj) {
  let total = 0;
  function walk(v) {
    if (typeof v === 'number' && isFinite(v)) total += v;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      // Evitar procesar objetos de Firebase como Timestamps
      if (v.seconds != null && v.nanoseconds != null) return;
      Object.values(v).forEach(walk);
    }
  }
  walk(obj);
  return total;
}

// Alias comunes por si varía el nombre del KPI
const KPI_ALIASES = {
  ce: ['ce', 'consulta_externa', 'consulta externa'],
  urgencias: ['urgencias', 'urg', 'atenciones', 'total_urgencias'],
  triages: ['triages', 'triage', 'total_triages'],
  egresos_hosp: ['egresos_hosp', 'egr_hosp', 'egresosHospitalizacion', 'egresos_hospitalizacion'],
  egresos_uce: ['egresos_uce', 'egr_uce', 'egresosUCE'],
  egresos_uci: ['egresos_uci', 'egr_uci', 'egresosUCI'],
  ocup_hosp: ['ocup_hosp', 'ocupacion_hosp', '%ocup_hosp', 'ocupacionHospitalizacion'],
  ocup_uce: ['ocup_uce', 'ocupacion_uce', '%ocup_uce'],
  ocup_uci: ['ocup_uci', 'ocupacion_uci', '%ocup_uci'],
  pde: ['pde', 'pde_hosp', 'promedio_dia_estancia'],
  pde_critico: ['pde_critico', 'pde_uci', 'promedio_dia_estancia_uci'],
};

function valueFromAliases(obj, id) {
  const aliases = KPI_ALIASES[id] || [id];
  for (const k of aliases) {
    const v = obj?.[k] ?? obj?.[k?.toLowerCase?.()] ?? obj?.[k?.toUpperCase?.()];
    if (v != null) return v;
  }
  return null;
}

async function sumarKpisMes(year, month0, config) {
  const DEF = {
    ce: { mode: 'sum' }, urgencias: { mode: 'sum' }, triages: { mode: 'sum' },
    egresos_hosp: { mode: 'sum' }, egresos_uce: { mode: 'sum' }, egresos_uci: { mode: 'sum' },
    ocup_hosp: { mode: 'avg' }, ocup_uce: { mode: 'avg' }, ocup_uci: { mode: 'avg' },
    pde: { mode: 'avg' }, pde_critico: { mode: 'avg' },
  };
  const CFGKPI = Object.assign({}, DEF, config || {});

  // Alias de nombres posibles por KPI (minúsculas)
  const KPI_ALIASES = {
    ce: ['ce', 'consulta_externa', 'consulta externa'],
    urgencias: ['urgencias', 'urg', 'atenciones', 'total_urgencias'],
    triages: ['triages', 'triages', 'triage', 'total_triages'],
    egresos_hosp: ['egresos_hosp', 'egr_hosp', 'egresos_hospitalizacion', 'egresosHospitalizacion'],
    egresos_uce: ['egresos_uce', 'egr_uce', 'egresosUCE'],
    egresos_uci: ['egresos_uci', 'egr_uci', 'egresosUCI'],
    ocup_hosp: ['ocup_hosp', '%ocup_hosp', 'ocupacion_hosp', 'ocupacionHospitalizacion'],
    ocup_uce: ['ocup_uce', '%ocup_uce', 'ocupacion_uce'],
    ocup_uci: ['ocup_uci', '%ocup_uci', 'ocupacion_uci'],
    pde: ['pde', 'pde_hosp', 'promedio_dia_estancia', 'promedio dia estancia'],
    pde_critico: ['pde_critico', 'pde_uci', 'promedio_dia_estancia_uci']
  };

  // ---- SUMA SEGURA: ignora Timestamps de Firestore y objetos Date ----
  function isFirestoreTs(v) {
    return v && typeof v === 'object' &&
      (typeof v.toDate === 'function' ||
        (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number'));
  }
  function sumAllNumbers(root) {
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const v = stack.pop();
      if (v == null) continue;

      if (typeof v === 'number' && isFinite(v)) { total += v; continue; }
      if (isFirestoreTs(v)) continue;      // ← evita sumar segundos/nanosegundos
      if (v instanceof Date) continue;     // ← evita sumar timestamps JS

      if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
      if (typeof v === 'object') { for (const x of Object.values(v)) stack.push(x); }
    }
    return total;
  }

  function valueFromAliases(obj, baseId) {
    const aliases = (KPI_ALIASES[baseId] || [baseId]).map(s => String(s).toLowerCase());
    for (const [k, v] of Object.entries(obj || {})) {
      if (aliases.includes(String(k).toLowerCase())) return v;
    }
    return null;
  }

  const y = String(year).padStart(4, '0');
  const mmPad = String(month0 + 1).padStart(2, '0'); // "09"
  const mmBare = String(month0 + 1);                 // "9"
  const monthList = [mmPad, mmBare];

  const res = {}; Object.keys(CFGKPI).forEach(k => res[k] = { sum: 0, n: 0, avg: null });
  let daysWithData = 0;
  let shape = 'none';

  // ----------- Intento principal: /kpi/{dd}/{kpi} como DOC o SUBCOLECCIÓN
  for (const mm of monthList) {
    try {
      const daysCol = collection(db, CFG.coleccionDiaria, y, mm, 'kpi');
      const daysSnap = await getDocs(daysCol);
      if (daysSnap.empty) continue;

      for (const dayDoc of daysSnap.docs) {
        const dd = dayDoc.id;
        if (!/^\d{1,2}$/.test(dd)) continue;
        let dayHit = false;

        // a) {kpi} como documento /kpi/{dd}/{kpi}
        for (const baseId of Object.keys(CFGKPI)) {
          const aliases = KPI_ALIASES[baseId] || [baseId];
          let captured = false;

          for (const alias of aliases) {
            try {
              const dref = doc(db, CFG.coleccionDiaria, y, mm, 'kpi', dd, alias);
              const d = await getDoc(dref);
              if (d.exists()) {
                const val = sumAllNumbers(d.data() || {});
                if (isFinite(val)) {
                  if (CFGKPI[baseId].mode === 'sum') res[baseId].sum += val;
                  else { res[baseId].sum += val; res[baseId].n += 1; }
                  captured = true; dayHit = true; shape = `kpi-first:doc ${y}/${mm}`;
                }
                break;
              }
            } catch (_) { }

            // b) {kpi} como subcolección /kpi/{dd}/{kpi}/*
            if (!captured) {
              try {
                const sub = await getDocs(collection(db, CFG.coleccionDiaria, y, mm, 'kpi', dd, alias));
                if (!sub.empty) {
                  let s = 0; sub.forEach(x => s += sumAllNumbers(x.data() || {}));
                  if (CFGKPI[baseId].mode === 'sum') res[baseId].sum += s;
                  else { res[baseId].sum += s; res[baseId].n += 1; }
                  captured = true; dayHit = true; shape = `kpi-first:subcol ${y}/${mm}`;
                  break;
                }
              } catch (_) { }
            }
          }
        }

        // c) Fallback: /kpi/{dd} con campos
        if (!dayHit) {
          try {
            const ddRef = doc(db, CFG.coleccionDiaria, y, mm, 'kpi', dd);
            const ddSnap = await getDoc(ddRef);
            if (ddSnap.exists()) {
              const data = ddSnap.data() || {};
              let localHit = false;
              for (const baseId of Object.keys(CFGKPI)) {
                const v = valueFromAliases(data, baseId);
                if (v == null) continue;
                const val = (typeof v === 'number') ? v :
                  (typeof v === 'object' ? sumAllNumbers(v) : null);
                if (val != null && isFinite(val)) {
                  if (CFGKPI[baseId].mode === 'sum') res[baseId].sum += val;
                  else { res[baseId].sum += val; res[baseId].n += 1; }
                  localHit = true; shape = `kpi-first:doccampos ${y}/${mm}`;
                }
              }
              dayHit = dayHit || localHit;
            }
          } catch (_) { }
        }

        if (dayHit) daysWithData++;
      } // días
      if (daysWithData) break; // ya encontramos datos en este mm (09 o 9)
    } catch (_) { }
  }

  // Promedios para los KPI 'avg'
  Object.keys(res).forEach(k => {
    if (CFGKPI[k].mode === 'avg') res[k].avg = (res[k].n > 0) ? (res[k].sum / res[k].n) : null;
  });

  res._days = daysWithData;
  res._shape = shape;
  return res;
}

/* -------------------- FLUJO DE CARGA Y AUTENTICACIÓN -------------------- */

async function runLoad() {
  // Poller de seguridad: asegura que Firebase esté listo antes de proceder
  if (!ensureFirebase() && window.firebaseFirestore) {
    ensureFirebase();
  }
  const mval = document.getElementById("month").value;
  if (!mval) { alert("Selecciona un mes."); return; }
  const btn = document.getElementById('btnLoad');
  if (btn) { btn.disabled = true; btn.textContent = "Cargando..."; }

  CURRENT_MONTH_ID = mval;
  try {
    await ensureAuth();
    const ref = monthDocRef(mval);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const savedData = snap.data();
      // Solo cargamos la capa estrictamente manual como overrides
      MANUAL_OVERRIDES = savedData.overrides || {};

      // ✅ RESCATE DE CONSOLIDADO PREVIO (Para meses históricos sin detalle diario como 2025)
      // Si el consolidado guardado es plano (snapshot de DOM), lo volcamos a MANUAL_OVERRIDES 
      // para que paintAll pueda encontrar los valores mediante getOverride.
      // Si es anidado (formato antiguo), lo usamos directamente en LAST_AGG.
      if (savedData.agg && Object.keys(savedData.agg).length > 0) {
        if (savedData.agg.urg) {
          LAST_AGG = savedData.agg; // Es anidado (Formato antiguo compatible)
        } else {
          // Es plano (Formato moderno de snapshot): Combinamos con overrides
          Object.assign(MANUAL_OVERRIDES, savedData.agg);
          LAST_AGG = newAgg();
        }
      } else {
        LAST_AGG = newAgg();
      }
      console.info("Capa de datos y manual (overrides) cargada:", MANUAL_OVERRIDES);
    } else {
      MANUAL_OVERRIDES = {};
      LAST_AGG = newAgg();
    }

    LAST_META = await loadForecastMeta(mval) || {};

    // ✅ ACTUALIZAR BANNER DE CUMPLIMIENTO
    if (typeof checkCompliance === 'function') {
      checkCompliance(mval, snap.exists());
    }

    // 🔴 FUENTE AUTOMÁTICA DESDE ESTADÍSTICA DIARIA (Refresco si existe detalle)
    const [year, mmRaw] = mval.split('-');
    const month0 = parseInt(mmRaw) - 1;
    const dias = await fetchDailyDocs(year, month0);
    if (dias.length > 0) {
      LAST_AGG = reduceDailyToAgg(dias); // Base refrescada desde Firestore diario
    }

    EDIT_MODE = true;
    const toggleEdit = document.getElementById("toggleEdit");
    if (toggleEdit) toggleEdit.checked = true;

    // ✅ PINTAR TODO: base diaria (LAST_AGG) + capa manual (MANUAL_OVERRIDES) + metas
    paintAll(LAST_AGG, LAST_META);

    // 🎯 CARGA DE ALINEACIÓN ESTRATÉGICA (BASADA EN CAP)
    try {
      const capRows = await loadCapRows(year);
      LAST_CAP_ROWS = capRows;

      const capMeta = extractStrategicCapMeta(capRows, mval);
      LAST_ALIGNMENT_MODEL = buildStrategicAlignmentModel({ capMeta, capRows });

      renderAlineacionEstrategica(LAST_ALIGNMENT_MODEL, mval);
    } catch (err) {
      console.error("Error en Alineación Estratégica:", err);
    }

    if (typeof runInteligencia === 'function') runInteligencia(year, month0, LAST_AGG, LAST_META);

    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = `Calculado desde datos diarios de ${mval}.`;
    const btnSave = document.getElementById("btnSave");
    if (btnSave) btnSave.disabled = false;

    // ✅ SINCRONIZACIÓN DE DASHBOARD (INICIAL) Y CONSOLIDADO HISTÓRICO (DIFERIDO)
    setTimeout(() => {
      if (typeof loadYearlyCharts === 'function') {
        loadYearlyCharts(year);
      }

      // LAZY LOAD: Solo montamos el consolidado enorme si se activa la pestaña 'tab-hist'
      // El dashboard anual 'loadYearlyCharts' es más ligero y es la vista inicial principal.
      const histTabBtn = document.querySelector('.nav-btn[data-target="tab-hist"]');
      if (histTabBtn && !window._histNavListenerAdded) {
        window._histNavListenerAdded = true;
        histTabBtn.addEventListener('click', () => {
          if (window._currentYearConsolidated !== year) {
            window._currentYearConsolidated = year;
            if (typeof loadYearlyConsolidated === 'function') loadYearlyConsolidated(year);
          }
        });
        // Si por casualidad la pestaña historial ya está abierta
        if (histTabBtn.classList.contains('active')) {
          window._currentYearConsolidated = year;
          if (typeof loadYearlyConsolidated === 'function') loadYearlyConsolidated(year);
        }
      }
    }, 300);

  } catch (e) {
    console.error("Error en runLoad:", e);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Error al cargar los datos.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Cargar acumulado"; }
  }
}

async function ensureAuth() {
  try {
    if (auth.currentUser) return auth.currentUser;
    await signInAnonymously(auth);
    return auth.currentUser;
  } catch (e) {
    console.warn("Auth anónima no disponible:", e);
    return null;
  }
}

function buildAutoCalculosSnapshot(agg) {
  // Lee overrides manuales (lo que editas en pantalla) si existen
  const ov = (sec, lab) => {
    const v = getOverride(sec, lab);
    return v != null && v !== "" ? Number(v) : null;
  };

  // --------- LABORATORIO (mismo cálculo que usas al pintar) ----------
  const labFuentes = [
    'INSTITUCIONAL', 'Microbiologia', 'PRIME', 'SUESCUN', 'COLCAN', 'ANTIOQUIA',
    'CENTRO DE REFERENCIA', 'LIME', 'SYNLAB', "ICMT", "CIB", 'UNILAB'
  ];

  // Si existen overrides en LAB, úsalos; si no, cae al agg (si aplica)
  let labSuma = 0;
  for (const f of labFuentes) {
    const v = ov('LAB', f);
    labSuma += (v ?? 0);
  }

  // “Muestras particulares” viene del agg (como ya lo tienes en EST)
  const labPart = Number(agg?.lab?.part?.muestras || 0);
  const labTotal = labSuma + labPart;

  // --------- IMÁGENES (pacientes totales) ----------
  const imgPacH = Number(ov('IMG_HOSP', 'Total pacientes') ?? 0);
  const imgPacA = Number(ov('IMG_AMB', 'Total pacientes') ?? 0);
  const imgPacT = imgPacH + imgPacA;

  // --------- ESTADÍSTICAS INSTITUCIONALES ----------
  const urgEgresosAt = Number(agg?.urg?.egresosAt || 0);
  const cxAmb = Number(agg?.cx?.egr?.ptesAmb || 0);
  const instEgresos = Number((agg?.uce?.egresos || 0) + (agg?.hosp?.egresos || 0));
  const ceTotal = Object.values(agg?.ce || {}).reduce((s, n) => s + (+n || 0), 0);

  // Total admisiones: si lo editas en EST como override úsalo; si no, usa agg
  const totalAdm = Number(ov('EST', 'Total admisiones') ?? (agg?.est?.admisiones || 0));

  // Atenciones efectivas (misma fórmula que ya usas)
  const atEfec = urgEgresosAt + cxAmb + instEgresos + ceTotal + imgPacT + labPart;
  const pctAtEfec = totalAdm > 0 ? (atEfec * 100 / totalAdm) : 0;

  // Deja un “paquete” organizado para guardar en Firebase
  return {
    EST: {
      totalAdmisiones: totalAdm,
      atencionesEfectivas: atEfec,
      pctAtencionesEfectivas: pctAtEfec
    },
    LAB: {
      totalMuestras: labTotal,
      muestrasParticulares: labPart
    },
    IMG: {
      totalPacientes: imgPacT,
      pacientesHosp: imgPacH,
      pacientesAmb: imgPacA
    }
  };
}

function snapshotAutoCalculados() {
  const out = {};
  const cleanToNum = (text) => {
    if (!text || text === "") return null;
    let s = String(text).trim();
    let pure = s.replace(/\./g, '').replace(',', '.'); // Quita puntos de miles
    let val = parseFloat(pure.replace(/[^\d.-]/g, ''));
    return isNaN(val) ? null : val;
  };

  // Escaneamos todas las tablas renderizadas
  const divs = Array.from(document.querySelectorAll('div[id^="tbl-"]'));
  divs.forEach(div => {
    let sectionId = div.id.replace("tbl-", "").toUpperCase();
    if (sectionId === "URGENCIAS") sectionId = "URG";

    // Capturar Totales calculados (los que NO son inputs)
    div.querySelectorAll("tr").forEach(tr => {
      const tds = tr.querySelectorAll("td");
      if (tds.length >= 2 && !tds[1].querySelector("input")) {
        const label = tds[0].textContent.trim().replace(/:$/, "");
        const val = cleanToNum(tds[1].textContent);
        if (val !== null) {
          const finalKey = `${sectionId}|${label}`;
          out[finalKey] = val;
        }
      }
    });

    // Capturar cualquier celda que ya traiga su data-label (útil para horizontales como LAB)
    div.querySelectorAll("td[data-label]").forEach(td => {
      const label = td.getAttribute("data-label");
      const val = cleanToNum(td.textContent);
      if (label && val !== null) {
        const finalKey = label.includes('|') ? label : `${sectionId}|${label}`;
        out[finalKey] = val;
      }
    });

    // Capturar Inputs (Especialidades, Urgencias, etc)
    div.querySelectorAll("input.cell").forEach(inp => {
      const label = inp.getAttribute("data-label");
      const val = cleanToNum(inp.value);
      if (label && val !== null) {
        // Si la etiqueta ya trae el prefijo (como HOSP|...) lo usamos directo
        const finalKey = label.includes('|') ? label : `${sectionId}|${label}`;
        out[finalKey] = val;
      }
    });
  });
  return out;
}

async function runSave() {
  if (!CURRENT_MONTH_ID) { alert("Carga primero el mes."); return; }
  const btnSave = document.getElementById("btnSave");
  btnSave.disabled = true;

  try {
    await ensureAuth();

    // 1. Extraemos SOLO los overrides (valores de inputs editables en pantalla)
    const finalOverrides = { ...MANUAL_OVERRIDES };
    document.querySelectorAll("input.cell").forEach(inp => {
      const label = inp.getAttribute("data-label");
      let val = null;
      if (inp.value && inp.value.trim() !== "") {
        let pure = inp.value.replace(/\./g, "").replace(",", ".");
        val = parseFloat(pure.replace(/[^\d.-]/g, ""));
      }
      if (label && val !== null && !isNaN(val)) {
        const tr = inp.closest("tr");
        if (!tr) return;
        const div = tr.closest("div[id^='tbl-']");
        if (!div) return;
        let sectionId = div.id.replace("tbl-", "").toUpperCase();
        if (sectionId === "URGENCIAS") sectionId = "URG";
        const finalKey = label.includes('|') ? label : `${sectionId}|${label}`;
        finalOverrides[finalKey] = val;
      }
    });

    // 2. Extraemos TODOS los valores visualizados (totales calculados + overrides) como el "agg" plano
    const screenSnapshot = snapshotAutoCalculados();
    const finalAgg = { ...screenSnapshot };

    // Validamos memoria
    MANUAL_OVERRIDES = { ...finalOverrides };

    // 3. Empaquetamos propiedades adicionales de auto cálculos requeridas por el formato (EST, LAB, IMG)
    const extrasAuto = buildAutoCalculosSnapshot(LAST_AGG);
    Object.assign(finalAgg, extrasAuto);

    const ref = monthDocRef(CURRENT_MONTH_ID);

    // 4. Guardamos separando estrictamente: agg (todo el consolidado visible y calculado) y overrides (solo la intervención manual)
    const payload = {
      monthId: CURRENT_MONTH_ID,
      metas: LAST_META || {},
      agg: finalAgg,
      overrides: finalOverrides,
      savedAt: serverTimestamp()
    };

    await setDoc(ref, payload, { merge: true });

    if (typeof loadYearlyCharts === 'function') {
      await loadYearlyCharts(CURRENT_MONTH_ID.split('-')[0]);
    }

    // ✅ ACTUALIZAR BANNER DE CUMPLIMIENTO TRAS GUARDAR
    if (typeof checkCompliance === 'function') {
      checkCompliance(CURRENT_MONTH_ID, true);
    }

    alert("¡Guardado exitoso!.");

  } catch (e) {
    console.error("Error en runSave:", e);
    alert("Error al guardar en la base de datos.");
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}
/* -------------------- INIT UI SEGURA -------------------- */
window.addEventListener("DOMContentLoaded", () => {
  // 1. Establecer mes anterior por defecto
  const today = new Date();
  today.setMonth(today.getMonth() - 1);
  const ym = today.toISOString().slice(0, 7);
  const monthInput = document.getElementById("month");
  if (monthInput) monthInput.value = ym;

  // 2. Asignación segura de botones (Evita el error de null)
  const setupBtn = (id, func) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = func;
  };

  setupBtn('btnLoad', runLoad);
  setupBtn('btnSave', runSave);
  setupBtn('btnShowMeta', showForecastMeta);
  setupBtn('btnPdf', exportPDF);
  setupBtn('btnXlsx', exportExcel);

  const btnUploadCap = document.getElementById("btnUploadCap");
  const inputCapExcel = document.getElementById("inputCapExcel");

  if (btnUploadCap && inputCapExcel) {
    btnUploadCap.addEventListener("click", () => {
      inputCapExcel.click();
    });

    inputCapExcel.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      btnUploadCap.disabled = true;
      const oldText = btnUploadCap.textContent;
      btnUploadCap.textContent = "Subiendo CAP...";

      try {
        await uploadCapSheetAsIs(file);
      } catch (err) {
        console.error(err);
        const statusEl = document.getElementById("capUploadStatus");
        if (statusEl) {
          statusEl.textContent = `Error al cargar CAP: ${err.message}`;
          statusEl.style.color = "#dc2626";
        }
        alert("Error al cargar la hoja CAP.");
      } finally {
        btnUploadCap.disabled = false;
        btnUploadCap.textContent = oldText;
        inputCapExcel.value = "";
      }
    });
  }

  const btnPreviewCap = document.getElementById("btnPreviewCap");
  if (btnPreviewCap) {
    btnPreviewCap.addEventListener("click", renderCapPreview);
  }

  // 3. Listener para cambios manuales
  const toggleEdit = document.getElementById("toggleEdit");
  if (toggleEdit) {
    toggleEdit.onchange = (e) => {
      EDIT_MODE = e.target.checked;
      if (LAST_AGG) paintAll(LAST_AGG, LAST_META || {});
    };
  }

  // 4. Autenticación y Carga automática
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.info("Usuario autenticado:", user.uid);
      const userEl = document.getElementById('userEmail');
      if (userEl) userEl.textContent = user.email || "Usuario GTC";

      // Carga inicial de datos y gráficas
      runLoad();
    }
  });
});
/* -------------------- MOTOR DE GRÁFICAS ANUALES (OPTIMIZADO Y SINCRONIZADO) -------------------- */
async function loadYearlyCharts(yearId) {
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  const dataSet = {
    triages: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    mg: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    uvr: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    procs: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    hosp: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    uci: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    uce: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    ce: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    endo: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    img: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    laboratorio: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    efectivas: { real: Array(12).fill(0), meta: Array(12).fill(75) },
    tac: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    rx: { real: Array(12).fill(0), meta: Array(12).fill(0) },
    eco: { real: Array(12).fill(0), meta: Array(12).fill(0) }
  };

  // Función de lectura para gráficas: Limpia puntos de miles y maneja prefijos
  const getValChart = (ov, sec, lab) => {
    if (!ov) return 0;
    const v = (valRaw) => {
      if (typeof valRaw === 'string') {
        const isDecimal = lab.toLowerCase().includes('%') || lab.toLowerCase().includes('promedio');
        return isDecimal ? (parseFloat(valRaw.replace(/\./g, '').replace(',', '.')) || 0) : (parseInt(valRaw.replace(/\./g, '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0);
      }
      return Number(valRaw) || 0;
    };
    // 1. Intento por llave exacta
    const fullKey = `${sec.toUpperCase()}|${lab}`;
    if (ov[fullKey] !== undefined) return v(ov[fullKey]);
    if (ov[lab] !== undefined) return v(ov[lab]);

    // 2. Búsqueda arqueológica (Búsqueda atómica por palabras clave)
    const roots = {
      tac: ["tac", "tomograf"],
      rx: ["rayo", "rx", "placa"],
      eco: ["ecogra", "eco"]
    };

    let targetRoots = [];
    const labClean = lab.toLowerCase();
    if (labClean.includes("tac") || labClean.includes("tomograf")) targetRoots = roots.tac;
    else if (labClean.includes("rayo") || labClean.includes("rx")) targetRoots = roots.rx;
    else if (labClean.includes("ecogra") || labClean.includes("eco")) targetRoots = roots.eco;
    else targetRoots = [lab.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 10)];

    let candidates = [];
    for (const k in ov) {
      const kClean = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (targetRoots.some(r => kClean.includes(r)) && !kClean.includes("equi")) {
        const val = typeof ov[k] === 'object' ? Object.values(ov[k])[0] : ov[k];
        const num = parseFloat(String(val).replace(/\./g, '').replace(',', '.'));
        if (!isNaN(num) && num > 0) candidates.push(num);
      }
    }

    // Si es una sub-línea de imágenes, elegimos el valor que parezca producción (>50)
    if (targetRoots.length > 0 && (targetRoots === roots.tac || targetRoots === roots.rx || targetRoots === roots.eco)) {
      const prodValue = candidates.find(n => n > 50);
      if (prodValue) return prodValue;
    }
    return candidates.length > 0 ? candidates[0] : 0;
  };

  const promises = months.map(async (mPad, i) => {
    const monthId = `${yearId}-${mPad}`;
    try {
      const resRef = doc(db, "realizados", String(yearId), mPad, "_mensual");
      const resSnap = await getDoc(resRef);

      if (resSnap.exists()) {
        const ov = resSnap.data().overrides || resSnap.data().agg || {};

        // --- MAPEO DE DATOS REALES (Sincronizado con etiquetas de identificación adecuada) ---
        dataSet.triages.real[i] = getValChart(ov, "URG", "Total ingresos a urgencias (triages + ortopedia)");
        dataSet.mg.real[i] = getValChart(ov, "URGENCIAS", "Consultas medicina general");

        // Etiquetas de Cirugía sincronizadas con el nuevo guardado
        dataSet.uvr.real[i] = getValChart(ov, "CX-ESP", "Total de U.V.R");
        dataSet.procs.real[i] = getValChart(ov, "CX-ESP", "Total de procedimientos quirúrgicos y no quirurgicos");

        // Áreas Críticas
        dataSet.hosp.real[i] = getValChart(ov, "HOSP", "EGRESOS HOSP. PUESTOS 2, 3 y 4");
        dataSet.uci.real[i] = getValChart(ov, "UCI", "EGRESOS DE UCI ADULTOS");
        dataSet.uce.real[i] = getValChart(ov, "UCE", "EGRESOS DE UCE ADULTOS");

        // Servicios Ambulatorios
        dataSet.ce.real[i] = getValChart(ov, "CE", "TOTAL");
        dataSet.endo.real[i] = getValChart(ov, "ENDO", "TOTAL");
        dataSet.img.real[i] = getValChart(ov, "IMG-TOT", "Imágenes (Total)");

        // Laboratorio: Valor total sin divisiones
        let labTotal = 0;
        LAB_HOSP_KEYS.forEach(k => labTotal += getValChart(ov, "LAB", k));
        labTotal += getValChart(ov, "LAB", "Muestras particulares");
        dataSet.laboratorio.real[i] = Math.round(labTotal);

        dataSet.efectivas.real[i] = getValChart(ov, "EST", "% Atenciones efectivas");

        // Sub-líneas de Imágenes
        dataSet.tac.real[i] = getValChart(ov, "IMG_HOSP", "Tomografías (TAC)") + getValChart(ov, "IMG_AMB", "Tomografías (TAC)");
        dataSet.rx.real[i] = getValChart(ov, "IMG_HOSP", "Rayos X") + getValChart(ov, "IMG_AMB", "Rayos X");
        dataSet.eco.real[i] = getValChart(ov, "IMG_HOSP", "Ecografías") + getValChart(ov, "IMG_AMB", "Ecografías");
      }

      const m = await loadForecastMeta(monthId);
      if (m) {
        dataSet.triages.meta[i] = m.urgenciasMeta || 0;
        dataSet.uvr.meta[i] = m.uvrMeta || 0;
        dataSet.procs.meta[i] = m.cxMetaProced || 0;
        dataSet.hosp.meta[i] = m.hospMetaEgresos || 0;
        dataSet.uci.meta[i] = m.uciMetaEgresos || 0;
        dataSet.uce.meta[i] = m.uceMetaEgresos || 0;
        dataSet.ce.meta[i] = m.ceMetaConsultas || 0;
        dataSet.img.meta[i] = m.imgMetaExamenes || 0;
        dataSet.laboratorio.meta[i] = m.labMetaTotal || 0;
      }
    } catch (err) { console.warn(`Error mes ${mPad}:`, err); }
  });

  await Promise.all(promises);
  GLOBAL_YEARLY_DATASET = dataSet;
  GLOBAL_YEARLY_LABELS = labels;

  // Una vez cargados los datos históricos, refrescar el modelo de alineación para incluir tendencias
  if (CURRENT_MONTH_ID && LAST_META) {
    const metaMes = extractStrategicCapMeta(LAST_CAP_ROWS, CURRENT_MONTH_ID);
    LAST_ALIGNMENT_MODEL = buildStrategicAlignmentModel({ capMeta: metaMes, capRows: LAST_CAP_ROWS });
    renderAlineacionEstrategica(LAST_ALIGNMENT_MODEL, CURRENT_MONTH_ID);
  }

  if (document.getElementById("dashboard-grafico")) renderCharts(dataSet, labels);
}
/* -------------------- FUNCIÓN PARA DIBUJAR GRÁFICAS (Real vs Meta) -------------------- */
function renderCharts(dataSet, labels) {
  // Configuración de IDs de canvas y sus etiquetas correspondientes
  const configs = [
    { id: "ch-tri", label: "Total Triages", data: dataSet.triages, color: "#12A89F" },
    { id: "ch-mg", label: "Consulta Med. General", data: dataSet.mg, color: "#0e8a82" },
    { id: "ch-uvr", label: "Total UVR", data: dataSet.uvr, color: "#f59e0b" },
    { id: "ch-proc", label: "Procedimientos Quirúrgicos", data: dataSet.procs, color: "#10b981" },
    { id: "ch-hosp", label: "Egresos Hospitalización", data: dataSet.hosp, color: "#3b82f6" },
    { id: "ch-uci", label: "Egresos UCI", data: dataSet.uci, color: "#ef4444" },
    { id: "ch-uce", label: "Egresos UCE", data: dataSet.uce, color: "#f97316" },
    { id: "ch-ce", label: "Total Consulta Externa", data: dataSet.ce, color: "#8b5cf6" },
    { id: "ch-endo", label: "Total Endoscopia", data: dataSet.endo, color: "#2dd4bf" },
    { id: "ch-img", label: "Total Imágenes", data: dataSet.img, color: "#fbbf24" },
    { id: "ch-efec", label: "% Atenciones Efectivas", data: dataSet.efectivas, color: "#10b981", isPct: true }
  ];

  const container = document.getElementById("dashboard-grafico");
  if (!container) return;

  container.innerHTML = ""; // Limpiar antes de redibujar

  configs.forEach(conf => {
    const div = document.createElement("div");
    div.className = "chart-card";
    div.innerHTML = `
            <h3 style="margin-bottom:15px; font-size:0.8rem;">${conf.label}</h3>
            <div class="chart-container" style="position: relative; height:220px;">
                <canvas id="${conf.id}"></canvas>
            </div>`;
    container.appendChild(div);

    const ctx = document.getElementById(conf.id).getContext('2d');

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Realizado',
            data: conf.data.real,
            borderColor: conf.color,
            backgroundColor: conf.color + "20",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            borderWidth: 3
          },
          {
            label: 'Meta',
            data: conf.data.meta,
            borderColor: "#94a3b8", // Gris para la meta
            borderDash: [5, 5],    // Línea punteada
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 10 } }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: "#f1f5f9" },
            ticks: {
              font: { size: 9 },
              callback: (v) => conf.isPct ? v + "%" : v.toLocaleString('es-CO')
            }
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 9 } }
          }
        }
      }
    });
  });
}

/* =================== CONSOLIDADO ANUAL MAESTRO (VERSIÓN INTEGRAL COMPLETA) =================== */

async function loadYearlyConsolidated(yearId) {
  const container = document.getElementById('consolidado-historico');
  if (!container) return;
  container.innerHTML = "<p style='padding:20px; font-weight:bold; color:#0056b3;'>⌛ Generando reporte ejecutivo anual integral...</p>";

  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const monthLabels = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const prevYear = Number(yearId) - 1;

  try {
    // 1. CARGA DE DATOS (Año actual, Año anterior y Metas)
    const promesasPrev = months.map(m => getDoc(doc(db, "realizados", String(prevYear), m, "_mensual")));
    const snapPrev = await Promise.all(promesasPrev);

    // ✅ REDONDEO DE DATOS HISTÓRICOS (Año Anterior)
    const dataPrevYear = snapPrev.map(s => {
      const data = s.exists() ? (s.data().overrides || s.data().agg || {}) : {};
      Object.keys(data).forEach(key => {
        if (typeof data[key] === 'number') {
          data[key] = Math.round(data[key]);
        }
      });
      return data;
    });

    const dataAnual = {};
    const metasAnuales = {};

    // Totales Anuales (Metas completas)
    let totalMetaUrg = 0, totalMetaCx = 0, totalMetaUvr = 0, totalMetaCE = 0;
    let totalMetaHosp = 0, totalMetaUCI = 0, totalMetaUCE = 0;
    let totalMetaImg = 0, totalMetaLab = 0, totalMetaEst = 0;

    // Metas Acumuladas (Solo hasta el mes con datos)
    let metaUrgAcum = 0, metaCxAcum = 0, metaUvrAcum = 0, metaCEAcum = 0;
    let metaHospAcum = 0, metaUCIAcum = 0, metaUCEAcum = 0;
    let metaImgAcum = 0, metaLabAcum = 0, metaEstAcum = 0;

    const promesasCurr = months.map(async (m) => {
      const mId = `${yearId}-${m}`;
      const [snap, metaRaw] = await Promise.all([
        getDoc(doc(db, "realizados", String(yearId), m, "_mensual")),
        loadForecastMeta(mId)
      ]);

      const mesData = snap.exists() ? (snap.data().overrides || snap.data().agg || {}) : {};

      // ✅ REDONDEO DE DATOS ACTUALES (Año en curso)
      Object.keys(mesData).forEach(key => {
        if (typeof mesData[key] === 'number') {
          mesData[key] = Math.round(mesData[key]);
        }
      });

      // ✅ REDONDEO DE METAS MENSUALES (Para evitar decimales en sumatorias)
      const meta = {};
      if (metaRaw) {
        Object.keys(metaRaw).forEach(k => {
          meta[k] = typeof metaRaw[k] === 'number' ? Math.round(metaRaw[k]) : metaRaw[k];
        });
      }

      dataAnual[m] = mesData;
      metasAnuales[m] = meta;

      const mUrg = meta.urgenciasMeta || 0;
      const mCx = meta.cxMetaProced || 0;
      const mUvr = meta.uvrMeta || 0;
      const mCE = meta.ceMetaConsultas || 0;
      const mHosp = meta.hospMetaEgresos || 0;
      const mUCI = meta.uciMetaEgresos || 0;
      const mUCE = meta.uceMetaEgresos || 0;
      const mImg = meta.imgMetaExamenes || 0;
      const mLab = meta.labMetaPruebas || 0;

      // Acumulación Total Anual
      totalMetaUrg += mUrg;
      totalMetaCx += mCx;
      totalMetaUvr += mUvr;
      totalMetaCE += mCE;
      totalMetaHosp += mHosp;
      totalMetaUCI += mUCI;
      totalMetaUCE += mUCE;
      totalMetaImg += mImg;
      totalMetaLab += mLab;

      // Acumulación Meta a la fecha (Si el mes tiene datos reales)
      if (Object.keys(mesData).length > 0) {
        metaUrgAcum += mUrg;
        metaCxAcum += mCx;
        metaUvrAcum += mUvr;
        metaCEAcum += mCE;
        metaHospAcum += mHosp;
        metaUCIAcum += mUCI;
        metaUCEAcum += mUCE;
        metaImgAcum += mImg;
        metaLabAcum += mLab;
      }
    });

    await Promise.all(promesasCurr);

    // 2. FUNCIÓN GENERADORA DE FILAS (REPARADA PARA GIRO CAMA Y SUMATORIAS DINÁMICAS)
    const generarFilaHTML = (fila, dataSet, metasSet, metaAnualTotal, metaAnualAcum) => {
      let sumaPrev = 0, mesesPrev = 0;
      dataPrevYear.forEach(mesSet => {
        // Lógica de suma dinámica para Laboratorio en año anterior
        if (fila.isSumatoriaLab) {
          const keysLab = ["LAB|INSTITUCIONAL", "LAB|Microbiologia", "LAB|PRIME", "LAB|SUESCUN", "LAB|COLCAN", "LAB|ANTIOQUIA", "LAB|CENTRO DE REFERENCIA", "LAB|LIME", "LAB|SYNLAB", "LAB|ICMT", "LAB|CIB", "LAB|UNILAB", "LAB|Muestras particulares"];
          let sumaMesPrev = 0;
          keysLab.forEach(k => sumaMesPrev += (parseFloat(mesSet[k]) || 0));
          // ✅ REGLA ACTUALIZADA: Se elimina la división histórica
          sumaPrev += sumaMesPrev;
          mesesPrev++;
        } else {
          for (let key of fila.dbKeys) {
            const v = mesSet[key] || mesSet[`URG|${key}`] || mesSet[`URGENCIAS|${key}`] || mesSet[`CIRUGIA_ING|${key}`] || mesSet[`CIRUGIA_EGR|${key}`] || mesSet[`CX-ESP|${key}`] || mesSet[`CE|${key}`] || mesSet[`HEM|${key}`] || mesSet[`HOSP|${key}`] || mesSet[`UCI|${key}`] || mesSet[`UCE|${key}`] || mesSet[`INST|${key}`] || mesSet[`HEMO_ONCO|${key}`] || mesSet[`HEMOCOMPONENTES|${key}`] || mesSet[`ENDO|${key}`] || mesSet[`IMG|${key}`] || mesSet[`IMG-HOS|${key}`] || mesSet[`IMG-AMB|${key}`] || mesSet[`IMG-TOT|${key}`] || mesSet[`LAB|${key}`] || mesSet[`EST|${key}`];
            if (v !== undefined) { sumaPrev += parseFloat(v); mesesPrev++; break; }
          }
        }
      });
      // ✅ 1. Redondear el promedio del año anterior (Columna: Promedio 2025)
      const promPrev = mesesPrev > 0 ? Math.round(sumaPrev / mesesPrev) : 0;

      let acumuladoReal = 0, mesesConDatos = 0, celdasMeses = "";
      months.forEach(m => {
        let val = 0;
        const mesSet = dataAnual[m] || {};

        if (fila.isSumatoriaImg) {
          const v1 = parseFloat(mesSet["IMG-TOT|Imágenes (Total)"]) || 0;
          const v2 = parseFloat(mesSet["IMG-TOT|Pacientes (Total)"]) || 0;
          const v3 = parseFloat(mesSet["IMG-TOT|Procedimientos guiados (Total)"]) || 0;
          val = v1 + v2 + v3;
        } else if (fila.isSumatoriaLab) {
          const keysLab = ["LAB|INSTITUCIONAL", "LAB|Microbiologia", "LAB|PRIME", "LAB|SUESCUN", "LAB|COLCAN", "LAB|ANTIOQUIA", "LAB|CENTRO DE REFERENCIA", "LAB|LIME", "LAB|SYNLAB", "LAB|ICMT", "LAB|CIB", "LAB|UNILAB", "LAB|Muestras particulares"];
          let sumaMes = 0;
          keysLab.forEach(k => sumaMes += (parseFloat(mesSet[k]) || 0));
          // ✅ REGLA ACTUALIZADA: Se elimina la división por 2 solicitada
          val = sumaMes;
        } else {
          for (let key of fila.dbKeys) {
            const v = mesSet[key] || mesSet[`URG|${key}`] || mesSet[`URGENCIAS|${key}`] || mesSet[`CIRUGIA_ING|${key}`] || mesSet[`CIRUGIA_EGR|${key}`] || mesSet[`CX-ESP|${key}`] || mesSet[`CE|${key}`] || mesSet[`HEM|${key}`] || mesSet[`HOSP|${key}`] || mesSet[`UCI|${key}`] || mesSet[`UCE|${key}`] || mesSet[`INST|${key}`] || mesSet[`HEMO_ONCO|${key}`] || mesSet[`HEMOCOMPONENTES|${key}`] || mesSet[`ENDO|${key}`] || mesSet[`IMG|${key}`] || mesSet[`IMG-HOS|${key}`] || mesSet[`IMG-AMB|${key}`] || mesSet[`IMG-TOT|${key}`] || mesSet[`LAB|${key}`] || mesSet[`EST|${key}`];
            if (v !== undefined) { val = v; break; }
          }
        }

        // ✅ 2. Forzar que el valor mensual sea entero antes de procesar
        const numVal = Math.round(parseFloat(val) || 0);

        let metaMComp = 0;
        if (fila.metaKey) {
          metaMComp = Math.round(metasSet[m]?.[fila.metaKey] || 0);
        } else if (fila.isSumaHospUCE) {
          metaMComp = Math.round((metasSet[m]?.hospMetaEgresos || 0) + (metasSet[m]?.uceMetaEgresos || 0));
        } else if (fila.isSumaGlobal) {
          metaMComp = Math.round((metasSet[m]?.hospMetaEgresos || 0) + (metasSet[m]?.uciMetaEgresos || 0) + (metasSet[m]?.uceMetaEgresos || 0));
        } else if (metaAnualTotal > 0) {
          // ✅ 3. Redondear la meta distribuida
          metaMComp = Math.round(metaAnualTotal / 12);
        }

        let estilo = "border: 1px solid #cbd5e1; padding: 10px;";
        if (fila.isMain && metaMComp > 0) {
          const cls = kpiClass(numVal, metaMComp);
          // ✅ CORRECCIÓN DE COLORES SEMÁFORO (KPIs)
          if (cls === 'ok') estilo += "background: #10b981; color: white; font-weight: bold;";
          else if (cls === 'warn') estilo += "background: #f59e0b; color: white; font-weight: bold;";
          else estilo += "background: #ef4444; color: white; font-weight: bold;";
        }

        acumuladoReal += numVal;
        if (numVal > 0 || Object.keys(mesSet).length > 0) mesesConDatos++;

        const esEficiencia = fila.label.includes("Giro") || fila.label.includes("Promedio") || fila.label.includes("Porcentaje") || fila.isPct;
        celdasMeses += `<td style="${estilo}">${fila.isPct ? fmtDec1(numVal) + '%' : (esEficiencia ? fmtDec1(numVal) : fmtInt(numVal))}</td>`;
      });

      const promMes = mesesConDatos > 0 ? acumuladoReal / mesesConDatos : 0;
      const esEficienciaFinal = fila.label.includes("Giro") || fila.label.includes("Promedio") || fila.label.includes("Porcentaje") || fila.isPct;
      const proyAnual = esEficienciaFinal ? promMes : promMes * 12;

      // ✅ CÁLCULO DE META ANUAL PARA LA COLUMNA
      let displayMeta = 0;
      if (fila.metaValorManualAnual) {
        displayMeta = fila.metaValorManualAnual;
      } else if (fila.metaKey || fila.isSumaHospUCE || fila.isSumaGlobal || fila.isSumatoriaImg || fila.isSumatoriaLab || fila.isUvr) {
        displayMeta = metaAnualTotal;
      } else if (metaAnualTotal > 0 && fila.isMain) {
        displayMeta = metaAnualTotal;
      }

      // ✅ CORRECCIÓN DE COLORES TOTALES Y PROYECCIÓN
      let estiloTotal = "border: 1px solid #cbd5e1; font-weight: bold; background: #f1f5f9; color: #253D5B; padding: 10px;";
      let estiloProy = "border: 1px solid #cbd5e1; font-weight: bold; background: #B6B5AF; color: #253D5B; padding: 10px;";
      let estiloPromPrev = "border: 1px solid #cbd5e1; background: #4E6C9F; padding: 10px; color: #ffffff; font-weight: bold;";
      let estiloMetaCol = "border: 1px solid #cbd5e1; background: #64748b; padding: 10px; color: #ffffff; font-weight: bold;";

      return `<tr>${fila.tdGroup || ''}
              <td style="border: 1px solid #cbd5e1; text-align: left; padding: 10px; font-weight: bold; background:#f1f5f9; color: #253D5B;">${fila.label}</td>
              <td style="${estiloPromPrev}">${fila.isPct ? fmtDec1(promPrev) + '%' : (esEficienciaFinal ? fmtDec1(promPrev) : fmtInt(promPrev))}</td>
              <td style="${estiloMetaCol}">${displayMeta > 0 ? (esEficienciaFinal ? fmtDec1(displayMeta) : fmtInt(displayMeta)) : "-"}</td>
              ${celdasMeses}
              <td style="${estiloTotal}">${esEficienciaFinal ? "" : fmtInt(acumuladoReal)}</td>
              <td style="${estiloTotal}">${fila.isPct ? fmtDec1(promMes) + '%' : (esEficienciaFinal ? fmtDec1(promMes) : fmtInt(promMes))}</td>
              <td style="${estiloProy}">${fila.isPct ? fmtDec1(proyAnual) + '%' : (esEficienciaFinal ? fmtDec1(proyAnual) : fmtInt(proyAnual))}</td>
          </tr>`;
    };

    // --- 1. TABLA URGENCIAS ---
    const configUrg = [
      { label: "Consultas medicina general", dbKeys: ["URGENCIAS|Consultas medicina general"], isUrg: true },
      { label: "Consultas ortopedia y pediatria", dbKeys: ["URGENCIAS|Consultas ortopedia y pediatria"], isUrg: true },
      { label: "Total pacientes de urgencias", dbKeys: ["URG|Total pacientes urgencias"], isMain: true, isUrg: true, metaKey: 'urgenciasMeta' },
      { label: "%Pacientes atendidos en urgencias", dbKeys: ["URG|%Pacientes atendidos en urgencias"], isPct: true, isUrg: true },
      { label: "Triages no atendidos", dbKeys: ["URGENCIAS|Triages no atendidos"], isUrg: true },
      { label: "Total triages", dbKeys: ["URG|Total triages"], isMain: true, isUrg: true, metaKey: 'urgenciasMeta' },
      { label: "Total ingresos a urgencias (triages + ortopedia)", dbKeys: ["URG|Total ingresos a urgencias (triages + ortopedia)"], isMain: true, isUrg: true, metaKey: 'urgenciasMeta' },
      { label: "Ptes trasladados a otros servicios", dbKeys: ["URGENCIAS|Ptes trasladados a otros servicios"], isUrg: true },
      { label: "Urgencias = > 24 horas", dbKeys: ["URGENCIAS|Urgencias = > 24 horas"], isUrg: true },
      { label: "% pacientes que se trasladan a otros servicios", dbKeys: ["URG|% pacientes que se trasladan a otros servicios"], isPct: true, isUrg: true },
      { label: "Pacientes en observación CMI", dbKeys: ["URGENCIAS|Pacientes en observación CMI"], isUrg: true },
      { label: "Egresos atendidos urgencias", dbKeys: ["URG|Egresos atendidos urgencias"], isUrg: true }
    ];
    // Estructura de tabla con paleta de colores institucional SIN TONOS VERDES
    let htmlUrg = `
        <div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:20px;">
            <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
                <thead>
                    <tr style="background: #253D5B; color: #fff;">
                        <th style="border: 1px solid #fff; padding: 12px; text-align:left;">URGENCIAS</th>
                        <th style="border: 1px solid #fff; background: #4E6C9F; padding: 12px;">Promedio ${prevYear}</th>
                        <th style="border: 1px solid #fff; background: #64748b; padding: 12px;">META ANUAL</th>
                        ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                        <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                        <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                        <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                    </tr>
                </thead>
                <tbody>`;

    configUrg.forEach(f => htmlUrg += generarFilaHTML(f, dataAnual, metasAnuales, totalMetaUrg, metaUrgAcum));

    // Fila de Meta (Pie de tabla) eliminando el verde por completo
    htmlUrg += `
                <tr style="background: #253D5B; color: #fff; font-weight: bold;">
                    <td style="border: 1px solid #fff; text-align: left; padding: 5px;">Meta presupuesto</td>
                    <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
                    <td style="border: 1px solid #fff; background: #64748b; padding: 5px;">${totalMetaUrg.toLocaleString()}</td>
                    ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${(metasAnuales[m]?.urgenciasMeta || 0).toLocaleString()}</td>`).join('')}
                    <td style="border: 1px solid #fff; background: #4E6C9F; padding: 5px;">${totalMetaUrg.toLocaleString()}</td>
                    <td style="border: 1px solid #fff; background: #4E6C9F; padding: 5px;">${(totalMetaUrg / 12).toLocaleString()}</td>
                    <td style="background: #B6B5AF; color: #253D5B; border: 1px solid #fff;">Meta Anual</td>
                </tr>
            </tbody>
            </table>
        </div>`;

    // --- 2. TABLA HOSPITALIZACIÓN (CORREGIDA CON CIERRE INSTITUCIONAL) ---
    let htmlHosp = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;"><table style="width:100%; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;"><thead><tr style="background: #253D5B; color: #fff;"><th style="border: 1px solid #fff; padding: 12px; text-align:left;">HOSPITALIZACIÓN</th><th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th><th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}<th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th><th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th><th style="background: #B6B5AF; color:#253D5B;">PROYECCIÓN CIERRE ${yearId}</th></tr></thead><tbody>`;

    htmlHosp += generarFilaHTML({ label: "EGRESOS HOSP. PUESTOS 2, 3 y 4", dbKeys: ["HOSP|EGRESOS HOSP. PUESTOS 2, 3 y 4"], isMain: true, metaKey: 'hospMetaEgresos' }, dataAnual, metasAnuales, totalMetaHosp, metaHospAcum);
    htmlHosp += generarFilaHTML({ label: "Promedio día estancia", dbKeys: ["HOSP|Promedio día estancia"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio cama disponible", dbKeys: ["HOSP|Promedio cama disponible"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Giro Cama", dbKeys: ["HOSP|Giro Camas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Ocupadas", dbKeys: ["HOSP|Dias Camas Ocupadas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Disponibles", dbKeys: ["HOSP|Dias Camas Disponibles"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "% OCUPACION", dbKeys: ["HOSP|% OCUPACION"], isPct: true }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += `<tr style="background: #f1f5f9; color: #253D5B; font-weight: bold;"><td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta egresos hospitalizacion</td><td style="border: 1px solid #cbd5e1;"></td><td style="border: 1px solid #cbd5e1; background: #64748b; color:white;">${fmtInt(totalMetaHosp)}</td>${months.map(m => `<td style="border: 1px solid #cbd5e1;">${fmtInt(metasAnuales[m]?.hospMetaEgresos || 0)}</td>`).join('')}<td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaHosp)}</td><td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaHosp / 12)}</td><td style="border: 1px solid #cbd5e1;">Meta Anual</td></tr>`;

    htmlHosp += generarFilaHTML({ label: "EGRESOS DE UCI ADULTOS", dbKeys: ["UCI|EGRESOS DE UCI ADULTOS"], isMain: true, metaKey: 'uciMetaEgresos' }, dataAnual, metasAnuales, totalMetaUCI, metaUCIAcum);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Ocupadas", dbKeys: ["UCI|Dias Camas Ocupadas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Disponibles", dbKeys: ["UCI|Dias Camas Disponibles"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio día estancia", dbKeys: ["UCI|Promedio día estancia"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio cama disponible", dbKeys: ["UCI|Promedio cama disponible"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Giro Cama", dbKeys: ["UCI|Giro Camas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "% DE OCUPACION", dbKeys: ["UCI|% DE OCUPACION"], isPct: true }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += `<tr style="background: #f1f5f9; color: #253D5B; font-weight: bold;"><td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta egresos UCI</td><td style="border: 1px solid #cbd5e1;"></td><td style="border: 1px solid #cbd5e1; background: #64748b; color:white;">${fmtInt(totalMetaUCI)}</td>${months.map(m => `<td style="border: 1px solid #cbd5e1;">${fmtInt(metasAnuales[m]?.uciMetaEgresos || 0)}</td>`).join('')}<td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaUCI)}</td><td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaUCI / 12)}</td><td style="border: 1px solid #cbd5e1;">Meta Anual</td></tr>`;

    htmlHosp += generarFilaHTML({ label: "EGRESOS DE UCE ADULTOS", dbKeys: ["UCE|EGRESOS DE UCE ADULTOS"], isMain: true, metaKey: 'uceMetaEgresos' }, dataAnual, metasAnuales, totalMetaUCE, metaUCEAcum);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Ocupadas", dbKeys: ["UCE|Dias Camas Ocupadas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio día estancia", dbKeys: ["UCE|Promedio día estancia"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio cama disponible", dbKeys: ["UCE|Promedio cama disponible"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Giro Cama", dbKeys: ["UCE|Giro Camas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "% DE OCUPACION", dbKeys: ["UCE|% DE OCUPACION"], isPct: true }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += `<tr style="background: #f1f5f9; color: #253D5B; font-weight: bold;"><td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta egresos UCE</td><td style="border: 1px solid #cbd5e1;"></td><td style="border: 1px solid #cbd5e1; background: #64748b; color:white;">${fmtInt(totalMetaUCE)}</td>${months.map(m => `<td style="border: 1px solid #cbd5e1;">${fmtInt(metasAnuales[m]?.uceMetaEgresos || 0)}</td>`).join('')}<td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaUCE)}</td><td style="border: 1px solid #cbd5e1;">${fmtInt(totalMetaUCE / 12)}</td><td style="border: 1px solid #cbd5e1;">Meta Anual</td></tr>`;

    const mHUCE = totalMetaHosp + totalMetaUCE;
    const mHUCEAcum = metaHospAcum + metaUCEAcum;
    htmlHosp += generarFilaHTML({ label: "EGRESOS UCE ADULTOS + HOSPITALIZACIÓN", dbKeys: ["INST|EGRESOS UCE ADULTOS + HOSPITALIZACIÓN"], isMain: true, isSumaHospUCE: true }, dataAnual, metasAnuales, mHUCE, mHUCEAcum);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Ocupadas", dbKeys: ["INST|Días Camas Ocupadas"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Dias Cama Disponibles", dbKeys: ["INST|Días Camas Disponibles"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Promedio día estancia", dbKeys: ["INST|Promedio día estancia (Hosp+Uce)", "Promedio día estancia (Hosp+Uce)"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "Giro Cama", dbKeys: ["INST|Giro Cama (Hosp+Uce)"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "% DE OCUPACION", dbKeys: ["INST|% DE OCUPACIÓN (Hosp+Uce)", "% DE OCUPACIÓN (Hosp+Uce)"], isPct: true }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += `<tr style="background: #f1f5f9; color: #253D5B; font-weight: bold;"><td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta egresos Hosp + UCE</td><td style="border: 1px solid #cbd5e1;"></td>${months.map(m => `<td style="border: 1px solid #cbd5e1;">${fmtInt((metasAnuales[m]?.hospMetaEgresos || 0) + (metasAnuales[m]?.uceMetaEgresos || 0))}</td>`).join('')}<td style="border: 1px solid #cbd5e1;">${fmtInt(mHUCE)}</td><td style="border: 1px solid #cbd5e1;">${fmtInt(mHUCE / 12)}</td><td style="border: 1px solid #cbd5e1;">Meta Anual</td></tr>`;

    const mGLOB = totalMetaHosp + totalMetaUCI + totalMetaUCE;
    const mGLOBAcum = metaHospAcum + metaUCIAcum + metaUCEAcum;
    htmlHosp += generarFilaHTML({ label: "TOTAL EGRESOS HOSPITALARIOS (Hosp, Uci, Uce)", dbKeys: ["INST|TOTAL EGRESOS HOSPITALARIOS"], isMain: true, isSumaGlobal: true }, dataAnual, metasAnuales, mGLOB, mGLOBAcum);
    htmlHosp += generarFilaHTML({ label: "TOTAL DIAS CAMAS OCUPADAS INTITUCIONAL", dbKeys: ["INST|TOTAL DÍAS CAMAS OCUPADAS"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "TOTAL DIAS CAMAS DISPONIBLES INSTITUCIONAL", dbKeys: ["INST|TOTAL DÍAS CAMAS DISPONIBLES"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "PROMEDIO DÍA ESTANCIA GENERAL", dbKeys: ["INST|PROMEDIO DÍA ESTANCIA GENERAL"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "GIRO CAMA INSTITUCIONAL", dbKeys: ["INST|GIRO CAMA INSTITUCIONAL"] }, dataAnual, metasAnuales, 0, 0);
    htmlHosp += generarFilaHTML({ label: "% DE OCUPACION INSTITUCIONAL", dbKeys: ["INST|% DE OCUPACIÓN INSTITUCIONAL"], isPct: true }, dataAnual, metasAnuales, 0, 0);

    // ✅ ÚLTIMA FILA: Ajustada al color del encabezado (#253D5B y texto blanco)
    htmlHosp += `<tr style="background: #253D5B; color: #fff; font-weight: bold;"><td style="border: 1px solid #ffffff; text-align: left; padding: 5px;">Meta Institucional Egresos</td><td style="border: 1px solid #ffffff; background: #4E6C9F;"></td><td style="border: 1px solid #ffffff; background: #64748b;">${fmtInt(mGLOB)}</td>${months.map(m => `<td style="border: 1px solid #ffffff;">${fmtInt((metasAnuales[m]?.hospMetaEgresos || 0) + (metasAnuales[m]?.uciMetaEgresos || 0) + (metasAnuales[m]?.uceMetaEgresos || 0))}</td>`).join('')}<td style="border: 1px solid #ffffff;">${fmtInt(mGLOB)}</td><td style="border: 1px solid #ffffff;">${fmtInt(mGLOB / 12)}</td><td style="border: 1px solid #ffffff;">Meta Anual</td></tr></tbody></table></div>`;

    // --- 3. TABLA CIRUGÍA GENERAL (AJUSTADA CON LLAVES ADICIONALES Y COLORES INSTITUCIONALES) ---
    const configCx = [
      { label: "Pacientes electivos", dbKeys: ["CIRUGIA_ING|Pacientes electivos (ingresos)"], group: "INGRESOS", rowSpan: 6 },
      { label: "Total procedimientos electivos", dbKeys: ["CIRUGIA_ING|Total procedimientos electivos"] },
      { label: "Pacientes urgentes", dbKeys: ["CIRUGIA_ING|Pacientes urgentes (ingresos)"] },
      { label: "Total procedimientos urgentes", dbKeys: ["CIRUGIA_ING|Total procedimientos urgentes"] },
      { label: "Total ingresos de pacientes", dbKeys: ["CX-ING|Total ingresos de pacientes", "Total ingresos de pacientes"] },
      { label: "Total procedimientos (ingresos)", dbKeys: ["CX-ING|Total procedimientos (ingresos)", "Total procedimientos (ingresos)"], isMain: true, metaKey: 'cxMetaProced' },
      { label: "Pacientes hospitalizados", dbKeys: ["CIRUGIA_EGR|Pacientes hospitalizados"], group: "EGRESOS", rowSpan: 6 },
      { label: "Total procedimientos hospitalizados", dbKeys: ["CIRUGIA_EGR|Total procedimientos hospitalarios"] },
      { label: "Pacientes ambulatorios", dbKeys: ["CIRUGIA_EGR|Pacientes ambulatorios"] },
      { label: "Total procedimientos ambulatorios", dbKeys: ["CIRUGIA_EGR|Total procedimientos ambulatorios"] },
      { label: "Total egresos de pacientes", dbKeys: ["Total egresos de pacientes", "CX-EGR|Total egresos de pacientes"] },
      { label: "Total procedimientos (egresos)", dbKeys: ["Total procedimientos (egresos)", "CX-EGR|Total procedimientos (egresos)"], isMain: true, metaKey: 'cxMetaProced' }
    ];

    // Encabezado con Azul Oscuro (#253D5B) y Azul Medio (#4E6C9F)
    let htmlCx = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
          <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
              <thead>
                  <tr style="background: #253D5B; color: #fff;">
                      <th style="border: 1px solid #fff; width:30px;"></th>
                      <th style="border: 1px solid #fff; padding: 12px; text-align:left;">CIRUGÍA</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                      <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                      ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                      <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                      <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                  </tr>
              </thead>
              <tbody>`;

    configCx.forEach(f => {
      if (f.group) {
        // Estilo de grupo lateral con texto vertical y Azul Oscuro
        f.tdGroup = `<td rowspan="${f.rowSpan}" style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px; font-size:9px;">
                  <div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">${f.group}</div>
              </td>`;
      }
      htmlCx += generarFilaHTML(f, dataAnual, metasAnuales, totalMetaCx, metaCxAcum);
    });

    // Fila de Meta Final con Azul Oscuro y Azul Medio
    htmlCx += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
          <td colspan="2" style="border: 1px solid #fff; text-align: left; padding: 5px;">Meta Procedimientos</td>
          <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
          <td style="border: 1px solid #fff; background: #64748b; padding: 5px;">${fmtInt(totalMetaCx)}</td>
          ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${fmtInt(metasAnuales[m]?.cxMetaProced || 0)}</td>`).join('')}
          <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaCx)}</td>
          <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaCx / 12)}</td>
          <td style="background: #4E6C9F; border: 1px solid #fff;">Meta Anual</td>
      </tr></tbody></table></div>`;

    // --- 4. TABLA ESPECIALIDADES (CON COLORES INSTITUCIONALES) ---
    const esps = ["CX. GENERAL", "ORTOPEDIA", "GINECOLOGÍA", "UROLOGÍA", "OTORRINO", "NEUROCIRUGÍA", "MAXILOFACIAL", "BARIÁTRICA", "CX. GÁSTRICA", "CX. VASCULAR", "HEMATOLÓGICA - ONCOLOGÍA", "GINECO + CX GNAL", "OTROS"];

    // Encabezado con Azul Oscuro (#253D5B) y Azul Medio (#4E6C9F)
    let htmlCxEsp = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
            <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
                <thead>
                    <tr style="background: #253D5B; color: #fff;">
                        <th style="border: 1px solid #fff; padding: 12px; text-align:left;">CIRUGÍA POR ESPECIALIDAD</th>
                        <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                        <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                        ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                        <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                        <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                        <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                    </tr>
                </thead>
                <tbody>`;

    esps.forEach(e => {
      htmlCxEsp += generarFilaHTML({ label: `TOTAL PACIENTES ${e}`, dbKeys: [`CX-ESP|${e} - TOTAL PACIENTES`] }, dataAnual, metasAnuales, 0, 0);
      htmlCxEsp += generarFilaHTML({ label: `TOTAL PROCEDIMIENTOS ${e}`, dbKeys: [`CX-ESP|${e} - TOTAL PROCEDIMIENTOS`] }, dataAnual, metasAnuales, 0, 0);
      htmlCxEsp += generarFilaHTML({ label: `U.V.R. (${e})`, dbKeys: [`CX-ESP|${e} - TOTAL U.V.R`] }, dataAnual, metasAnuales, 0, 0);
    });

    const resumenCx = [
      { label: "TOTAL CIRUGIAS POR ESPECIALIDAD", dbKeys: ["CX-ESP|Total de cirugias por especialidad"] },
      { label: "TOTAL DE PROCEDIMIENTOS QUIRURGICOS Y NO QUIRURGICOS", dbKeys: ["CX-ESP|Total de procedimientos quirúrgicos y no quirurgicos"] },
      { label: "Total de U.V.R", dbKeys: ["CX-ESP|Total de U.V.R"], isMain: true, isUvr: true, metaKey: 'uvrMeta' }
    ];

    resumenCx.forEach(rf => {
      const mT = rf.isUvr ? totalMetaUvr : 0;
      const mA = rf.isUvr ? metaUvrAcum : 0;
      htmlCxEsp += generarFilaHTML(rf, dataAnual, metasAnuales, mT, mA);
    });

    // Fila Final de Meta UVR ajustada al color del encabezado (#253D5B)
    htmlCxEsp += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
            <td style="border: 1px solid #fff; text-align: left; padding: 5px;">Meta UVR</td>
            <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
            <td style="border: 1px solid #fff; background: #64748b; padding: 5px;">${fmtInt(totalMetaUvr)}</td>
            ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${fmtInt(metasAnuales[m]?.uvrMeta || 0)}</td>`).join('')}
            <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaUvr)}</td>
            <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaUvr / 12)}</td>
            <td style="background: #4E6C9F; border: 1px solid #fff;">Meta Anual</td>
        </tr></tbody></table></div>`;

    // --- 5. TABLA CONSULTA EXTERNA (CON COLORES INSTITUCIONALES) ---
    const especCE = ["ANESTESIOLOGIA Y REANIMACION", "CIRUGIA GENERAL", "CIRUGIA MAXILOFACIAL", "CIRUGIA VASCULAR", "GINECOLOGIA Y OBSTETRICIA", "HEMATO - ONCOLOGIA", "GRUPO BARIATRICO", "NEUROCIRUGIA", "ORTOPEDIA Y TRAUMATOLOGIA", "OTORRINOLARINGOLOGIA", "UROLOGIA", "OTROS"];

    // Encabezado principal en Azul Oscuro (#253D5B) y soportes en Azul Medio (#4E6C9F)
    let htmlCE = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
          <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
              <thead>
                  <tr style="background: #253D5B; color: #fff;">
                      <th style="border: 1px solid #fff; padding: 12px; text-align:left;">CONSULTA EXTERNA</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                      <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                      ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                      <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                      <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                  </tr>
              </thead>
              <tbody>`;

    especCE.forEach(ce => htmlCE += generarFilaHTML({ label: ce, dbKeys: [`CE|${ce}`] }, dataAnual, metasAnuales, 0, 0));

    // Fila de TOTAL (Utiliza lógica de colores de generarFilaHTML)
    htmlCE += generarFilaHTML({ label: "TOTAL", dbKeys: ["CE|TOTAL"], isMain: true, metaKey: 'ceMetaConsultas' }, dataAnual, metasAnuales, totalMetaCE, metaCEAcum);

    // Fila de META: Cierre sólido en Azul Oscuro para jerarquía visual
    htmlCE += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
          <td style="border: 1px solid #fff; text-align: left; padding: 5px;">META CONSULTAS MES</td>
          <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
          <td style="border: 1px solid #fff; background: #64748b; padding: 5px;">${fmtInt(totalMetaCE)}</td>
          ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${fmtInt(metasAnuales[m]?.ceMetaConsultas || 0)}</td>`).join('')}
          <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaCE)}</td>
          <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaCE / 12)}</td>
          <td style="background: #4E6C9F; border: 1px solid #fff;">Meta Anual</td>
      </tr></tbody></table></div>`;

    // --- 6. TABLA HEMATO ONCOLOGÍA (CON COLORES INSTITUCIONALES) ---
    const configHem = [
      { label: "Total quimio administrados amb", dbKeys: ["HEMO_ONCO|Total quimio administrados amb"] },
      { label: "Total pacientes de quimio", dbKeys: ["HEMO_ONCO|Total pacientes de quimio"] },
      { label: "Total aspirados de medula osea", dbKeys: ["HEMO_ONCO|Aspirados MO (Ambulatorio)"] },
      { label: "Total de pacientes transfundidos en la unidad amb", dbKeys: ["HEMO_ONCO|Pacientes transfundidos (Amb)"] },
      { label: "Flebotomia", dbKeys: ["HEMO_ONCO|Flebotomía"] },
      { label: "Curaciones cateteres PICC", dbKeys: ["HEMO_ONCO|Curaciones PICC"] },
      { label: "Oportunidad aspiradorados médula ósea", dbKeys: ["HEMO_ONCO|Oportunidad aspirados MO"] },
      { label: "Oportunidad quimio hospitalaria", dbKeys: ["HEMO_ONCO|Oportunidad quimio hospitalaria"] },
      { label: "Oportunidad quimio ambulatoria", dbKeys: ["HEMO_ONCO|Oportunidad quimio ambulatoria"] }
    ];

    // Encabezado en Azul Oscuro (#253D5B) y Azul Medio (#4E6C9F)
    let htmlHem = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
          <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
              <thead>
                  <tr style="background: #253D5B; color: #fff;">
                      <th style="border: 1px solid #fff; padding: 12px; text-align:left;">HEMATO ONCOLOGIA</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                      <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                      ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                      <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                      <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                  </tr>
              </thead>
              <tbody>`;

    configHem.forEach(h => htmlHem += generarFilaHTML(h, dataAnual, metasAnuales, 0, 0));

    htmlHem += `</tbody></table></div>`;

    // --- 7. TABLA HEMOCOMPONENTES (CON COLORES INSTITUCIONALES) ---
    const configHcom = [
      { label: "APLICACION DE LA UNIDAD DE GLOBULOS ROJOS O ERITROCITOS", dbKeys: ["HEMOCOMP|APLICACION DE LA UNIDAD DE GLOBULOS ROJOS O ERITROCITOS"] },
      { label: "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS (ESTANDAR)", dbKeys: ["HEMOCOMP|UNIDAD DE GLOBULOS ROJOS O ERITROCITOS (ESTANDAR)"] },
      { label: "APLICACION DE LA UNIDAD DE PLAQUETAS TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO", dbKeys: ["HEMOCOMP|HEMOCOMP|APLICACION DE LA UNIDAD DE PLAQUETAS TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO"] },
      { label: "UNIDAD DE CONCENTRADO DE PLAQUETAS POR AFERESIS O PLAQUETOFERESIS TARIFA HASTA 6 UNIDADES POR SISTEMA ABIERTO O CERRADO", dbKeys: ["HEMOCOMP|UNIDAD DE CONCENTRADO DE PLAQUETAS POR AFERESIS O PLAQUETOFERESIS TARIFA HASTA 6 UNIDADES POR SISTEMA ABIERTO O CERRADO"] },
      { label: "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS DESLEUCOCITADOS APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%", dbKeys: ["HEMOCOMP|UNIDAD DE GLOBULOS ROJOS O ERITROCITOS DESLEUCOCITADOS APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%"] },
      { label: "APLICACION DE PLASMA FRESCO O CONGELADO", dbKeys: ["HEMOCOMP|APLICACION DE PLASMA FRESCO O CONGELADO"] },
      { label: "UNIDAD DE PLASMA FRESCO", dbKeys: ["HEMOCOMP|UNIDAD DE PLASMA FRESCO"] },
      { label: "APLICACION DE LA UNIDAD DE CRIOPRECIPITADO TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO", dbKeys: ["HEMOCOMP|HEMOCOMP|APLICACION DE LA UNIDAD DE CRIOPRECIPITADO TARIFA HASTA 6 UNIDADES EN UN MISMO ACTO"] },
      { label: "UNIDAD DE CRIOPRECIPITADO", dbKeys: ["HEMOCOMP|UNIDAD DE CRIOPRECIPITADO"] },
      { label: "UNIDAD DE SANGRE TOTAL", dbKeys: ["HEMOCOMP|HEMOCOMP|UNIDAD DE SANGRE TOTAL"] },
      { label: "UNIDAD DE CONCENTRADO DE PLAQUETAS DELEUCOCITADOS (ESTANDAR) APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%", dbKeys: ["HEMOCOMP|UNIDAD DE CONCENTRADO DE PLAQUETAS DELEUCOCITADOS (ESTANDAR) APLICA PARA LEUCOREDUCCION SUPERIOR AL 70%"] },
      { label: "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS IRRADIADOS", dbKeys: ["HEMOCOMP|UNIDAD DE GLOBULOS ROJOS O ERITROCITOS IRRADIADOS"] },
      { label: "UNIDAD DE CONCENTRADO DE LEUCOCITOS POR AFERESIS O LEUCOFERESIS", dbKeys: ["HEMOCOMP|UNIDAD DE CONCENTRADO DE LEUCOCITOS POR AFERESIS O LEUCOFERESIS"] },
      { label: "UNIDAD DE CONCENTRADO DE PLAQUETAS (ESTANDAR)", dbKeys: ["HEMOCOMP|UNIDAD DE CONCENTRADO DE PLAQUETAS (ESTANDAR)"] },
      { label: "UNIDAD DE GLOBULOS ROJOS O ERITROCITOS LAVADOS", dbKeys: ["HEMOCOMP|HEMOCOMP|UNIDAD DE GLOBULOS ROJOS O ERITROCITOS LAVADOS"] },
      { label: "Total Aplicaciones", dbKeys: ["HEMO-COMP|Total Aplicaciones"] },
      { label: "Total Unidades", dbKeys: ["HEMO-COMP|Total Unidades"] },
      { label: "Total de pacientes", dbKeys: ["HEMOCOMP|HEMOCOMP|Total de pacientes"] },
      { label: "Total general (aplicaciones + unidades)", dbKeys: ["HEMO-COMP|TOTAL HEMOCOMPONENTES"], isMain: true }
    ];

    // Encabezado principal con Azul Oscuro (#253D5B)
    let htmlHcom = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
          <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
              <thead>
                  <tr style="background: #253D5B; color: #fff;">
                      <th style="border: 1px solid #fff; padding: 12px; text-align:left;">HEMOCOMPONENTES</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                      <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                      ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                      <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                      <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                  </tr>
              </thead>
              <tbody>`;

    configHcom.forEach(hc => htmlHcom += generarFilaHTML(hc, dataAnual, metasAnuales, 0, 0));

    htmlHcom += `</tbody></table></div>`;

    // --- 8. TABLA ENDOSCOPIA (CON FILAS DE META MENSUAL) ---
    const configEndo = [
      { label: "Endoscopia", dbKeys: ["ENDOS|Endoscopia"], isMain: true, metaValorManual: 130 },
      { label: "Colonoscopia", dbKeys: ["ENDOS|Colonoscopia"] },
      { label: "Fibrobroncoscopia", dbKeys: ["ENDOS|Fibrobroncoscopia"], isMain: true, metaValorManual: 16 },
      { label: "CPRE", dbKeys: ["ENDOS|CPRE"] },
      { label: "Gastrostomia", dbKeys: ["ENDOS|Gastrostomía"] },
      { label: "Rectosigmoidoscopia", dbKeys: ["ENDOS|Rectosigmoidoscopia"] },
      { label: "Otros", dbKeys: ["ENDOS|Otros"] },
      { label: "TOTAL", dbKeys: ["ENDO|TOTAL"], isMain: true },
      { label: "Ambulatorios", dbKeys: ["ENDOS|Ambulatorios"] }
    ];

    let htmlEndo = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
          <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
              <thead>
                  <tr style="background: #253D5B; color: #fff;">
                      <th style="border: 1px solid #fff; padding: 12px; text-align:left;">SERVICIO ENDOSCOPIA</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                      <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                      ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                      <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                      <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                      <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                  </tr>
              </thead>
              <tbody>`;

    // Renderizado de las filas de datos
    configEndo.forEach(en => {
      const metaAnual = en.metaValorManual ? (en.metaValorManual * 12) : 0;
      htmlEndo += generarFilaHTML(en, dataAnual, metasAnuales, metaAnual, 0);
    });

    // ✅ FILA FINAL: META FIBROBRONCOSCOPIA (16 mensual)
    htmlEndo += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
          <td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta Fibrobroncoscopia</td>
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;"></td>
          <td style="border: 1px solid #cbd5e1; background: #64748b; color:white;">${16 * 12}</td>
          ${months.map(() => `<td style="border: 1px solid #cbd5e1; padding: 5px;">16</td>`).join('')}
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">${16 * 12}</td>
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">16</td>
          <td style="background: #4E6C9F; color: #fff; border: 1px solid #cbd5e1;">Meta Mensual</td>
      </tr>`;

    // ✅ FILA FINAL: META ENDOSCOPIA (130 mensual)
    htmlEndo += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
          <td style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta Endoscopia</td>
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;"></td>
          <td style="border: 1px solid #cbd5e1; background: #64748b; color:white; padding: 5px;">${fmtInt(130 * 12)}</td>
          ${months.map(() => `<td style="border: 1px solid #cbd5e1; padding: 5px;">130</td>`).join('')}
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">${fmtInt(130 * 12)}</td>
          <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">130</td>
          <td style="background: #4E6C9F; color: #fff; border: 1px solid #cbd5e1;">Meta Mensual</td>
      </tr>`;

    htmlEndo += `</tbody></table></div>`;

    // --- 9. TABLA IMÁGENES DIAGNÓSTICAS (CORRECCIÓN DE COLORES) ---
    const configImgHosp = [
      { label: "Tomografías", dbKeys: ["IMG-TOT|Tomografías (Hosp)", "IMG|Tomografías (Hosp)"], tdGroup: '<td rowspan="9" style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px;"><div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">Hospitalario</div></td>' },
      { label: "Rayos X", dbKeys: ["IMG-TOT|Rayos X (Hosp)", "IMG|Rayos X (Hosp)"] },
      { label: "Ecografías", dbKeys: ["IMG-TOT|Ecografías (Hosp)", "IMG|Ecografías (Hosp)"] },
      { label: "Procedimientos guiados por tomografías", dbKeys: ["IMG-TOT|Procedimientos guiados por tomografías (Hosp)", "IMG|Procedimientos guiados por tomografías (Hosp)"] },
      { label: "Procedimientos guiados por ecografías", dbKeys: ["IMG-TOT|Procedimientos guiados por ecografías (Hosp)", "IMG|Procedimientos guiados por ecografías (Hosp)"] },
      { label: "Total Procedimientos guiados", dbKeys: ["IMG-TOT|Total Procedimientos guiados (Hosp)", "IMG|Total Procedimientos guiados (Hosp)"] },
      { label: "Total imágenes", dbKeys: ["IMG-TOT|Total imágenes (Hosp)"] },
      { label: "Total pacientes", dbKeys: ["IMG-TOT|Total pacientes (Hosp)"] },
      { label: "Promedio exámenes por paciente", dbKeys: ["IMG-TOT|Promedio exámenes por paciente (Hosp)"] }
    ];
    const configImgAmb = [
      { label: "Tomografías", dbKeys: ["IMG-TOT|Tomografías (Amb)", "IMG|Tomografías (Amb)"], tdGroup: '<td rowspan="9" style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px;"><div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">Ambulatorio</div></td>' },
      { label: "Rayos X", dbKeys: ["IMG-TOT|Rayos X (Amb)", "IMG|Rayos X (Amb)"] },
      { label: "Ecografías", dbKeys: ["IMG-TOT|Ecografías (Amb)", "IMG|Ecografías (Amb)"] },
      { label: "Procedimientos guiados por tomografías", dbKeys: ["IMG-TOT|Procedimientos guiados por tomografías (Amb)", "IMG|Procedimientos guiados por tomografías (Amb)"] },
      { label: "Procedimientos guiados por ecografías", dbKeys: ["IMG-TOT|Procedimientos guiados por ecografías (Amb)", "IMG|Procedimientos guiados por ecografías (Amb)"] },
      { label: "Total Procedimientos guiados", dbKeys: ["IMG-TOT|Total Procedimientos guiados (Amb)", "IMG|Total Procedimientos guiados (Amb)"] },
      { label: "Total imágenes", dbKeys: ["IMG-TOT|Total imágenes (Amb)", "IMG|Total imágenes (Amb)"] },
      { label: "Total pacientes", dbKeys: ["IMG-TOT|Total pacientes (Amb)", "IMG|Total pacientes (Amb)"] },
      { label: "Promedio exámenes por paciente", dbKeys: ["IMG-TOT|Promedio exámenes por paciente (Amb)", "IMG|Promedio exámenes por paciente (Amb)"] }
    ];
    const configImgTotal = [
      { label: "Imágenes (Total)", dbKeys: ["IMG-TOT|Imágenes (Total)"], tdGroup: '<td rowspan="4" style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px;"><div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">TOTAL</div></td>' },
      { label: "Pacientes (Total)", dbKeys: ["IMG-TOT|Pacientes (Total)"] },
      { label: "Procedimientos guiados (Total)", dbKeys: ["IMG-TOT|Procedimientos guiados (Total)"] },
      { label: "SUMA TOTAL (PARA META)", dbKeys: [], isSumatoriaImg: true, isMain: true, metaKey: 'imgMetaExamenes' }
    ];

    // Encabezado con Azul Oscuro (#253D5B) y Azul Medio (#4E6C9F)
    let htmlImg = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
        <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
            <thead>
                <tr style="background: #253D5B; color: #fff;">
                    <th style="border: 1px solid #fff; width:30px;"></th>
                    <th style="border: 1px solid #fff; padding: 12px; text-align:left;">IMÁGENES DIAGNÓSTICAS</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                    <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                    ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                    <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                    <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                </tr>
            </thead>
            <tbody>`;

    configImgHosp.forEach(f => htmlImg += generarFilaHTML(f, dataAnual, metasAnuales, 0, 0));
    configImgAmb.forEach(f => htmlImg += generarFilaHTML(f, dataAnual, metasAnuales, 0, 0));
    configImgTotal.forEach(f => htmlImg += generarFilaHTML(f, dataAnual, metasAnuales, totalMetaImg, metaImgAcum));

    // Fila final de Meta con Azul Oscuro para jerarquía visual
    htmlImg += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
        <td colspan="2" style="border: 1px solid #fff; text-align: left; padding: 5px;">Meta Exámenes</td>
        <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
        <td style="border: 1px solid #fff; background: #64748b; color:white; padding: 5px;">${fmtInt(totalMetaImg)}</td>
        ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${fmtInt(metasAnuales[m]?.imgMetaExamenes || 0)}</td>`).join('')}
        <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaImg)}</td>
        <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaImg / 12)}</td>
        <td style="background: #4E6C9F; border: 1px solid #fff;">Meta Anual</td>
    </tr></tbody></table></div>`;

    // --- 10. TABLA LABORATORIO CLÍNICO (CON METAS ESPECÍFICAS PARA PARTICULARES) ---
    const configLabHosp = [
      { label: "INSTITUCIONAL", dbKeys: ["LAB|INSTITUCIONAL"], tdGroup: '<td rowspan="12" style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px;"><div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">Hospitalario</div></td>' },
      { label: "Microbiologia", dbKeys: ["LAB|Microbiologia"] },
      { label: "PRIME", dbKeys: ["LAB|PRIME"] },
      { label: "SUESCUN", dbKeys: ["LAB|SUESCUN"] },
      { label: "COLCAN", dbKeys: ["LAB|COLCAN"] },
      { label: "ANTIOQUIA", dbKeys: ["LAB|ANTIOQUIA"] },
      { label: "CENTRO DE REFERENCIA", dbKeys: ["LAB|CENTRO DE REFERENCIA"] },
      { label: "LIME", dbKeys: ["LAB|LIME"] },
      { label: "SYNLAB", dbKeys: ["LAB|SYNLAB"] },
      { label: "ICMT", dbKeys: ["LAB|ICMT"] },
      { label: "CIB", dbKeys: ["LAB|CIB"] },
      { label: "UNILAB", dbKeys: ["LAB|UNILAB"] }
    ];

    const configLabPart = [
      {
        label: "Muestras particulares",
        dbKeys: ["LAB|Muestras particulares"],
        isMain: true,
        // Meta variable: 11 meses de 1000 + 1 mes de 500 = 11500 anual
        metaValorManualAnual: 11500,
        tdGroup: '<td style="border:1px solid #cbd5e1; background:#ffffff; color:#253D5B; font-weight:bold; width:30px;"><div style="writing-mode: vertical-lr; transform: rotate(180deg); margin: 0 auto;">Particulares</div></td>'
      }
    ];

    const configLabTotal = [
      { label: "Total (Sumatoria Dinámica)", dbKeys: [], tdGroup: '<td style="border:none;"></td>', isSumatoriaLab: true, isMain: true, metaKey: 'labMetaPruebas' }
    ];

    let htmlLab = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
        <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
            <thead>
                <tr style="background: #253D5B; color: #fff;">
                    <th style="border: 1px solid #fff; width:30px;"></th>
                    <th style="border: 1px solid #fff; padding: 12px; text-align:left;">LABORATORIO CLÍNICO</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                    <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                    ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                    <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                    <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                </tr>
            </thead>
            <tbody>`;

    configLabHosp.forEach(f => htmlLab += generarFilaHTML(f, dataAnual, metasAnuales, 0, 0));

    // Renderizado de Particulares con su meta anual calculada
    configLabPart.forEach(f => {
      htmlLab += generarFilaHTML(f, dataAnual, metasAnuales, f.metaValorManualAnual, 0);
    });

    configLabTotal.forEach(f => htmlLab += generarFilaHTML(f, dataAnual, metasAnuales, totalMetaLab, metaLabAcum));

    // ✅ FILA ADICIONAL: META PARTICULARES (1000 Ene-Nov / 500 Dic)
    htmlLab += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
        <td colspan="2" style="border: 1px solid #cbd5e1; text-align: left; padding: 5px;">Meta Particulares</td>
        <td style="border: 1px solid #cbd5e1; background: #4E6C9F;"></td>
        <td style="border: 1px solid #cbd5e1; background: #64748b; color:white; padding: 5px;">${fmtInt(11500)}</td>
        ${months.map(m => {
      const metaM = (m === "12") ? 500 : 1000;
      return `<td style="border: 1px solid #cbd5e1; padding: 5px;">${fmtInt(metaM)}</td>`;
    }).join('')}
        <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">${fmtInt(11500)}</td>
        <td style="border: 1px solid #cbd5e1; background: #4E6C9F;">${fmtInt(11500 / 12)}</td>
        <td style="background: #4E6C9F; color: #fff; border: 1px solid #cbd5e1;">Meta Variable</td>
    </tr>`;

    // FILA FINAL: META TOTAL PRUEBAS
    htmlLab += `<tr style="background: #253D5B; color: #fff; font-weight: bold;">
        <td colspan="2" style="border: 1px solid #fff; text-align: left; padding: 5px;">Meta Total Pruebas (Global)</td>
        <td style="border: 1px solid #fff; background: #4E6C9F;"></td>
        <td style="border: 1px solid #fff; background: #64748b; padding: 5px;">${fmtInt(totalMetaLab)}</td>
        ${months.map(m => `<td style="border: 1px solid #fff; padding: 5px;">${fmtInt(metasAnuales[m]?.labMetaPruebas || 0)}</td>`).join('')}
        <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaLab)}</td>
        <td style="border: 1px solid #fff; background: #4E6C9F;">${fmtInt(totalMetaLab / 12)}</td>
        <td style="background: #4E6C9F; border: 1px solid #fff;">Meta Anual</td>
    </tr></tbody></table></div>`;

    // --- 11. TABLA ESTADÍSTICA INSTITUCIONAL (CORRECCIÓN DE COLORES INSTITUCIONALES) ---
    const configEst = [
      { label: "Total admisiones", dbKeys: ["EST|Total admisiones"] },
      { label: "Atenciones efectivas (Egresos atendidos)", dbKeys: ["EST|Atenciones efectivas (Egresos atendidos)"] },
      { label: "Porcentaje atenciones efectivas", dbKeys: ["EST|% Atenciones efectivas"], isPct: true }
    ];

    // Encabezado en Azul Oscuro (#253D5B) y Azul Medio (#4E6C9F)
    let htmlEst = `<div class="card full-width" style="padding:0; overflow-x:auto; border:1px solid #253D5B; margin-top:30px;">
        <table style="min-width: 100%; width: max-content; border-collapse: collapse; font-family: 'Outfit', sans-serif; font-size: 0.95rem; text-align: center;">
            <thead>
                <tr style="background: #253D5B; color: #fff;">
                    <th style="border: 1px solid #fff; padding: 12px; text-align:left;">ESTADÍSTICA INSTITUCIONAL</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">Promedio ${prevYear}</th>
                    <th style="border: 1px solid #fff; background: #64748b;">META ANUAL</th>
                    ${monthLabels.map(m => `<th style="border: 1px solid #fff; padding: 12px;">${m}</th>`).join('')}
                    <th style="border: 1px solid #fff; background: #4E6C9F;">TOTAL</th>
                    <th style="border: 1px solid #fff; background: #4E6C9F;">PROM.</th>
                    <th style="background: #B6B5AF; color:#253D5B; border: 1px solid #fff;">PROYECCIÓN CIERRE ${yearId}</th>
                </tr>
            </thead>
            <tbody>`;

    configEst.forEach(f => htmlEst += generarFilaHTML(f, dataAnual, metasAnuales, 0, 0));

    htmlEst += `</tbody></table></div>`;

    // --- RENDERIZADO FINAL DEL DASHBOARD ---
    container.innerHTML = htmlUrg + htmlHosp + htmlCx + htmlCxEsp + htmlCE + htmlHem + htmlHcom + htmlEndo + htmlImg + htmlLab + htmlEst;
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (err) {
    console.error("Error reporte integral:", err);
    container.innerHTML = "<p style='color:red; padding:20px;'>⚠️ Error al sincronizar el reporte anual integral.</p>";
  }
}

/* =================== NÚCLEO DE INTELIGENCIA Y PROYECCIONES =================== */

async function runInteligencia(year, month0, agg, meta) {
  console.log("Iniciando motor de inteligencia gerencial...");
  const intelContainer = document.getElementById('intel-container');
  const intelDateBadge = document.getElementById('intel-date-badge');
  const intelRanking = document.getElementById('intel-ranking');
  const intelAlerts = document.getElementById('intel-alerts');
  const intelInsights = document.getElementById('intel-insights');
  const intelPerfMatrix = document.getElementById('intel-perf-matrix');

  if (!intelContainer) return;

  const monthNamesArr = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const currentName = monthNamesArr[parseInt(month0) - 1];
  if (intelDateBadge) intelDateBadge.textContent = `${currentName} ${year}`;

  // 1. Contexto Temporal y Proyección de Cierre de Año
  const mIdx = parseInt(month0);
  const yNum = parseInt(year);
  const factorAnual = 12 / mIdx; // Proyección simple: (YTD / m) * 12

  // 2. Indicadores (IDs sincronizados exactamente con snapshotAutoCalculados y tablas)
  // 2. Indicadores (IDs sincronizados exactamente con snapshotAutoCalculados y tablas)
  const indicators = [
    { label: "Admisiones Totales", id: "EST|Total admisiones", unit: "pacientes", useYoYMeta: true },
    { label: "Atenciones Efectivas", id: "EST|Atenciones efectivas (Egresos atendidos)", unit: "egresos", useYoYMeta: true },
    { label: "Urgencias (Ingresos)", id: "URG|Total ingresos a urgencias (triages + ortopedia)", unit: "pacientes", metaKey: "urgenciasMeta" },
    { label: "Consulta Externa", id: "CE|TOTAL", unit: "consultas", metaKey: "ceMetaConsultas" },
    { label: "Egresos Hosp.", id: "HOSP|EGRESOS HOSP. PUESTOS 2, 3 y 4", unit: "egresos", target: Math.round(7560 / 12) },
    { label: "Egresos UCI", id: "UCI|EGRESOS DE UCI ADULTOS", unit: "egresos", target: Math.round(924 / 12) },
    { label: "Egresos UCE", id: "UCE|EGRESOS DE UCE ADULTOS", unit: "egresos", target: Math.round(984 / 12) },
    { label: "Producción UVR", id: "CX-ESP|Total de U.V.R", unit: "UVR", metaKey: "uvrMeta" },
    { label: "Ocupación Hosp.", id: "HOSP|% OCUPACION", unit: "%", isPct: true, target: 95 },
    { label: "Img. Diagnósticas", id: "IMG-TOT|Pacientes (Total)", unit: "pacientes", metaKey: "imgMetaExamenes" },
    { label: "Lab. Clínico", id: "LAB|TOTAL", unit: "muestras", useYoYMeta: true }
  ];

  const currentSnapshot = snapshotAutoCalculados();

  // 3. Recopilación Histórica (ESTABLE)
  const history = Array(7).fill(null).map(() => ({ data: {} }));
  let yoyData = {};

  try {
    // Buscamos meses del año actual para YTD
    const monthPromises = [];
    for (let i = 0; i < 7; i++) {
      let targetM = mIdx - i;
      let targetY = yNum;
      if (targetM <= 0) { targetM += 12; targetY -= 1; }
      const mPad = String(targetM).padStart(2, '0');
      const mName = monthNamesArr[targetM - 1];

      monthPromises.push(
        getDoc(doc(db, "realizados", String(targetY), mPad, "_mensual"))
          .then(snap => {
            if (snap.exists()) {
              history[i] = {
                m: mName, y: targetY,
                data: snap.data().overrides || snap.data().agg || {}
              };
            }
          })
      );
    }

    // Buscamos mismo mes año anterior (YoY)
    const yoyMPad = String(mIdx).padStart(2, '0');
    monthPromises.push(
      getDoc(doc(db, "realizados", String(yNum - 1), yoyMPad, "_mensual"))
        .then(snap => {
          if (snap.exists()) { yoyData = snap.data().overrides || snap.data().agg || {}; }
        })
    );

    await Promise.all(monthPromises);
  } catch (e) { console.warn("Intel History Error:", e); }

  // 4. Procesamiento de Analítica
  const getValFromData = (data, indicatorId) => {
    if (!data) return 0;

    // SUMATORIA ESPECIAL: LABORATORIO
    if (indicatorId === "LAB|TOTAL") {
      const labItems = [
        "LAB|ANTIOQUIA", "LAB|CENTRO DE REFERENCIA", "LAB|CIB", "LAB|COLCAN",
        "LAB|ICMT", "LAB|INSTITUCIONAL", "LAB|LIME", "LAB|Microbiologia",
        "LAB|Muestras particulares", "LAB|PRIME", "LAB|SUESCUN", "LAB|SYNLAB", "LAB|UNILAB"
      ];
      let sumLab = 0;
      labItems.forEach(k => {
        const labelNoPrefix = k.replace("LAB|", "");
        if (data[k] != null) sumLab += Number(data[k]);
        else if (data.lab && data.lab.hosp && data.lab.hosp[labelNoPrefix]) sumLab += Number(data.lab.hosp[labelNoPrefix]);
        else if (k === "LAB|Muestras particulares" && data.lab && data.lab.part) sumLab += Number(data.lab.part.muestras);
      });
      // ✅ REGLA OBLIGATORIA: Siempre aplicamos la regla de división por 2 para el motor de alineación/ranking
      return Math.round(sumLab / 2);
    }

    // SUMATORIA ESPECIAL: CONSULTA EXTERNA
    if (indicatorId === "CE|TOTAL") {
      let sumCe = 0;
      Object.keys(data).forEach(k => { if (k.startsWith("CE|") && k !== "CE|TOTAL") sumCe += Number(data[k]); });
      if (sumCe === 0 && data.ce) Object.values(data.ce).forEach(v => sumCe += Number(v));
      return sumCe;
    }
    return 0;
  };

  let htmlTilesArr = "";
  let htmlMatrixArr = "";
  const analysisArr = [];
  const alertsArr = [];

  indicators.forEach(ind => {
    const val = currentSnapshot[ind.id] || getValFromData(currentSnapshot, ind.id);

    // MoM y YoY (Para comparativos y metas históricas) usando el helper sumador
    const vPrev = getValFromData(history[1]?.data, ind.id);
    const vLastYear = getValFromData(yoyData, ind.id);
    const deltaMoM = vPrev > 0 ? ((val - vPrev) * 100 / vPrev) : 0;
    const deltaYoY = vLastYear > 0 ? ((val - vLastYear) * 100 / vLastYear) : 0;

    // Meta: Usamos meta fija (target), meta de base de datos o benchmark 2025 (YoY)
    let metaVal = (ind.target) ? ind.target : ((ind.metaKey) ? (meta[ind.metaKey] || 0) : 0);
    if (ind.useYoYMeta) metaVal = vLastYear;

    // Cumplimiento Mensual (Es un informe de cierre)
    const pctCumplimiento = metaVal > 0 ? (val * 100 / metaVal) : 0;

    // Proyección Cierre Año (Basado en el promedio del año actual hasta el mes de corte)
    let ytdSum = val;
    let monthsFound = 1;
    for (let i = 1; i < mIdx; i++) {
      const hVal = getValFromData(history[i]?.data, ind.id);
      if (hVal != null && hVal > 0) { ytdSum += hVal; monthsFound++; }
    }
    const proyAnual = Math.round((ytdSum / monthsFound) * 12);

    // Promedio Móvil 3M
    const last3Values = [
      getValFromData(history[1]?.data, ind.id),
      getValFromData(history[2]?.data, ind.id),
      getValFromData(history[3]?.data, ind.id)
    ].filter(v => v > 0);
    const avg3m = last3Values.length > 0 ? (last3Values.reduce((a, b) => a + b, 0) / last3Values.length) : val;
    const deviationHist = avg3m > 0 ? ((val - avg3m) * 100 / avg3m) : 0;

    let statusClass = "Estable";
    let color = "var(--ok)";
    if (pctCumplimiento < 80) { statusClass = "Crítico"; color = "var(--err)"; }
    else if (pctCumplimiento < 90) { statusClass = "Riesgo"; color = "#f97316"; }
    else if (pctCumplimiento < 95) { statusClass = "Vigilancia"; color = "var(--warn)"; }

    if (statusClass === "Crítico" || statusClass === "Riesgo") {
      alertsArr.push({
        type: statusClass === "Crítico" ? 'err' : 'warn',
        text: `<strong>${ind.label}</strong>: Cumplimiento del <strong>${pctCumplimiento.toFixed(1)}%</strong> vs meta. Variación MoM: <strong>${deltaMoM.toFixed(1)}%</strong>.`
      });
    }

    const resObj = { ...ind, val, proyAnual, metaVal, pctCumplimiento, deltaMoM, deltaYoY, deviationHist, statusClass, color };
    analysisArr.push(resObj);

    htmlTilesArr += `
        <div class="intel-card">
            <div class="intel-header">
                <div class="intel-title"><i data-lucide="bar-chart-2"></i> ${ind.label}</div>
                <div class="badge-intel" style="background:${color}15; color:${color}; border:1px solid ${color}30;">${statusClass.toUpperCase()}</div>
            </div>
            <div style="font-size: 1.8rem; font-weight: 900; color: var(--pri-dark); margin-bottom: 5px;">
                ${ind.isPct ? val.toFixed(1) : val.toLocaleString()}<span style="font-size:0.8rem; opacity:0.6; font-weight:700; margin-left:6px;">${ind.unit}</span>
            </div>
            <div class="proy-container"><div class="proy-bar" style="width:${Math.min(100, pctCumplimiento)}%; background:${color}"></div></div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:15px;">
                <div style="font-size:0.7rem;"><span style="display:block; color:var(--text-muted); font-weight:700;">PROY. CIERRE AÑO</span><span style="font-weight:900; color:var(--pri-dark); font-size:0.9rem;">${ind.isPct ? proyAnual.toFixed(1) : proyAnual.toLocaleString()}</span></div>
                <div style="font-size:0.7rem; text-align:right;"><span style="display:block; color:var(--text-muted); font-weight:700;">CUMPLIMIENTO META</span><span style="font-weight:900; color:${color}; font-size:0.9rem;">${pctCumplimiento.toFixed(1)}%</span></div>
            </div>
            <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap;">
                <div class="badge-intel ${deltaMoM >= 0 ? 'badge-up' : 'badge-down'}" style="font-size:0.65rem;"><i data-lucide="${deltaMoM >= 0 ? 'arrow-up-right' : 'arrow-down-right'}" style="width:10px;"></i> ${deltaMoM.toFixed(1)}% vs Mes Ant.</div>
                <div class="badge-intel ${deltaYoY >= 0 ? 'badge-up' : 'badge-down'}" style="font-size:0.65rem;"><i data-lucide="${deltaYoY >= 0 ? 'trending-up' : 'trending-down'}" style="width:10px;"></i> ${deltaYoY.toFixed(1)}% vs Año Ant.</div>
            </div>
        </div>`;

    htmlMatrixArr += `
        <div style="display:grid; grid-template-columns: 100px 1fr; gap:15px; align-items:center; padding-bottom:12px; border-bottom:1px solid #f1f5f9;">
            <div style="font-weight:800; font-size:0.75rem; color:var(--pri-dark); line-height:1.2;">${ind.label}</div>
            <div class="perf-matrix">
                <div class="perf-cell"><span class="p-label">vs Meta</span><span class="p-val" style="color:${color}">${pctCumplimiento.toFixed(0)}%</span></div>
                <div class="perf-cell"><span class="p-label">Tendencia</span><span class="p-val" style="color:${deltaMoM >= 0 ? 'var(--ok)' : 'var(--err)'}">${deltaMoM >= 0 ? '↑' : '↓'} ${Math.abs(deltaMoM).toFixed(0)}%</span></div>
                <div class="perf-cell"><span class="p-label">vs Hist. 3M</span><span class="p-val" style="color:${deviationHist >= 0 ? 'var(--ok)' : '#f97316'}">${deviationHist >= 0 ? '+' : ''}${deviationHist.toFixed(0)}%</span></div>
            </div>
        </div>`;
  });

  intelContainer.innerHTML = htmlTilesArr;
  if (intelPerfMatrix) intelPerfMatrix.innerHTML = htmlMatrixArr;

  // 5. Alertas
  if (intelAlerts) {
    if (alertsArr.length === 0) {
      intelAlerts.innerHTML = '<div class="alert-item" style="border-left-color:var(--ok); color:var(--text-muted); background:#f0fdf4;"><i data-lucide="check-circle" style="color:var(--ok)"></i><div><strong>Metas bajo cumplimiento</strong><p style="margin:2px 0 0 0; font-size:0.8rem;">Los indicadores clave se mantienen en rangos aceptables.</p></div></div>';
    } else {
      intelAlerts.innerHTML = alertsArr.map(a => `<div class="alert-item" style="border-left-color:${a.type === 'err' ? 'var(--err)' : 'var(--warn)'}"><i data-lucide="${a.type === 'err' ? 'alert-octagon' : 'alert-triangle'}"></i><span>${a.text}</span></div>`).join('');
    }
  }

  // 6. Ranking por cumplimiento
  if (intelRanking) {
    const sorted = [...analysisArr].sort((a, b) => b.pctCumplimiento - a.pctCumplimiento);
    intelRanking.innerHTML = sorted.map((r, i) => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-radius:10px; background:${i < 2 ? '#eff6ff' : 'transparent'}; border: 1px solid ${i < 2 ? '#dbeafe' : 'transparent'}"><div style="display:flex; align-items:center; gap:10px"><span style="background:var(--pri); color:white; width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:100%; font-size:0.7rem;">${i + 1}</span><span style="font-weight:700; font-size:0.8rem;">${r.label}</span></div><span style="font-weight:900; font-size:0.85rem;">${r.pctCumplimiento.toFixed(1)}%</span></div>`).join('');
  }

  // 7. Gráfica Tendencia (Historial)
  const ctxTrend = document.getElementById('chart-intel-trend');
  if (ctxTrend) {
    if (window._intelChart) window._intelChart.destroy();
    const validHistory = history.filter(h => h.m).reverse();
    const tLabels = validHistory.map(h => `${h.m.substring(0, 3)} ${h.y % 100}`);
    const tValues = validHistory.map(h => h.data["EST|Total admisiones"] || 0);
    window._intelChart = new Chart(ctxTrend, {
      type: 'line',
      data: { labels: tLabels, datasets: [{ label: 'Admisiones', data: tValues, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false, grid: { borderDash: [5, 5] } }, x: { grid: { display: false } } } }
    });
  }

  // 8. Resumen Ejecutivo (Insights)
  if (intelInsights) {
    const avgCumpl = analysisArr.reduce((s, x) => s + x.pctCumplimiento, 0) / analysisArr.length;
    const best = [...analysisArr].sort((a, b) => b.pctCumplimiento - a.pctCumplimiento)[0];
    const worst = [...analysisArr].sort((a, b) => a.pctCumplimiento - b.pctCumplimiento)[0];
    intelInsights.innerHTML = `
            <div style="display:grid; gap:15px; font-size:0.9rem;">
                <p>El cierre de <strong>${currentName}</strong> muestra un cumplimiento meta promedio del <strong>${avgCumpl.toFixed(1)}%</strong>. El indicador con mejor desempeño es <strong>${best.label}</strong> (${best.pctCumplimiento.toFixed(1)}%).</p>
                <p>Se observa una brecha crítica en <strong>${worst.label}</strong>, cuya proyección de cierre anual indica una desviación del <strong>${Math.abs(100 - (worst.proyAnual * 100 / (worst.metaVal * 12))).toFixed(1)}%</strong> respecto a la meta presupuestal consolidada.</p>
                <div style="margin-top:10px; padding:15px; background:white; border-radius:12px; border:1px solid var(--border); border-left:4px solid var(--pri-dark);">
                    <strong>ESTRATEGIA RECOMENDADA:</strong> Priorizar la gestión de <strong>${worst.label}</strong> para alinear el comportamiento histórico con el presupuesto de fin de año.
                </div>
            </div>`;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => { if (typeof lucide !== 'undefined') lucide.createIcons(); });