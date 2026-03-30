/* ==========================================================================
   INTERFACES DE FIREBASE (Desde Layout)
   ========================================================================== */
const { db, auth } = window.firebaseInstance || {};
const { doc, setDoc, getDoc } = window.firebaseFirestore || {};
const { onAuthStateChanged, signInAnonymously } = window.firebaseAuth || {};

/* ==========================================================================
   REFERENCIAS AL DOM
   ========================================================================== */
const refs = {
    mesSel: document.getElementById('mesSel'),
    espSel: document.getElementById('espSel'),
    consultarBtn: document.getElementById('consultarBtn'),
    limpiarBtn: document.getElementById('limpiarBtn'),
    guardarBtn: document.getElementById('guardarBtn'),

    // Campos de captura
    totalConsultas: document.getElementById('totalConsultas'),
    consultasPOP: document.getElementById('consultasPOP'),
    consultasPrimeraVez: document.getElementById('consultasPrimeraVez'),
    consultasControl: document.getElementById('consultasControl'),
    citasIncumplidas: document.getElementById('citasIncumplidas'),
    citasCanceladas: document.getElementById('citasCanceladas'),
    citasEfectivas: document.getElementById('citasEfectivas'),
    consultasNoPOP: document.getElementById('consultasNoPOP'),
    ordenesCx: document.getElementById('ordenesCx'),
    ordenesImgTotal: document.getElementById('ordenesImgTotal'),
    ordenesImgExternas: document.getElementById('ordenesImgExternas'),
    procedimientosExternos: document.getElementById('procedimientosExternos'),

    // KPIs
    k_pctEf: document.getElementById('k_pctEf'),
    k_pctInc: document.getElementById('k_pctInc'),
    k_pctCanc: document.getElementById('k_pctCanc'),
    k_efN: document.getElementById('k_efN'),
    k_noPOPN: document.getElementById('k_noPOPN'),
    k_pctPOP: document.getElementById('k_pctPOP'),
    k_convCx: document.getElementById('k_convCx'),
    k_convImgTot: document.getElementById('k_convImgTot'),
    k_convImgInt: document.getElementById('k_convImgInt')
};

/* ==========================================================================
   CONSTANTES Y ESPECIALIDADES
   ========================================================================== */
const ESPECIALIDADES = [
    "ANESTESIOLOGIA Y REANIMACION", "CIRUGIA GENERAL", "CIRUGIA MAXILOFACIAL", "CIRUGIA VASCULAR",
    "GINECOLOGIA Y OBSTETRICIA", "HEMATO ONCOLOGIA", "HEMATOLOGIA", "MEDICINA DEL DEPORTE",
    "MEDICINA INTERNA", "NEUROCIRUGIA", "NEUROLOGIA", "NUTRICION", "ORTOPEDIA Y TRAUMATOLOGIA",
    "OTORRINOLARINGOLOGIA", "PEDIATRIA", "PSICOLOGIA", "PSIQUIATRIA", "HEPATOLOGÍA",
    "RADIOLOGÍA E IMAGENES DIAGNOSTICAS", "TOXICOLOGIA CLINICA", "TRABAJO SOCIAL", "UROLOGIA"
];

/* ==========================================================================
   HELPERS
   ========================================================================== */
const n = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const clamp0 = v => v < 0 ? 0 : v;
const toPct = num => isFinite(num) ? (num * 100).toFixed(2) + '%' : '—';
const yyyymm = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const idFor = (mes, esp) => {
    if (!mes || !esp) return "invalid";
    return `${mes}_${esp}`.replaceAll(' ', '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/* ==========================================================================
   LÓGICA DE NEGOCIO Y CÁLCULOS
   ========================================================================== */
function recompute() {
    const total = n(refs.totalConsultas?.value);
    const inc = n(refs.citasIncumplidas?.value);
    const canc = n(refs.citasCanceladas?.value);

    // Atendidas (Efectivas)
    const efectivas = clamp0(total - inc - canc);
    if (refs.citasEfectivas) refs.citasEfectivas.value = String(efectivas);

    // POP ⊂ Control
    const pop = n(refs.consultasPOP?.value);
    const ctrl = n(refs.consultasControl?.value);

    // Controles sin POP = Control − POP
    const controlesSinPOP = clamp0(ctrl - pop);
    if (refs.consultasNoPOP) refs.consultasNoPOP.value = String(controlesSinPOP);

    // Imágenes internas
    const imgT = n(refs.ordenesImgTotal?.value);
    const imgExt = Math.min(imgT, Math.max(0, n(refs.ordenesImgExternas?.value)));
    const imgInt = clamp0(imgT - imgExt);

    // Actualización de KPIs en el DOM
    if (refs.k_efN) refs.k_efN.textContent = efectivas.toLocaleString('es-CO');
    if (refs.k_noPOPN) refs.k_noPOPN.textContent = controlesSinPOP.toLocaleString('es-CO');

    if (refs.k_pctEf) refs.k_pctEf.textContent = toPct(total > 0 ? efectivas / total : NaN);
    if (refs.k_pctInc) refs.k_pctInc.textContent = toPct(total > 0 ? inc / total : NaN);
    if (refs.k_pctCanc) refs.k_pctCanc.textContent = toPct(total > 0 ? canc / total : NaN);

    if (refs.k_pctPOP) refs.k_pctPOP.textContent = toPct(efectivas > 0 ? pop / efectivas : NaN);

    if (refs.k_convCx) refs.k_convCx.textContent = toPct(total > 0 ? n(refs.ordenesCx?.value) / total : NaN);
    if (refs.k_convImgTot) refs.k_convImgTot.textContent = toPct(total > 0 ? imgT / total : NaN);
    if (refs.k_convImgInt) refs.k_convImgInt.textContent = toPct(total > 0 ? imgInt / total : NaN);
}

/* ==========================================================================
   OPERACIONES FIREBASE (CONSULTA Y GUARDADO)
   ========================================================================== */
async function loadOne() {
    const mes = (refs.mesSel.value || '').trim();
    const esp = (refs.espSel.value || '').trim();
    if (!mes) return alert('Selecciona el mes.');
    if (!esp) return alert('Selecciona la especialidad.');

    try {
        const ref = doc(db, 'estadistica_ce', idFor(mes, esp));
        const s = await getDoc(ref);
        if (!s.exists()) {
            limpiarCampos();
            alert('No hay registro previo. Puedes crearlo.');
            return;
        }
        const r = s.data();
        refs.totalConsultas.value = r.totalConsultas ?? '';
        refs.consultasPOP.value = r.consultasPOP ?? '';
        refs.consultasPrimeraVez.value = r.consultasPrimeraVez ?? '';
        refs.consultasControl.value = r.consultasControl ?? '';
        refs.citasIncumplidas.value = r.citasIncumplidas ?? '';
        refs.citasCanceladas.value = r.citasCanceladas ?? '';
        refs.ordenesCx.value = r.ordenesCx ?? '';
        refs.ordenesImgTotal.value = r.ordenesImgTotal ?? '';
        refs.ordenesImgExternas.value = r.ordenesImgExternas ?? '';
        refs.procedimientosExternos.value = r.procedimientosExternos ?? '';
        recompute();
    } catch (e) {
        console.error(e);
        alert('Error cargando registro: ' + (e?.message || e));
    }
}

async function runSave() {
    const mes = (refs.mesSel.value || '').trim();
    const esp = (refs.espSel.value || '').trim();
    if (!mes) return alert('Selecciona el mes.');
    if (!esp) return alert('Selecciona la especialidad.');

    const total = n(refs.totalConsultas.value);
    const pop = n(refs.consultasPOP.value);
    const pv = n(refs.consultasPrimeraVez.value);
    const ctrl = n(refs.consultasControl.value);
    const inc = n(refs.citasIncumplidas.value);
    const canc = n(refs.citasCanceladas.value);

    const efectivas = clamp0(total - inc - canc);

    // Validaciones obligatorias
    if (pop > ctrl) {
        return alert('Las consultas POP no pueden superar las citas de control (Control incluye POP).');
    }
    if (pv + ctrl > total) {
        return alert('Primera vez + Control no pueden superar el Total de consultas (agendadas).');
    }

    const cx = n(refs.ordenesCx.value);
    const imgT = n(refs.ordenesImgTotal.value);
    const imgExt = Math.min(imgT, Math.max(0, n(refs.ordenesImgExternas.value)));
    const imgInt = clamp0(imgT - imgExt);

    const controlesSinPOP = clamp0(ctrl - pop);
    const noPOPLegacy = clamp0(efectivas - pop);

    const payload = {
        mes, especialidad: esp,
        totalConsultas: total,
        consultasPOP: pop,
        consultasPrimeraVez: pv,
        consultasControl: ctrl,
        citasIncumplidas: inc,
        citasCanceladas: canc,
        citasEfectivas: efectivas,
        controlesSinPOP: controlesSinPOP,
        consultasNoPOP: noPOPLegacy,
        ordenesCx: cx,
        ordenesImgTotal: imgT,
        ordenesImgExternas: imgExt,
        procedimientosExternos: n(refs.procedimientosExternos.value),

        // Porcentajes
        pctEfectividad: (total > 0 ? efectivas / total : null),
        pctIncumplidas: (total > 0 ? inc / total : null),
        pctCanceladas: (total > 0 ? canc / total : null),
        pctPOP: (efectivas > 0 ? pop / efectivas : null),

        // Conversiones (sobre agendadas)
        convCx: (total > 0 ? cx / total : null),
        convImgTotal: (total > 0 ? imgT / total : null),
        convImgInternas: (total > 0 ? imgInt / total : null),

        updatedAt: new Date().toISOString()
    };

    try {
        refs.guardarBtn.disabled = true;
        refs.guardarBtn.textContent = "Guardando...";
        await setDoc(doc(db, 'estadistica_ce', idFor(mes, esp)), payload, { merge: true });
        alert('Registro guardado exitosamente.');
    } catch (e) {
        console.error('Error guardando:', e);
        alert('No se pudo guardar: ' + (e?.message || e));
    } finally {
        refs.guardarBtn.disabled = false;
        refs.guardarBtn.textContent = "Guardar registro del Mes";
    }
}

function limpiarCampos() {
    [
        refs.totalConsultas, refs.consultasPOP, refs.consultasPrimeraVez, refs.consultasControl,
        refs.citasIncumplidas, refs.citasCanceladas, refs.citasEfectivas, refs.consultasNoPOP,
        refs.ordenesCx, refs.ordenesImgTotal, refs.ordenesImgExternas, refs.procedimientosExternos
    ].forEach(el => { if (el) el.value = ''; });
    recompute();
}

/* ==========================================================================
   INICIALIZACIÓN
   ========================================================================== */
function init() {
    if (!db) {
        console.warn("Firebase no inicializado correctamente desde el Layout.");
        return;
    }

    // Poblar especialidades
    if (refs.espSel) refs.espSel.innerHTML = ESPECIALIDADES.map(s => `<option value="${s}">${s}</option>`).join('');

    // Listeners de entrada para recálculo automático
    [
        refs.totalConsultas, refs.consultasPOP, refs.consultasPrimeraVez, refs.consultasControl,
        refs.citasIncumplidas, refs.citasCanceladas, refs.ordenesCx, refs.ordenesImgTotal, refs.ordenesImgExternas,
        refs.procedimientosExternos
    ].forEach(el => { if (el) el.addEventListener('input', recompute); });

    // Listeners de botones
    if (refs.consultarBtn) refs.consultarBtn.addEventListener('click', loadOne);
    if (refs.limpiarBtn) refs.limpiarBtn.addEventListener('click', limpiarCampos);
    if (refs.guardarBtn) refs.guardarBtn.addEventListener('click', runSave);

    // Periodo inicial
    if (refs.mesSel) {
        const now = new Date();
        refs.mesSel.value = yyyymm(now);
    }
    if (refs.espSel) refs.espSel.value = ESPECIALIDADES[0];

    // Auth Listener
    if (onAuthStateChanged && auth) {
        onAuthStateChanged(auth, u => {
            if (!u && signInAnonymously) {
                signInAnonymously(auth).catch(e => console.warn("Anon Auth Error:", u));
            }
        });
    }

    recompute();
}

// Arrancar
document.addEventListener('DOMContentLoaded', init);
