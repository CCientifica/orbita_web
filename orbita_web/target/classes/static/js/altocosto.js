(async function init() {
        // Esperar a que Firebase esté disponible (expuesto por layout.html)
        let attempts = 0;
        while ((!window.firebaseInstance || !window.firebaseFirestore) && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
        }

        if (!window.firebaseInstance || !window.firebaseFirestore) {
                console.error("Firebase no se pudo inicializar en el tiempo esperado.");
                return;
        }

        const { db, auth } = window.firebaseInstance;
        const {
                collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
                query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch
        } = window.firebaseFirestore;
        const { onAuthStateChanged, signOut } = window.firebaseAuth;

        // =========================================================
        // 🛠️ HELPERS GLOBALES (Normalización y Clasificación)
        // =========================================================
        window.norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        window.esPacienteIncidente = function(p) {
                if (!p) return true;
                const isRealValue = (v) => {
                        if (v === null || v === undefined) return false;
                        return String(v).trim() !== '';
                };
                const isKeyClinica = (key) => {
                        const m = key.match(/^VAR(\d+)/i);
                        return m && parseInt(m[1]) >= 17;
                };
                const base = p.datos_base || {};
                const combinedKeys = [...Object.keys(p), ...Object.keys(base)];
                for (const k of combinedKeys) {
                        if (isKeyClinica(k)) {
                                const val = p[k] ?? base[k];
                                if (isRealValue(val)) return false; 
                        }
                }
                if (p.periodos) {
                        for (const pKey in p.periodos) {
                                const vars = p.periodos[pKey]?.variables || {};
                                for (const vKey in vars) {
                                        if (isKeyClinica(vKey)) {
                                                if (isRealValue(vars[vKey])) return false;
                                        }
                                }
                        }
                }
                return true; 
        };

        // 🎨 SISTEMA DE ESTILOS PREMIUM PARA AYUDAS Y TOOLTIPS
        if (!document.getElementById('altocosto-ui-styles')) {
                const style = document.createElement('style');
                style.id = 'altocosto-ui-styles';
                style.innerHTML = `
                        .info-icon {
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                width: 16px;
                                height: 16px;
                                background: #6366f1;
                                color: white;
                                border-radius: 50%;
                                font-size: 11px;
                                font-weight: 800;
                                cursor: help;
                                margin-left: 6px;
                                vertical-align: middle;
                                transition: all 0.2s ease;
                                box-shadow: 0 2px 4px rgba(99, 102, 241, 0.3);
                                border: 1px solid rgba(255,255,255,0.2);
                        }
                        .info-icon:hover {
                                background: #4f46e5;
                                transform: scale(1.15);
                                box-shadow: 0 4px 8px rgba(99, 102, 241, 0.4);
                        }
                        .tooltip-ayuda {
                                position: fixed;
                                background: #0f172a;
                                color: #f8fafc;
                                padding: 12px 16px;
                                border-radius: 12px;
                                font-size: 12px;
                                line-height: 1.5;
                                max-width: 320px;
                                z-index: 999999;
                                pointer-events: none;
                                opacity: 0;
                                transform: translateY(10px);
                                transition: opacity 0.3s ease, transform 0.3s ease;
                                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                                border: 1px solid rgba(255,255,255,0.1);
                                backdrop-filter: blur(8px);
                        }
                        .tooltip-ayuda.visible {
                                opacity: 1;
                                transform: translateY(0);
                        }
                `;
                document.head.appendChild(style);
        }

        const ensureAuth = async () => {
                if (auth?.currentUser) return auth.currentUser;

                // 1. Espera a que la sesión se restaure (rehidratación)
                await new Promise(resolve => {
                        const unsub = onAuthStateChanged(auth, (user) => {
                                unsub();
                                resolve();
                        });
                        setTimeout(resolve, 1200); // 1.2s de timeout
                });

                if (!auth || !auth.currentUser) {
                        try {
                                await window.firebaseAuth.signInAnonymously(auth);
                                console.log("🔓 [ALTO_COSTO] Sesión anónima establecida");
                        } catch (e) {
                                if (e.code === 'auth/admin-restricted-operation') {
                                        console.warn("⚠️ [ALTO_COSTO] El acceso anónimo está deshabilitado en esta consola de Firebase. Se requiere sesión en el portal principal.");
                                } else {
                                        console.error("📛 [ALTO_COSTO] Fallo en sesión de Firebase:", e);
                                }
                        }
                }
                return auth?.currentUser;
        };

        await ensureAuth();

        // ============================================================
        // 🔒 LOCKS DE FICHA - SOLO ALTO COSTO
        // ============================================================
        const LOCKS_API_BASE = '/api/altocosto/locks';
        const LOCK_HEARTBEAT_MS = 60000;
        const LOCKS_REFRESH_MS = 15000; // ⚡ Reducido a 15s para mayor fluidez

        // Inyectar estilos de locks necesarios para la tabla
        const lockStyleEl = document.createElement('style');
        lockStyleEl.textContent = `
                .lock-by-me { background: #eff6ff !important; }
                .lock-by-other { background: #fef2f2 !important; }
        `;
        document.head.appendChild(lockStyleEl);

        const lockState = {
                currentPatientId: null,
                heartbeatTimer: null,
                refreshTimer: null,
                activeLocksMap: new Map()
        };

        function getLockUser() {
                const u = window.orbitaUser || window.OrbitaContext || {};
                return {
                        email: String(u.email || auth?.currentUser?.email || '').trim().toLowerCase(),
                        nombre: String(u.displayName || u.nombre || u.email || auth?.currentUser?.email || 'Usuario').trim()
                };
        }

        async function lockFetch(path, method = 'GET', body = null) {
                const opts = {
                        method,
                        headers: { 'Content-Type': 'application/json' }
                };
                if (body) opts.body = JSON.stringify(body);

                const res = await fetch(`${LOCKS_API_BASE}${path}`, opts);
                let data = null;
                try { data = await res.json(); } catch (_) { }
                return { ok: res.ok, status: res.status, data };
        }

        async function tomarLockFicha(pacienteId) {
                const user = getLockUser();
                if (!pacienteId || !user.email) {
                        return { ok: false, blocked: false, message: 'No se pudo identificar el usuario o el paciente.' };
                }

                const r = await lockFetch('/tomar', 'POST', {
                        pacienteId: String(pacienteId).trim(),
                        email: user.email,
                        nombre: user.nombre,
                        isIdle: !!window.__isIdle
                });

                if (r.ok && r.data?.success) {
                        lockState.currentPatientId = String(pacienteId).trim();
                        iniciarHeartbeatFicha();
                        return { ok: true, blocked: false, data: r.data };
                }

                if (r.status === 409 && r.data?.status === 'LOCKED_BY_OTHER') {
                        const lock = r.data.lock || {};
                        return {
                                ok: false,
                                blocked: true,
                                message: `Esta ficha ya está siendo trabajada por ${lock.nombre || lock.email || 'otro usuario'}.`
                        };
                }

                return {
                        ok: false,
                        blocked: false,
                        message: r.data?.message || 'No se pudo tomar la ficha.'
                };
        }

        async function heartbeatFicha() {
                const user = getLockUser();
                if (!lockState.currentPatientId || !user.email) return;

                const r = await lockFetch('/heartbeat', 'POST', {
                        pacienteId: lockState.currentPatientId,
                        email: user.email,
                        isIdle: !!window.__isIdle
                });

                if (r.ok && r.data?.success) return;

                if (r.status === 409 || r.status === 410) {
                        detenerHeartbeatFicha();
                        alert(r.data?.message || 'La ficha dejó de estar disponible.');
                }
        }

        function iniciarHeartbeatFicha() {
                detenerHeartbeatFicha();
                lockState.heartbeatTimer = setInterval(() => {
                        // 🛑 Si el usuario está IDLE (inactivo), dejamos de enviar latidos.
                        // Esto permite que el lock expire naturalmente en el servidor y otros puedan entrar.
                        if (window.__isIdle) {
                                console.warn("[LOCKS] Sesión en inactividad profunda. Suspendiendo heartbeat.");
                                return;
                        }
                        heartbeatFicha().catch(err => console.warn('[LOCKS] heartbeat error', err));
                }, LOCK_HEARTBEAT_MS);
        }

        function detenerHeartbeatFicha() {
                if (lockState.heartbeatTimer) {
                        clearInterval(lockState.heartbeatTimer);
                        lockState.heartbeatTimer = null;
                }
        }

        async function liberarLockFicha(pacienteId = null) {
                const user = getLockUser();
                const pid = pacienteId || lockState.currentPatientId;

                detenerHeartbeatFicha();

                if (!pid || !user.email) {
                        lockState.currentPatientId = null;
                        return;
                }

                try {
                        await lockFetch('/liberar', 'POST', {
                                pacienteId: String(pid).trim(),
                                email: user.email
                        });
                } catch (e) {
                        console.warn('[LOCKS] liberar error', e);
                } finally {
                        if (lockState.currentPatientId === pid) {
                                lockState.currentPatientId = null;
                        }
                }
        }

        async function cargarLocksActivos() {
                const r = await lockFetch('/activos');
                return (r.ok && Array.isArray(r.data)) ? r.data : [];
        }

        function pintarLocksEnTabla() {
                const user = getLockUser();
                const rows = document.querySelectorAll('tbody tr[data-paciente-id]');

                rows.forEach(tr => {
                        const pid = String(tr.getAttribute('data-paciente-id') || '').trim();
                        const lock = lockState.activeLocksMap.get(pid);

                        tr.classList.remove('lock-by-me', 'lock-by-other');
                        tr.removeAttribute('title');

                        const old = tr.querySelector('.lock-badge-inline');
                        if (old) old.remove();

                        if (!lock) return;

                        const badge = document.createElement('span');
                        badge.className = 'lock-badge-inline';
                        badge.style.marginLeft = '8px';
                        badge.style.padding = '2px 8px';
                        badge.style.borderRadius = '999px';
                        badge.style.fontSize = '11px';
                        badge.style.fontWeight = '700';

                        const owner = lock.nombre || lock.email || 'Usuario';

                        if (String(lock.email || '').trim().toLowerCase() === user.email) {
                                tr.classList.add('lock-by-me');
                                tr.title = 'Ficha en uso por ti';
                                badge.innerHTML = '👤 <span style="margin-left:4px;">En uso por ti</span>';
                                badge.style.background = '#dbeafe';
                                badge.style.color = '#1d4ed8';
                                badge.style.border = '1px solid #3b82f6';
                        } else {
                                tr.classList.add('lock-by-other');
                                tr.title = `Ficha en uso por ${owner}${lock.isIdle ? ' (INACTIVO)' : ''}`;
                                badge.innerHTML = `${lock.isIdle ? '⏳' : '🔒'} <span style="margin-left:4px;">${lock.isIdle ? 'Inactivo' : 'En uso'} por ${owner}</span>`;
                                badge.style.background = lock.isIdle ? '#fffef3' : '#fee2e2';
                                badge.style.color = lock.isIdle ? '#d97706' : '#b91c1c';
                                badge.style.border = lock.isIdle ? '1px solid #f59e0b' : '1px solid #ef4444';
                                badge.style.boxShadow = lock.isIdle ? 'none' : '0 0 10px rgba(239, 68, 68, 0.2)';

                                if (lock.isIdle) tr.classList.add('lock-is-idle');
                        }

                        const firstNameCell = tr.querySelector('td:nth-child(2) .pac-nombre');
                        if (firstNameCell) firstNameCell.appendChild(badge);
                });
        }

        async function refrescarLocksVisuales() {
                try {
                        const locks = await cargarLocksActivos();
                        lockState.activeLocksMap = new Map(
                                locks.map(x => [String(x.pacienteId || '').trim(), x])
                        );
                        pintarLocksEnTabla();
                } catch (e) {
                        console.warn('[LOCKS] refresh error', e);
                }
        }

        function iniciarRefreshLocks() {
                if (lockState.refreshTimer) clearInterval(lockState.refreshTimer);
                
                // ⚡ Refrescar inmediatamente al iniciar
                refrescarLocksVisuales().catch(() => { });

                lockState.refreshTimer = setInterval(() => {
                        refrescarLocksVisuales().catch(() => { });
                }, LOCKS_REFRESH_MS);
        }

        window.__altoCostoLocks = {
                tomarLockFicha,
                liberarLockFicha,
                refrescarLocksVisuales
        };

        window.addEventListener('beforeunload', () => {
                const user = getLockUser();
                if (!lockState.currentPatientId || !user.email) return;
                try {
                        navigator.sendBeacon(
                                `${LOCKS_API_BASE}/liberar`,
                                new Blob(
                                        [JSON.stringify({ pacienteId: lockState.currentPatientId, email: user.email })],
                                        { type: 'application/json' }
                                )
                        );
                } catch (_) { }
        });

        // =========================================================
        // 🕵️‍♂️ NUEVO: SISTEMA DE DETECCIÓN DE INACTIVIDAD (IDLE)
        // =========================================================
        const IDLE_LIMIT_MS = 2 * 60 * 1000; // 2 minutos
        window.__idleSeconds = 0;
        window.__lastActivity = Date.now();
        window.__isIdle = false;

        function resetActivity() {
                if (window.__isIdle) {
                        console.log("🚀 [ALTO-COSTO] Usuario regresó. Reanudando...");
                        window.__isIdle = false;
                        const overlay = document.getElementById("idleOverlay");
                        if (overlay) overlay.style.display = "none";
                }
                window.__lastActivity = Date.now();
        }

        // Listeners globales para actividad (solo mientras el modal está abierto)
        document.addEventListener('mousemove', resetActivity);
        document.addEventListener('keydown', resetActivity);
        document.addEventListener('click', resetActivity);
        document.addEventListener('scroll', resetActivity, true);

        function chequearInactividad() {
                if (!lockState.currentPatientId || window.__modalReadOnly) return;

                const diff = Date.now() - window.__lastActivity;
                if (diff > IDLE_LIMIT_MS && !window.__isIdle) {
                        window.__isIdle = true;
                        console.warn("⏳ [ALTO-COSTO] Inactividad detectada (2m). Pausando gestión.");
                        mostrarAvisoInactividad();
                }

                if (window.__isIdle) {
                        window.__idleSeconds += 1;
                }
        }

        setInterval(chequearInactividad, 1000);

        function mostrarAvisoInactividad() {
                let overlay = document.getElementById("idleOverlay");
                if (!overlay) {
                        overlay = document.createElement("div");
                        overlay.id = "idleOverlay";
                        overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.85); backdrop-filter:blur(8px); z-index:11000; display:flex; align-items:center; justify-content:center; flex-direction:column; color:white; font-family:sans-serif; transition:all 0.3s;";
                        overlay.innerHTML = `
                        <div style="background:#1e293b; padding:40px; border-radius:2rem; text-align:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); border:1px solid #334155; max-width:400px;">
                            <div style="font-size:48px; margin-bottom:20px;">⏳</div>
                            <h2 style="font-weight:800; margin-bottom:10px;">Sesión Pausada</h2>
                            <p style="opacity:0.8; font-size:14px; margin-bottom:25px;">Hemos detectado 2 minutos de inactividad. El cronómetro se ha detenido para mayor precisión.</p>
                            <button onclick="window.resetActivity()" style="background:#6366f1; color:white; border:none; padding:12px 30px; border-radius:12px; font-weight:800; cursor:pointer; width:100%; transition:transform 0.2s;">ESTOY AQUÍ, CONTINUAR</button>
                        </div>
                    `;
                        document.body.appendChild(overlay);
                }
                overlay.style.display = "flex";
        }
        window.resetActivity = resetActivity;

        // 🔥 HELPERS MÍNIMOS REQUERIDOS (BLINDAJE TOTAL)
        const $getID = (id) => document.getElementById(id);
        const $safeGet = (id) => {
                const el = $getID(id);
                if (!el) {
                        // console.warn(`[ALTO_COSTO] Elemento no encontrado: ${id}`);
                        return { value: "", textContent: "", style: {}, appendChild: () => { }, addEventListener: () => { }, classList: { add: () => { }, remove: () => { }, toggle: () => { }, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, setAttribute: () => { }, getAttribute: () => "" };
                }
                return el;
        };
        const $setText = (id, txt) => {
                const el = $getID(id);
                if (el) el.textContent = txt;
        };
        const $setWidth = (id, pct) => {
                const el = $getID(id);
                if (el) el.style.width = pct + "%";
        };
        const $safeAction = (id, event, cb) => {
                const el = $getID(id);
                if (el) el.addEventListener(event, cb);
        };

        /**
         * 🏁 HELPER CICLO OPERATIVO
         * Retorna el mes operativo (Data Month N-1) según la fecha actual.
         */
        function getCicloOperativoHoy() {
                const h = new Date();
                let pY = h.getFullYear(), pM = h.getMonth(); // getMonth() es 0-11
                if (pM === 0) { pM = 12; pY--; }
                return { y: pY, m: pM };
        }

        /**
         * 🎨 HELPER DE PRESENTACIÓN (UI) - ÓRBITA PREMIUM
         * Transforma nombres técnicos (Ej: VAR1_PrimerNombre) a formato legible (Ej: VAR1 : Primer Nombre)
         * SOLO para visualización en el modal, sin afectar lógica ni TXT.
         */
        window.formatLabelParaHumanos = (key) => {
                if (!key) return "";
                let label = key.replace(/_/g, ' '); // Quitar guiones bajos

                // Separar CamelCase (Ej: PrimerNombre -> Primer Nombre)
                label = label.replace(/([a-z])([A-Z])/g, '$1 $2');
                label = label.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');

                // Expansiones estéticas para lectura profesional
                const exp = {
                        "Dx": "Diagnóstico", "Tto": "Tratamiento", "Ini": "Inicio",
                        "Act": "Actual", "Cant": "Cantidad", "Ips": "IPS",
                        "Vhc": "VHC", "Vhb": "VHB", "Vih": "VIH", "Bdua": "BDUA",
                        "id": "ID", "SGSSS": "SGSSS", "Causamuerte": "Causa Muerte",
                        "Fechamuerte": "Fecha Muerte", "idEPS": "ID EPS"
                };

                Object.keys(exp).forEach(k => {
                        const reg = new RegExp(`\\b${k}\\b`, 'gi');
                        label = label.replace(reg, exp[k]);
                });

                // Mantener el prefijo VAR## elegante: "VAR1 : Primer Nombre"
                // El usuario pidió un espacio entre nombre técnico y descriptivo visible.
                label = label.replace(/^(VAR\d+)\s(.*)/i, '$1 : $2');

                return label.replace(/\s+/g, ' ').trim();
        };


        // ✅ INICIALIZACIÓN DE FILTROS DESDE FIRESTORE
        const initFilters = async () => {
                const now = new Date();
                const mesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const mDefault = String(mesAnterior.getMonth() + 1).padStart(2, '0');
                const yDefault = String(mesAnterior.getFullYear());

                const elA = document.getElementById("filtroAnio");
                const elM = document.getElementById("filtroMes");

                // Obtener años únicos desde Firestore
                try {
                        // Optimización: limitamos la carga inicial para detectar años
                        const snap = await getDocs(query(collection(db, "pacientes_cac"), limit(300)));
                        const aniosSet = new Set();

                        snap.forEach(d => {
                                const periodos = d.data()?.periodos || {};
                                Object.keys(periodos).forEach(p => {
                                        const anio = p.split('-')[0];
                                        if (anio && /^\d{4}$/.test(anio)) aniosSet.add(anio);
                                });
                        });

                        // Siempre incluir el año actual
                        aniosSet.add(String(now.getFullYear()));

                        const aniosOrdenados = [...aniosSet].sort();

                        if (elA) {
                                elA.innerHTML = '';
                                aniosOrdenados.forEach(anio => {
                                        const opt = document.createElement('option');
                                        opt.value = anio;
                                        opt.textContent = anio;
                                        elA.appendChild(opt);
                                });
                                elA.value = yDefault;
                        }

                } catch (e) {
                        console.error("[ALTO_COSTO] Error al cargar años únicos:", e);
                        // Fallback si falla Firestore
                        if (elA) {
                                elA.innerHTML = `<option value="${yDefault}">${yDefault}</option>`;
                        }
                }

                if (elM) elM.value = mDefault;
                console.log(`[ALTO_COSTO] Filtros inicializados: ${yDefault}-${mDefault}`);
        };
        await initFilters();

        // --- CONSTANTS FROM ORIGINAL MODULE ---
        const PERIODO_INICIO = "2024-01-01";
        const EXCEPCION_NOV = "2024-11-01";
        const S_UNKNOWN = "1800-01-01";
        const S_NO_APPLY = "1845-01-01";
        const AYUDA_HEMATO = {
                "VAR1_PrimerNombre": "MAYÚSCULAS. Sin tildes, sin caracteres especiales. Debe coincidir con identificación/BDUA.",
                "VAR2_SegundoNombre": "MAYÚSCULAS. Si no tiene, registrar NONE (obligatorio).",
                "VAR3_PrimerApellido": "MAYÚSCULAS. Sin tildes, sin caracteres especiales.",
                "VAR4_SegundoApellido": "MAYÚSCULAS. Si no tiene, registrar NOAP (obligatorio).",
                "VAR5_TipoIdentificacion": "Código del tipo de documento según estándar CAC (p. ej., CC/CE/PA/TI/RC u otros permitidos). Debe ser consistente con el número de ID.",
                "VAR6_Identificacion": "Número de identificación sin puntos, comas ni espacios. Debe corresponder al tipo de identificación.",
                "VAR7_FechaNacimiento": "Formato AAAA-MM-DD. Fecha real de nacimiento.",
                "VAR8_Sexo": "Registrar M o F según documento/HC.",
                "VAR9_Ocupacion": "Código CIUO (Clasificación Internacional Uniforme de Ocupaciones) o comodines permitidos (p. ej., 9999 sin info / 9998 no aplica, si tu estándar los usa).",
                "VAR10_Regimen": "Código de régimen SGSSS según estándar CAC (C/S/P/E/N/I u opciones que manejes institucionalmente).",
                "VAR11_idEPS": "Código de la EAPB/EPS que reporta (según estándar CAC). Si es entidad territorial, código DANE depto + 000.",
                "VAR12_idPertenenciaEtnica": "Código de pertenencia étnica según estándar CAC (1–6).",
                "VAR13_idGrupoPoblacional": "Código de grupo poblacional según estándar CAC (listado completo).",
                "VAR14_MunicipioDeResidencia": "Código DIVIPOLA/DANE del municipio de residencia (consistente con HC).",
                "VAR15_TelefonoPaciente": "Máximo 2 teléfonos separados por guion (-). Solo números. Si no hay, usar 0 (o el comodín definido por tu estándar).",
                "VAR16_FechaAfiliacion": "Formato AAAA-MM-DD. Fecha de afiliación a la EAPB que reporta (según BDUA/soporte).",

                "VAR17_GestacionAlCorte": "Aplica a mujeres: registrar estado de gestación a la fecha de corte según categorías del instructivo (si no aplica, usar el código 'No aplica' definido).",
                "VAR18_EnPlanificacion": "Aplica a mujeres: indicar si está en planificación a la fecha de corte según categorías del instructivo (si no aplica, usar 'No aplica').",
                "VAR19_EdadUsuarioMomentoDx": "Edad al momento del diagnóstico (en años). Debe ser coherente con fecha nacimiento y fecha Dx.",
                "VAR20_MotivoPruebaDx": "Código del motivo que llevó a la prueba diagnóstica (según instructivo: sangrado/antecedente familiar/otro/desc.).",
                "VAR21_FechaDx": "Formato AAAA-MM-DD. Fecha de confirmación diagnóstica. Si el instructivo permite comodines para desconocido, usarlos solo si está soportado.",
                "VAR22_IpsRealizaConfirmacionDx": "Código de habilitación REPS de la IPS que confirmó Dx (12 dígitos con cero inicial). Si fuera del país, usar el código especial definido por instructivo.",

                "VAR23_TipoDeficienciaDiagnosticada": "Código del tipo de deficiencia (Hemofilia A/B, EvW, portadora u otras coagulopatías objeto de reporte) según instructivo.",
                "VAR24_SeveridadSegunNivelFactor": "Clasificación según nivel de factor (leve/moderada/severa, EvW por tipo, portadora) o 9999 si no aplica para coagulopatía diferente.",
                "VAR25_ActividadCoagulanteDelFactor": "Valor EXACTO de actividad FVIII/FIX al Dx (0–40). Máx 2 decimales, usar punto (.). No aproximar. 3333 solo para diagnósticos antiguos sin dato (no válido en nuevos).",
                "VAR26_AntecedentesFamilares": "0=Sí, 1=No, 2=Desconocido (según instructivo).",

                "VAR27_FactorRecibidoTtoIni": "Código del factor/tratamiento recibido al inicio (según lista del instructivo). Si no recibió, usar el código correspondiente.",
                "VAR28_EsquemaTtoIni": "Código del esquema inicial (a demanda/profilaxis/ITI u otras opciones del instructivo).",
                "VAR29_FechaDeIniPrimerTto": "Formato AAAA-MM-DD. Inicio del primer tratamiento. Debe ser ≥ fecha Dx.",

                "VAR30_FactorRecibidoTtoAct": "Código del factor/tratamiento ACTUAL según instructivo (incluye opciones específicas para concentrados, bypassing, emicizumab, EvW, portadoras, etc.). Usar 9996 si abandono; 9999 si no aplica (coagulopatía diferente).",
                "VAR31_EsquemaTtoAct": "Código del esquema ACTUAL según instructivo (p. ej., a demanda/profilaxis/ITI/otros). Coherente con VAR30 y con dosis/frecuencia.",
                "VAR32_Peso": "Peso actual en kg (numérico). Usar el formato definido (sin unidades en texto).",

                "VAR32_1_Dosis": "Dosis del tratamiento actual. Reglas del instructivo: si el tratamiento actual es a demanda, este campo debe ir con el comodín definido (p. ej., 9998). Si aplica, registrar dosis según unidad (UI/kg o mg/kg) coherente con el fármaco.",
                "VAR32_2_FrecuenciaPorSemana": "Frecuencia semanal (número). Si el instructivo define comodines por no aplicación (p. ej., a demanda), usar el comodín correspondiente.",
                "VAR32_3_UnidadesTotalesEnElPeriodo": "Total de unidades administradas en el periodo (numérico). Debe cuadrar con dosis × aplicaciones si aplica.",
                "VAR32_4_AplicacionesDelFactorEnElPeriodo": "Número de aplicaciones del factor/tratamiento en el periodo (numérico).",

                "VAR33_ModalidadAplicacionTratamiento": "Modalidad según instructivo (domiciliaria/institucional/mixta u opciones vigentes).",
                "VAR34_ViaDeAdministracion": "Vía según instructivo (IV/SC u otras permitidas). Debe ser coherente con el medicamento.",

                "VAR35_CodigoCumFactorPosRecibido": "Código CUM del factor POS recibido (solo números). Si no aplica, usar el comodín definido (p. ej., 999997/999998 según instructivo).",
                "VAR36_CodigoCumFactorNoPosRecibido": "Código CUM del factor NO POS recibido. Si no recibió NO POS, usar el comodín definido por instructivo.",
                "VAR37_CodigoCumDeOtrosTratamientosUtilizadosI": "CUM de otros tratamientos (1). Si no aplica, usar comodín del instructivo.",
                "VAR38_CodigoCumDeOtrosTratamientosUtilizadosII": "CUM de otros tratamientos (2). Si no aplica, usar comodín del instructivo.",

                "VAR39_IpsSeguimientoActual": "Código REPS (12 dígitos) de la IPS que hace seguimiento actual. Si seguimiento fuera del país, usar el código especial del instructivo si aplica.",

                "VAR40_Hemartrosis": "0=No, 1=Sí. 9996=abandono. 9999=no aplica (coagulopatía diferente).",
                "VAR40_1_CantHemartrosisEspontaneasUlt12Meses": "Número de eventos (entero). 9996=abandono. 9999=no aplica.",
                "VAR40_2_CantHemartrosisTraumaticasUlt12Meses": "Número de eventos (entero). 9996=abandono. 9999=no aplica.",

                "VAR41_HemorragiaIlioPsoas": "Número de eventos en últimos 12 meses. Si no tuvo, registrar 0. 9996=abandono. 9999=no aplica.",
                "VAR42_HemorragiaDeOtrosMusculosTejidos": "Número de eventos en últimos 12 meses. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR43_HemorragiaIntracraneal": "Número de eventos en últimos 12 meses. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR44_HemorragiaEnCuelloOGarganta": "Número de eventos en últimos 12 meses. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR45_Hemorragia Oral": "Número de eventos en últimos 12 meses. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR46_OtrasHemorragias": "Número de eventos en otras localizaciones (ej. epistaxis, hemorragia uterina no ginecológica) en últimos 12 meses. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",

                "VAR47_1_CantOtrasHemorragiasEspontaneasDiffHemartrosis": "Número de eventos (espontáneos) distintos a hemartrosis. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR47_2_CantOtrasHemorragiasTraumaticasDiffHemartrosis": "Número de eventos (traumáticos) distintos a hemartrosis. Si no tuvo, 0. 9996=abandono. 9999=no aplica.",
                "VAR47_3_CantOtrasHemorragAsocProcedimientoDiffHemartrosis": "Número de eventos asociados a procedimientos (solo si sangrado anormal por cirugía/procedimiento). Si no tuvo, 0. 9996=abandono. 9999=no aplica.",

                "VAR48_PresenciaDeInhibidor": "Registrar opción según instructivo (hemofilia: baja respuesta / alta respuesta / sin inhibidor / sin prueba en periodo / no requerido; EvW: con o sin toma). 9996=abandono. 9999=no aplica (coagulopatía diferente; portadoras también reportan no aplica).",
                "VAR48_1_FechaDeterminacionTitulosInhibidor": "Fecha del paraclínico (AAAA-MM-DD). Debe existir interpretación médica (salvo excepciones del mes previo al reporte).",
                "VAR48_2_HaRecibidoITI": "0=No, 1=Sí. 9999=no aplica (coagulopatía diferente).",
                "VAR48_3_EstaRecibiendoITI": "0=no recibió ITI en el periodo, 1=recibió en periodo pero ya no está, 2=a la fecha de corte está en ITI. 9996=abandono. 9999=no aplica.",
                "VAR48_4_DiasEnITI": "Número de días en la última ITI dentro del periodo. 9996=abandono. 9998=no aplica si no ha recibido ITI. 9999=no aplica.",

                "VAR49_ArtropatiaHemofilicaCronica": "0=No, 1=Sí (artropatía crónica asociada). 9999=no aplica (coagulopatía diferente y EvW incluye portadoras).",
                "VAR49_1_CantArticulacionesComprometidas": "Número de articulaciones comprometidas (entero). 9999=no aplica.",

                "VAR50_UsuarioInfectadoPorVhc": "0=No, 1=Sí. 9996=abandono. 9999=no aplica.",
                "VAR51_UsuarioInfectadoPorVhb": "0=No, 1=Sí. 9996=abandono. 9999=no aplica.",
                "VAR52_UsuarioInfectadoPorVih": "0=No, 1=Sí. 9996=abandono. 9999=no aplica. En prevalentes, conservar dato del periodo anterior si aplica.",

                "VAR53_Pseudotumores": "0=No, 1=Sí. 9996=abandono. 9999=no aplica.",
                "VAR54_Fracturas": "0=No, 1=Sí (solo por osteopenia/osteoporosis; NO fracturas traumáticas). 9996=abandono. 9999=no aplica.",
                "VAR55_Anafilaxis": "0=No, 1=Sí (reacción anafiláctica severa y potencialmente mortal posterior a factor). 9996=abandono. 9999=no aplica.",
                "VAR55_1_FactorAtribuyeReaccionAnafilactica": "Código CUM del factor atribuido. Si no presentó anafilaxis, registrar 0. 9996=abandono. 9999=no aplica.",

                "VAR56_CantidadReemplazosArticulares": "Cantidad total de reemplazos articulares por complicaciones de hemofilia (durante la vida). No contar reintervenciones por complicación. 9999=no aplica.",
                "VAR56_1_ReemplazosArticularesEnPeriodoDeCorte": "Cantidad de reemplazos articulares realizados en el periodo. 9996=abandono. 9999=no aplica.",

                "VAR57_LiderAtencion": "Profesional que lideró la atención en el periodo: 0=Hematólogo, 2=Médico familiar, 3=Internista, 4=Ortopedista, 5=Pediatra. 9996=abandono.",
                "VAR57_1_ConsultasConHematologo": "Número de consultas ambulatorias con hematología en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_2_ConsultasConOrtopedista": "Número de consultas ambulatorias con ortopedia en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_3_IntervencionProfesionalEnfermeria": "Número de intervenciones de enfermería (educación, talleres, seguimiento telefónico, consulta; NO administración de factor). Si no tuvo, 0. 9996=abandono.",
                "VAR57_4_ConsultasOdontologo": "Número de consultas con odontología en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_5_ConsultasNutricionista": "Número de consultas con nutrición en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_6_IntervencionTrabajoSocial": "Número de intervenciones de trabajo social en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_7_ConsultasConFisiatria": "Número de consultas con fisiatría en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_8_ConsultasConPsicologia": "Número de consultas con psicología en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_9_IntervencionQuimicoFarmaceutico": "Número de intervenciones por químico farmacéutico en el periodo. Si no tuvo, 0. 9996=abandono.",
                "VAR57_10_IntervencionFisioterapia": "Número de intervenciones de fisioterapia en el periodo. Si no tuvo, 0. 9996=abandono.",

                "VAR57_11_PrimerNombreMedicoTratantePrincipal": "MAYÚSCULAS. Primer nombre del médico tratante principal. Sin tildes/símbolos.",
                "VAR57_12_SegundoNombreMedicoTratantePrincipal": "MAYÚSCULAS. Si no tiene, NONE.",
                "VAR57_13_PrimerApellidoMedicoTratantePrincipal": "MAYÚSCULAS. Sin tildes/símbolos.",
                "VAR57_14_SegundoApellidoMedicoTratantePrincipal": "MAYÚSCULAS. Si no tiene, NOAP.",

                "VAR58_CantAtencionesUrgencias": "Cantidad de atenciones por urgencias durante el periodo (entero). Si no tuvo, 0.",
                "VAR59_CantEventosHospitalarios": "Cantidad de eventos de hospitalización durante el periodo (entero). Si no tuvo, 0.",

                "VAR60_CostoFactoresPos": "Costo total en COP de factores POS suministrados en el periodo. Solo número (sin $).",
                "VAR61_CostoFactoresNoPos": "Costo total en COP de factores NO POS suministrados en el periodo. Solo número (sin $).",
                "VAR62_CostoTotalManejo": "Costo total en COP del manejo del paciente en el periodo (NO incluir incapacidades).",
                "VAR63_CostoIncapacidadesLaborales": "Costo en COP por incapacidades laborales en el periodo (solo si aplica).",

                "VAR64_Novedades": "Estado respecto al periodo anterior: 0 sin novedad; 1 ingresó con Dx previo; 2 nuevo Dx; 3 Dx antiguo no reportado; 4 falleció; 5 desafiliado; 6 eliminar por corrección; 7 alta voluntaria; 8 cambio de ID; 9 abandono imposible ubicar; 10 no reportado antes y ya fallecido; 12 migrante Venezuela; 13 traslado glosado no gestionado; 14 cruce externo no confirmado/no gestionado; 15 cruce externo descartado o fallecido/desafiliado no gestionado; 16 se fue al extranjero.",
                "VAR64_1_CausaMuerte": "Diligenciar SOLO si la novedad indica fallecimiento. Registrar causa según soporte clínico (texto/código según tu plantilla). Si no aplica, dejar según regla del instructivo.",
                "VAR64_2_FechaMuerte": "Formato AAAA-MM-DD. SOLO si falleció.",

                "VAR65_SerialBDUA": "Serial/código BDUA del usuario (tal cual aparece en BDUA). No inventar; si no está disponible, usar el comodín permitido por tu estándar.",
                "VAR66_V66FechaCorte": "Fecha de corte del reporte en formato AAAA-MM-DD (debe ser la definida por el instructivo del periodo).",

                "Dx": "Código CIE-10 del diagnóstico principal objeto de reporte (consistente con tipo de deficiencia y soportes)."
        };

        const AYUDA_CANCER = {
                "VAR1_PrimerNombreUsuario": "en MAYÚSCULAS, como en BDUA. Sin símbolos/tildes. No confundir con apellido",
                "VAR2_SegundoNombreUsuario": "en MAYÚSCULAS. Si no tiene, escribe NONE (si tiene 3 nombres, el 3º va separado por espacio). Sin tildes ni caracteres especiales.",
                "VAR3_PrimerApellidoUsuario": "en MAYÚSCULAS, como BDUA. Sin símbolos/tildes. No poner nombre aquí.",
                "VAR4_SegundoApellidoUsuario": "en MAYÚSCULAS. Si no tiene, escribe NOAP. Sin tildes ni caracteres especiales.",
                "VAR5_TipoIdentificacionUsuario": "Registre el código del tipo de documento según catálogo del instructivo (TI/CC/CE/PA/etc.).",
                "VAR6_NumeroIdentificacionUsuario": "Registre el número del documento. Para MS/AS, use consecutivo según norma aplicable del instructivo.",
                "VAR7_FechaNacimiento": "Formato AAAA-MM-DD. Debe ser coherente con afiliación y corte.",
                "VAR8_Sexo": "Registre: M (Masculino) o F (Femenino).",
                "VAR9_Ocupacion": "Código CIUO. Registre 9999 si no hay info; 9998 si no aplica.",
                "VAR10_RegimenAfiliacionSGSSS": "Registre: C, S, P, E, N o I según régimen.",
                "VAR11_idEPS": "Código EAPB o entidad territorial (si es territorial: código dpto + '000', ej 01000).",
                "VAR12_CodigoPertenenciaEtnica": "Registre 1–6 según pertenencia étnica.",
                "VAR13_GrupoPoblacional": "Registre el código del grupo poblacional según catálogo del instructivo.",
                "VAR14_MunicipioResidencia": "Código DIVIPOLA DANE (5 dígitos) del municipio de residencia.",
                "VAR15_NumeroTelefonicopaciente": "Teléfono(s) del paciente según regla del instructivo (si no existe, registre 0).",
                "VAR16_FechaAfiliacionEPSRegistra": "Fecha de afiliación a la EAPB que reporta. Formato AAAA-MM-DD.",
                "VAR17_NombreNeoplasia": " CIE-10 primario (no metástasis). 1fila=1primario. C80X prohibido. No duplicar mismo tipo histológico. Primarios múltiples=filas indep. In situ=D+Estadio 0(V29). CRITERIOS: Cérvix: solo histopatol(no citología). Paget profundo=mama; pezón=piel. Dermatofibrosarcoma=piel. GIST=t.blandos. Adenoma velloso: solo si es in situ/infiltrante. U.Gastroesof: Adeno=estómago; Escamo/tercio medio-sup=esófago. Tiroides: Dx quir(Beth III-V no es cáncer; VI ok). HEMATO/SNC: Linfoma requiere IHQ. LLC=LNH. Waldenström/Castleman con cod.propio. Reportar astrocitomas/blastomas. Histio/Mastocitosis: solo sistémicas. Sarcomas s/origen(extraóseo=blandos). Ewing s/sitio. Phyllodes: solo maligno/alto grado",
                "VAR18_FechaDx": "Fecha de diagnóstico: AAAA-MM-DD. Si solo año/mes, día 15. Si el instructivo permite 'desconocido', use 1800-01-01 únicamente cuando no esté en soportes. Diagnóstico histopatológico: Las variables 18 y 24 deben tener la misma fecha y es obligatorio adjuntar el reporte para nuevos pacientes. Diagnóstico clínico: Se registra la fecha de la primera consulta donde el especialista confirma el cáncer basado en imágenes o laboratorios (sin patología). Tratamiento previo a patología: Si se inicia tratamiento basándose en un diagnóstico clínico inicial, esa fecha se asigna a las variables 18 y 26; la fecha de la patología posterior se registra únicamente en la variable 24. Confirmación exclusiva por patología: En tipos de cáncer que solo se confirman por tejido (como piel o tiroides), las variables 18 y 24 siempre deben coincidir.",
                "VAR19_FechaNotaRemisionMedico": "Fecha de remisión/interconsulta previa al diagnóstico (si aplica). AAAA-MM-DD; si solo año/mes. Si conoce sólo el año y el mes, registre el día 15. Registre 1800-01-01: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos. Para diagnósticos basados en imágenes o tamización (TAC, resonancia, endoscopia, mamografía, etc.), es válido usar la fecha del reporte del estudio. Como requisito obligatorio, se debe anexar el reporte físico para el proceso de auditoría.",
                "VAR20_FechaIngresoInstitucionRealizo": "Fecha de ingreso a la institución donde se realizó el diagnóstico. Si conoce sólo el año y el mes, registre el día 15. Registre 1800-01-01: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos. Diagnóstico clínico: Usa la fecha de la consulta médica (las variables 18 y 20 deben ser iguales). Diagnóstico por patología: Usa la fecha en que la muestra entró al laboratorio de procesamiento. Sin fecha de laboratorio: Usa la fecha en que el médico ordenó el examen (biopsia o imagen), siempre que esté debidamente justificado en la nota médica.",
                "VAR21_TipoEstudioRealizoDiagnostico": "Tipo de estudio confirmatorio (IHQ/citometría/clínico/patología/etc.) según catálogo del instructivo. Aclaración: Para pacientes nuevos, las opciones 1 a 4 ya no son válidas y se unifican en la opción 10. Dichas categorías solo se permiten como dato histórico en usuarios reportados antes de 2020. Siempre se debe registrar el primer estudio que confirmó el diagnóstico de cáncer.",
                "VAR22_MotivoUsuarioNOTuvoDiagnostico": "Aplica solo si en VAR21 registró diagnóstico clínico sin histopatología. Registre 1–6, 98 (sí tuvo histopatología) o 99 (desconocido).",
                "VAR23_FechaRecoleccionMuestraEstudioHistopatologico": "Use formato AAAA-MM-DD. Si solo conoce año/mes, use día 15. Registre 1800-01-01 si el dato es desconocido en soportes y 1845-01-01 si no hubo estudio histopatológico (Var 21=7). En diagnósticos por cirugía (tiroides, piel, etc.), use la fecha del procedimiento. Son soportes válidos la nota quirúrgica o la fecha de recolección en el reporte de patología; no use la fecha de ingreso al laboratorio.",
                "VAR24_FechaInformHistopatologicoValido": "Use formato AAAA-MM-DD (si solo conoce año/mes, use día 15). Registre la fecha de la primera prueba que confirmó el cáncer e inició el manejo. Use 1800-01-01 para datos desconocidos y 1845-01-01 si no hubo histopatología (Var 21=7). Es obligatorio adjuntar el reporte de patología como soporte para validar esta variable.",
                "VAR25_CodigoValidoHabilitacionIPS": "Registre el código REPS (12 dígitos) de la IPS que procesó la patología o realizó el diagnóstico clínico, verificando que esté habilitada para dicho servicio; de lo contrario, el auditor calificará como DOND. Extraiga este dato del reporte original (sede responsable). Use 96 para diagnósticos en el extranjero y 99 si es desconocido. No es válido registrar el código de la IPS de seguimiento o tratamiento.",
                "VAR26_FechaPrimeraConsultaMedicoTratante": "Formato AAAA-MM-DD (día 15 si solo sabe año/mes). Use fecha de consulta donde el especialista define manejo (sistémico, cirugía, radio, paliativo o expectante). Use 1800-01-01 si es desconocido. Casos desde 1-nov-2024: si no hay consulta de conducta aún, use 1800-01-01 y reporte novedad 2, 10 o 13 en Var 128.",
                "VAR27_HistologiaTumorMuestraBiopsia": "Tipo histológico según reporte de patología. La opción 2 (escamocelular) aplica a todos los órganos con esa histología (cérvix, pulmón, anal, etc.), no solo a piel. En pacientes incidentes, el uso de la opción 99 se calificará como dato no gestionado (DOND). Para el reporte 2025, se añade la opción 21 (célula pequeña), válida exclusivamente para cáncer de pulmón.",
                "VAR28_GradoDiferenciacionTumorSolidoMaligno": "Grado de diferenciación del tumor sólido maligno según patología/catálogo del instructivo. La escala de Nottingham (grado 1, 2 o 3) es válida para esta variable. Use opción 99 solo si el grado no está en soportes y el diagnóstico es anterior a 2015-01-01 (si es posterior, no es válida). En cáncer de próstata sin grado explícito, use opción 94; está prohibido homologar o calcular el grado a partir del Gleason.",
                "VAR29_SiEsTumorSolido": "Indique si el cáncer reportado corresponde a tumor sólido según catálogo. Use 98 para piel basocelular, hematológicos o SNC (excepto neuroblastoma) y 99 si no hay dato en soportes. Prioridad: Registre la estadificación usada para iniciar tratamiento o la primera tras exámenes de extensión. Si el cáncer no es priorizado, use la opción que indique el soporte clínico aunque no coincida con los agrupadores. Incidentes: Opción 99 se califica como gestión deficiente. Casos desde 1-nov-2024: Si no hay estadificación aún, use 99 y novedad 2, 10 o 13 en Var 128. In situ (CIE-10 con D): Debe marcar Opción 0 (estadio clínico in situ). FIGO 34 y 35 solo aplican a ovario, no a cérvix.",
                "VAR30_FechaRealizoEstaEstadificacion": "Fecha de estadificación. AAAA-MM-DD; si solo año/mes, día 15. Use 1800-01-01 si el dato es desconocido. Use 1845-01-01 (No Aplica) para piel basocelular, hematológicos o SNC (salvo neuroblastoma). Casos desde 1-nov-2024: si no hay consulta de estadificación aún, use 1800-01-01 y reporte novedad 2, 10 o 13 en Var 128.",
                "VAR31_ParaCancerMama": "HER2 antes de iniciar tratamiento: 1 Sí, 2 No, 97 In situ, 98 No aplica (no es mama), 99 Desconocido. Capture la información si el examen se realizó en cáncer de mama in situ. Si el HER2 se hizo después de iniciar tratamiento, marque opción 2 (No se realizó) en la Var 31, pero reporte obligatoriamente la fecha y el resultado en las Var 32 y 33.",
                "VAR32_ParaCancerMamaFechaRealizacion": "Use formato AAAA-MM-DD (día 15 si solo conoce año/mes). Registre 1800-01-01 si es desconocido, 1840-01-01 para cáncer de mama in situ y 1845-01-01 si no es cáncer de mama o si en la variable 31 marcó la opción 2 (no se realizó).",
                "VAR33_ParaCancerMamaResultadoPrimera": "Resultado HER2: 1 +++, 2 ++, 3 +, 4 0; 97/98/99 según aplique. Aclaración:En pacientes prevalentes, si una nueva inmunohistoquímica (ej. postquirúrgica) arroja un resultado de HER2 diferente al anterior (especialmente si es positivo), el dato debe ajustarse en el registro debido al cambio en el enfoque del tratamiento. ",
                "VAR34_ParaCancerColorrectalEstadificacionDukes": "Dukes: 1 A, 2 B, 3 C, 4 D; 98 No aplica (no colorrectal); 99 colorrectal sin info.",
                "VAR35_FechaEstadificacionDukes": "Use formato AAAA-MM-DD (día 15 si solo conoce año/mes). Registre 1845-01-01 si no es cáncer colorrectal o si la variable anterior se marcó como 99.",
                "VAR36_EstadificacionLinfomaClinicaHodgkin": "Estadificación clínica linfomas/MM según sistema indicado (Ann Arbor/Lugano u otro). Aclaración: Use sufijos A/B para síntomas sistémicos y opciones específicas para compromiso extranodal, SNC o mediastino. Si solo tiene el número (1 a 4), reporte la opción básica. Ignore el sufijo X (Bulky) y elija el estadio base. Se incluye Mieloma Múltiple en esta variable. Casos desde 1-nov-2024: si no hay estadificación aún, use 99 y novedad 2, 10 o 13 en Var 128.",
                "VAR37_CancerProstataValorClasificacionGleason": "Gleason: 11 (<=6), 12 (7 3+4), 13 (7 4+3), 14 (8), 15 (9-10). 97 próstata dx clínico sin info; 98 no próstata; En casos nuevos, la opción 99 se califica como dato no gestionado (DOND). Las opciones 1 a 10 no son válidas para pacientes reportados por primera vez (independiente del año de diagnóstico); solo se aceptan como histórico para pacientes reportados antes de 2021.",
                "VAR38_ClasificacionRiesgoLeucemiasLinfomas": "Clasificación de riesgo (linfomas/leucemias/MM y sólidos pediátricos) según catálogo. 98 no aplica; 99 desconocido. Aclaración: Opciones 1 a 5 se clasifican por tipo de cáncer (leucemias/linfomas). Opciones 6 a 13 son solo para históricos (antes de 2021). Casos desde 1-nov-2024: si no hay riesgo definido, use 99 y novedad 2, 10 o 13 en Var 128. Linfoma de Hodgkin: Homologar según estadio (Estadio I-II = Bajo riesgo; III-IV = Riesgo alto). Mieloma Múltiple: Reportar riesgo bajo (1), intermedio (3) o alto (5). Si el cáncer no tiene clasificación de riesgo, use 98.",
                "VAR39_FechaClasificacionRiesgo": "Use formato AAAA-MM-DD (día 15 si solo conoce año/mes). Registre 1800-01-01 si el dato es desconocido y 1845-01-01 si no es leucemia ni linfoma. Casos desde 1-nov-2024: si no hay consulta de riesgo aún, use 1800-01-01 y reporte novedad 2, 10 o 13 en Var 128.",
                "VAR40_ObjetivoTratamientoMedicoInic": "Intención del tratamiento: Registre 1 (Curación), 2 (Paliación) o 3 (Manejo expectante). Use 99 si no hay dato en soportes. Nota clave: La información corresponde a la decisión tomada al momento del diagnóstico y no es modificable en el tiempo.",
                "VAR41_ObjetivoIntervencionMedicaPeriodoReporte": "Registre 1 (Observación/Expectante), 2 (Tratamiento activo: curativo o paliativo), o 3 (Seguimiento post-tratamiento). Use combinaciones: 4 (1+2), 5 (2+3) o 6 (1, 2+3). Use 99 si no hubo intervención (abandono, alta oncológica o voluntaria)",
                "VAR42_TieneAntecedenteOtroCancerPrimario": "Registre 1 (Sí), 2 (No) o 99 (Desconocido/Insuficiente). Si hay dos primarios del mismo agrupador (ej. mama bilateral), reporte ambos en líneas separadas (Var 17) y cruce la información en la Var 44. Con tres primarios, reporte en antecedentes el más cercano a la fecha de corte. Todo segundo primario debe estar plenamente soportado en la historia clínica.",
                "VAR43_FechaDiagnosticoOtroCancerPrimario": "Use formato AAAA-MM-DD (día 15 si solo conoce año/mes). Registre 1800-01-01 si es desconocido y 1845-01-01 si no ha tenido otro cáncer primario (No Aplica).",
                "VAR44_TipoCancerAntecedente": "Registre el código CIE-10 del segundo cáncer (según archivo SISCAC). Si el diagnóstico inicial fue genérico (ej. tumor de células pequeñas) pero luego se confirmó un tipo específico (ej. linfoma), reporte este último. Use 99 si no hay otro primario. Nota: En casos de múltiples primarios, asigne cada tratamiento al cáncer que corresponda (ej. cirugía para cérvix, quimioterapia para mama).",
                "VAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual": "Registre 1 (Sí recibió) si el tratamiento se administró efectivamente dentro del periodo de reporte (no valen tratamientos propuestos). Use 98 (No Aplica) si no está indicada (asegure registro de No Aplica en Var 46 a 73). En casos de múltiples primarios, asegúrese de reportar en cada línea solo la terapia correspondiente al cáncer de la Var 17 o sus metástasis.",
                "VAR46_FaseQuimioterapiaRecibioUsuarioCorte": "Escriba el número de fases propuestas para el periodo. Use 0 solo si es cáncer hematolinfático (C835, C910, C920, C924, C925) y en la Var 45 marcó 98. Use 98 si es tumor sólido o un cáncer diferente a los códigos mencionados.",
                "VAR46_1_UsuarioRecibioCorteQuimioterapiaPrefase": "Registre 1 (Sí recibió). Use 2 (No recibió) solo para los códigos CIE-10 específicos (C835, C910, C920, C924 y C925). Use 97 (No Aplica) si no es leucemia linfoide/mieloide aguda o linfoma linfoblástico.",
                "VAR46_2_UsuarioRecibioCorteFaseQuimioterapiaInduccion": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_3_UsuarioRecibioCorteFaseQuimioterapIntensificacion": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_4_UsuarioRecibioCorteFaseQuimioterapiaConsolidacion": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_5_UsuarioRecibioCorteFaseQuimioterapiaReinduccion": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_6_UsuarioRecibiCorteFaseQuimioterapiaMantenimiento": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_7_UsuarioRecibioCorteFaseQuimioterapiaMantenimientoL": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR46_8_UsuarioRecibiCorteOtraFaseQuimioterapia": "Registre 1 (Sí recibió). Use 2 (No recibió) únicamente para los códigos CIE-10 mencionados (leucemias y linfoma linfoblástico). Use 97 (No Aplica) si el diagnóstico es diferente a los enunciados.",
                "VAR47_NumeroCiclosIniciadosPeriodoReporteActual": "Registre el total de administraciones del esquema según la historia clínica. Use 98 si no aplica o no recibió terapia (Var 45=98). Criterios: En tumores sólidos, cuente cada administración del esquema. En hormonoterapia oral continua, registre 1. En hormonoterapia inyectable (IM/SC) e intratecales, cada aplicación cuenta como un ciclo. En hematolinfáticos, registre según el protocolo descrito.",
                "VAR48_UbicacionTemporalPrimerCicloRelacionOncologico": "Registre 1 (Neoadyuvancia) pre-cirugía, 2 (Curativo sin cirugía) frecuente en leucemias/linfomas, o 3 (Adyuvancia) post-cirugía (incluye hormonoterapia en mama tras cirugía). Use 11 (Recaída), 12 (Metastásica) o 13 (Paliativo puro). Marque 98 si la Var 45 es 98. Nota: El esquema es el plan de uno o varios fármacos según guías médicas.",
                "VAR49_FechaInicioPrimerCicloQuimioterapiaCorte": "Use formato AAAA-MM-DD (día 15 si solo conoce año/mes). Es válido que la fecha sea anterior al periodo si el esquema es prolongado y continúa vigente. Registre 1845-01-01 si la variable 45 fue 98 (No Aplica).",
                "VAR50_NumeroIPSPrimerCicloCorte": "Registre la cantidad de instituciones que suministraron el primer esquema de quimioterapia en el periodo. Use 98 si la variable 45 fue 98 (No Aplica).",
                "VAR51_CodigoIPS1PrimerCicloCorte": "Registre el código de 12 dígitos (incluyendo el cero inicial) de la IPS que suministra el esquema. Para tratamientos orales, use el código de la IPS que prescribe, nunca el del operador logístico de entrega. Use 96 si la terapia fue en el exterior y 98 si la Var 45 es 98.",
                "VAR52_CodigoIPS2PrimerCicloCorte": "Registre el código REPS de 12 dígitos (con el cero inicial). En tratamientos orales, use el de la IPS que prescribe, no el del operador logístico. Verifique que la IPS tenga habilitado el servicio de quimioterapia. Use 98 si no aplica (solo una IPS o sin tratamiento).",
                "VAR53_MedicamentosAntineoplasicosPrimerCicloCorte": "Registre el número total de fármacos proyectados para el primer esquema sin contar premedicación ni adyuvantes; use 98 si la Var 45 es 98. En las variables 53.1 a 56 reporte solo los códigos ATC de fármacos administrados, omitiendo esteroides en tumores sólidos, Linfoma de Hodgkin o LMA por ser soporte. El pegfilgrastim y los antirresortivos para metástasis ósea se reportan con su ATC pero no se cuantifican ni valen como monoterapia.",
                "VAR53_1_Medicamentoadm1PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_2_Medicamentoadm2PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_3_Medicamentoadm3PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_4_Medicamentoadm4PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_5_Medicamentoadm5PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_6_Medicamentoadm6PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_7_Medicamentoadm7PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_8_Medicamentoadm8PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR53_9_Medicamentoadm9PrimerEsquema": "Registre el código alfanumérico del fármaco administrado (incluido o no en el plan de beneficios) verificado en soportes clínicos y aplicado entre el 2 de enero de 2024 y el 1 de enero de 2025. Use 97 si ya registró todos los fármacos en campos previos y 98 si en la variable 45 marcó 98. Evite duplicar el mismo esquema de tratamiento en los campos del primer y segundo esquema.",
                "VAR54_Medicamento No POS 1 Administrado Usuario Primer Ciclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 53.1 a 53.9, sin importar su cobertura en el plan de beneficios. Use 97 si recibió quimioterapia pero no usó medicamentos distintos a los ya reportados, y 98 si no recibió tratamiento (Var 45=98). Asegúrese de no repetir fármacos en las variables 55 y 56, y evite registrar el mismo esquema de tratamiento como si fuera un segundo esquema diferente.",
                "VAR55_Medicamento No POS 2 Administrado Usuario Primer Ciclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 53.1 a 53.9 ni en la 54, sin considerar su cobertura en el plan de beneficios. Use 97 si recibió quimioterapia pero no usó medicamentos distintos a los ya reportados, y 98 si no recibió este esquema o la Var 45 es 98. Verifique en los soportes clínicos que el fármaco sea estrictamente un antineoplásico y no esté repetido en campos previos.",
                "VAR56_Medicamento No POS 3 Administrado Usuario Primer Ciclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 53.1 a 53.9 ni en la 54, sin considerar su cobertura en el plan de beneficios. Use 97 si recibió quimioterapia pero no usó medicamentos distintos a los ya reportados, y 98 si no recibió este esquema o la Var 45 es 98. Verifique en los soportes clínicos que el fármaco sea estrictamente un antineoplásico y no esté repetido en campos previos.",
                "VAR57_Recibio Quimioterapia Intratecal Primer Ciclo": "Registre 1 (Sí recibió) o 2 (No recibió). Use la opción 2 si el paciente recibió otros tipos de terapia sistémica pero su cáncer no requiere administración intratecal. Use 98 (No Aplica) únicamente si no recibió ningún esquema de quimioterapia en general, coincidiendo con la opción 98 de la variable 45.",
                "VAR58_Fecha Finalizacion Primer Ciclo Corte": "Registre la fecha de finalización en formato AAAA-MM-DD, usando el día 15 si solo conoce el año y el mes. Use 1845-01-01 si no aplica (Variable 45 es 98) y use 1800-01-01 para casos de hormonoterapia o esquemas que aún se encuentran en curso y no han finalizado al corte.",
                "VAR59_CaracteristicasActualesPrimerCicloCorte": "Registre 1 si el esquema finalizó con todos los medicamentos programados, 2 si terminó de forma incompleta por cualquier motivo, o 3 si el tratamiento aún continúa y no ha finalizado (como en el caso de la hormonoterapia). Use 98 (No Aplica) únicamente si no recibió ningún esquema de terapia sistémica en coherencia con la opción 98 de la variable 45.",
                "VAR60_MotivoFinalizacionPrimerCiclo": "Registre 1 por toxicidad de medicamentos, 2 por otros motivos médicos, 3 por muerte del paciente, 4 por cambio de EAPB, 5 por decisión o abandono del usuario, 6 por falta de disponibilidad de fármacos, 7 por otros motivos administrativos u 8 por causas no contempladas. Use 98 (No Aplica) si el esquema se completó satisfactoriamente o si no hubo tratamiento inicial.",
                "VAR61_UbicacionTemporalUltimoCicloCorteOncologico": "Registre 1 (Neoadyuvancia), 2 (Curativo sin cirugía), 3 (Adyuvancia), 11 (Progresión o recaída), 12 (Metastásica), 13 (Cambio por toxicidad) o 14 (Paliativo puro). No reporte nuevamente si solo recibió hormonoterapia como esquema final. Use 97 si solo recibió un esquema en el periodo, si el esquema único no ha finalizado o para evitar duplicar el primer esquema (Var 45 a 61) en estas variables. Use 98 si la Var 45 es 98.",
                "VAR62_FechaInicioUltimoCicloQuimioterapiaCorte": "Fecha inicio del último esquema del periodo: AAAA-MM-DD. Registre 1845-01-01 si No aplica.",
                "VAR63_NumeroIPSSuministranUltimoCicloCorte": "Registre la cantidad de instituciones que suministraron el segundo o último esquema de quimioterapia durante el periodo de reporte. Use 98 si no aplica porque solo recibió un esquema o porque no recibió tratamiento sistémico según la variable 45.",
                "VAR64_CodigoIPS1SuministraUltimoCicloReporte": "Registre el código REPS de 12 dígitos (con el cero inicial) de la institución que suministra el segundo esquema. En tratamientos orales, use el código de la IPS que prescribe, nunca el del operador logístico de entrega. Use 98 si no aplica porque solo recibió un esquema o la variable 45 fue 98.",
                "VAR65_CodigoIPS2SuministraUltimoCicloReporte": "Registre el código REPS de 12 dígitos (con el cero inicial) de la institución que suministra el segundo esquema. En tratamientos orales, use el código de la IPS que prescribe, nunca el del operador logístico de entrega. Use 98 si no aplica porque solo recibió un esquema o la variable 45 fue 98.",
                "VAR66_MedicamentosAntineoplasicosEspecialistaCancer": "Registre el número total de fármacos proyectados para el segundo esquema sin incluir premedicación ni adyuvantes; use 98 si no recibió un segundo esquema o la Var 45 es 98. Registre el total de medicamentos propuestos por el especialista aunque no se hayan administrado todos, pero en las variables 66.1 a 69 reporte únicamente los códigos ATC de los fármacos que efectivamente fueron suministrados en el periodo.",
                "VAR66_1_Medicamentoadm1UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_2_Medicamentoadm2UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_3_Medicamentoadm3UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_4_Medicamentoadm4UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_5_Medicamentoadm5UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_6_Medicamentoadm6UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_7_Medicamentoadm7UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_8_Medicamentoadm8UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR66_9_Medicamentoadm9UltimoEsquema": "Registre el código alfanumérico completo del fármaco administrado en el segundo esquema, esté o no incluido en el plan de beneficios. Use 97 si recibió quimioterapia pero los medicamentos ya fueron reportados en campos previos para evitar duplicidad, y use 98 si no aplica por no haber recibido un segundo esquema o por la opción seleccionada en la variable 45.",
                "VAR67_MedicamentoNoPOS1AdministradoUsuarioUltimoCiclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 66.1 a 66.9, sin considerar su cobertura en el plan de beneficios. Use 97 si recibió el esquema pero no usó medicamentos distintos a los ya reportados, y 98 si no tuvo este último esquema o la Variable 61 fue 97 o 98. Verifique que el fármaco no se repita en las variables 68 y 69 y que corresponda estrictamente a un antineoplásico según los soportes.",
                "VAR68_MedicamentoNoPOS2AdministradoUsuarioUltimoCiclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 66.1 a 66.9 ni en la 67, sin considerar su cobertura en el plan de beneficios. Use 97 si recibió el esquema pero no usó medicamentos distintos a los ya reportados, y 98 si no tuvo este último esquema o la Variable 61 fue 97 o 98. Verifique que el fármaco no se repita en las variables 67 y 69 y que corresponda estrictamente a un antineoplásico según los soportes.",
                "VAR69_MedicamentoNoPOS3AdministradoUsuarioUltimoCiclo": "Registre el código ATC del fármaco antineoplásico administrado que no haya sido incluido en las variables 66.1 a 66.9 ni en la 67 o 68, sin considerar su cobertura en el plan de beneficios. Use 97 si recibió el esquema pero no usó medicamentos distintos a los ya reportados, y 98 si no tuvo este último esquema o la Variable 61 fue 97 o 98. Verifique que el fármaco no se repita en las variables 67 y 68 y que corresponda estrictamente a un antineoplásico según los soportes.",
                "VAR70_RecibioQuimioterapiaIntratecalUltimoCicloCorte": "Registre 1 si recibió o 2 si no recibió. Use la opción 2 si el paciente recibió el segundo esquema de terapia sistémica pero este no incluyó administración intratecal. Marque 98 únicamente si el paciente no recibió ningún esquema de quimioterapia en el periodo, en concordancia con la opción 98 de la variable 45.",
                "VAR71_FechaFinalizacionCicloUltimo": "Registre la fecha de finalización en formato AAAA-MM-DD, usando el día 15 si solo conoce el año y el mes. Use 1845-01-01 si no aplica por ausencia de segundo esquema o tratamiento. Use 1800-01-01 en casos de hormonoterapia o si el segundo esquema aún se encuentra en curso y no ha finalizado al cierre del periodo.",
                "VAR72_CaracteristicasActualesUltimoCicloCorte": "Registre 1 si el esquema finalizó con todos los medicamentos programados, 2 si terminó de forma incompleta por cualquier motivo, o 3 si el tratamiento aún continúa y no ha finalizado (como en el caso de la hormonoterapia o esquemas en curso). Use 98 (No Aplica) si no se administró un segundo esquema o si la variable 45 fue 98.",
                "VAR73_MotivoFinalizacionPrematuraUltimoCiclo": "Registre 1 por toxicidad de medicamentos, 2 por otros motivos médicos, 3 por muerte, 4 por cambio de EPS, 5 por decisión o abandono del usuario, 6 por falta de disponibilidad de fármacos, 7 por otros motivos administrativos u 8 por causas no contempladas. Use 98 (No Aplica) si el esquema se completó satisfactoriamente, si aún continúa en curso o si no hubo un segundo tratamiento.",
                "VAR74_SometidoUsuarioCirugiasCurativasPaliativas": "Registre 1 si el paciente se sometió al menos a una cirugía durante el periodo o 2 si no recibió cirugía. Reporte procedimientos cuyo objetivo sea el tratamiento del cáncer (incluyendo diagnósticos que resulten terapéuticos como tiroidectomías), verificando que estén en el listado CUPS permitido; no incluya implantes de catéter, punciones lumbares, biopsias, cierre de ostomías ni cirugías para manejo de complicaciones. En caso de múltiples intervenciones simultáneas, elija la más representativa para el tipo de cáncer y recuerde que no se reportan cirugías propuestas que no se llevaron a cabo.",
                "VAR75_NumeroCirugiasSometidoUsuarioPeriodoReporteActual": "Registre la cantidad total de tiempos quirúrgicos a los que el usuario fue sometido en el periodo de reporte, incluyendo intervenciones por complicaciones derivadas de la cirugía inicial. Asegúrese de contabilizar el número de ingresos a quirófano y no la cantidad de códigos CUPS ejecutados en un mismo procedimiento. Use 98 (No Aplica) si en la variable 74 marcó la opción 2 por no haber recibido cirugía.",
                "VAR76_FechaRealizacionPrimeraCirugiaReporte": "Registre la fecha en que se realizó el procedimiento quirúrgico más representativo del periodo en formato AAAA-MM-DD, utilizando el día 15 si solo dispone de información sobre el año y el mes. Use 1845-01-01 (No Aplica) únicamente si en la variable 74 seleccionó la opción 2 por no haber recibido intervenciones quirúrgicas durante el periodo de reporte.",
                "VAR77_CodigoIPSRealizoPrimeraCirugiaCorte": "Registre el código REPS de 12 dígitos (incluyendo el cero inicial) de la institución donde se realizó el procedimiento quirúrgico. Use 96 si la cirugía fue realizada fuera del país y 98 (No Aplica) si en la variable 74 marcó la opción 2 por no haber recibido intervenciones en el periodo.",
                "VAR78_CodigoPrimeraCirugia": "Registre el código del procedimiento que tenga mayor relación con el tratamiento del cáncer o el que represente la mayor complejidad técnica dentro del tiempo quirúrgico. Incluya en este campo los códigos correspondientes a fotoféresis, fototerapia, crioterapia y radiofrecuencia si fueron realizados. Use 98 (No Aplica) únicamente si en la variable 74 seleccionó la opción 2 por no haber recibido intervenciones quirúrgicas.",
                "VAR79_UbicacionTemporalPrimeraCirugiaOncologico": "Registre 1 si el procedimiento forma parte del manejo inicial curativo del cáncer, 5 si corresponde al manejo de una recaída, o 6 si el objetivo es el tratamiento de enfermedad metastásica. Use 98 (No Aplica) únicamente si en la variable 74 marcó la opción 2 por no haber recibido intervenciones quirúrgicas durante el periodo de reporte.",
                "VAR80_FechaRealizacionUltimoProcedimientoQuirurgico": "Registre la fecha de la última intervención quirúrgica del periodo en formato AAAA-MM-DD, utilizando el día 15 si solo conoce el año y el mes. Use 1845-01-01 (No Aplica) si el paciente solo tuvo una cirugía en el periodo o si no se realizó ninguna. Asegúrese de no duplicar aquí la fecha reportada en la variable 76 correspondiente a la primera cirugía.",
                "VAR81_MotivoHaberRealizadoUltimaIntervencionQuirurgica": "Registre 1 si la intervención fue para complementar el tratamiento oncológico (sin relación con complicaciones), 2 si fue por complicaciones de cirugías previas, 3 por complicaciones de otras condiciones médicas, 5 si coinciden los motivos 1 y 3, o 6 si coinciden los motivos 2 y 3. Use 98 (No Aplica) si el paciente solo tuvo una cirugía en el periodo or si no se realizó ninguna.",
                "VAR82_CodigoIPSRealizaUltimoProcedimientosQuirugicos": "Registre el código REPS de 12 dígitos (incluyendo el cero inicial) de la IPS donde se realizó el último procedimiento quirúrgico del periodo. Use 98 (No Aplica) si el paciente solo tuvo una intervención en este ciclo o si no se realizó ninguna cirugía.",
                "VAR83_CodigoUltimaCirugia": "Registre el código del procedimiento que tenga mayor relación con el tratamiento del cáncer o el que represente la mayor complejidad técnica dentro de este último tiempo quirúrgico. Use 98 (No Aplica) únicamente si el paciente solo tuvo una intervención en el periodo o si no se realizó ninguna cirugía.",
                "VAR84_UbicacionTemporalUltimaCirugiaOncologico": "Registre 1 si este procedimiento final fue parte del manejo inicial curativo, 5 si correspondió al tratamiento de una recaída o 6 si fue para el manejo de enfermedad metastásica. Use 98 (No Aplica) si el paciente solo tuvo una intervención en el periodo o si no se realizó ninguna cirugía (Variable 74 = 2).",
                "VAR85_EstadoVitalFinalizarUnicaUltimaCirugia": "Registre 1 si el paciente se encuentra vivo tras el procedimiento o 2 si falleció. Use 98 (No Aplica) únicamente si en la variable 74 seleccionó la opción 2 por no haber recibido intervenciones quirúrgicas durante el periodo de reporte.",
                "VAR86_RecibioUsuarioAlgunTipoRadioterapiaCorteActual": "Registre 1 si el paciente recibió efectivamente algún tipo de radioterapia durante este periodo. Use 98 (No Aplica) si no recibió el tratamiento, asegurándose de que las variables subsiguientes (87 a 105) también se marquen como 'No Aplica'. Tenga en cuenta que no se deben reportar tratamientos propuestos que no llegaron a suministrarse.",
                "VAR87_NumeroEsquemasRadioterapiaSuministradosCorteActual": "Registre el valor numérico del total de sesiones de radioterapia (interna o externa) efectivamente suministradas durante el periodo de reporte actual. Asegúrese de que la cantidad coincida con los soportes clínicos, ya que este dato será validado contra las sesiones ordenadas durante la auditoría. Use 98 (No Aplica) si no recibió este tratamiento.",
                "VAR88_FechaInicioPrimerUnicoEsquemaRadioterapia": "Registre la fecha de inicio de cualquier modalidad de radioterapia recibida en este periodo en formato AAAA-MM-DD. Si solo dispone del mes y el año, use el día 15. Registre 1845-01-01 si no aplica por no haber recibido este tratamiento.",
                "VAR89_UbicacionTemporalPrimerUnicoEsquemaRadioterapia": "Registre 1 si fue externa, 2 si fue interna (braquiterapia), 3 si fue metabólica, 4 si fue una combinación de externa e interna, 5 si fue combinación de externa y metabólica, o 6 si fue combinación de interna y metabólica, usando siempre el código 98 (No Aplica) si en la variable 86 marcó que no recibió el tratamiento en este periodo.",
                "VAR90_TipoRadioterapiaAplicadaPrimerUnicoEsquema": "Registre el código CUPS del procedimiento de radioterapia suministrado durante el periodo de reporte, consultando siempre el listado del archivo operativo vigente de la Cuenta de Alto Costo (CAC), y utilice el código 98 (No Aplica) únicamente si en la variable 86 se indicó que el paciente no recibió este tipo de tratamiento.",
                "VAR91_NumeroIPSSuministranPrimerUnicoEsquemaRadioterapia": "Registre la cantidad total de IPS que participaron directamente en la administración de las dosis de radioterapia durante el periodo de reporte actual y utilice el código 98 (No Aplica) si el paciente no recibió este tipo de tratamiento según lo registrado en la variable 86.",
                "VAR92_CodigoIPS1SuministraRadioterapia": "Registre el código de 12 dígitos (incluyendo el cero inicial) consultado en la página del REPS de la IPS donde se administró el tratamiento, use el código 96 si la radioterapia se realizó fuera del país o el código 98 (No Aplica) si el paciente no recibió este tratamiento durante el periodo de reporte.",
                "VAR93_CodigoIPS2SuministraRadioterapia": "Registre el código de 12 dígitos (incluyendo el cero inicial) consultado en la página del REPS de la IPS donde se administró el tratamiento, use el código 96 si la radioterapia se realizó fuera del país o el código 98 (No Aplica) si el paciente no recibió este tratamiento durante el periodo de reporte.",
                "VAR94_FechaFinalizacionPrimerUnicoEsquemaRadioterapia": "Registre la fecha en que terminó el tratamiento en formato AAAA-MM-DD usando el día 15 si solo conoce el mes y el año, use el código 1800-01-01 para esquemas que aún se encuentran en curso al cierre del periodo de reporte y el código 1845-01-01 (No Aplica) si el paciente no recibió radioterapia en este ciclo.",
                "VAR95_CaracteristicasActualesPrimerEsquemaRadioterapia": "Registre el código 1 si el paciente completó la dosis total prescrita, el código 2 si el tratamiento se dio por terminado con una dosis incompleta debido a cualquier motivo clínico o administrativo, el código 3 si el esquema sigue incompleto pero el paciente continúa asistiendo activamente a sus sesiones, o el código 98 (No Aplica) si el usuario no recibió radioterapia durante este periodo de reporte.",
                "VAR96_MotivoFinalizacionPrimerEsquemaRadioterapia": "Registre el código 1 si fue por toxicidad, el código 2 por otros motivos médicos, el código 3 por fallecimiento, el código 4 por cambio de EPS, el código 5 por decisión o abandono del usuario, el código 6 por otros motivos administrativos, el código 7 por causas no contempladas previamente, o el código 98 (No Aplica) si el paciente completó el esquema, sigue en tratamiento o no recibió radioterapia.",
                "VAR97_FechaInicioUltimoEsquemaRadioterapia": "Registre la fecha exacta en la que el usuario comenzó su esquema de radioterapia más reciente dentro del periodo de reporte utilizando el formato AAAA-MM-DD, emplee el día 15 si solo dispone de información sobre el mes y el año, y consigne el código 1845-01-01 (No Aplica) si el paciente no recibió ningún tipo de radioterapia en este ciclo.",
                "VAR98_UbicacionTemporalUltimoEsquemaRadioterapia": "Registre el código 1 si corresponde a neoadyuvancia prequirúrgica, el 2 si es un tratamiento curativo exclusivo sin cirugía, el 3 para adyuvancia postquirúrgica, el 11 para manejo de recaída, el 12 para enfermedad metastásica, el 13 para manejo paliativo sin evidencia de las anteriores, o el código 98 (No Aplica) si el paciente no recibió radioterapia durante este periodo de reporte.",
                "VAR99_TipoRadioterapiaAplicadaUltimoEsquemaRadioterapia": "Registre el código alfanumérico correspondiente al último procedimiento de radioterapia suministrado según el listado del archivo operativo vigente de la Cuenta de Alto Costo (CAC), utilizando el código 98 (No Aplica) únicamente si el paciente no recibió este tipo de tratamiento durante el periodo de reporte actual.",
                "VAR100_NumeroIPSSuministranUltimoEsquemaRadioterapia": "Registre la cantidad total de IPS que participaron en la administración de las dosis de este último esquema de radioterapia durante el periodo de reporte actual y utilice el código 98 (No Aplica) si el paciente no recibió este tipo de tratamiento según lo registrado previamente.",
                "VAR101_CodigoIPS1SuministraRadioterapia1": "Registre el código de 12 dígitos, incluyendo el cero inicial, que identifica a la IPS donde se administró el último esquema de radioterapia según el registro del REPS, y consigne el código 98 (No Aplica) si el paciente no recibió dicho tratamiento durante el periodo de reporte actual..",
                "VAR102_CodigoIPS2SuministraRadioterapia1": "Registre el código de 12 dígitos, incluyendo el cero inicial, de la IPS donde se administró el último esquema de radioterapia según lo dispuesto en el registro del REPS, y utilice el código 98 (No Aplica) si el paciente no recibió este tratamiento durante el periodo de reporte.",
                "VAR103_FechaFinalizacionUltimoEsquemaRadioterapia": "Registre la fecha de terminación del tratamiento más reciente en formato AAAA-MM-DD utilizando el día 15 si solo dispone del mes y el año, emplee el código 1800-01-01 si el esquema de radioterapia aún se encuentra en curso al momento del cierre y consigne 1845-01-01 (No Aplica) si el paciente no recibió radioterapia durante este periodo de reporte.",
                "VAR104_CaracteristicasActualesUltimoEsquemaRadioterapia": "Registre el código 1 si el paciente recibió la dosis completa prescrita, el código 2 si el esquema se dio por terminado con una dosis incompleta debido a cualquier circunstancia, el código 3 si el tratamiento aún no ha finalizado y el paciente continúa asistiendo a sus sesiones, o el código 98 (No Aplica) si el usuario no recibió radioterapia durante este periodo de reporte.",
                "VAR105_MotivoFinalizacionUltimoEsquemaRadioTerapia": "Registre el código 1 si la interrupción fue por toxicidad, el código 2 por otros motivos médicos, el código 3 por fallecimiento, el código 4 por cambio de EPS, el código 5 por decisión o abandono del usuario, el código 6 por otros motivos administrativos, el código 7 por causas no contempladas previamente, o el código 98 (No Aplica) si el paciente completó la dosis, continúa en tratamiento o no recibió radioterapia.",
                "VAR106_RecibioUsuarioTrasplanteCelulasProgenitoras": "Registre el código 1 si el paciente efectivamente recibió el trasplante durante el periodo de reporte actual, o el código 98 (No Aplica) si no se realizó el procedimiento, asegurándose de que las variables 107 a 110 también se marquen como No Aplica. Tenga en cuenta que no debe reportar trasplantes propuestos que no llegaron a ejecutarse, ni trasplantes de órganos sólidos u otros procedimientos ajenos a los progenitores hematopoyéticos.",
                "VAR107_TipoTrasplanteRecibido": "Registre el código 1 si el trasplante fue autólogo, el código 2 si fue alogénico de donante idéntico relacionado, el código 3 si fue alogénico de donante no idéntico relacionado, el código 4 si fue alogénico de donante idéntico no relacionado, el código 5 si fue alogénico de donante no idéntico no relacionado, el código 6 si fue alogénico de cordón umbilical idéntico familiar, el código 7 si fue alogénico de cordón umbilical idéntico no familiar, el código 8 si fue alogénico de cordón no idéntico no familiar, el código 9 si fue alogénico de dos unidades de cordón, o use el código 98 (No Aplica) si en la variable anterior se indicó que no se realizó el procedimiento.",
                "VAR108_UbicacionTemporalTrasplanteOncologico": "Registre el código 95 si el procedimiento se realizó debido a una recaída en un paciente que previamente había alcanzado criterios de remisión, el código 96 si fue por refractariedad en un paciente que no logró remisión a pesar del manejo inicial, el código 97 si el trasplante se efectuó como parte de un esquema de consolidación programado, o el código 98 (No Aplica) si no se realizó el trasplante durante el periodo de reporte actual.",
                "VAR109_FechaTrasplante": "Registre la fecha exacta en la que se llevó a cabo el procedimiento utilizando el formato AAAA-MM-DD y emplee el código 1845-01-01 (No Aplica) si el paciente no recibió un trasplante durante el periodo de reporte actual.",
                "VAR110_CodigoIPSRealizoTrasplante": "Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la IPS donde se realizó el trasplante de progenitores hematopoyéticos según el registro del REPS, utilice el código 96 si el procedimiento se llevó a cabo fuera del país o el código 98 (No Aplica) si el paciente no recibió este tratamiento durante el periodo de reporte actual..",
                "VAR111_UsuarioRecibioCirugiaReconstructiva": "Registre el código 1 si el paciente efectivamente recibió este procedimiento durante el periodo de reporte, o el código 98 (No Aplica) si no se realizó la cirugía, asegurándose de que las variables 112 y 113 también se marquen como No Aplica. Tenga en cuenta que si se realizó una cirugía curativa y una reconstructiva en el mismo tiempo quirúrgico, solo debe reportar la cirugía curativa en las variables 76 u 80 según corresponda, y no debe registrar cirugías reconstructivas propuestas que no llegaron a ejecutarse.",
                "VAR112_FechaCirugia": "Registre la fecha exacta en que se llevó a cabo el procedimiento utilizando el formato AAAA-MM-DD, emplee el día 15 si solo dispone de información sobre el mes y el año, y consigne el código 1845-01-01 (No Aplica) si el paciente no recibió este tipo de intervención durante el periodo de reporte actual.",
                "VAR113_CodigoIPSRealizoCirugiaReconstructiva": "Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la IPS donde se realizó el procedimiento según la base de datos del REPS, o consigne el código 98 (No Aplica) si el paciente no recibió esta intervención durante el periodo de reporte actual.",
                "VAR114_UsuarioValoradoConsultaProcedimientoPaliativo": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con la especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Tenga en cuenta que esta valoración aplica para cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas, y que no deben reportarse consultas o procedimientos propuestos que no llegaron a ejecutarse.",
                "VAR114_1_UsuarioRecibioConsultaProcedimientoCuidadoPaliativ": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR114_2_UsuarioRecibioConsultaCuidadoPaliativo": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR114_3_UsuarioRecibioConsultaPaliativoEspecialista": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR114_4_UsuarioRecibioConsultaPaliativoGeneral": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR114_5_UsuarioRecibioConsultaPaliativoTrabajoSocial": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR114_6_UsuarioRecibioConsultaPaliativoNoEspecializado": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional con especialidad en cuidados paliativos durante el periodo de reporte, o el código 2 si no recibió dicha atención. Recuerde que esta valoración es aplicable a cualquier tipo de cáncer y en cualquier estadio de la enfermedad, no siendo exclusiva de fases avanzadas o terminales.",
                "VAR115_FechaPrimeraConsultaPaliativoCorte": "Registre la fecha exacta de la primera interconsulta o intervención realizada por el especialista en cuidados paliativos utilizando el formato AAAA-MM-DD. Si solo dispone del mes y el año, registre el día 15, y emplee el código 1845-01-01 (No Aplica) si el paciente no recibió esta atención durante el periodo de reporte.",
                "VAR116_CodigoIPSRecibioPrimeraValoracionPaliativo": "Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la IPS donde se realizó la primera valoración o procedimiento por cuidados paliativos, según lo registrado en la plataforma REPS. Utilice el código 98 (No Aplica) si el paciente no recibió esta atención durante el periodo de reporte actual.",
                "VAR117_HaSidoValoradoUsuarioPorServicioPsiquiatria": "Registre el código 1 si el paciente fue efectivamente valorado por un especialista en psiquiatría durante el periodo de reporte, el código 2 si la interconsulta fue ordenada pero aún se encuentra pendiente de realizarse, o el código 98 (No Aplica) si no se ha generado una orden médica para dicha valoración.",
                "VAR118_FechaPrimeraConsultaServicioPsiquiatria": "Registre la fecha exacta en la que se realizó la primera interconsulta con el especialista en psiquiatría utilizando el formato AAAA-MM-DD. En caso de conocer únicamente el mes y el año, consigne el día 15; si el paciente no ha recibido esta valoración o no aplica según el registro anterior, utilice el código 1845-01-01 (No Aplica).",
                "VAR119_CodigoIPSRecibioPrimeraValoracionPsiquiatria": "Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la IPS donde se llevó a cabo la primera interconsulta por psiquiatría, según la base de datos del REPS. Utilice el código 98 (No Aplica) si el paciente no recibió esta valoración durante el periodo de reporte.",
                "VAR120_FueValoradoUsuarioPorProfesionalNutricion": "Registre el código 1 si el paciente fue efectivamente valorado por un profesional en nutrición durante el periodo de reporte, el código 2 si la consulta fue ordenada pero aún se encuentra pendiente de realizarse, o el código 98 (No Aplica) si no se ha generado una orden médica para dicha valoración.",
                "VAR121_FechaConsultaInicialNutricionCorte": "Registre la fecha exacta en la que se llevó a cabo la primera atención por el servicio de nutrición utilizando el formato AAAA-MM-DD. Si solo dispone de información sobre el mes y el año, consigne el día 15; en caso de que el paciente no haya recibido esta valoración, utilice el código 1845-01-01 (No Aplica).",
                "VAR122_CodigoIPSRecibioValoracionNutricion": "Código habilitación IPS valoración por nutrición: Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la IPS donde se realizó la primera atención por nutrición, según la base de datos del REPS. Utilice el código 98 (No Aplica) si el paciente no recibió esta valoración durante el periodo de reporte.",
                "VAR123_UsuarioRecibioSoporteNutricional": "Registre el código 1 si el paciente recibió soporte nutricional enteral (vía sonda directamente al sistema gastrointestinal), el código 2 si recibió soporte parenteral (vía venosa), el código 3 si recibió ambos tipos de soporte, o el código 4 si no recibió ninguno. Nota importante: Para este registro no es válido el reporte de fórmulas nutricionales de administración oral.",
                "VAR124_UsuarioRecibidoTerapiasComplementariasRehabilitaci": "Registre el código de 12 dígitos (incluyendo el cero inicial) que identifica a la institución prestadora de salud donde se realizó la atención de terapia física, de lenguaje u ocupacional, según la base de datos del REPS. Utilice el código 98 (No Aplica) si el paciente no recibió ninguna de estas terapias durante el periodo de reporte.",
                "VAR125_TipoTratamientoRecibiendoUsuarioFechaCorte": "Registre el código 1 si recibió radioterapia, el 2 para terapia sistémica, el 3 para cirugía desde el 1 de noviembre de 2024, el 4 si recibió 1 y 2, el 5 para 1 y 3, el 6 para 2 y 3, el 7 para manejo expectante, el 8 para seguimiento tras tratamiento, el 9 para antecedente con seguimiento, el 10 si recibió las tres terapias principales, el 11 para cuidado paliativo, o el 98 (No Aplica) por fallecimiento, abandono o desafiliación.",
                "VAR126_ResultadoFinalManejoOncologicoCorte": "Registre el código 1 para pseudoprogresión por inmunoterapia, el 2 si existe progresión o recaída con crecimiento tumoral ≥ 25%, el 3 para respuesta parcial con disminución tumoral ≥ 30%, el 4 para respuesta completa con desaparición de evidencia clínica, el 5 para enfermedad estable sin cambios significativos, el 6 por abandono o alta voluntaria, el 7 si el paciente está en seguimiento por antecedente con atención documentada, el 8 si está pendiente de iniciar tratamiento tras el diagnóstico, el 97 si continúa en tratamiento inicial, el 98 si continúa en tratamiento de recaída, o el 99 si el paciente falleció o está desafiliado.",
                "VAR127_EstadoVitalFinalizarCorte": "Estado vital a fecha corte (vivo/fallecido).",
                "VAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior": "Registre 0 si no hay cambios, 1 para ingresos con diagnóstico previo, 2 para diagnósticos nuevos en el periodo, 3 para diagnósticos antiguos omitidos, 4 si falleció, 5 por desafiliación, 6 para eliminar por auditoría, 7 por alta voluntaria, 8 por cambio de ID, 9 por abandono, 10 si falleció sin reporte previo, 11 por traslado de IPS, 12 por cánceres múltiples, 13 si se desafilió sin reporte previo, 15 para migrantes venezolanos, 16 por ajuste de CIE-10, 17 para casos externos sin gestión, 18 para diagnósticos descartados y 19 para traslados con glosa previa.",
                "VAR129_NovedadClinicaUsuarioFechaCorte": "Registre el código 1 si está en manejo inicial curativo, el 3 si finalizó tratamiento y está en seguimiento, el 8 por abandono, el 9 si firmó alta voluntaria, el 10 para manejo expectante pretratamiento, el 11 si recibe manejo paliativo por metástasis o recaída, o el 12 si el usuario falleció o se encuentra desafiliado.",
                "VAR130_FechaDesafiliacionEPS": "Registre la fecha exacta en la que el paciente dejó de estar afiliado a la EAPB utilizando el formato AAAA-MM-DD, o consigne el código 1845-01-01 (No Aplica) si el usuario permanece afiliado a la entidad al cierre del periodo de reporte.",
                "VAR131_FechaMuerte": "Registre la fecha exacta del deceso en formato AAAA-MM-DD o utilice el código 1845-01-01 si el usuario no falleció o se desconoce su estado vital; tenga en cuenta que si el paciente está fallecido y desafiliado prima la fecha de muerte, y si el reporte de BDUA como fallecido es erróneo, deberá disponer de los soportes de atención y afiliación para la auditoría.",
                "VAR132_CausaMuerte": "Registre el código 1 si el deceso estuvo asociado directamente al cáncer, el 2 si fue por una patología clínica no relacionada con la enfermedad oncológica, el 3 si se debió a una causa externa, el 4 si la causa no ha sido determinada, o el 98 (No Aplica) si el paciente se encuentra vivo o si aún se desconoce su estado vital actual.",
                "VAR133_SerialBDUA": "Registre el código único serial de identificación BDUA-BDEX-PVS asignado al paciente por el Ministerio de Salud y Protección Social para garantizar la trazabilidad del usuario en las bases de datos oficiales.",
                "VAR134_V134FechaCorte": "Fecha fija del corte del reporte (para este archivo, el corte es 2025-01-01)."
        };

        const OBLIG_HEMO = ["VAR1_PrimerNombre", "VAR2_SegundoNombre", "VAR3_PrimerApellido", "VAR4_SegundoApellido", "VAR5_TipoIdentificacion", "VAR6_Identificacion", "VAR7_FechaNacimiento", "VAR23_TipoDeficienciaDiagnosticada", "VAR24_SeveridadSegunNivelFactor", "VAR25_ActividadCoagulanteDelFactor", "VAR45_HemorragiaOral"];
        const OBLIG_CANCER = [
                "VAR1_PrimerNombreUsuario", "VAR2_SegundoNombreUsuario", "VAR3_PrimerApellidoUsuario",
                "VAR4_SegundoApellidoUsuario", "VAR5_TipoIdentificacionUsuario", "VAR6_NumeroIdentificacionUsuario",
                "VAR7_FechaNacimiento", "VAR8_Sexo", "VAR9_Ocupacion", "VAR10_RegimenAfiliacionSGSSS",
                "VAR11_idEPS", "VAR12_CodigoPertenenciaEtnica", "VAR13_GrupoPoblacional",
                "VAR14_MunicipioResidencia", "VAR15_NumeroTelefonicopaciente", "VAR16_FechaAfiliacionEPSRegistra",
                "VAR17_NombreNeoplasia", "VAR18_FechaDx", "VAR21_TipoEstudioRealizoDiagnostico",
                "VAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual", "VAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior"
        ];

        const VARS_HEMO = ["VAR1_PrimerNombre", "VAR2_SegundoNombre", "VAR3_PrimerApellido", "VAR4_SegundoApellido", "VAR5_TipoIdentificacion", "VAR6_Identificacion", "VAR7_FechaNacimiento", "VAR8_Sexo", "VAR9_Ocupacion", "VAR10_Regimen", "VAR11_idEPS", "VAR12_idPertenenciaEtnica", "VAR13_idGrupoPoblacional", "VAR14_MunicipioDeResidencia", "VAR15_TelefonoPaciente", "VAR16_FechaAfiliacion", "VAR17_GestacionAlCorte", "VAR18_EnPlanificacion", "VAR19_EdadUsuarioMomentoDx", "VAR20_MotivoPruebaDx", "VAR21_FechaDx", "VAR22_IpsRealizaConfirmacionDx", "VAR23_TipoDeficienciaDiagnosticada", "VAR24_SeveridadSegunNivelFactor", "VAR25_ActividadCoagulanteDelFactor", "VAR26_AntecedentesFamilares", "VAR27_FactorRecibidoTtoIni", "VAR28_EsquemaTtoIni", "VAR29_FechaDeIniPrimerTto", "VAR30_FactorRecibidoTtoAct", "VAR31_EsquemaTtoAct", "VAR32_Peso", "VAR32_1_Dosis", "VAR32_2_FrecuenciaPorSemana", "VAR32_3_UnidadesTotalesEnElPeriodo", "VAR32_4_AplicacionesDelFactorEnElPeriodo", "VAR33_ModalidadAplicacionTratamiento", "VAR34_ViaDeAdministracion", "VAR35_CodigoCumFactorPosRecibido", "VAR36_CodigoCumFactorNoPosRecibido", "VAR37_CodigoCumDeOtrosTratamientosUtilizadosI", "VAR38_CodigoCumDeOtrosTratamientosUtilizadosII", "VAR39_IpsSeguimientoActual", "VAR40_Hemartrosis", "VAR40_1_CantHemartrosisEspontaneasUlt12Meses", "VAR40_2_CantHemartrosisTraumaticasUlt12Meses", "VAR41_HemorragiaIlioPsoas", "VAR42_HemorragiaDeOtrosMusculosTejidos", "VAR43_HemorragiaIntracraneal", "VAR44_HemorragiaEnCuelloOGarganta", "VAR45_HemorragiaOral", "VAR46_OtrasHemorragias", "VAR47_1_CantOtrasHemorragiasEspontaneasDiffHemartrosis", "VAR47_2_CantOtrasHemorragiasTraumaticasDiffHemartrosis", "VAR47_3_CantOtrasHemorragAsocProcedimientoDiffHemartrosis", "VAR48_PresenciaDeInhibidor", "VAR48_1_FechaDeterminacionTitulosInhibidor", "VAR48_2_HaRecibidoITI", "VAR48_3_EstaRecibiendoITI", "VAR48_4_DiasEnITI", "VAR49_ArtropatiaHemofilicaCronica", "VAR49_1_CantArticulacionesComprometidas", "VAR50_UsuarioInfectadoPorVhc", "VAR51_UsuarioInfectadoPorVhb", "VAR52_UsuarioInfectadoPorVih", "VAR53_Pseudotumores", "VAR54_Fracturas", "VAR55_Anafilaxis", "VAR55_1_FactorAtribuyeReaccionAnafilactica", "VAR56_CantidadReemplazosArticulares", "VAR56_1_ReemplazosArticularesEnPeriodoDeCorte", "VAR57_LiderAtencion", "VAR57_1_ConsultasConHematologo", "VAR57_2_ConsultasConOrtopedista", "VAR57_3_IntervencionProfesionalEnfermeria", "VAR57_4_ConsultasOdontologo", "VAR57_5_ConsultasNutricionista", "VAR57_6_IntervencionTrabajoSocial", "VAR57_7_ConsultasConFisiatria", "VAR57_8_ConsultasConPsicologia", "VAR57_9_IntervencionQuimicoFarmaceutico", "VAR57_10_IntervencionFisioterapia", "VAR57_11_PrimerNombreMedicoTratantePrincipal", "VAR57_12_SegundoNombreMedicoTratantePrincipal", "VAR57_13_PrimerApellidoMedicoTratantePrincipal", "VAR57_14_SegundoApellidoMedicoTratantePrincipal", "VAR58_CantAtencionesUrgencias", "VAR59_CantEventosHospitalarios", "VAR60_CostoFactoresPos", "VAR61_CostoFactoresNoPos", "VAR62_CostoTotalManejo", "VAR63_CostoIncapacidadesLaborales", "VAR64_Novedades", "VAR64_1_CausaMuerte", "VAR64_2_FechaMuerte", "VAR65_SerialBDUA", "VAR66_V66FechaCorte"];

        const VARS_CANCER = ["VAR1_PrimerNombreUsuario", "VAR2_SegundoNombreUsuario", "VAR3_PrimerApellidoUsuario", "VAR4_SegundoApellidoUsuario", "VAR5_TipoIdentificacionUsuario", "VAR6_NumeroIdentificacionUsuario", "VAR7_FechaNacimiento", "VAR8_Sexo", "VAR9_Ocupacion", "VAR10_RegimenAfiliacionSGSSS", "VAR11_idEPS", "VAR12_CodigoPertenenciaEtnica", "VAR13_GrupoPoblacional", "VAR14_MunicipioResidencia", "VAR15_NumeroTelefonicopaciente", "VAR16_FechaAfiliacionEPSRegistra", "VAR17_NombreNeoplasia", "VAR18_FechaDx", "VAR19_FechaNotaRemisionMedico", "VAR20_FechaIngresoInstitucionRealizo", "VAR21_TipoEstudioRealizoDiagnostico", "VAR22_MotivoUsuarioNOTuvoDiagnostico", "VAR23_FechaRecoleccionMuestraEstudioHistopatologico", "VAR24_FechaInformHistopatologicoValido", "VAR25_CodigoValidoHabilitacionIPS", "VAR26_FechaPrimeraConsultaMedicoTratante", "VAR27_HistologiaTumorMuestraBiopsia", "VAR28_GradoDiferenciacionTumorSolidoMaligno", "VAR29_SiEsTumorSolido", "VAR30_FechaRealizoEstaEstadificacion", "VAR31_ParaCancerMama", "VAR32_ParaCancerMamaFechaRealizacion", "VAR33_ParaCancerMamaResultadoPrimera", "VAR34_ParaCancerColorrectalEstadificacionDukes", "VAR35_FechaEstadificacionDukes", "VAR36_EstadificacionLinfomaClinicaHodgkin", "VAR37_CancerProstataValorClasificacionGleason", "VAR38_ClasificacionRiesgoLeucemiasLinfomas", "VAR39_FechaClasificacionRiesgo", "VAR40_ObjetivoTratamientoMedicoInic", "VAR41_ObjetivoIntervencionMedicaPeriodoReporte", "VAR42_TieneAntecedenteOtroCancerPrimario", "VAR43_FechaDiagnosticoOtroCancerPrimario", "VAR44_TipoCancerAntecedente", "VAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual", "VAR46_FaseQuimioterapiaRecibioUsuarioCorte", "VAR46_1_UsuarioRecibioCorteQuimioterapiaPrefase", "VAR46_2_UsuarioRecibioCorteFaseQuimioterapiaInduccion", "VAR46_3_UsuarioRecibioCorteFaseQuimioterapIntensificacion", "VAR46_4_UsuarioRecibioCorteFaseQuimioterapiaConsolidacion", "VAR46_5_UsuarioRecibioCorteFaseQuimioterapiaReinduccion", "VAR46_6_UsuarioRecibiCorteFaseQuimioterapiaMantenimiento", "VAR46_7_UsuarioRecibioCorteFaseQuimioterapiaMantenimientoL", "VAR46_8_UsuarioRecibiCorteOtraFaseQuimioterapia", "VAR47_NumeroCiclosIniciadosPeriodoReporteActual", "VAR48_UbicacionTemporalPrimerCicloRelacionOncologico", "VAR49_FechaInicioPrimerCicloQuimioterapiaCorte", "VAR50_NumeroIPSPrimerCicloCorte", "VAR51_CodigoIPS1PrimerCicloCorte", "VAR52_CodigoIPS2PrimerCicloCorte", "VAR53_MedicamentosAntineoplasicosPrimerCicloCorte", "VAR53_1_Medicamentoadm1PrimerEsquema", "VAR53_2_Medicamentoadm2PrimerEsquema", "VAR53_3_Medicamentoadm3PrimerEsquema", "VAR53_4_Medicamentoadm4PrimerEsquema", "VAR53_5_Medicamentoadm5PrimerEsquema", "VAR53_6_Medicamentoadm6PrimerEsquema", "VAR53_7_Medicamentoadm7PrimerEsquema", "VAR53_8_Medicamentoadm8PrimerEsquema", "VAR53_9_Medicamentoadm9PrimerEsquema", "VAR54_MedicamentoNoPOS1AdministradoUsuarioPrimerCiclo", "VAR55_MedicamentoNoPOS2AdministradoUsuarioPrimerCiclo", "VAR56_MedicamentoNoPOS3AdministradoUsuarioPrimerCiclo", "VAR57_RecibioQuimioterapiaIntratecalPrimerCiclo", "VAR58_FechaFinalizacionPrimerCicloCorte", "VAR59_CaracteristicasActualesPrimerCicloCorte", "VAR60_MotivoFinalizacionPrimerCiclo", "VAR61_UbicacionTemporalUltimoCicloCorteOncologico", "VAR62_FechaInicioUltimoCicloQuimioterapiaCorte", "VAR63_NumeroIPSSuministranUltimoCicloCorte", "VAR64_CodigoIPS1SuministraUltimoCicloReporte", "VAR65_CodigoIPS2SuministraUltimoCicloReporte", "VAR66_MedicamentosAntineoplasicosEspecialistaCancer", "VAR66_1_Medicamentoadm1UltimoEsquema", "VAR66_2_Medicamentoadm2UltimoEsquema", "VAR66_3_Medicamentoadm3UltimoEsquema", "VAR66_4_Medicamentoadm4UltimoEsquema", "VAR66_5_Medicamentoadm5UltimoEsquema", "VAR66_6_Medicamentoadm6UltimoEsquema", "VAR66_7_Medicamentoadm7UltimoEsquema", "VAR66_8_Medicamentoadm8UltimoEsquema", "VAR66_9_Medicamentoadm9UltimoEsquema", "VAR67_MedicamentoNoPOS1AdministradoUsuarioUltimoCiclo", "VAR68_MedicamentoNoPOS2AdministradoUsuarioUltimoCiclo", "VAR69_MedicamentoNoPOS3AdministradoUsuarioUltimoCiclo", "VAR70_RecibioQuimioterapiaIntratecalUltimoCicloCorte", "VAR71_FechaFinalizacionCicloUltimo", "VAR72_CaracteristicasActualesUltimoCicloCorte", "VAR73_MotivoFinalizacionPrematuraUltimoCiclo", "VAR74_SometidoUsuarioCirugiasCurativasPaliativas", "VAR75_NumeroCirugiasSometidoUsuarioPeriodoReporteActual", "VAR76_FechaRealizacionPrimeraCirugiaReporte", "VAR77_CodigoIPSRealizoPrimeraCirugiaCorte", "VAR78_CodigoPrimeraCirugia", "VAR79_UbicacionTemporalPrimeraCirugiaOncologico", "VAR80_FechaRealizacionUltimoProcedimientoQuirurgico", "VAR81_MotivoHaberRealizadoUltimaIntervencionQuirurgica", "VAR82_CodigoIPSRealizaUltimoProcedimientosQuirugicos", "VAR83_CodigoUltimaCirugia", "VAR84_UbicacionTemporalUltimaCirugiaOncologico", "VAR85_EstadoVitalFinalizarUnicaUltimaCirugia", "VAR86_RecibioUsuarioAlgunTipoRadioterapiaCorteActual", "VAR87_NumeroEsquemasRadioterapiaSuministradosCorteActual", "VAR88_FechaInicioPrimerUnicoEsquemaRadioterapia", "VAR89_UbicacionTemporalPrimerUnicoEsquemaRadioterapia", "VAR90_TipoRadioterapiaAplicadaPrimerUnicoEsquema", "VAR91_NumeroIPSSuministranPrimerUnicoEsquemaRadioterapia", "VAR92_CodigoIPS1SuministraRadioterapia", "VAR93_CodigoIPS2SuministraRadioterapia", "VAR94_FechaFinalizacionPrimerUnicoEsquemaRadioterapia", "VAR95_CaracteristicasActualesPrimerEsquemaRadioterapia", "VAR96_MotivoFinalizacionPrimerEsquemaRadioterapia", "VAR97_FechaInicioUltimoEsquemaRadioterapia", "VAR98_UbicacionTemporalUltimoEsquemaRadioterapia", "VAR99_TipoRadioterapiaAplicadaUltimoEsquemaRadioterapia", "VAR100_NumeroIPSSuministranUltimoEsquemaRadioterapia", "VAR101_CodigoIPS1SuministraRadioterapia1", "VAR102_CodigoIPS2SuministraRadioterapia1", "VAR103_FechaFinalizacionUltimoEsquemaRadioterapia", "VAR104_CaracteristicasActualesUltimoEsquemaRadioterapia", "VAR105_MotivoFinalizacionUltimoEsquemaRadioTerapia", "VAR106_RecibioUsuarioTrasplanteCelulasProgenitoras", "VAR107_TipoTrasplanteRecibido", "VAR108_UbicacionTemporalTrasplanteOncologico", "VAR109_FechaTrasplante", "VAR110_CodigoIPSRealizoTrasplante", "VAR111_UsuarioRecibioCirugiaReconstructiva", "VAR112_FechaCirugia", "VAR113_CodigoIPSRealizoCirugiaReconstructiva", "VAR114_UsuarioValoradoConsultaProcedimientoPaliativo", "VAR114_1_UsuarioRecibioConsultaProcedimientoCuidadoPaliativ", "VAR114_2_UsuarioRecibioConsultaCuidadoPaliativo", "VAR114_3_UsuarioRecibioConsultaPaliativoEspecialista", "VAR114_4_UsuarioRecibioConsultaPaliativoGeneral", "VAR114_5_UsuarioRecibioConsultaPaliativoTrabajoSocial", "VAR114_6_UsuarioRecibioConsultaPaliativoNoEspecializado", "VAR115_FechaPrimeraConsultaPaliativoCorte", "VAR116_CodigoIPSRecibioPrimeraValoracionPaliativo", "VAR117_HaSidoValoradoUsuarioPorServicioPsiquiatria", "VAR118_FechaPrimeraConsultaServicioPsiquiatria", "VAR119_CodigoIPSRecibioPrimeraValoracionPsiquiatria", "VAR120_FueValoradoUsuarioPorProfesionalNutricion", "VAR121_FechaConsultaInicialNutricionCorte", "VAR122_CodigoIPSRecibioValoracionNutricion", "VAR123_UsuarioRecibioSoporteNutricional", "VAR124_UsuarioRecibidoTerapiasComplementariasRehabilitaci", "VAR125_TipoTratamientoRecibiendoUsuarioFechaCorte", "VAR126_ResultadoFinalManejoOncologicoCorte", "VAR127_EstadoVitalFinalizarCorte", "VAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior", "VAR129_NovedadClinicaUsuarioFechaCorte", "VAR130_FechaDesafiliacionEPS", "VAR131_FechaMuerte", "VAR132_CausaMuerte", "VAR133_SerialBDUA", "VAR134_V134FechaCorte"];

        const canonKey = (k) => (k || "").toString().trim().replace(/\s+/g, "");

        // =====================================================
        // REGLAS UNIVERSALES POR VARIABLE (DEFAULTS + FECHAS)
        // Pegar UNA SOLA VEZ, en nivel GLOBAL (fuera de funciones)
        // =====================================================

        // 1) Reglas base (no redeclara si lo pegas por accidente)
        window.FIELD_RULES = window.FIELD_RULES || {};

        // Defaults (CÁNCER)
        window.FIELD_RULES["VAR2_SegundoNombreUsuario"] = { defaultIfEmpty: "NONE" };
        window.FIELD_RULES["VAR4_SegundoApellidoUsuario"] = { defaultIfEmpty: "NOAP" };

        // Defaults (HEMOFILIA)
        window.FIELD_RULES["VAR2_SegundoNombre"] = { defaultIfEmpty: "NONE" };
        window.FIELD_RULES["VAR4_SegundoApellido"] = { defaultIfEmpty: "NOAP" };

        // 2) Listas de variables tipo FECHA (CÁNCER) — keys SIN espacios (como guardas en Firestore)
        const DATE_KEYS_CANCER = new Set([
                "VAR7_FechaNacimiento",
                "VAR16_FechaAfiliacionEPSRegistra",
                "VAR18_FechaDx",
                "VAR19_FechaNotaRemisionMedico",
                "VAR20_FechaIngresoInstitucionRealizo",
                "VAR23_FechaRecoleccionMuestraEstudioHistopatologico",
                "VAR24_FechaInformHistopatologicoValido",
                "VAR26_FechaPrimeraConsultaMedicoTratante",
                "VAR30_FechaRealizoEstaEstadificacion",
                "VAR35_FechaEstadificacionDukes",
                "VAR39_FechaClasificacionRiesgo",
                "VAR43_FechaDiagnosticoOtroCancerPrimario",
                "VAR49_FechaInicioPrimerCicloQuimioterapiaCorte",
                "VAR58_FechaFinalizacionPrimerCicloCorte",
                "VAR62_FechaInicioUltimoCicloQuimioterapiaCorte",
                "VAR71_FechaFinalizacionCicloUltimo",
                "VAR76_FechaRealizacionPrimeraCirugiaReporte",
                "VAR80_FechaRealizacionUltimoProcedimientoQuirurgico",
                "VAR88_FechaInicioPrimerUnicoEsquemaRadioterapia",
                "VAR94_FechaFinalizacionPrimerUnicoEsquemaRadioterapia",
                "VAR97_FechaInicioUltimoEsquemaRadioterapia",
                "VAR103_FechaFinalizacionUltimoEsquemaRadioterapia",
                "VAR109_FechaTrasplante",
                "VAR112_FechaCirugia",
                "VAR115_FechaPrimeraConsultaPaliativoCorte",
                "VAR118_FechaPrimeraConsultaServicioPsiquiatria",
                "VAR121_FechaConsultaInicialNutricionCorte",
                "VAR130_FechaDesafiliacionEPS",
                "VAR131_FechaMuerte",
                "VAR134_V134FechaCorte"
        ]);

        // 3) Dependencias entre fechas (CÁNCER)
        const DEPEND_NOT_BEFORE_BIRTH = new Set([
                "VAR16_FechaAfiliacionEPSRegistra",
                "VAR18_FechaDx"
        ]);

        const DEPEND_NOT_BEFORE_DX = new Set([
                "VAR19_FechaNotaRemisionMedico",
                "VAR20_FechaIngresoInstitucionRealizo",
                "VAR23_FechaRecoleccionMuestraEstudioHistopatologico",
                "VAR24_FechaInformHistopatologicoValido",
                "VAR26_FechaPrimeraConsultaMedicoTratante",
                "VAR30_FechaRealizoEstaEstadificacion",
                "VAR35_FechaEstadificacionDukes",
                "VAR39_FechaClasificacionRiesgo",
                "VAR43_FechaDiagnosticoOtroCancerPrimario",
                "VAR49_FechaInicioPrimerCicloQuimioterapiaCorte",
                "VAR58_FechaFinalizacionPrimerCicloCorte",
                "VAR62_FechaInicioUltimoCicloQuimioterapiaCorte",
                "VAR71_FechaFinalizacionCicloUltimo",
                "VAR76_FechaRealizacionPrimeraCirugiaReporte",
                "VAR80_FechaRealizacionUltimoProcedimientoQuirurgico",
                "VAR88_FechaInicioPrimerUnicoEsquemaRadioterapia",
                "VAR94_FechaFinalizacionPrimerUnicoEsquemaRadioterapia",
                "VAR97_FechaInicioUltimoEsquemaRadioterapia",
                "VAR103_FechaFinalizacionUltimoEsquemaRadioterapia",
                "VAR109_FechaTrasplante",
                "VAR112_FechaCirugia",
                "VAR115_FechaPrimeraConsultaPaliativoCorte",
                "VAR118_FechaPrimeraConsultaServicioPsiquiatria",
                "VAR121_FechaConsultaInicialNutricionCorte",
                "VAR130_FechaDesafiliacionEPS",
                "VAR131_FechaMuerte",
                "VAR134_V134FechaCorte"
        ]);

        // 4) Helpers de fecha
        const pad2 = (n) => String(n).padStart(2, "0");

        const parseISODate = (s) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
                const [Y, M, D] = s.split("-").map(Number);
                const dt = new Date(Date.UTC(Y, M - 1, D));
                // Validación real (evita 2026-02-31)
                if (dt.getUTCFullYear() !== Y || (dt.getUTCMonth() + 1) !== M || dt.getUTCDate() !== D) return null;
                return dt;
        };

        const formatToISOIfPossible = (raw) => {
                // Deja solo dígitos e intenta formar AAAA-MM-DD
                const digits = (raw || "").toString().replace(/[^\d]/g, "");
                if (digits.length < 8) return raw.toString().replace(/[^\d-]/g, ""); // permite ir digitando
                const Y = digits.slice(0, 4);
                const M = digits.slice(4, 6);
                const D = digits.slice(6, 8);
                return `${Y}-${M}-${D}`;
        };

        const DATE_KEYS_HEMO = new Set([
                "VAR7_FechaNacimiento",
                "VAR16_FechaAfiliacion",
                "VAR21_FechaDx",
                "VAR29_FechaDeIniPrimerTto",
                "VAR48_1_FechaDeterminacionTitulosInhibidor",
                "VAR64_2_FechaMuerte",
                "VAR66_V66FechaCorte"
        ]);

        const isDateKey = (keyStore) => DATE_KEYS_CANCER.has(keyStore) || DATE_KEYS_HEMO.has(keyStore);



        // 5) Saneo general (tu estándar) + defaults + formato de fecha + Lógica de IPS
        window.applyFieldRules = function (keyStore, rawValue) {
                const key = String(keyStore || "").replace(/\s+/g, "");
                let v = (rawValue ?? "").toString();

                const cohorteActual = (window.cohorteModalActual || (typeof cohorteModalActual !== "undefined" ? cohorteModalActual : "")).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                // 1) SOPORTE PARA DECIMALES (HEMOFILIA)
                const decimalVars = new Set(["VAR25_ActividadCoagulanteDelFactor", "VAR32_Peso", "VAR32_1_Dosis"]);
                if (cohorteActual.includes("hemo") && decimalVars.has(key)) {
                        return v.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").trim();
                }

                // 2) Caso Fechas
                if (typeof isDateKey === "function" && isDateKey(key)) {
                        const el = document.getElementById(`f_${key}`);
                        if (el && el.type === "date" && el.valueAsDate instanceof Date) {
                                const d = el.valueAsDate;
                                const Y = d.getFullYear();
                                const M = String(d.getMonth() + 1).padStart(2, "0");
                                const D = String(d.getDate()).padStart(2, "0");
                                return `${Y}-${M}-${D}`;
                        }
                }

                // 3) Saneo general (Texto)
                v = v.toUpperCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        .replace(/Ñ/g, "N")
                        .replace(/[^A-Z0-9 -]/g, "")
                        .trimStart();

                // 4) Regla de IPS (Cero a la izquierda)
                const match = key.match(/VAR(\d+)/i);
                if (match) {
                        const numVar = parseInt(match[1]);
                        let ipsVars = (cohorteActual === "cancer") ? [25, 51, 52, 64, 65, 77, 82, 92, 93, 101, 102, 110, 113, 116, 119, 122] : [22, 39];
                        if (ipsVars.includes(numVar)) {
                                v = v.replace(/\D/g, "");
                                if (v.length === 11) v = "0" + v;
                        }
                }

                // 5) Default por variable
                const rule = window.FIELD_RULES[keyStore];
                if (rule?.defaultIfEmpty && v.trim() === "") v = rule.defaultIfEmpty;

                return v;
        };

        window.SELECT_OPTIONS = window.SELECT_OPTIONS || {};

        window.SELECT_OPTIONS["VAR5_TipoIdentificacionUsuario"] = [
                { v: "", t: "Selecciona..." },
                { v: "CC", t: "CC: Cédula de Ciudadanía" },
                { v: "CE", t: "CE: Cédula de Extranjería" },
                { v: "CD", t: "CD: Carné diplomático" },
                { v: "PA", t: "PA: Pasaporte" },
                { v: "SC", t: "SC: Salvoconducto de permanencia" },
                { v: "PT", t: "PT: Permiso temporal de permanencia" },
                { v: "PE", t: "PE: Permiso especial de permanencia" },
                { v: "RC", t: "RC: Registro Civil" },
                { v: "TI", t: "TI: Tarjeta de Identidad" },
                { v: "CN", t: "CN: Certificado de nacido vivo" },
                { v: "AS", t: "AS: Adulto sin identificar (Solo para el Régimen Subsidiado)" },
                { v: "MS", t: "MS: Menor sin identificar (Solo para el Régimen Subsidiado)" },
                { v: "DE", t: "DE: Documento extranjero" },
                { v: "SI", t: "SI: Sin identificación" }
        ];

        window.SELECT_OPTIONS["VAR8_Sexo"] = [
                { v: "", t: "Selecciona..." },
                { v: "F", t: "F: Femenino" },
                { v: "M", t: "M: Masculino" }
        ];

        window.SELECT_OPTIONS["VAR10_RegimenAfiliacionSGSSS"] = [
                { v: "", t: "Selecciona..." },
                { v: "C", t: "C: Régimen Contributivo" },
                { v: "S", t: "S: Régimen Subsidiado" },
                { v: "P", t: "P: Regímenes de excepción" },
                { v: "E", t: "E: Régimen especial" },
                { v: "N", t: "N: No asegurado" },
                { v: "I", t: "I: Fondo Atención en Salud para PPL" }
        ];

        window.SELECT_OPTIONS["VAR11_idEPS"] = [
                { v: "", t: "Selecciona..." },
                { v: "EPS010", t: "EPS SURA (EPS010)" },
                { v: "EPS002", t: "Salud Total (EPS002)" }
        ];

        window.SELECT_OPTIONS["VAR26_AntecedentesFamilares"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Sí" },
                { v: "1", t: "1: No" },
                { v: "2", t: "2: Desconocido" }
        ];

        // === VAR12: Pertenencia Étnica (CÁNCER) ===
        window.SELECT_OPTIONS["VAR12_CodigoPertenenciaEtnica"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Indígena" },
                { v: "2", t: "2: ROM (gitano)" },
                { v: "3", t: "3: Raizal (San Andrés y Providencia)" },
                { v: "4", t: "4: Palenquero (San Basilio)" },
                { v: "5", t: "5: Negro(a)/mulato(a)/afrocolombiano(a)/afrodescendiente" },
                { v: "6", t: "6: Ninguna de las anteriores" }
        ];

        // === VAR12: Pertenencia Étnica (HEMOFILIA) ===
        window.SELECT_OPTIONS["VAR12_idPertenenciaEtnica"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Indígena" },
                { v: "2", t: "2: ROM (gitano)" },
                { v: "3", t: "3: Raizal (San Andrés y Providencia)" },
                { v: "4", t: "4: Palenquero (San Basilio)" },
                { v: "5", t: "5: Negro(a)/mulato(a)/afrocolombiano(a)/afrodescendiente" },
                { v: "6", t: "6: Ninguna de las anteriores" }
        ];

        // === VAR13: Grupo poblacional (CÁNCER) ===
        window.SELECT_OPTIONS["VAR13_GrupoPoblacional"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Indigentes" },
                { v: "2", t: "2: Población infantil a cargo del ICBF" },
                { v: "3", t: "3: Madres comunitarias" },
                { v: "4", t: "4: Artistas, autores, compositores" },
                { v: "5", t: "5: Otro grupo poblacional" },
                { v: "6", t: "6: Recién Nacidos" },
                { v: "7", t: "7: Persona en situación de discapacidad" },
                { v: "8", t: "8: Desmovilizados" },
                { v: "9", t: "9: Desplazados" },
                { v: "10", t: "10: Población ROM" },
                { v: "11", t: "11: Población raizal" },
                { v: "12", t: "12: Población en centros psiquiátricos" },
                { v: "13", t: "13: Migratorio" },
                { v: "14", t: "14: Población en centros carcelarios" },
                { v: "15", t: "15: Población rural no migratoria" },
                { v: "16", t: "16: Afrocolombiano" },
                { v: "31", t: "31: Adulto mayor" },
                { v: "32", t: "32: Cabeza de familia" },
                { v: "33", t: "33: Mujer embarazada" },
                { v: "34", t: "34: Mujer lactante" },
                { v: "35", t: "35: Trabajador urbano" },
                { v: "36", t: "36: Trabajador rural" },
                { v: "37", t: "37: Víctima de violencia armada" },
                { v: "38", t: "38: Jóvenes vulnerables rurales" },
                { v: "39", t: "39: Jóvenes vulnerables urbanos" },
                { v: "50", t: "50: Persona en situación de discapacidad del sistema nervioso" },
                { v: "51", t: "51: Persona en situación de discapacidad de los ojos" },
                { v: "52", t: "52: Persona en situación de discapacidad de los oídos" },
                { v: "53", t: "53: Persona en situación de discapacidad de los demás órganos de los sentidos (olfato, tacto y gusto)" },
                { v: "54", t: "54: Persona en situación de discapacidad de la voz y el habla" },
                { v: "55", t: "55: Persona en situación de discapacidad del sistema cardiorrespiratorio y las defensas" },
                { v: "56", t: "56: Persona en situación de discapacidad de la digestión, el metabolismo, las hormonas" },
                { v: "57", t: "57: Persona en situación de discapacidad del sistema genital y reproductivo" },
                { v: "58", t: "58: Persona en situación de discapacidad del movimiento del cuerpo, manos, brazos, piernas" },
                { v: "59", t: "59: Persona en situación de discapacidad de la piel" },
                { v: "60", t: "60: Persona en situación de discapacidad de otro tipo" },
                { v: "61", t: "61: No definido" },
                { v: "62", t: "62: Comunidad indígena" },
                { v: "63", t: "63: Población migrante de la República Bolivariana de Venezuela" }
        ];

        // === VAR13: Grupo poblacional (HEMOFILIA) ===
        // Si en Hemofilia la variable tiene exactamente la misma key, deja esto igual.
        // Si allá la tienes con otro nombre (ej. VAR13_GrupoPoblacionalHemo), cámbialo a ese.
        window.SELECT_OPTIONS["VAR13_GrupoPoblacional"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Indigentes" },
                { v: "2", t: "2: Población infantil a cargo del ICBF" },
                { v: "3", t: "3: Madres comunitarias" },
                { v: "4", t: "4: Artistas, autores, compositores" },
                { v: "5", t: "5: Otro grupo poblacional" },
                { v: "6", t: "6: Recién Nacidos" },
                { v: "7", t: "7: Persona en situación de discapacidad" },
                { v: "8", t: "8: Desmovilizados" },
                { v: "9", t: "9: Desplazados" },
                { v: "10", t: "10: Población ROM" },
                { v: "11", t: "11: Población raizal" },
                { v: "12", t: "12: Población en centros psiquiátricos" },
                { v: "13", t: "13: Migratorio" },
                { v: "14", t: "14: Población en centros carcelarios" },
                { v: "15", t: "15: Población rural no migratoria" },
                { v: "16", t: "16: Afrocolombiano" },
                { v: "31", t: "31: Adulto mayor" },
                { v: "32", t: "32: Cabeza de familia" },
                { v: "33", t: "33: Mujer embarazada" },
                { v: "34", t: "34: Mujer lactante" },
                { v: "35", t: "35: Trabajador urbano" },
                { v: "36", t: "36: Trabajador rural" },
                { v: "37", t: "37: Víctima de violencia armada" },
                { v: "38", t: "38: Jóvenes vulnerables rurales" },
                { v: "39", t: "39: Jóvenes vulnerables urbanos" },
                { v: "50", t: "50: Persona en situación de discapacidad del sistema nervioso" },
                { v: "51", t: "51: Persona en situación de discapacidad de los ojos" },
                { v: "52", t: "52: Persona en situación de discapacidad de los oídos" },
                { v: "53", t: "53: Persona en situación de discapacidad de los demás órganos de los sentidos (olfato, tacto y gusto)" },
                { v: "54", t: "54: Persona en situación de discapacidad de la voz y el habla" },
                { v: "55", t: "55: Persona en situación de discapacidad del sistema cardiorrespiratorio y las defensas" },
                { v: "56", t: "56: Persona en situación de discapacidad de la digestión, el metabolismo, las hormonas" },
                { v: "57", t: "57: Persona en situación de discapacidad del sistema genital y reproductivo" },
                { v: "58", t: "58: Persona en situación de discapacidad del movimiento del cuerpo, manos, brazos, piernas" },
                { v: "59", t: "59: Persona en situación de discapacidad de la piel" },
                { v: "60", t: "60: Persona en situación de discapacidad de otro tipo" },
                { v: "61", t: "61: No definido" },
                { v: "62", t: "62: Comunidad indígena" },
                { v: "63", t: "63: Población migrante de la República Bolivariana de Venezuela" }
        ];

        // === VAR17_Nombre Neoplasia (CA) ===
        window.SELECT_OPTIONS["VAR17_NombreNeoplasia"] = [
                { v: "", t: "Selecciona..." },
                { v: "C530", t: "C530: Tumor maligno del endocervix" },
                { v: "C531", t: "C531: Tumor maligno de exocervix" },
                { v: "C538", t: "C538: Lesion de sitios contiguos del cuello del utero" },
                { v: "C539", t: "C539: Tumor maligno del cuello del utero, sin otra especificacion" },
                { v: "D060", t: "D060: Carcinoma in situ del endocervix" },
                { v: "D061", t: "D061: Carcinoma in situ del exocervix" },
                { v: "D067", t: "D067: Carcinoma in situ de otras partes especificadas del cuello del utero" },
                { v: "D069", t: "D069: Carcinoma in situ del cuello del utero, parte no especificada" },
                { v: "C180", t: "C180: Tumor maligno del ciego" },
                { v: "C181", t: "C181: Tumor maligno del apendice" },
                { v: "C182", t: "C182: Tumor maligno del colon ascendente" },
                { v: "C183", t: "C183: Tumor maligno del angulo hepatico" },
                { v: "C184", t: "C184: Tumor maligno del colon transverso" },
                { v: "C185", t: "C185: Tumor maligno del angulo esplenico" },
                { v: "C186", t: "C186: Tumor maligno del colon descendente" },
                { v: "C187", t: "C187: Tumor maligno del colon sigmoide" },
                { v: "C188", t: "C188: Lesion de sitios contiguos del colon" },
                { v: "C189", t: "C189: Tumor maligno del colon, parte no especificada" },
                { v: "C19X", t: "C19X: Tumor maligno de la unión rectosigmoidea" },
                { v: "C20X", t: "C20X: Tumor maligno del recto" },
                { v: "C210", t: "C210: Tumor maligno del ano, parte no especificada" },
                { v: "C211", t: "C211: Tumor maligno del conducto anal" },
                { v: "C212", t: "C212: Tumor maligno de la zona cloacogenica" },
                { v: "C218", t: "C218: Lesion de sitios contiguos del ano, del conducto anal y del recto" },
                { v: "D010", t: "D010: Carcinoma in situ del colon" },
                { v: "D011", t: "D011: Carcinoma in situ de la union rectosigmoidea" },
                { v: "D012", t: "D012: Carcinoma in situ del recto" },
                { v: "D013", t: "D013: Carcinoma in situ del ano y del conducto anal" },
                { v: "C160", t: "C160: Tumor maligno del cardias" },
                { v: "C161", t: "C161: Tumor maligno del fundus gastrico" },
                { v: "C162", t: "C162: Tumor maligno del cuerpo del estomago" },
                { v: "C163", t: "C163: Tumor maligno del antro pilorico" },
                { v: "C164", t: "C164: Tumor maligno del piloro" },
                { v: "C165", t: "C165: Tumor maligno de la curvatura menor del estomago, sin otra especificacion" },
                { v: "C166", t: "C166: Tumor maligno de la curvatura mayor del estomago, sin otra especificacion" },
                { v: "C168", t: "C168: Lesion de sitios contiguos del estomago" },
                { v: "C169", t: "C169: Tumor maligno del estomago, parte no especificada" },
                { v: "D002", t: "D002: Carcinoma in situ del estomago" },
                { v: "C810", t: "C810: Linfoma de Hodgkin nodular con predominio linfocítico" },
                { v: "C811", t: "C811: Linfoma de Hodgkin (clásico) con esclerosis nodular" },
                { v: "C812", t: "C812: Linfoma de Hodgkin (clásico) con celularidad mixta" },
                { v: "C813", t: "C813: Linfoma de Hodgkin (clásico) con depleción linfocítica" },
                { v: "C817", t: "Otros linfomas de Hodgkin (clásicos)" },
                { v: "C819", t: "C819: Linfoma de Hodgkin, no especificado" },
                { v: "C910", t: "C910: Leucemia linfoblástica aguda [LLA]" },
                { v: "C920", t: "C920: Leucemia mieloblástica aguda [LMA]" },
                { v: "C924", t: "C924: Leucemia promielocítica aguda [LPA]" },
                { v: "C925", t: "C925: Leucemia mielomonocitica aguda" },
                { v: "C500", t: "C500: Tumor maligno del pezon y areola mamaria" },
                { v: "C501", t: "C501: Tumor maligno de la porcion central de la mama" },
                { v: "C502", t: "C502: Tumor maligno del cuadrante superior interno de la mama" },
                { v: "C503", t: "C503: Tumor maligno del cuadrante inferior interno de la mama" },
                { v: "C504", t: "C504: Tumor maligno del cuadrante superior externo de la mama" },
                { v: "C505", t: "C505: Tumor maligno del cuadrante inferior externo de la mama" },
                { v: "C506", t: "C506: Tumor maligno de la prolongacion axilar de la mama" },
                { v: "C508", t: "C508: Lesion de sitios contiguos de la mama" },
                { v: "C509", t: "C509: Tumor maligno de la mama, parte no especificada" },
                { v: "D050", t: "D050: Carcinoma in situ lobular" },
                { v: "D051", t: "D051: Carcinoma in situ intracanalicular" },
                { v: "D057", t: "D057: Otros carcinomas in situ de la mama" },
                { v: "D059", t: "D059: Carcinoma in situ de la mama, parte no especificada" },
                { v: "C430", t: "C430: Melanoma maligno del labio" },
                { v: "C431", t: "C431: Melanoma maligno del parpado, incluida la comisura palpebral" },
                { v: "C432", t: "C432: Melanoma maligno de la oreja y del conducto auditivo externo" },
                { v: "C433", t: "C433: Melanoma maligno de las otras partes y las no especificadas de la cara" },
                { v: "C434", t: "C434: Melanoma maligno del cuero cabelludo y del cuello" },
                { v: "C435", t: "C435: Melanoma maligno del tronco" },
                { v: "C436", t: "C436: Melanoma maligno del miembro superior, incluido el hombro" },
                { v: "C437", t: "C437: Melanoma maligno del miembro inferior, incluida la cadera" },
                { v: "C438", t: "C438: Melanoma maligno de sitios contiguos de la piel" },
                { v: "C439", t: "C439: Melanoma maligno de piel, sitio no especificado" },
                { v: "D030", t: "D030: Melanoma in situ del labio" },
                { v: "D031", t: "D031: Melanoma in situ del parpado y de la comisura palpebral" },
                { v: "D032", t: "D032: Melanoma in situ de la oreja y del conducto auditivo externo" },
                { v: "D033", t: "D033: Melanoma in situ de otras partes y de las no especificadas de la cara" },
                { v: "D034", t: "D034: Melanoma in situ del cuero cabelludo y del cuello" },
                { v: "D035", t: "D035: Melanoma in situ del tronco" },
                { v: "D036", t: "D036: Melanoma in situ del miembro superior, incluido el hombro" },
                { v: "D037", t: "D037: Melanoma in situ del miembro inferior, incluida la cadera" },
                { v: "D038", t: "D038: Melanoma in situ de otros sitios" },
                { v: "D039", t: "D039: Melanoma in situ, sitio no especificado" },
                { v: "C820", t: "C820: Linfoma folicular grado I" },
                { v: "C821", t: "C821: Linfoma folicular grado II" },
                { v: "C822", t: "C822: Linfoma folicular grado III, no especificado" },
                { v: "C827", t: "C827: Otros tipos especificados de linfoma folicular" },
                { v: "C829", t: "C829: Linfoma folicular, sin otra especificación" },
                { v: "C830", t: "C830: Linfoma de células B pequeñas" },
                { v: "C831", t: "C831: Linfoma de células del manto" },
                { v: "C832", t: "C832: Linfoma no hodgkin mixto, de celulas pequeñas y grandes (difuso)" },
                { v: "C833", t: "C833: Linfoma de células grandes B difuso" },
                { v: "C834", t: "C834: Linfoma no hodgkin inmunoblastico (difuso)" },
                { v: "C835", t: "C835: Linfoma linfoblástico (difuso)" },
                { v: "C836", t: "C836: Linfoma no hodgkin indiferenciado (difuso)" },
                { v: "C837", t: "C837: Linfoma de Burkitt" },
                { v: "C838", t: "C838: Otros tipos especificados de linfoma no folicular" },
                { v: "C839", t: "C839: Linfoma no folicular (difuso), sin otra especificación" },
                { v: "C840", t: "C840: Micosis fungoide" },
                { v: "C841", t: "C841: Enfermedad de sezary" },
                { v: "C842", t: "C842: Linfoma de zona t" },
                { v: "C843", t: "C843: Linfoma linfoepitelioide" },
                { v: "C844", t: "C844: Linfoma de celulas t periferico" },
                { v: "C845", t: "C845: Otros linfomas de celulas y los no especificados" },
                { v: "C850", t: "C850: Linfosarcoma" },
                { v: "C851", t: "C851: Linfoma de celulas b, sin otra especificacion" },
                { v: "C857", t: "C857: Otros tipos especificados de linfoma no hodgkin" },
                { v: "C859", t: "C859: Linfoma no hodgkin, no especificado" },
                { v: "C960", t: "C960: Histiocitosis de células de Langerhans multifocal y multisistémica (diseminada) [Enfermedad de Letterer-Siwe]" },
                { v: "C961", t: "C961: Histiocitosis maligna" },
                { v: "C962", t: "C962: Tumor maligno de mastocitos" },
                { v: "C963", t: "C963: Linfoma histiocitico verdadero" },
                { v: "C967", t: "C967: Otros tumores malignos especificados del tejido linfatico, hematopoyetico y tejidos afines" },
                { v: "C969", t: "C969: Tumor maligno del tejido linfatico, hematopoyetico y tejidos afines, sin otra especificacion" },
                { v: "C61X", t: "C61X: Tumor maligno de la próstata" },
                { v: "D075", t: "D075:Carcinoma in situ de la prostata" },
                { v: "C33X", t: "C33X: Tumor maligno de la tráquea" },
                { v: "C340", t: "C340: Tumor maligno del bronquio principal" },
                { v: "C341", t: "C341: Tumor maligno del lobulo superior, bronquio o pulmon" },
                { v: "C342", t: "C342: Tumor maligno del lobulo medio, bronquio o pulmon" },
                { v: "C343", t: "C343: Tumor maligno del lobulo inferior, bronquio o pulmon" },
                { v: "C348", t: "C348: Lesion de sitios contiguos de los bronquios y del pulmon" },
                { v: "C349", t: "C349: Tumor maligno de los bronquios o del pulmon, parte no especificada" },
                { v: "D021", t: "D021: Carcinoma in situ de la traquea" },
                { v: "D022", t: "D022: Carcinoma in situ del bronquio y del pulmon" },
                { v: "C000", t: "C000: Tumor maligno del labio superior, cara externa" },
                { v: "C001", t: "C001: Tumor maligno del labio inferior, cara externa" },
                { v: "C002", t: "C002: Tumor maligno del labio, cara externa, sin otra especificacion" },
                { v: "C003", t: "C003: Tumor maligno del labio superior, cara interna" },
                { v: "C004", t: "C004: Tumor maligno del labio inferior, cara interna" },
                { v: "C005", t: "C005: Tumor maligno del labio, cara interna, sin otra especificacion" },
                { v: "C006", t: "C006: Tumor maligno de la comisura labial" },
                { v: "C008", t: "C008: Lesion de sitios contiguos del labio" },
                { v: "C009", t: "C009: Tumor maligno del labio, parte no especificada" },
                { v: "C01X", t: "C01X: Tumor maligno de la base de la lengua" },
                { v: "C020", t: "C020: Tumor maligno de la cara dorsal de la lengua" },
                { v: "C021", t: "C021: Tumor maligno del borde de la lengua" },
                { v: "C022", t: "C022: Tumor maligno de la cara ventral de la lengua" },
                { v: "C023", t: "C023: Tumor maligno de los dos tercios anteriores de la lengua, parte no especificada" },
                { v: "C024", t: "C024: Tumor maligno de la amigdala lingual" },
                { v: "C028", t: "C028: Lesion de sitios contiguos de la lengua" },
                { v: "C029", t: "C029: Tumor maligno de la lengua, parte no especificada" },
                { v: "C030", t: "C030: Tumor maligno de la encia superior" },
                { v: "C031", t: "C031: Tumor maligno de la encia inferior" },
                { v: "C039", t: "C039: Tumor maligno de la encia, parte no especificada" },
                { v: "C040", t: "C040: Tumor maligno de la parte anterior del piso de la boca" },
                { v: "C041", t: "C041: Tumor maligno de la parte lateral del piso de la boca" },
                { v: "C048", t: "C048: Lesion de sitios contiguos del piso de la boca" },
                { v: "C049", t: "C049: Tumor maligno del piso de la boca, parte no especificada" },
                { v: "C050", t: "C050: Tumor maligno del paladar duro" },
                { v: "C051", t: "C051: Tumor maligno del paladar blando" },
                { v: "C052", t: "C052: Tumor maligno de la uvula" },
                { v: "C058", t: "C058: Lesion de sitios contiguos del paladar" },
                { v: "C059", t: "C059: Tumor maligno del paladar, parte no especificada" },
                { v: "C060", t: "C060: Tumor maligno de la mucosa de la mejilla" },
                { v: "C061", t: "C061: Tumor maligno del vestibulo de la boca" },
                { v: "C062", t: "C062: Tumor maligno del area retromolar" },
                { v: "C068", t: "C068: Lesion de sitios contiguos de otras partes y de las no especificadas de la boca" },
                { v: "C069", t: "C069: Tumor maligno de la boca, parte no especificada" },
                { v: "C07X", t: "C07X: Tumor maligno de la glándula parótida" },
                { v: "C080", t: "C080: Tumor maligno de la glandula submaxilar" },
                { v: "C081", t: "C081: Tumor maligno de la glandula sublingual" },
                { v: "C088", t: "C088: Lesion de sitios contiguos de las glandulas salivales mayores" },
                { v: "C089", t: "C089: Tumor maligno de glandula salival mayor, no especificada" },
                { v: "C090", t: "C090: Tumor maligno de la fosa amigdalina" },
                { v: "C091", t: "C091: Tumor maligno del pilar amigdalino (anterior) (posterior)" },
                { v: "C098", t: "C098: Lesion de sitios contiguos de la amigdala" },
                { v: "C099", t: "C099: Tumor maligno de la amigdala, parte no especificada" },
                { v: "C100", t: "C100: Tumor maligno de la valecula" },
                { v: "C101", t: "C101: Tumor maligno de la cara anterior de la epiglotis" },
                { v: "C102", t: "C102: Tumor maligno de la pared lateral de la orofaringe" },
                { v: "C103", t: "C103: Tumor maligno de la pared posterior de la orofaringe" },
                { v: "C104", t: "C104: Tumor maligno de la hendidura branquial" },
                { v: "C108", t: "C108: Lesion de sitios contiguos de la orofaringe" },
                { v: "C109", t: "C109: Tumor maligno de la orofaringe, parte no especificada" },
                { v: "C110", t: "C110: Tumor maligno de la pared superior de la nasofaringe" },
                { v: "C111", t: "C111: Tumor maligno de la pared posterior de la nasofaringe" },
                { v: "C112", t: "C112: Tumor maligno de la pared lateral de la nasofaringe" },
                { v: "C113", t: "C113: Tumor maligno de la pared anterior de la nasofaringe" },
                { v: "C118", t: "C118: Lesion de sitios contiguos de la nasofaringe" },
                { v: "C119", t: "C119: Tumor maligno de la nasofaringe, parte no especificada" },
                { v: "C12X", t: "C12X: Tumor maligno del seno piriforme" },
                { v: "C130", t: "C130: Tumor maligno de la region postcricoidea" },
                { v: "C131", t: "C131: Tumor maligno del pliegue aritenoepiglotico, cara hipofaringea" },
                { v: "C132", t: "C132: Tumor maligno de la pared posterior de la hipofaringe" },
                { v: "C138", t: "C138: Lesion de sitios contiguos de la hipofaringe" },
                { v: "C139", t: "C139: Tumor maligno de la hipofaringe, parte no especificada" },
                { v: "C140", t: "C140: Tumor maligno de la faringe, parte no especificada" },
                { v: "C142", t: "C142: Tumor maligno del anillo de waldeyer" },
                { v: "C148", t: "C148: Lesion de sitios contiguos del labio, de la cavidad bucal y de la laringe" },
                { v: "D000", t: "C000: Carcinoma in situ del labio, de la cavidad bucal y de la faringe" },
                { v: "C150", t: "C150: Tumor maligno del esofago, porcion cervical" },
                { v: "C151", t: "C151: Tumor maligno del esofago, porcion toracica" },
                { v: "C152", t: "C152: Tumor maligno del esofago, porcion abdominal" },
                { v: "C153", t: "C153: Tumor maligno del tercio superior del esofago" },
                { v: "C154", t: "C154: Tumor maligno del tercio medio del esofago" },
                { v: "C155", t: "C155: Tumor maligno del tercio inferior del esofago" },
                { v: "C158", t: "C158: Lesion de sitios contiguos del esofago" },
                { v: "C159", t: "C159: Tumor maligno del esofago, parte no especificada" },
                { v: "D023", t: "D023: Carcinoma in situ de otras partes del sistema respiratorio" },
                { v: "D024", t: "D024: Carcinoma in situ de organos respiratorios no especificados" },
                { v: "C400", t: "C400: Tumor maligno del omoplato y de los huesos largos del miembro superior" },
                { v: "C401", t: "C401: Tumor maligno de los huesos cortos del miembro superior" },
                { v: "C402", t: "C402: Tumor maligno de los huesos largos del miembro inferior" },
                { v: "C403", t: "C403: Tumor maligno de los huesos cortos del miembro inferior" },
                { v: "C408", t: "C408: Lesion de sitios contiguos de los huesos y de los cartilagos articulares de los miembros" },
                { v: "C409", t: "C409: Tumor maligno de los huesos y de los cartilagos articulares de los miembros, sin otra especificacion" },
                { v: "C410", t: "C410: Tumor maligno de los huesos del craneo y de la cara" },
                { v: "C411", t: "C411: Tumor maligno del hueso del maxilar inferior" },
                { v: "C412", t: "C412: Tumor maligno de la columna vertebral" },
                { v: "C413", t: "C413: Tumor maligno de la costilla, esternon y clavicula" },
                { v: "C414", t: "C414: Tumor maligno de los huesos de la pelvis, sacro y coccix" },
                { v: "C418", t: "C418: Lesion de sitios contiguos del hueso y del cartilago articular" },
                { v: "C419", t: "C419: Tumor maligno de hueso y del cartilago articular, no especificado" },
                { v: "C440", t: "C440: Tumor maligno de la piel del labio" },
                { v: "C441", t: "C441: Tumor maligno de la piel del parpado, incluida la comisura palpebral" },
                { v: "C442", t: "C442: Tumor maligno de la piel de la oreja y del conducto auditivo externo" },
                { v: "C443", t: "C443: Tumor maligno de la piel de otras partes y de las no especificadas de la cara" },
                { v: "C444", t: "C444: Tumor maligno de la piel del cuero cabelludo y del cuello" },
                { v: "C445", t: "C445: Tumor maligno de la piel del tronco" },
                { v: "C446", t: "C446: Tumor maligno de la piel del miembro superior, incluido el hombro" },
                { v: "C447", t: "C447: Tumor maligno de la piel del miembro inferior, incluida la cadera" },
                { v: "C448", t: "C448: Lesion de sitios contiguos de la piel" },
                { v: "C449", t: "C449: Tumor maligno de la piel, sitio no especificado" },
                { v: "D040", t: "D040: Carcinoma in situ de la piel del labio" },
                { v: "D041", t: "D041: Carcinoma in situ de la piel del parpado y de la comisura palpebral" },
                { v: "D042", t: "D042: Carcinoma in situ de la piel de la oreja y del conducto auditivo externo" },
                { v: "D043", t: "D043: Carcinoma in situ de la piel de otras partes y de las no especificadas de la cara" },
                { v: "D044", t: "D044: Carcinoma in situ de la piel del cuero cabelludo y cuello" },
                { v: "D045", t: "D045: Carcinoma in situ de la piel del tronco" },
                { v: "D046", t: "D046: Carcinoma in situ de la piel del miembro superior, incluido el hombro" },
                { v: "D047", t: "D047: Carcinoma in situ de la piel del miembro inferior, incluida la cadera" },
                { v: "D048", t: "D048: Carcinoma in situ de la piel de otros sitios especificados" },
                { v: "D049", t: "D049: Carcinoma in situ de la piel, sitio no especificado" },
                { v: "C450", t: "C450: Mesotelioma de la pleura" },
                { v: "C451", t: "C451: Mesotelioma del peritoneo" },
                { v: "C452", t: "C452: Mesotelioma del pericardio" },
                { v: "C457", t: "C457: Mesotelioma de otros sitios especificados" },
                { v: "C459", t: "C459: Mesotelioma, de sitio no especificado" },
                { v: "C460", t: "C460: Sarcoma de kaposi de la piel" },
                { v: "C461", t: "C461: Sarcoma de kaposi del tejido blando" },
                { v: "C462", t: "C462: Sarcoma de kaposi del paladar" },
                { v: "C463", t: "C463: Sarcoma de kaposi de los ganglios linfaticos" },
                { v: "C467", t: "C467: Sarcoma de kaposi de otros sitios especificados" },
                { v: "C468", t: "C468: Sarcoma de kaposi de multiples organos" },
                { v: "C469", t: "C469: Sarcoma de kaposi, de sitio no especificado" },
                { v: "C470", t: "C470: Tumor maligno de los nervios perifericos de la cabeza, cara y cuello" },
                { v: "C471", t: "C471: Tumor maligno de los nervios perifericos del miembro superior, incluido el hombro" },
                { v: "C472", t: "C472: Tumor maligno de los nervios perifericos del miembro inferior, incluida la cadera" },
                { v: "C473", t: "C473: Tumor maligno de los nervios perifericos del torax" },
                { v: "C474", t: "C474: Tumor maligno de los nervios perifericos del abdomen" },
                { v: "C475", t: "C475: Tumor maligno de los nervios perifericos de la pelvis" },
                { v: "C476", t: "C476: Tumor maligno de los nervios perifericos del tronco, sin otra especificacion" },
                { v: "C478", t: "C478: Lesion de sitios contiguos de los nervios perifericos y del sistema nervioso autonomo" },
                { v: "C479", t: "C479: Tumor maligno de los nervios perifericos y del sistema nervioso autonomo, parte no especificada" },
                { v: "C480", t: "C480: Tumor maligno del retroperitoneo" },
                { v: "C481", t: "C481: Tumor maligno de parte especificada del peritoneo" },
                { v: "C482", t: "C482: Tumor maligno del peritoneo, sin otra especificacion" },
                { v: "C488", t: "C488: Lesion de sitios contiguos del peritoneo y del retroperitoneo" },
                { v: "C490", t: "C490: Tumor maligno del tejido conjuntivo y tejido blando de la cabeza, cara y cuello" },
                { v: "C491", t: "C491: Tumor maligno del tejido conjuntivo y tejido blando del miembro superior, incluido el hombro" },
                { v: "C492", t: "C492: Tumor maligno del tejido conjuntivo y tejido blando del miembro inferior, incluida la cadera" },
                { v: "C493", t: "C493: Tumor maligno del tejido conjuntivo y tejido blando del torax" },
                { v: "C494", t: "C494: Tumor maligno del tejido conjuntivo y tejido blando del abdomen" },
                { v: "C495", t: "C495: Tumor maligno del tejido conjuntivo y tejido blando de la pelvis" },
                { v: "C496", t: "C496: Tumor maligno del tejido conjuntivo y tejido blando del tronco, sin otra especificacion" },
                { v: "C498", t: "C498: Lesion de sitios contiguos del tejido conjuntivo y del tejido del blando" },
                { v: "C499", t: "C499: Tumor maligno del tejido conjuntivo y tejido blando, de sitio no especificado" },
                { v: "C510", t: "C510: Tumor maligno del labio mayor" },
                { v: "C511", t: "C511: Tumor maligno del labio menor" },
                { v: "C512", t: "C512: Tumor maligno del clitoris" },
                { v: "C518", t: "C518: Lesion de sitios contiguos de la vulva" },
                { v: "C519", t: "C519: Tumor maligno de la vulva, parte no especificada" },
                { v: "C52X", t: "C52X: Tumor maligno de la vagina" },
                { v: "C540", t: "C540: Tumor maligno del istmo uterino" },
                { v: "C541", t: "C541: Tumor maligno del endometrio" },
                { v: "C542", t: "C542: Tumor maligno del miometrio" },
                { v: "C543", t: "C543: Tumor maligno del fondo del utero" },
                { v: "C548", t: "C548: Lesion de sitios contiguos del cuerpo del utero" },
                { v: "C549", t: "C549: Tumor maligno del cuerpo del utero, parte no especificada" },
                { v: "C55X", t: "C55X: Tumor maligno del útero parte no especificada" },
                { v: "C56X", t: "C56X: Tumor maligno del ovario" },
                { v: "C570", t: "C570: Tumor maligno de la trompa de falopio" },
                { v: "C571", t: "C571: Tumor maligno del ligamento ancho" },
                { v: "C572", t: "C572: Tumor maligno del ligamento redondo" },
                { v: "C573", t: "C573: Tumor maligno del parametrio" },
                { v: "C574", t: "C574: Tumor maligno de los anexos uterinos, sin otra especificacion" },
                { v: "C577", t: "C577: Tumor maligno de otras partes especificadas de los organos genitales femeninos" },
                { v: "C578", t: "C578: Lesion de sitios contiguos de los organos genitales femeninos" },
                { v: "C579", t: "C579: Tumor maligno de organo genital femenino, parte no especificada" },
                { v: "C58X", t: "C58X: Tumor maligno de la placenta" },
                { v: "D070", t: "D070: Carcinoma in situ del endometrio" },
                { v: "D071", t: "D071: Carcinoma in situ de la vulva" },
                { v: "D072", t: "D072: Carcinoma in situ de la vagina" },
                { v: "D073", t: "D073: Carcinoma in situ de otros sitios de organos genitales femeninos y de los no especificados" },
                { v: "C600", t: "C600: Tumor maligno del prepucio" },
                { v: "C601", t: "C601: Tumor maligno del glande" },
                { v: "C602", t: "C602: Tumor maligno del cuerpo del pene" },
                { v: "C608", t: "C608: Lesion de sitios contiguos del pene" },
                { v: "C609", t: "C609: Tumor maligno del pene, parte no especificada" },
                { v: "C620", t: "C620: Tumor maligno del testiculo no descendido" },
                { v: "C621", t: "C621: Tumor maligno del testiculo descendido" },
                { v: "C629", t: "C629: Tumor maligno del testiculo, no especificado" },
                { v: "C630", t: "C630: Tumor maligno del epididimo" },
                { v: "C631", t: "C631: Tumor maligno del cordon espermatico" },
                { v: "C632", t: "C632: Tumor maligno del escroto" },
                { v: "C637", t: "C637: Tumor maligno de otras partes especificadas de los organos genitales masculinos" },
                { v: "C638", t: "C638: Lesion de sitios contiguos de los organos genitales masculinos" },
                { v: "C639", t: "C639: Tumor maligno de organo genital masculino, parte no especificada" },
                { v: "D074", t: "D074: Carcinoma in situ del pene" },
                { v: "D076", t: "D076: Carcinoma in situ de otros organos genitales masculinos y de los no especificados" },
                { v: "C64X", t: "C64X: Tumor maligno del riñón excepto de la pelvis renal" },
                { v: "C65X", t: "C65X: Tumor maligno de la pelvis renal" },
                { v: "C66X", t: "C66X: Tumor maligno del uréter" },
                { v: "C670", t: "C670: Tumor maligno del trigono vesical" },
                { v: "C671", t: "C671: Tumor maligno de la cupula vesical" },
                { v: "C672", t: "C672: Tumor maligno de la pared lateral de la vejiga" },
                { v: "C673", t: "C673: Tumor maligno de la pared anterior de la vejiga" },
                { v: "C674", t: "C674: Tumor maligno de la pared posterior de la vejiga" },
                { v: "C675", t: "C675: Tumor maligno del cuello de la vejiga" },
                { v: "C676", t: "C676: Tumor maligno del orificio ureteral" },
                { v: "C677", t: "C677: Tumor maligno del uraco" },
                { v: "C678", t: "C678: Lesion de sitios contiguos de la vejiga" },
                { v: "C679", t: "C679: Tumor maligno de la vejiga urinaria, parte no especificada" },
                { v: "C680", t: "C680: Tumor maligno de la uretra" },
                { v: "C681", t: "C681: Tumor maligno de las glandulas parauretrales" },
                { v: "C688", t: "C688: Lesion de sitios contiguos de los organos urinarios" },
                { v: "C689", t: "C689: Tumor maligno de organo urinario no especificado" },
                { v: "D090", t: "D090: Carcinoma in situ de la vejiga" },
                { v: "D091", t: "D091: Carcinoma in situ de otros organos urinarios y de los no especificados" },
                { v: "C690", t: "C690: Tumor maligno de la conjuntiva" },
                { v: "C691", t: "C691: Tumor maligno de la cornea" },
                { v: "C692", t: "C692: Tumor maligno de la retina" },
                { v: "C693", t: "C693: Tumor maligno de la coroides" },
                { v: "C694", t: "C694: Tumor maligno del cuerpo ciliar" },
                { v: "C695", t: "C695: Tumor maligno de la glandula y conducto lagrimales" },
                { v: "C696", t: "C696: Tumor maligno de la orbita" },
                { v: "C698", t: "C698: Lesion de sitios contiguos del ojo y sus anexos" },
                { v: "C699", t: "C699: Tumor maligno del ojo, parte no especificada" },
                { v: "C700", t: "C700: Tumor maligno de las meninges cerebrales" },
                { v: "C701", t: "C701: Tumor maligno de las meninges raquideas" },
                { v: "C709", t: "C709: Tumor maligno de las meninges, parte no especificada" },
                { v: "C710", t: "C710: Tumor maligno del cerebro, excepto lobulos y ventriculos" },
                { v: "C711", t: "C711: Tumor maligno del lobulo frontal" },
                { v: "C712", t: "C712: Tumor maligno del lobulo temporal" },
                { v: "C713", t: "C713: Tumor maligno del lobulo parietal" },
                { v: "C714", t: "C714: Tumor maligno del lobulo occipital" },
                { v: "C715", t: "C715: Tumor maligno del ventriculo cerebral" },
                { v: "C716", t: "C716: Tumor maligno del cerebelo" },
                { v: "C717", t: "C717: Tumor maligno del pedunculo cerebral" },
                { v: "C718", t: "C718: Lesion de sitios contiguos del encefalo" },
                { v: "C719", t: "C719: Tumor maligno del encefalo, parte no especificada" },
                { v: "C720", t: "C720: Tumor maligno de la medula espinal" },
                { v: "C721", t: "C721: Tumor maligno de la cola de caballo" },
                { v: "C722", t: "C722: Tumor maligno del nervio olfatorio" },
                { v: "C723", t: "C723: Tumor maligno del nervio optico" },
                { v: "C724", t: "C724: Tumor maligno del nervio acustico" },
                { v: "C725", t: "C725: Tumor maligno de otros nervios craneales y los no especificados" },
                { v: "C728", t: "C728: Lesion de sitios contiguos del encefalo y otras partes del sistema nervioso central" },
                { v: "C729", t: "C729: Tumor maligno del sistema nervioso central, sin otra especificacion" },
                { v: "D092", t: "D092: Carcinoma in situ del ojo" },
                { v: "C73X", t: "C73X: Tumor maligno de la glándula tiroides" },
                { v: "C740", t: "C740: Tumor maligno de la corteza de la glandula suprarrenal" },
                { v: "C741", t: "C741: Tumor maligno de la medula de la glandula suprarrenal" },
                { v: "C749", t: "C749: Tumor maligno de la glandula suprarrenal, parte no especificada" },
                { v: "C750", t: "C750: Tumor maligno de la glandula paratiroides" },
                { v: "C751", t: "C751: Tumor maligno de la hipofisis" },
                { v: "C752", t: "C752: Tumor maligno del conducto craneofaringeo" },
                { v: "C753", t: "C753: Tumor maligno de la glandula pineal" },
                { v: "C754", t: "C754: Tumor maligno del cuerpo carotideo" },
                { v: "C755", t: "C755: Tumor maligno del cuerpo aortico y otros cuerpos cromafines" },
                { v: "C758", t: "C758: Tumor maligno pluriglandular, no especificado" },
                { v: "C759", t: "C759: Tumor maligno de glandula endocrina no especificada" },
                { v: "D093", t: "D093: Carcinoma in situ de la glandula tiroides y de otras glandulas endocrinas" },
                { v: "C760", t: "C760: Tumor maligno de la cabeza, cara y cuello" },
                { v: "C761", t: "C761: Tumor maligno del torax" },
                { v: "C762", t: "C762: Tumor maligno del abdomen" },
                { v: "C763", t: "C763: Tumor maligno de la pelvis" },
                { v: "C764", t: "C764: Tumor maligno del miembro superior" },
                { v: "C765", t: "C765: Tumor maligno del miembro inferior" },
                { v: "C767", t: "C767: Tumor maligno de otros sitios mal definidos" },
                { v: "C768", t: "C768: Lesion de sitios contiguos mal definidos" },
                { v: "C80X", t: "C80X: Tumor maligno de sitios no especificados" },
                { v: "C800", t: "C800: Tumor maligno de sitio primario desconocido, asi descrito" },
                { v: "C809", t: "C809: Tumor maligno sitio primario no especificado" },
                { v: "C97X", t: "C97X: Tumores malignos (primarios) de sitios múltiples independientes" },
                { v: "D097", t: "D097: Carcinoma in situ de otros sitios especificados" },
                { v: "D099", t: "D099: Carcinoma in situ, sitio no especificado" },
                { v: "C880", t: "C880: Macroglobulinemia de waldenstrom" },
                { v: "C881", t: "C881: Enfermedad de cadena pesada alfa" },
                { v: "C882", t: "C882: Otras enfermedades de cadena pesada" },
                { v: "C883", t: "C883: Enfermedad inmunoproliferativa del intestino delgado" },
                { v: "C887", t: "C887: Otras enfermedades inmunoproliferativas malignas" },
                { v: "C889", t: "C889: Enfermedad inmunoproliferativa maligna, sin otra especificacion" },
                { v: "C900", t: "C900: Mieloma multiple" },
                { v: "C901", t: "C901: Leucemia de celulas plasmaticas" },
                { v: "C902", t: "C902: Plasmocitoma extramedular" },
                { v: "C911", t: "C911: Leucemia linfocítica crónica de célula tipo B" },
                { v: "C912", t: "C912: Leucemia linfocitica subaguda" },
                { v: "C913", t: "C913: Leucemia prolinfocítica de célula tipo B" },
                { v: "C914", t: "C914: Leucemia de celulas vellosas" },
                { v: "C915", t: "C915: Leucemia/linfoma de células T adultas [HTLV-1-asociado]" },
                { v: "C917", t: "C917: Otras leucemias linfoides" },
                { v: "C919", t: "C919: Leucemia linfoide, sin otra especificacion" },
                { v: "C921", t: "C921: Leucemia mieloide crónica [LMC], BCR/ABL-positivo" },
                { v: "C922", t: "C922: Leucemia mieloide crónica atípica, BCR/ABL-negativo" },
                { v: "C923", t: "C923: Sarcoma mieloide" },
                { v: "C927", t: "C927: Otras leucemias mieloides" },
                { v: "C929", t: "C929: Leucemia mieloide, sin otra especificacion" },
                { v: "C930", t: "C930: Leucemia monocítica/monoblástica aguda" },
                { v: "C931", t: "C931: Leucemia mielomonocítica crónica" },
                { v: "C932", t: "C932: Leucemia monocitica subaguda" },
                { v: "C937", t: "C937: Otras leucemias monociticas" },
                { v: "C939", t: "C939: Leucemia monocitica, sin otra especificacion" },
                { v: "C940", t: "C940: Leucemia eritroide aguda (antes ERITREMIA AGUDA Y ERITROLEUCEMIA)" },
                { v: "C941", t: "C941: Eritremia cronica" },
                { v: "C942", t: "C942: Leucemia megacarioblastica aguda" },
                { v: "C943", t: "C943: Leucemia de mastocitos" },
                { v: "C944", t: "C944: Panmielosis aguda con mielofibrosis" },
                { v: "C945", t: "C945: Mielofibrosis aguda" },
                { v: "C947", t: "C947: Otras leucemias especificadas" },
                { v: "C950", t: "C950: Leucemia aguda, celulas de tipo no especificado" },
                { v: "C951", t: "C951: Leucemia cronica, celulas de tipo no especificado" },
                { v: "C952", t: "C952: Leucemia subaguda, celulas de tipo no especificado" },
                { v: "C957", t: "C957: Otras leucemias de celulas de tipo no especificado" },
                { v: "C959", t: "C959: Leucemia, no especificada" },
                { v: "D45X", t: "D45X: Policitemia vera" },
                { v: "D460", t: "D460: Anemia refractaria sin sideroblastos" },
                { v: "D461", t: "D461: Anemia refractaria con sideroblastos en forma de anillo" },
                { v: "D462", t: "D462: Anemia refractaria con exceso de blastos [AREB I y II]" },
                { v: "D463", t: "D463: Anemia refractaria con exceso de blastos con trasformación" },
                { v: "D464", t: "D464: Anemia refractaria sin otra especificación" },
                { v: "D467", t: "D467: Otros síndromes mielodisplasicos" },
                { v: "D469", t: "D469: Síndrome mielodisplasico sin otra especificación" },
                { v: "D471", t: "D471: Enfermedad mieloproliferativa cronica" },
                { v: "D473", t: "D473: Trombocitopenia (hemorragica) esencial" },
                { v: "D752", t: "D752: Trombocitosis esencial" },
                { v: "D760", t: "D760: Histiocitosis de las celulas de langerhans, no clasificada en otra parte" },
                { v: "C770", t: "C770: Tumor maligno de los ganglios linfaticos de la cabeza, cara y cuello" },
                { v: "C771", t: "C771: Tumor maligno de los ganglios linfaticos intratoracicos" },
                { v: "C772", t: "C772: Tumor maligno de los ganglios linfaticos intraabdominales" },
                { v: "C773", t: "C773: Tumor maligno de los ganglios linfaticos de la axila y del miembro superior" },
                { v: "C774", t: "C774: Tumor maligno de los ganglios linfaticos de la region inguinal y del miembro inferior" },
                { v: "C775", t: "C775: Tumor maligno de los ganglios linfaticos de la pelvis" },
                { v: "C778", t: "C778: Tumor maligno de los ganglios linfaticos de regiones multiples" },
                { v: "C779", t: "C779: Tumor maligno del ganglio linfatico, sitio no especificado" },
                { v: "C780", t: "C780: Tumor maligno secundario del pulmon" },
                { v: "C781", t: "C781: Tumor maligno secundario del mediastino" },
                { v: "C782", t: "C782: Tumor maligno secundario de la pleura" },
                { v: "C783", t: "C783: Tumor maligno secundario de otros organos respiratorios y de los no especificados" },
                { v: "C784", t: "C784: Tumor maligno secundario del intestino delgado" },
                { v: "C785", t: "C785: Tumor maligno secundario del intestino grueso y del recto" },
                { v: "C786", t: "C786: Tumor maligno secundario del peritoneo y del retroperitoneo" },
                { v: "C787", t: "C787: Tumor maligno secundario del hígado y de los conductos biliares intrahepáticos" },
                { v: "C788", t: "C788: Tumor maligno secundario de otros organos digestivos y de los no especificados" },
                { v: "C790", t: "C790: Tumor maligno secundario del riñon y de la pelvis renal" },
                { v: "C791", t: "C791: Tumor maligno secundario de la vejiga, y de otros organos y los no especificados de las vias urinarias" },
                { v: "C792", t: "C792: Tumor maligno secundario de la piel" },
                { v: "C793", t: "C793: Tumor maligno secundario del encefalo y de las meninges cerebrales" },
                { v: "C794", t: "C794: Tumor maligno secundario de otras partes del sistema nervioso y de las no especificadas" },
                { v: "C795", t: "C795: Tumor maligno secundario de los huesos y de la medula osea" },
                { v: "C796", t: "C796: Tumor maligno secundario del ovario" },
                { v: "C797", t: "C797: Tumor maligno secundario de la glandula suprarrenal" },
                { v: "C798", t: "C798: Tumor maligno secundario de otros sitios especificados" },
                { v: "C799", t: "C799: Tumor maligno secundario, sitio no especificado" },
                { v: "C814", t: "C814: Linfoma de Hodgkin clásico rico en linfocitos" },
                { v: "C823", t: "C823: Linfoma folicular grado IIIa" },
                { v: "C824", t: "C824: Linfoma folicular grado IIIb" },
                { v: "C825", t: "C825: Linfoma centro folicular difuso" },
                { v: "C826", t: "C826: Linfoma centro folicular cutáneo" },
                { v: "C846", t: "C846: Linfoma anaplásico de células grandes ALK-positivo" },
                { v: "C847", t: "C847: Linfoma anaplásico de células grandes ALK-negativo" },
                { v: "C848", t: "C848: Linfoma cutáneo de células T, no especificado" },
                { v: "C849", t: "C849: Linfoma de células T/NK maduras, no especificado" },
                { v: "C852", t: "C852: Linfoma mediastinal de células B grandes (del timo)" },
                { v: "C860", t: "C860: Linfoma extranodal de células T/NK, tipo nasal" },
                { v: "C861", t: "C861: Linfoma hepatoesplénico de células T" },
                { v: "C862", t: "C862: Linfoma de células T tipo enteropatía (intestinal)" },
                { v: "C863", t: "C863: Linfoma de células T tipo paniculitis subcutánea" },
                { v: "C864", t: "C864: Linfoma blástico de células NK" },
                { v: "C865", t: "C865: Linfoma angioinmunoblástico de células T" },
                { v: "C866", t: "C866: Trastornos linfoproliferativos primario cutáneos de células T CD30-positivo" },
                { v: "C884", t: "C884: Linfoma de células B extranodal de zona marginal de tejido linfoide asociado a mucosas [Linfoma TLAM]" },
                { v: "C903", t: "C903: Plasmocitoma solitario" },
                { v: "C916", t: "C916: Leucemia prolinfocítica de células tipo T" },
                { v: "C918", t: "C918: Leucemia tipo Burkitt de células B maduras" },
                { v: "C926", t: "C926: Leucemia mieloide aguda con anormalidad 11q23" },
                { v: "C928", t: "C928: Leucemia mieloide aguda con displasia multilinaje" },
                { v: "C933", t: "C933: Leucemia mielomonocítica juvenil" },
                { v: "C946", t: "C946: Enfermedad mielodisplásica y mieloproliferativa, no clasificada en otra parte" },
                { v: "C964", t: "C964: Sarcoma de células dendríticas (células accesorias)" },
                { v: "C965", t: "C965: Histiocitosis de células de Langerhans multifocal y unisistémica" },
                { v: "C966", t: "C966: Histiocitosis de células de Langerhans unifocal" },
                { v: "C968", t: "C968: Sarcoma histiocítico" },
                { v: "D465", t: "D465: Anemia refractaria con displasia multilinaje" },
                { v: "D466", t: "D466: Síndrome mielodisplásico con anormalidad cromosómica aislada del (5q)" },
                { v: "D474", t: "D474: Osteomielofibrosis crónica" },
                { v: "D475", t: "D475: Leucemia eosinofílica crónica [síndrome hipereosinofílico]" }
        ];

        window.SELECT_OPTIONS["VAR21_TipoEstudioRealizoDiagnostico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Histología del tumor primario (SOLO Para los pacientes anteriores (antiguos) y que fueron reportados antes del 2020)" },
                { v: "2", t: "2: Histología de metástasis (SOLO Para los pacientes anteriores (antiguos) y que fueron reportados antes del 2020)" },
                { v: "3", t: "3: Citología exfoliativa (SOLO Para los pacientes anteriores (antiguos) y que fueron reportados antes del 2020)" },
                { v: "4", t: "4: Aspiración con aguja fina (BACAF) (SOLO Para los pacientes anteriores (antiguos) y que fueron reportados antes del 2020)" }, // <-- CORREGIDO AQUÍ
                { v: "5", t: "5: Inmunohistoquímica" },
                { v: "6", t: "6: Citometría de flujo" },
                { v: "7", t: "7: Clínica exclusivamente (incluye estudios imagenológicos y/o de laboratorio en aquellos casos clínicamente justificados en donde fue imposible tomar muestra de estudio histopatológico)" },
                { v: "8", t: "8: Otro" },
                { v: "9", t: "9: Genética" },
                { v: "10", t: "10: Patología básica" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos." }
        ];

        window.SELECT_OPTIONS["VAR22_MotivoUsuarioNOTuvoDiagnostico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Clínica, usuario con coagulopatía" },
                { v: "2", t: "2: Clínica, debido a localización del tumor" },
                { v: "3", t: "3: Clínica, debido al estado funcional del usuario (deterioro)" },
                { v: "4", t: "4: Negativa del usuario o su acudiente para realizar el estudio histopatológico, con documentación de soporte" },
                { v: "5", t: "5: Administrativa" },
                { v: "6", t: "6: Clínica por reporte de imágenes o laboratorios." },
                { v: "98", t: "98: Tiene confirmación por histopatología" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos." }
        ];

        window.SELECT_OPTIONS["VAR27_HistologiaTumorMuestraBiopsia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Adenocarcinoma, con o sin otra especificación" },
                { v: "2", t: "2: Carcinoma escamocelular (epidermoide), con o sin otra especificación" },
                { v: "3", t: "3: Carcinoma de células basales (basocelular)" },
                { v: "4", t: "4: Carcinoma, con o sin otra especificación diferentes a las anteriores" },
                { v: "5", t: "5: Oligodendroglioma, con o sin otra especificación" },
                { v: "6", t: "6: Astrocitoma, con o sin otra especificación" },
                { v: "7", t: "7: Ependimoma, con o sin otra especificación" },
                { v: "8", t: "8: Neuroblastoma, con o sin otra especificación" },
                { v: "9", t: "9: Meduloblastoma, con o sin otra especificación" },
                { v: "10", t: "10: Hepatoblastoma, con o sin otra especificación" },
                { v: "11", t: "11: Rabdomiosarcoma, con o sin otra especificación" },
                { v: "12", t: "12: Leiomiosarcoma, con o sin otra especificación" },
                { v: "13", t: "13: Osteosarcoma, con o sin otra especificación" },
                { v: "14", t: "14: Fibrosarcoma, con o sin otra especificación" },
                { v: "15", t: "15: Angiosarcoma, con o sin otra especificación" },
                { v: "16", t: "16: Condrosarcoma, con o sin otra especificación" },
                { v: "17", t: "17: Otros sarcomas, con o sin otra especificación" },
                { v: "18", t: "18: Pancreatoblastoma, con o sin otra especificación" },
                { v: "19", t: "19: Blastoma pleuropulmonar, con o sin otra especificación" },
                { v: "20", t: "20: Otros tipos histológicos no mencionados" },
                { v: "21", t: "21: Célula pequeña (cáncer de pulmón)" },
                { v: "23", t: "23: Melanoma" },
                { v: "24", t: "24: Carcinoma papilar de tiroides" },
                { v: "98", t: "98: No se realizó estudio histopatológico (en la variable 21 registró la opción 7)" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR28_GradoDiferenciacionTumorSolidoMaligno"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Bien diferenciado (grado 1)" },
                { v: "2", t: "2: Moderadamente diferenciado (grado 2)" },
                { v: "3", t: "3: Mal diferenciado (grado 3)" },
                { v: "4", t: "4: Anaplásico o indiferenciado (grado 4) " },
                { v: "94", t: "94: Es un cáncer sólido cuyo reporte de patología no incluye la descripción de la diferenciación celular. (ejemplo: cáncer de tiroides, carcinoma basocelular, tumores in situ, melanoma, próstata, entre otros)" },
                { v: "95", t: "95: No es sólido (cáncer hematolinfáticos)" },
                { v: "98", t: "98: No se realizó estudio histopatológico (en la variable 21 registró la opción 7)" },
                { v: "99", t: "99: No hay información en la historia clínica" }
        ];

        // ===============================
        // VAR29_SiEsTumorSolido (ENCADENADO: Categoría UI -> Estadio clínico que se guarda)
        // ===============================

        window.SELECT_OPTIONS = window.SELECT_OPTIONS || {};
        window.SELECT_OPTIONS_BY_GROUP = window.SELECT_OPTIONS_BY_GROUP || {};

        // Select A: Categoría (SOLO UI, NO se guarda)
        window.SELECT_OPTIONS["__ui_estadio_cat"] = [
                { v: "", t: "Selecciona categoría..." },
                { v: "MAMA_GASTRICO", t: "Cáncer de mama y cáncer gástrico" },
                { v: "PROSTATA", t: "Cáncer de próstata" },
                { v: "PULMON", t: "Cáncer de pulmón" },
                { v: "MELANOMA", t: "Melanoma" },
                { v: "COLON_RECTO", t: "Cáncer de colon y recto" },
                { v: "ANAL", t: "Cáncer anal (Agrupador colon y recto)" },
                { v: "CERVIX_FIGO", t: "Cáncer de cérvix (FIGO)" },
                { v: "OTRAS", t: "Otras opciones" }
        ];

        // Select B: Opciones por categoría (SÍ se guarda solo el CÓDIGO numérico final)
        window.SELECT_OPTIONS_BY_GROUP["VAR29_SiEsTumorSolido"] = {
                "MAMA_GASTRICO": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "2", t: "2: EC IA o 1A" },
                        { v: "5", t: "5: EC IB o 1B" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "20", t: "20: EC IV o 4" }
                ],

                "PROSTATA": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "1", t: "1: EC I o 1" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB" },
                        { v: "15", t: "15: EC IIC o 2C" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "21", t: "21: EC IVA o 4A" },
                        { v: "22", t: "22: EC IVB o 4B" }
                ],

                "PULMON": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "3", t: "3: EC IA1" },
                        { v: "4", t: "4: EC IA2" },
                        { v: "36", t: "36: EC IA3" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB o 2B" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "21", t: "21: EC IVA o 4A" },
                        { v: "22", t: "22: EC IVB o 4B" }
                ],

                "MELANOMA": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "2", t: "2: EC IA o 1A" },
                        { v: "5", t: "5: EC IB o 1B" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB o 2B" },
                        { v: "15", t: "15: EC IIC o 2C" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "29", t: "29: EC IIID o 3D" },
                        { v: "20", t: "20: EC IV o 4" }
                ],

                "COLON_RECTO": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "1", t: "1: EC I o 1" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB o 2B" },
                        { v: "15", t: "15: EC IIC o 2C" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "21", t: "21: EC IVA o 4A" },
                        { v: "22", t: "22: EC IVB o 4B" },
                        { v: "23", t: "23: EC IVC o 4C" }
                ],

                "ANAL": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "1", t: "1: EC I o 1" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "14", t: "14: EC IIB o 2B" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "20", t: "20: EC IV o 4" }
                ],

                "CERVIX_FIGO": [
                        { v: "", t: "Selecciona..." },
                        { v: "0", t: "0: EC 0 (tumor in situ)" },
                        { v: "1", t: "1: EC I o 1" },
                        { v: "2", t: "2: EC IA o 1A" },
                        { v: "3", t: "3: EC IA1" },
                        { v: "4", t: "4: EC IA2" },
                        { v: "5", t: "5: EC IB o 1B" },
                        { v: "6", t: "6: EC IB1" },
                        { v: "7", t: "7: EC IB2" },
                        { v: "30", t: "30: EC IB3" },
                        { v: "10", t: "10: EC II o 2" },
                        { v: "11", t: "11: EC IIA o 2A" },
                        { v: "12", t: "12: EC IIA1" },
                        { v: "13", t: "13: EC IIA2" },
                        { v: "14", t: "14: EC IIB o 2B" },
                        { v: "16", t: "16: EC III o 3" },
                        { v: "17", t: "17: EC IIIA o 3A" },
                        { v: "18", t: "18: EC IIIB o 3B" },
                        { v: "19", t: "19: EC IIIC o 3C" },
                        { v: "27", t: "27: EC IIIC1" },
                        { v: "28", t: "28: EC IIIC2" },
                        { v: "21", t: "21: EC IVA o 4A" },
                        { v: "22", t: "22: EC IVB o 4B" }
                ],

                "OTRAS": [
                        { v: "", t: "Selecciona..." },
                        { v: "8", t: "8: EC IC o 1C" },
                        { v: "9", t: "9: EC IS o 1S" },
                        { v: "24", t: "24: EC 4S (para neuroblastoma)" },
                        { v: "25", t: "25: EC V o 5" },
                        { v: "31", t: "31: EC IC1" },
                        { v: "32", t: "32: EC IC2" },
                        { v: "33", t: "33: EC IC3" },
                        { v: "34", t: "34: EC IIIA1" },
                        { v: "35", t: "35: EC IIIA2" },
                        { v: "98", t: "98: No Aplica" },
                        { v: "99", t: "99: Desconocido" }
                ]
        };

        window.SELECT_OPTIONS["VAR31_ParaCancerMama"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí se le realizó" },
                { v: "2", t: "2: No se le realizó" },
                { v: "97", t: "97: No Aplica porque es cáncer de mama in situ" },
                { v: "98", t: "98: No Aplica (no es cáncer de mama)" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR33_ParaCancerMamaResultadoPrimera"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: +++ (positivo" },
                { v: "2", t: "2: ++ (equivoco o indeterminado)" },
                { v: "3", t: "3: + (negativo)" },
                { v: "4", t: "4: cero ó (negativo)" },
                { v: "97", t: "97: No Aplica porque es cáncer de mama in situ" },
                { v: "98", t: "98: No Aplica (no es cáncer de mama) o marcó la variable 31 con la opción 2" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR34_ParaCancerColorrectalEstadificacionDukes"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: A" },
                { v: "2", t: "2: B" },
                { v: "3", t: "3: C" },
                { v: "4", t: "4: D" },
                { v: "98", t: "98: No Aplica (no es cáncer colorrectal)" },
                { v: "99", t: "99: Es cáncer colorrectal pero no hay información en la historia clínica acerca de esta estadificación" } // <-- CORREGIDO AQUÍ
        ];

        window.SELECT_OPTIONS["VAR36_EstadificacionLinfomaClinicaHodgkin"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Estadio I" },
                { v: "2", t: "2: Estadio II" },
                { v: "3", t: "3: Estadio III" },
                { v: "4", t: "4: Estadio IV" },
                { v: "5", t: "5: Estadio IA" },
                { v: "6", t: "6: Estadio IB" },
                { v: "7", t: "7: Estadio IIA" },
                { v: "8", t: "8: Estadio IIB" },
                { v: "9", t: "9: Estadio IIIA" },
                { v: "10", t: "10: Estadio IIIB" },
                { v: "11", t: "11: Estadio IVA" },
                { v: "12", t: "12: Estadio IVB" },
                { v: "13", t: "13: Extranodal cualquier estadio" },
                { v: "14", t: "14: Primario SNC" },
                { v: "15", t: "15: Primario Mediastinal" },
                { v: "16", t: "16: Primario de otros órganos" },
                { v: "98", t: "98: No Aplica (porque es un tumor diferente a los enunciados)" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR37_CancerProstataValorClasificacionGleason"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Gleason 1 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "2", t: "2: Gleason 2 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "3", t: "3: Gleason 3 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "4", t: "4: Gleason 4 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "5", t: "5: Gleason 5 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "6", t: "6: Gleason 6 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "7", t: "7: Gleason 7 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "8", t: "8: Gleason 8 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "9", t: "9: Gleason 9 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "10", t: "10: Gleason 10 (Estos valores ya NO SON válidos para casos nuevos)" },
                { v: "11", t: "11: Gleason ≤ 6: ≤ 3+3" },
                { v: "12", t: "12: Gleason 7: 3+4" },
                { v: "13", t: "13: Gleason 7: 4+3" },
                { v: "14", t: "14: Gleason 8: 4+4 o 3+5 o 5+3" },
                { v: "15", t: "15: Gleason 9 o 10: 4+5 o 5+4 o 5+5" },
                { v: "97", t: "97: Es cáncer de próstata, pero no hay información acerca de esta estadificación porque el diagnóstico fue clínico" }, // <-- CORREGIDO AQUÍ
                { v: "98", t: "98: No es cáncer de próstata" },
                { v: "99", t: "99: Es cáncer de próstata, pero no hay información en la historia clínica acerca de esta clasificación a pesar de que fue diagnóstico histopatológico" }
        ];

        // ===============================
        // VAR38_ClasificacionRiesgoLeucemiasLinfomas (ENCADENADO: Categoría -> Riesgo)
        // ===============================

        window.SELECT_OPTIONS = window.SELECT_OPTIONS || {};
        window.SELECT_OPTIONS_BY_GROUP = window.SELECT_OPTIONS_BY_GROUP || {};

        // Select A: Categoría (SOLO UI, NO se guarda)
        window.SELECT_OPTIONS["__ui_riesgo38_cat"] = [
                { v: "", t: "Selecciona categoría..." },
                { v: "LNH", t: "Clasificación de riesgo en linfoma no Hodgkin" },
                { v: "LH", t: "Clasificación de riesgo en linfoma de Hodgkin" },
                { v: "ADULTOS", t: "Clasificación del riesgo en adultos (LLA, LMA y MM)" },
                { v: "PEDIATRIA", t: "Clasificación del riesgo en Pediatría (LLA y LMA)" },
                { v: "OTRAS", t: "Otras (No aplica / Desconocido)" }
        ];

        // Select B: Opciones por categoría (SÍ se guarda solo el CÓDIGO numérico final)
        window.SELECT_OPTIONS_BY_GROUP["VAR38_ClasificacionRiesgoLeucemiasLinfomas"] = {
                "LNH": [
                        { v: "", t: "Selecciona..." },
                        { v: "1", t: "1: Bajo Riesgo" },
                        { v: "2", t: "2: Riesgo intermedio bajo" },
                        { v: "3", t: "3: Intermedio" },
                        { v: "4", t: "4: Riesgo intermedio alto" },
                        { v: "5", t: "5: Riesgo alto" }
                ],

                "LH": [
                        { v: "", t: "Selecciona..." },
                        { v: "1", t: "1: Bajo Riesgo" },
                        { v: "5", t: "5: Riesgo alto" }
                ],

                "ADULTOS": [
                        { v: "", t: "Selecciona..." },
                        { v: "1", t: "1: Riesgo estándar, bajo" },
                        { v: "3", t: "3: Riesgo intermedio" },
                        { v: "5", t: "5: Riesgo alto" }
                ],

                "PEDIATRIA": [
                        { v: "", t: "Selecciona..." },
                        { v: "1", t: "1: Riesgo estándar, favorable, bajo riesgo" },
                        { v: "3", t: "3: Riesgo intermedio" },
                        { v: "5", t: "5: Riesgo alto, desfavorable" }
                ],

                "OTRAS": [
                        { v: "", t: "Selecciona..." },
                        { v: "98", t: "98: No Aplica (no es leucemia, ni linfoma)" },
                        { v: "99", t: "99: Desconocido (no descrito en soportes clínicos)" }
                ]
        };

        window.SELECT_OPTIONS["VAR40_ObjetivoTratamientoMedicoInic"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Curación" },
                { v: "2", t: "2: Paliación (intención paliativa) exclusivamente." },
                { v: "3", t: "3: Manejo expectante una vez se ha realizado el diagnóstico" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR41_ObjetivoIntervencionMedicaPeriodoReporte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Observación previa a tratamiento (manejo expectante o casos en los que ya tienen orden médica de tratamiento, pero no alcanzó a ser administrado, dado que está cercano a la fecha del corte)" },
                { v: "2", t: "2: Ofrecer tratamiento curativo (quimioterapia, hormonoterapia, radioterapia, cirugía, terapia biológica) o paliativo dirigido al cáncer inicial o por recaída" },
                { v: "3", t: "3: Observación o seguimiento oncológico luego de tratamiento inicial (incluye tratamientos médicos para enfermedad general -no oncológica- y métodos diagnósticos de seguimiento)" },
                { v: "4", t: "4: 1 y 2 únicamente" },
                { v: "5", t: "5: 2 y 3 únicamente" },
                { v: "6", t: "6: 1, 2 y 3" },
                { v: "99", t: "99: No hay intervención en el periodo (abandono de terapia, alta oncológica ó alta voluntaria)" }
        ];

        window.SELECT_OPTIONS["VAR42_TieneAntecedenteOtroCancerPrimario"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí" },
                { v: "2", t: "2: No" },
                { v: "99", t: "99: Desconocido, el dato de esta variable no se encuentra descrito en los soportes clínicos" }
        ];

        window.SELECT_OPTIONS["VAR44_TipoCancerAntecedente"] = [
                { v: "", t: "Selecciona..." },
                { v: "99", t: "99: No Aplica (no hay antecedente o concurrencia de otro cáncer primario)" },
                { v: "C530", t: "C530: Tumor maligno del endocervix" },
                { v: "C531", t: "C531: Tumor maligno de exocervix" },
                { v: "C538", t: "C538: Lesion de sitios contiguos del cuello del utero" },
                { v: "C539", t: "C539: Tumor maligno del cuello del utero, sin otra especificacion" },
                { v: "D060", t: "D060: Carcinoma in situ del endocervix" },
                { v: "D061", t: "D061: Carcinoma in situ del exocervix" },
                { v: "D067", t: "D067: Carcinoma in situ de otras partes especificadas del cuello del utero" },
                { v: "D069", t: "D069: Carcinoma in situ del cuello del utero, parte no especificada" },
                { v: "C180", t: "C180: Tumor maligno del ciego" },
                { v: "C181", t: "C181: Tumor maligno del apendice" },
                { v: "C182", t: "C182: Tumor maligno del colon ascendente" },
                { v: "C183", t: "C183: Tumor maligno del angulo hepatico" },
                { v: "C184", t: "C184: Tumor maligno del colon transverso" },
                { v: "C185", t: "C185: Tumor maligno del angulo esplenico" },
                { v: "C186", t: "C186: Tumor maligno del colon descendente" },
                { v: "C187", t: "C187: Tumor maligno del colon sigmoide" },
                { v: "C188", t: "C188: Lesion de sitios contiguos del colon" },
                { v: "C189", t: "C189: Tumor maligno del colon, parte no especificada" },
                { v: "C19X", t: "C19X: Tumor maligno de la unión rectosigmoidea" },
                { v: "C20X", t: "C20X: Tumor maligno del recto" },
                { v: "C210", t: "C210: Tumor maligno del ano, parte no especificada" },
                { v: "C211", t: "C211: Tumor maligno del conducto anal" },
                { v: "C212", t: "C212: Tumor maligno de la zona cloacogenica" },
                { v: "C218", t: "C218: Lesion de sitios contiguos del ano, del conducto anal y del recto" },
                { v: "D010", t: "D010: Carcinoma in situ del colon" },
                { v: "D011", t: "D011: Carcinoma in situ de la union rectosigmoidea" },
                { v: "D012", t: "D012: Carcinoma in situ del recto" },
                { v: "D013", t: "D013: Carcinoma in situ del ano y del conducto anal" },
                { v: "C160", t: "C160: Tumor maligno del cardias" },
                { v: "C161", t: "C161: Tumor maligno del fundus gastrico" },
                { v: "C162", t: "C162: Tumor maligno del cuerpo del estomago" },
                { v: "C163", t: "C163: Tumor maligno del antro pilorico" },
                { v: "C164", t: "C164: Tumor maligno del piloro" },
                { v: "C165", t: "C165: Tumor maligno de la curvatura menor del estomago, sin otra especificacion" },
                { v: "C166", t: "C166: Tumor maligno de la curvatura mayor del estomago, sin otra especificacion" },
                { v: "C168", t: "C168: Lesion de sitios contiguos del estomago" },
                { v: "C169", t: "C169: Tumor maligno del estomago, parte no especificada" },
                { v: "D002", t: "D002: Carcinoma in situ del estomago" },
                { v: "C810", t: "C810: Linfoma de Hodgkin nodular con predominio linfocítico" },
                { v: "C811", t: "C811: Linfoma de Hodgkin (clásico) con esclerosis nodular" },
                { v: "C812", t: "C812: Linfoma de Hodgkin (clásico) con celularidad mixta" },
                { v: "C813", t: "C813: Linfoma de Hodgkin (clásico) con depleción linfocítica" },
                { v: "C817", t: "Otros linfomas de Hodgkin (clásicos)" },
                { v: "C819", t: "C819: Linfoma de Hodgkin, no especificado" },
                { v: "C910", t: "C910: Leucemia linfoblástica aguda [LLA]" },
                { v: "C920", t: "C920: Leucemia mieloblástica aguda [LMA]" },
                { v: "C924", t: "C924: Leucemia promielocítica aguda [LPA]" },
                { v: "C925", t: "C925: Leucemia mielomonocitica aguda" },
                { v: "C500", t: "C500: Tumor maligno del pezon y areola mamaria" },
                { v: "C501", t: "C501: Tumor maligno de la porcion central de la mama" },
                { v: "C502", t: "C502: Tumor maligno del cuadrante superior interno de la mama" },
                { v: "C503", t: "C503: Tumor maligno del cuadrante inferior interno de la mama" },
                { v: "C504", t: "C504: Tumor maligno del cuadrante superior externo de la mama" },
                { v: "C505", t: "C505: Tumor maligno del cuadrante inferior externo de la mama" },
                { v: "C506", t: "C506: Tumor maligno de la prolongacion axilar de la mama" },
                { v: "C508", t: "C508: Lesion de sitios contiguos de la mama" },
                { v: "C509", t: "C509: Tumor maligno de la mama, parte no especificada" },
                { v: "D050", t: "D050: Carcinoma in situ lobular" },
                { v: "D051", t: "D051: Carcinoma in situ intracanalicular" },
                { v: "D057", t: "D057: Otros carcinomas in situ de la mama" },
                { v: "D059", t: "D059: Carcinoma in situ de la mama, parte no especificada" },
                { v: "C430", t: "C430: Melanoma maligno del labio" },
                { v: "C431", t: "C431: Melanoma maligno del parpado, incluida la comisura palpebral" },
                { v: "C432", t: "C432: Melanoma maligno de la oreja y del conducto auditivo externo" },
                { v: "C433", t: "C433: Melanoma maligno de las otras partes y las no especificadas de la cara" },
                { v: "C434", t: "C434: Melanoma maligno del cuero cabelludo y del cuello" },
                { v: "C435", t: "C435: Melanoma maligno del tronco" },
                { v: "C436", t: "C436: Melanoma maligno del miembro superior, incluido el hombro" },
                { v: "C437", t: "C437: Melanoma maligno del miembro inferior, incluida la cadera" },
                { v: "C438", t: "C438: Melanoma maligno de sitios contiguos de la piel" },
                { v: "C439", t: "C439: Melanoma maligno de piel, sitio no especificado" },
                { v: "D030", t: "D030: Melanoma in situ del labio" },
                { v: "D031", t: "D031: Melanoma in situ del parpado y de la comisura palpebral" },
                { v: "D032", t: "D032: Melanoma in situ de la oreja y del conducto auditivo externo" },
                { v: "D033", t: "D033: Melanoma in situ de otras partes y de las no especificadas de la cara" },
                { v: "D034", t: "D034: Melanoma in situ del cuero cabelludo y del cuello" },
                { v: "D035", t: "D035: Melanoma in situ del tronco" },
                { v: "D036", t: "D036: Melanoma in situ del miembro superior, incluido el hombro" },
                { v: "D037", t: "D037: Melanoma in situ del miembro inferior, incluida la cadera" },
                { v: "D038", t: "D038: Melanoma in situ de otros sitios" },
                { v: "D039", t: "D039: Melanoma in situ, sitio no especificado" },
                { v: "C820", t: "C820: Linfoma folicular grado I" },
                { v: "C821", t: "C821: Linfoma folicular grado II" },
                { v: "C822", t: "C822: Linfoma folicular grado III, no especificado" },
                { v: "C827", t: "C827: Otros tipos especificados de linfoma folicular" },
                { v: "C829", t: "C829: Linfoma folicular, sin otra especificación" },
                { v: "C830", t: "C830: Linfoma de células B pequeñas" },
                { v: "C831", t: "C831: Linfoma de células del manto" },
                { v: "C832", t: "C832: Linfoma no hodgkin mixto, de celulas pequeñas y grandes (difuso)" },
                { v: "C833", t: "C833: Linfoma de células grandes B difuso" },
                { v: "C834", t: "C834: Linfoma no hodgkin inmunoblastico (difuso)" },
                { v: "C835", t: "C835: Linfoma linfoblástico (difuso)" },
                { v: "C836", t: "C836: Linfoma no hodgkin indiferenciado (difuso)" },
                { v: "C837", t: "C837: Linfoma de Burkitt" },
                { v: "C838", t: "C838: Otros tipos especificados de linfoma no folicular" },
                { v: "C839", t: "C839: Linfoma no folicular (difuso), sin otra especificación" },
                { v: "C840", t: "C840: Micosis fungoide" },
                { v: "C841", t: "C841: Enfermedad de sezary" },
                { v: "C842", t: "C842: Linfoma de zona t" },
                { v: "C843", t: "C843: Linfoma linfoepitelioide" },
                { v: "C844", t: "C844: Linfoma de celulas t periferico" },
                { v: "C845", t: "C845: Otros linfomas de celulas y los no especificados" },
                { v: "C850", t: "C850: Linfosarcoma" },
                { v: "C851", t: "C851: Linfoma de celulas b, sin otra especificacion" },
                { v: "C857", t: "C857: Otros tipos especificados de linfoma no hodgkin" },
                { v: "C859", t: "C859: Linfoma no hodgkin, no especificado" },
                { v: "C960", t: "C960: Histiocitosis de células de Langerhans multifocal y multisistémica (diseminada) [Enfermedad de Letterer-Siwe]" },
                { v: "C961", t: "C961: Histiocitosis maligna" },
                { v: "C962", t: "C962: Tumor maligno de mastocitos" },
                { v: "C963", t: "C963: Linfoma histiocitico verdadero" },
                { v: "C967", t: "C967: Otros tumores malignos especificados del tejido linfatico, hematopoyetico y tejidos afines" },
                { v: "C969", t: "C969: Tumor maligno del tejido linfatico, hematopoyetico y tejidos afines, sin otra especificacion" },
                { v: "C61X", t: "C61X: Tumor maligno de la próstata" },
                { v: "D075", t: "D075: Carcinoma in situ de la prostata" },
                { v: "C33X", t: "C33X: Tumor maligno de la tráquea" },
                { v: "C340", t: "C340: Tumor maligno del bronquio principal" },
                { v: "C341", t: "C341: Tumor maligno del lobulo superior, bronquio o pulmon" },
                { v: "C342", t: "C342: Tumor maligno del lobulo medio, bronquio o pulmon" },
                { v: "C343", t: "C343: Tumor maligno del lobulo inferior, bronquio o pulmon" },
                { v: "C348", t: "C348: Lesion de sitios contiguos de los bronquios y del pulmon" },
                { v: "C349", t: "C349: Tumor maligno de los bronquios o del pulmon, parte no especificada" },
                { v: "D021", t: "D021: Carcinoma in situ de la traquea" },
                { v: "D022", t: "D022: Carcinoma in situ del bronquio y del pulmon" },
                { v: "C000", t: "C000: Tumor maligno del labio superior, cara externa" },
                { v: "C001", t: "C001: Tumor maligno del labio inferior, cara externa" },
                { v: "C002", t: "C002: Tumor maligno del labio, cara externa, sin otra especificacion" },
                { v: "C003", t: "C003: Tumor maligno del labio superior, cara interna" },
                { v: "C004", t: "C004: Tumor maligno del labio inferior, cara interna" },
                { v: "C005", t: "C005: Tumor maligno del labio, cara interna, sin otra especificacion" },
                { v: "C006", t: "C006: Tumor maligno de la comisura labial" },
                { v: "C008", t: "C008: Lesion de sitios contiguos del labio" },
                { v: "C009", t: "C009: Tumor maligno del labio, parte no especificada" },
                { v: "C01X", t: "C01X: Tumor maligno de la base de la lengua" },
                { v: "C020", t: "C020: Tumor maligno de la cara dorsal de la lengua" },
                { v: "C021", t: "C021: Tumor maligno del borde de la lengua" },
                { v: "C022", t: "C022: Tumor maligno de la cara ventral de la lengua" },
                { v: "C023", t: "C023: Tumor maligno de los dos tercios anteriores de la lengua, parte no especificada" },
                { v: "C024", t: "C024: Tumor maligno de la amigdala lingual" },
                { v: "C028", t: "C028: Lesion de sitios contiguos de la lengua" },
                { v: "C029", t: "C029: Tumor maligno de la lengua, parte no especificada" },
                { v: "C030", t: "C030: Tumor maligno de la encia superior" },
                { v: "C031", t: "C031: Tumor maligno de la encia inferior" },
                { v: "C039", t: "C039: Tumor maligno de la encia, parte no especificada" },
                { v: "C040", t: "C040: Tumor maligno de la parte anterior del piso de la boca" },
                { v: "C041", t: "C041: Tumor maligno de la parte lateral del piso de la boca" },
                { v: "C048", t: "C048: Lesion de sitios contiguos del piso de la boca" },
                { v: "C049", t: "C049: Tumor maligno del piso de la boca, parte no especificada" },
                { v: "C050", t: "C050: Tumor maligno del paladar duro" },
                { v: "C051", t: "C051: Tumor maligno del paladar blando" },
                { v: "C052", t: "C052: Tumor maligno de la uvula" },
                { v: "C058", t: "C058: Lesion de sitios contiguos del paladar" },
                { v: "C059", t: "C059: Tumor maligno del paladar, parte no especificada" },
                { v: "C060", t: "C060: Tumor maligno de la mucosa de la mejilla" },
                { v: "C061", t: "C061: Tumor maligno del vestibulo de la boca" },
                { v: "C062", t: "C062: Tumor maligno del area retromolar" },
                { v: "C068", t: "C068: Lesion de sitios contiguos de otras partes y de las no especificadas de la boca" },
                { v: "C069", t: "C069: Tumor maligno de la boca, parte no especificada" },
                { v: "C07X", t: "C07X: Tumor maligno de la glándula parótida" },
                { v: "C080", t: "C080: Tumor maligno de la glandula submaxilar" },
                { v: "C081", t: "C081: Tumor maligno de la glandula sublingual" },
                { v: "C088", t: "C088: Lesion de sitios contiguos de las glandulas salivales mayores" },
                { v: "C089", t: "C089: Tumor maligno de glandula salival mayor, no especificada" },
                { v: "C090", t: "C090: Tumor maligno de la fosa amigdalina" },
                { v: "C091", t: "C091: Tumor maligno del pilar amigdalino (anterior) (posterior)" },
                { v: "C098", t: "C098: Lesion de sitios contiguos de la amigdala" },
                { v: "C099", t: "C099: Tumor maligno de la amigdala, parte no especificada" },
                { v: "C100", t: "C100: Tumor maligno de la valecula" },
                { v: "C101", t: "C101: Tumor maligno de la cara anterior de la epiglotis" },
                { v: "C102", t: "C102: Tumor maligno de la pared lateral de la orofaringe" },
                { v: "C103", t: "C103: Tumor maligno de la pared posterior de la orofaringe" },
                { v: "C104", t: "C104: Tumor maligno de la hendidura branquial" },
                { v: "C108", t: "C108: Lesion de sitios contiguos de la orofaringe" },
                { v: "C109", t: "C109: Tumor maligno de la orofaringe, parte no especificada" },
                { v: "C110", t: "C110: Tumor maligno de la pared superior de la nasofaringe" },
                { v: "C111", t: "C111: Tumor maligno de la pared posterior de la nasofaringe" },
                { v: "C112", t: "C112: Tumor maligno de la pared lateral de la nasofaringe" },
                { v: "C113", t: "C113: Tumor maligno de la pared anterior de la nasofaringe" },
                { v: "C118", t: "C118: Lesion de sitios contiguos de la nasofaringe" },
                { v: "C119", t: "C119: Tumor maligno de la nasofaringe, parte no especificada" },
                { v: "C12X", t: "C12X: Tumor maligno del seno piriforme" },
                { v: "C130", t: "C130: Tumor maligno de la region postcricoidea" },
                { v: "C131", t: "C131: Tumor maligno del pliegue aritenoepiglotico, cara hipofaringea" },
                { v: "C132", t: "C132: Tumor maligno de la pared posterior de la hipofaringe" },
                { v: "C138", t: "C138: Lesion de sitios contiguos de la hipofaringe" },
                { v: "C139", t: "C139: Tumor maligno de la hipofaringe, parte no especificada" },
                { v: "C140", t: "C140: Tumor maligno de la faringe, parte no especificada" },
                { v: "C142", t: "C142: Tumor maligno del anillo de waldeyer" },
                { v: "C148", t: "C148: Lesion de sitios contiguos del labio, de la cavidad bucal y de la laringe" },
                { v: "D000", t: "C000: Carcinoma in situ del labio, de la cavidad bucal y de la faringe" },
                { v: "C150", t: "C150: Tumor maligno del esofago, porcion cervical" },
                { v: "C151", t: "C151: Tumor maligno del esofago, porcion toracica" },
                { v: "C152", t: "C152: Tumor maligno del esofago, porcion abdominal" },
                { v: "C153", t: "C153: Tumor maligno del tercio superior del esofago" },
                { v: "C154", t: "C154: Tumor maligno del tercio medio del esofago" },
                { v: "C155", t: "C155: Tumor maligno del tercio inferior del esofago" },
                { v: "C158", t: "C158: Lesion de sitios contiguos del esofago" },
                { v: "C159", t: "C159: Tumor maligno del esofago, parte no especificada" },
                { v: "D023", t: "D023: Carcinoma in situ de otras partes del sistema respiratorio" },
                { v: "D024", t: "D024: Carcinoma in situ de organos respiratorios no especificados" },
                { v: "C400", t: "C400: Tumor maligno del omoplato y de los huesos largos del miembro superior" },
                { v: "C401", t: "C401: Tumor maligno de los huesos cortos del miembro superior" },
                { v: "C402", t: "C402: Tumor maligno de los huesos largos del miembro inferior" },
                { v: "C403", t: "C403: Tumor maligno de los huesos cortos del miembro inferior" },
                { v: "C408", t: "C408: Lesion de sitios contiguos de los huesos y de los cartilagos articulares de los miembros" },
                { v: "C409", t: "C409: Tumor maligno de los huesos y de los cartilagos articulares de los miembros, sin otra especificacion" },
                { v: "C410", t: "C410: Tumor maligno de los huesos del craneo y de la cara" },
                { v: "C411", t: "C411: Tumor maligno del hueso del maxilar inferior" },
                { v: "C412", t: "C412: Tumor maligno de la columna vertebral" },
                { v: "C413", t: "C413: Tumor maligno de la costilla, esternon y clavicula" },
                { v: "C414", t: "C414: Tumor maligno de los huesos de la pelvis, sacro y coccix" },
                { v: "C418", t: "C418: Lesion de sitios contiguos del hueso y del cartilago articular" },
                { v: "C419", t: "C419: Tumor maligno de hueso y del cartilago articular, no especificado" },
                { v: "C440", t: "C440: Tumor maligno de la piel del labio" },
                { v: "C441", t: "C441: Tumor maligno de la piel del parpado, incluida la comisura palpebral" },
                { v: "C442", t: "C442: Tumor maligno de la piel de la oreja y del conducto auditivo externo" },
                { v: "C443", t: "C443: Tumor maligno de la piel de otras partes y de las no especificadas de la cara" },
                { v: "C444", t: "C444: Tumor maligno de la piel del cuero cabelludo y del cuello" },
                { v: "C445", t: "C445: Tumor maligno de la piel del tronco" },
                { v: "C446", t: "C446: Tumor maligno de la piel del miembro superior, incluido el hombro" },
                { v: "C447", t: "C447: Tumor maligno de la piel del miembro inferior, incluida la cadera" },
                { v: "C448", t: "C448: Lesion de sitios contiguos de la piel" },
                { v: "C449", t: "C449: Tumor maligno de la piel, sitio no especificado" },
                { v: "D040", t: "D040: Carcinoma in situ de la piel del labio" },
                { v: "D041", t: "D041: Carcinoma in situ de la piel del parpado y de la comisura palpebral" },
                { v: "D042", t: "D042: Carcinoma in situ de la piel de la oreja y del conducto auditivo externo" },
                { v: "D043", t: "D043: Carcinoma in situ de la piel de otras partes y de las no especificadas de la cara" },
                { v: "D044", t: "D044: Carcinoma in situ de la piel del cuero cabelludo y cuello" },
                { v: "D045", t: "D045: Carcinoma in situ de la piel del tronco" },
                { v: "D046", t: "D046: Carcinoma in situ de la piel del miembro superior, incluido el hombro" },
                { v: "D047", t: "D047: Carcinoma in situ de la piel del miembro inferior, incluida la cadera" },
                { v: "D048", t: "D048: Carcinoma in situ de la piel de otros sitios especificados" },
                { v: "D049", t: "D049: Carcinoma in situ de la piel, sitio no especificado" },
                { v: "C450", t: "C450: Mesotelioma de la pleura" },
                { v: "C451", t: "C451: Mesotelioma del peritoneo" },
                { v: "C452", t: "C452: Mesotelioma del pericardio" },
                { v: "C457", t: "C457: Mesotelioma de otros sitios especificados" },
                { v: "C459", t: "C459: Mesotelioma, de sitio no especificado" },
                { v: "C460", t: "C460: Sarcoma de kaposi de la piel" },
                { v: "C461", t: "C461: Sarcoma de kaposi del tejido blando" },
                { v: "C462", t: "C462: Sarcoma de kaposi del paladar" },
                { v: "C463", t: "C463: Sarcoma de kaposi de los ganglios linfaticos" },
                { v: "C467", t: "C467: Sarcoma de kaposi de otros sitios especificados" },
                { v: "C468", t: "C468: Sarcoma de kaposi de multiples organos" },
                { v: "C469", t: "C469: Sarcoma de kaposi, de sitio no especificado" },
                { v: "C470", t: "C470: Tumor maligno de los nervios perifericos de la cabeza, cara y cuello" },
                { v: "C471", t: "C471: Tumor maligno de los nervios perifericos del miembro superior, incluido el hombro" },
                { v: "C472", t: "C472: Tumor maligno de los nervios perifericos del miembro inferior, incluida la cadera" },
                { v: "C473", t: "C473: Tumor maligno de los nervios perifericos del torax" },
                { v: "C474", t: "C474: Tumor maligno de los nervios perifericos del abdomen" },
                { v: "C475", t: "C475: Tumor maligno de los nervios perifericos de la pelvis" },
                { v: "C476", t: "C476: Tumor maligno de los nervios perifericos del tronco, sin otra especificacion" },
                { v: "C478", t: "C478: Lesion de sitios contiguos de los nervios perifericos y del sistema nervioso autonomo" },
                { v: "C479", t: "C479: Tumor maligno de los nervios perifericos y del sistema nervioso autonomo, parte no especificada" },
                { v: "C480", t: "C480: Tumor maligno del retroperitoneo" },
                { v: "C481", t: "C481: Tumor maligno de parte especificada del peritoneo" },
                { v: "C482", t: "C482: Tumor maligno del peritoneo, sin otra especificacion" },
                { v: "C488", t: "C488: Lesion de sitios contiguos del peritoneo y del retroperitoneo" },
                { v: "C490", t: "C490: Tumor maligno del tejido conjuntivo y tejido blando de la cabeza, cara y cuello" },
                { v: "C491", t: "C491: Tumor maligno del tejido conjuntivo y tejido blando del miembro superior, incluido el hombro" },
                { v: "C492", t: "C492: Tumor maligno del tejido conjuntivo y tejido blando del miembro inferior, incluida la cadera" },
                { v: "C493", t: "C493: Tumor maligno del tejido conjuntivo y tejido blando del torax" },
                { v: "C494", t: "C494: Tumor maligno del tejido conjuntivo y tejido blando del abdomen" },
                { v: "C495", t: "C495: Tumor maligno del tejido conjuntivo y tejido blando de la pelvis" },
                { v: "C496", t: "C496: Tumor maligno del tejido conjuntivo y tejido blando del tronco, sin otra especificacion" },
                { v: "C498", t: "C498: Lesion de sitios contiguos del tejido conjuntivo y del tejido del blando" },
                { v: "C499", t: "C499: Tumor maligno del tejido conjuntivo y tejido blando, de sitio no especificado" },
                { v: "C510", t: "C510: Tumor maligno del labio mayor" },
                { v: "C511", t: "C511: Tumor maligno del labio menor" },
                { v: "C512", t: "C512: Tumor maligno del clitoris" },
                { v: "C518", t: "C518: Lesion de sitios contiguos de la vulva" },
                { v: "C519", t: "C519: Tumor maligno de la vulva, parte no especificada" },
                { v: "C52X", t: "C52X: Tumor maligno de la vagina" },
                { v: "C540", t: "C540: Tumor maligno del istmo uterino" },
                { v: "C541", t: "C541: Tumor maligno del endometrio" },
                { v: "C542", t: "C542: Tumor maligno del miometrio" },
                { v: "C543", t: "C543: Tumor maligno del fondo del utero" },
                { v: "C548", t: "C548: Lesion de sitios contiguos del cuerpo del utero" },
                { v: "C549", t: "C549: Tumor maligno del cuerpo del utero, parte no especificada" },
                { v: "C55X", t: "C55X: Tumor maligno del útero parte no especificada" },
                { v: "C56X", t: "C56X: Tumor maligno del ovario" },
                { v: "C570", t: "C570: Tumor maligno de la trompa de falopio" },
                { v: "C571", t: "C571: Tumor maligno del ligamento ancho" },
                { v: "C572", t: "C572: Tumor maligno del ligamento redondo" },
                { v: "C573", t: "C573: Tumor maligno del parametrio" },
                { v: "C574", t: "C574: Tumor maligno de los anexos uterinos, sin otra especificacion" },
                { v: "C577", t: "C577: Tumor maligno de otras partes especificadas de los organos genitales femeninos" },
                { v: "C578", t: "C578: Lesion de sitios contiguos de los organos genitales femeninos" },
                { v: "C579", t: "C579: Tumor maligno de organo genital femenino, parte no especificada" },
                { v: "C58X", t: "C58X: Tumor maligno de la placenta" },
                { v: "D070", t: "D070: Carcinoma in situ del endometrio" },
                { v: "D071", t: "D071: Carcinoma in situ de la vulva" },
                { v: "D072", t: "D072: Carcinoma in situ de la vagina" },
                { v: "D073", t: "D073: Carcinoma in situ de otros sitios de organos genitales femeninos y de los no especificados" },
                { v: "C600", t: "C600: Tumor maligno del prepucio" },
                { v: "C601", t: "C601: Tumor maligno del glande" },
                { v: "C602", t: "C602: Tumor maligno del cuerpo del pene" },
                { v: "C608", t: "C608: Lesion de sitios contiguos del pene" },
                { v: "C609", t: "C609: Tumor maligno del pene, parte no especificada" },
                { v: "C620", t: "C620: Tumor maligno del testiculo no descendido" },
                { v: "C621", t: "C621: Tumor maligno del testiculo descendido" },
                { v: "C629", t: "C629: Tumor maligno del testiculo, no especificado" },
                { v: "C630", t: "C630: Tumor maligno del epididimo" },
                { v: "C631", t: "C631: Tumor maligno del cordon espermatico" },
                { v: "C632", t: "C632: Tumor maligno del escroto" },
                { v: "C637", t: "C637: Tumor maligno de otras partes especificadas de los organos genitales masculinos" },
                { v: "C638", t: "C638: Lesion de sitios contiguos de los organos genitales masculinos" },
                { v: "C639", t: "C639: Tumor maligno de organo genital masculino, parte no especificada" },
                { v: "D074", t: "D074: Carcinoma in situ del pene" },
                { v: "D076", t: "D076: Carcinoma in situ de otros organos genitales masculinos y de los no especificados" },
                { v: "C64X", t: "C64X: Tumor maligno del riñón excepto de la pelvis renal" },
                { v: "C65X", t: "C65X: Tumor maligno de la pelvis renal" },
                { v: "C66X", t: "C66X: Tumor maligno del uréter" },
                { v: "C670", t: "C670: Tumor maligno del trigono vesical" },
                { v: "C671", t: "C671: Tumor maligno de la cupula vesical" },
                { v: "C672", t: "C672: Tumor maligno de la pared lateral de la vejiga" },
                { v: "C673", t: "C673: Tumor maligno de la pared anterior de la vejiga" },
                { v: "C674", t: "C674: Tumor maligno de la pared posterior de la vejiga" },
                { v: "C675", t: "C675: Tumor maligno del cuello de la vejiga" },
                { v: "C676", t: "C676: Tumor maligno del orificio ureteral" },
                { v: "C677", t: "C677: Tumor maligno del uraco" },
                { v: "C678", t: "C678: Lesion de sitios contiguos de la vejiga" },
                { v: "C679", t: "C679: Tumor maligno de la vejiga urinaria, parte no especificada" },
                { v: "C680", t: "C680: Tumor maligno de la uretra" },
                { v: "C681", t: "C681: Tumor maligno de las glandulas parauretrales" },
                { v: "C688", t: "C688: Lesion de sitios contiguos de los organos urinarios" },
                { v: "C689", t: "C689: Tumor maligno de organo urinario no especificado" },
                { v: "D090", t: "D090: Carcinoma in situ de la vejiga" },
                { v: "D091", t: "D091: Carcinoma in situ de otros organos urinarios y de los no especificados" },
                { v: "C690", t: "C690: Tumor maligno de la conjuntiva" },
                { v: "C691", t: "C691: Tumor maligno de la cornea" },
                { v: "C692", t: "C692: Tumor maligno de la retina" },
                { v: "C693", t: "C693: Tumor maligno de la coroides" },
                { v: "C694", t: "C694: Tumor maligno del cuerpo ciliar" },
                { v: "C695", t: "C695: Tumor maligno de la glandula y conducto lagrimales" },
                { v: "C696", t: "C696: Tumor maligno de la orbita" },
                { v: "C698", t: "C698: Lesion de sitios contiguos del ojo y sus anexos" },
                { v: "C699", t: "C699: Tumor maligno del ojo, parte no especificada" },
                { v: "C700", t: "C700: Tumor maligno de las meninges cerebrales" },
                { v: "C701", t: "C701: Tumor maligno de las meninges raquideas" },
                { v: "C709", t: "C709: Tumor maligno de las meninges, parte no especificada" },
                { v: "C710", t: "C710: Tumor maligno del cerebro, excepto lobulos y ventriculos" },
                { v: "C711", t: "C711: Tumor maligno del lobulo frontal" },
                { v: "C712", t: "C712: Tumor maligno del lobulo temporal" },
                { v: "C713", t: "C713: Tumor maligno del lobulo parietal" },
                { v: "C714", t: "C714: Tumor maligno del lobulo occipital" },
                { v: "C715", t: "C715: Tumor maligno del ventriculo cerebral" },
                { v: "C716", t: "C716: Tumor maligno del cerebelo" },
                { v: "C717", t: "C717: Tumor maligno del pedunculo cerebral" },
                { v: "C718", t: "C718: Lesion de sitios contiguos del encefalo" },
                { v: "C719", t: "C719: Tumor maligno del encefalo, parte no especificada" },
                { v: "C720", t: "C720: Tumor maligno de la medula espinal" },
                { v: "C721", t: "C721: Tumor maligno de la cola de caballo" },
                { v: "C722", t: "C722: Tumor maligno del nervio olfatorio" },
                { v: "C723", t: "C723: Tumor maligno del nervio optico" },
                { v: "C724", t: "C724: Tumor maligno del nervio acustico" },
                { v: "C725", t: "C725: Tumor maligno de otros nervios craneales y los no especificados" },
                { v: "C728", t: "C728: Lesion de sitios contiguos del encefalo y otras partes del sistema nervioso central" },
                { v: "C729", t: "C729: Tumor maligno del sistema nervioso central, sin otra especificacion" },
                { v: "D092", t: "D092: Carcinoma in situ del ojo" },
                { v: "C73X", t: "C73X: Tumor maligno de la glándula tiroides" },
                { v: "C740", t: "C740: Tumor maligno de la corteza de la glandula suprarrenal" },
                { v: "C741", t: "C741: Tumor maligno de la medula de la glandula suprarrenal" },
                { v: "C749", t: "C749: Tumor maligno de la glandula suprarrenal, parte no especificada" },
                { v: "C750", t: "C750: Tumor maligno de la glandula paratiroides" },
                { v: "C751", t: "C751: Tumor maligno de la hipofisis" },
                { v: "C752", t: "C752: Tumor maligno del conducto craneofaringeo" },
                { v: "C753", t: "C753: Tumor maligno de la glandula pineal" },
                { v: "C754", t: "C754: Tumor maligno del cuerpo carotideo" },
                { v: "C755", t: "C755: Tumor maligno del cuerpo aortico y otros cuerpos cromafines" },
                { v: "C758", t: "C758: Tumor maligno pluriglandular, no especificado" },
                { v: "C759", t: "C759: Tumor maligno de glandula endocrina no especificada" },
                { v: "D093", t: "D093: Carcinoma in situ de la glandula tiroides y de otras glandulas endocrinas" },
                { v: "C760", t: "C760: Tumor maligno de la cabeza, cara y cuello" },
                { v: "C761", t: "C761: Tumor maligno del torax" },
                { v: "C762", t: "C762: Tumor maligno del abdomen" },
                { v: "C763", t: "C763: Tumor maligno de la pelvis" },
                { v: "C764", t: "C764: Tumor maligno del miembro superior" },
                { v: "C765", t: "C765: Tumor maligno del miembro inferior" },
                { v: "C767", t: "C767: Tumor maligno de otros sitios mal definidos" },
                { v: "C768", t: "C768: Lesion de sitios contiguos mal definidos" },
                { v: "C80X", t: "C80X: Tumor maligno de sitios no especificados" },
                { v: "C800", t: "C800: Tumor maligno de sitio primario desconocido, asi descrito" },
                { v: "C809", t: "C809: Tumor maligno sitio primario no especificado" },
                { v: "C97X", t: "C97X: Tumores malignos (primarios) de sitios múltiples independientes" },
                { v: "D097", t: "D097: Carcinoma in situ de otros sitios especificados" },
                { v: "D099", t: "D099: Carcinoma in situ, sitio no especificado" },
                { v: "C880", t: "C880: Macroglobulinemia de waldenstrom" },
                { v: "C881", t: "C881: Enfermedad de cadena pesada alfa" },
                { v: "C882", t: "C882: Otras enfermedades de cadena pesada" },
                { v: "C883", t: "C883: Enfermedad inmunoproliferativa del intestino delgado" },
                { v: "C887", t: "C887: Otras enfermedades inmunoproliferativas malignas" },
                { v: "C889", t: "C889: Enfermedad inmunoproliferativa maligna, sin otra especificacion" },
                { v: "C900", t: "C900: Mieloma multiple" },
                { v: "C901", t: "C901: Leucemia de celulas plasmaticas" },
                { v: "C902", t: "C902: Plasmocitoma extramedular" },
                { v: "C911", t: "C911: Leucemia linfocítica crónica de célula tipo B" },
                { v: "C912", t: "C912: Leucemia linfocitica subaguda" },
                { v: "C913", t: "C913: Leucemia prolinfocítica de célula tipo B" },
                { v: "C914", t: "C914: Leucemia de celulas vellosas" },
                { v: "C915", t: "C915: Leucemia/linfoma de células T adultas [HTLV-1-asociado]" },
                { v: "C917", t: "C917: Otras leucemias linfoides" },
                { v: "C919", t: "C919: Leucemia linfoide, sin otra especificacion" },
                { v: "C921", t: "C921: Leucemia mieloide crónica [LMC], BCR/ABL-positivo" },
                { v: "C922", t: "C922: Leucemia mieloide crónica atípica, BCR/ABL-negativo" },
                { v: "C923", t: "C923: Sarcoma mieloide" },
                { v: "C927", t: "C927: Otras leucemias mieloides" },
                { v: "C929", t: "C929: Leucemia mieloide, sin otra especificacion" },
                { v: "C930", t: "C930: Leucemia monocítica/monoblástica aguda" },
                { v: "C931", t: "C931: Leucemia mielomonocítica crónica" },
                { v: "C932", t: "C932: Leucemia monocitica subaguda" },
                { v: "C937", t: "C937: Otras leucemias monociticas" },
                { v: "C939", t: "C939: Leucemia monocitica, sin otra especificacion" },
                { v: "C940", t: "C940: Leucemia eritroide aguda (antes ERITREMIA AGUDA Y ERITROLEUCEMIA)" },
                { v: "C941", t: "C941: Eritremia cronica" },
                { v: "C942", t: "C942: Leucemia megacarioblastica aguda" },
                { v: "C943", t: "C943: Leucemia de mastocitos" },
                { v: "C944", t: "C944: Panmielosis aguda con mielofibrosis" },
                { v: "C945", t: "C945: Mielofibrosis aguda" },
                { v: "C947", t: "C947: Otras leucemias especificadas" },
                { v: "C950", t: "C950: Leucemia aguda, celulas de tipo no especificado" },
                { v: "C951", t: "C951: Leucemia cronica, celulas de tipo no especificado" },
                { v: "C952", t: "C952: Leucemia subaguda, celulas de tipo no especificado" },
                { v: "C957", t: "C957: Otras leucemias de celulas de tipo no especificado" },
                { v: "C959", t: "C959: Leucemia, no especificada" },
                { v: "D45X", t: "D45X: Policitemia vera" },
                { v: "D460", t: "D460: Anemia refractaria sin sideroblastos" },
                { v: "D461", t: "D461: Anemia refractaria con sideroblastos en forma de anillo" },
                { v: "D462", t: "D462: Anemia refractaria con exceso de blastos [AREB I y II]" },
                { v: "D463", t: "D463: Anemia refractaria con exceso de blastos con trasformación" },
                { v: "D464", t: "D464: Anemia refractaria sin otra especificación" },
                { v: "D467", t: "D467: Otros síndromes mielodisplasicos" },
                { v: "D469", t: "D469: Síndrome mielodisplasico sin otra especificación" },
                { v: "D471", t: "D471: Enfermedad mieloproliferativa cronica" },
                { v: "D473", t: "D473: Trombocitopenia (hemorragica) esencial" },
                { v: "D752", t: "D752: Trombocitosis esencial" },
                { v: "D760", t: "D760: Histiocitosis de las celulas de langerhans, no clasificada en otra parte" },
                { v: "C770", t: "C770: Tumor maligno de los ganglios linfaticos de la cabeza, cara y cuello" },
                { v: "C771", t: "C771: Tumor maligno de los ganglios linfaticos intratoracicos" },
                { v: "C772", t: "C772: Tumor maligno de los ganglios linfaticos intraabdominales" },
                { v: "C773", t: "C773: Tumor maligno de los ganglios linfaticos de la axila y del miembro superior" },
                { v: "C774", t: "C774: Tumor maligno de los ganglios linfaticos de la region inguinal y del miembro inferior" },
                { v: "C775", t: "C775: Tumor maligno de los ganglios linfaticos de la pelvis" },
                { v: "C778", t: "C778: Tumor maligno de los ganglios linfaticos de regiones multiples" },
                { v: "C779", t: "C779: Tumor maligno del ganglio linfatico, sitio no especificado" },
                { v: "C780", t: "C780: Tumor maligno secundario del pulmon" },
                { v: "C781", t: "C781: Tumor maligno secundario del mediastino" },
                { v: "C782", t: "C782: Tumor maligno secundario de la pleura" },
                { v: "C783", t: "C783: Tumor maligno secundario de otros organos respiratorios y de los no especificados" },
                { v: "C784", t: "C784: Tumor maligno secundario del intestino delgado" },
                { v: "C785", t: "C785: Tumor maligno secundario del intestino grueso y del recto" },
                { v: "C786", t: "C786: Tumor maligno secundario del peritoneo y del retroperitoneo" },
                { v: "C787", t: "C787: Tumor maligno secundario del hígado y de los conductos biliares intrahepáticos" },
                { v: "C788", t: "C788: Tumor maligno secundario de otros organos digestivos y de los no especificados" },
                { v: "C790", t: "C790: Tumor maligno secundario del riñon y de la pelvis renal" },
                { v: "C791", t: "C791: Tumor maligno secundario de la vejiga, y de otros organos y los no especificados de las vias urinarias" },
                { v: "C792", t: "C792: Tumor maligno secundario de la piel" },
                { v: "C793", t: "C793: Tumor maligno secundario del encefalo y de las meninges cerebrales" },
                { v: "C794", t: "C794: Tumor maligno secundario de otras partes del sistema nervioso y de las no especificadas" },
                { v: "C795", t: "C795: Tumor maligno secundario de los huesos y de la medula osea" },
                { v: "C796", t: "C796: Tumor maligno secundario del ovario" },
                { v: "C797", t: "C797: Tumor maligno secundario de la glandula suprarrenal" },
                { v: "C798", t: "C798: Tumor maligno secundario de otros sitios especificados" },
                { v: "C799", t: "C799: Tumor maligno secundario, sitio no especificado" },
                { v: "C814", t: "C814: Linfoma de Hodgkin clásico rico en linfocitos" },
                { v: "C823", t: "C823: Linfoma folicular grado IIIa" },
                { v: "C824", t: "C824: Linfoma folicular grado IIIb" },
                { v: "C825", t: "C825: Linfoma centro folicular difuso" },
                { v: "C826", t: "C826: Linfoma centro folicular cutáneo" },
                { v: "C846", t: "C846: Linfoma anaplásico de células grandes ALK-positivo" },
                { v: "C847", t: "C847: Linfoma anaplásico de células grandes ALK-negativo" },
                { v: "C848", t: "C848: Linfoma cutáneo de células T, no especificado" },
                { v: "C849", t: "C849: Linfoma de células T/NK maduras, no especificado" },
                { v: "C852", t: "C852: Linfoma mediastinal de células B grandes (del timo)" },
                { v: "C860", t: "C860: Linfoma extranodal de células T/NK, tipo nasal" },
                { v: "C861", t: "C861: Linfoma hepatoesplénico de células T" },
                { v: "C862", t: "C862: Linfoma de células T tipo enteropatía (intestinal)" },
                { v: "C863", t: "C863: Linfoma de células T tipo paniculitis subcutánea" },
                { v: "C864", t: "C864: Linfoma blástico de células NK" },
                { v: "C865", t: "C865: Linfoma angioinmunoblástico de células T" },
                { v: "C866", t: "C866: Trastornos linfoproliferativos primario cutáneos de células T CD30-positivo" },
                { v: "C884", t: "C884: Linfoma de células B extranodal de zona marginal de tejido linfoide asociado a mucosas [Linfoma TLAM]" },
                { v: "C903", t: "C903: Plasmocitoma solitario" },
                { v: "C916", t: "C916: Leucemia prolinfocítica de células tipo T" },
                { v: "C918", t: "C918: Leucemia tipo Burkitt de células B maduras" },
                { v: "C926", t: "C926: Leucemia mieloide aguda con anormalidad 11q23" },
                { v: "C928", t: "C928: Leucemia mieloide aguda con displasia multilinaje" },
                { v: "C933", t: "C933: Leucemia mielomonocítica juvenil" },
                { v: "C946", t: "C946: Enfermedad mielodisplásica y mieloproliferativa, no clasificada en otra parte" },
                { v: "C964", t: "C964: Sarcoma de células dendríticas (células accesorias)" },
                { v: "C965", t: "C965: Histiocitosis de células de Langerhans multifocal y unisistémica" },
                { v: "C966", t: "C966: Histiocitosis de células de Langerhans unifocal" },
                { v: "C968", t: "C968: Sarcoma histiocítico" },
                { v: "D465", t: "D465: Anemia refractaria con displasia multilinaje" },
                { v: "D466", t: "D466: Síndrome mielodisplásico con anormalidad cromosómica aislada del (5q)" },
                { v: "D474", t: "D474: Osteomielofibrosis crónica" },
                { v: "D475", t: "D475: Leucemia eosinofílica crónica [síndrome hipereosinofílico]" }
        ];

        window.SELECT_OPTIONS["VAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "98", t: "98: No Aplica (no está indicada esta terapia, verifique que en las variables 46 a 73 se registra No Aplica)" }
        ];

        window.SELECT_OPTIONS["VAR46_FaseQuimioterapiaRecibioUsuarioCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1 Fase" },
                { v: "2", t: "2 Fases" },
                { v: "3", t: "3 Fases" },
                { v: "4", t: "4 Fases" },
                { v: "5", t: "5 Fases" },
                { v: "6", t: "6 Fases" },
                { v: "7", t: "7 Fases" },
                { v: "8", t: "8 Fases" },
                { v: "9", t: "9 Fases" },
                { v: "10", t: "10 Fases" },
                { v: "0", t: "0: Es cáncer hematolinfático con CIE-10 (C835, C910, C920, C924 o C925) y NO recibió quimioterapia (VAR45=98)" },
                { v: "98", t: "98: No Aplica (es sólido o es cáncer diferente a los enunciados en las fases)" }
        ];

        window.SELECT_OPTIONS["VAR46_1_UsuarioRecibioCorteQuimioterapiaPrefase"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_2_UsuarioRecibioCorteFaseQuimioterapiaInduccion"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_3_UsuarioRecibioCorteFaseQuimioterapIntensificacion"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_4_UsuarioRecibioCorteFaseQuimioterapiaConsolidacion"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_5_UsuarioRecibioCorteFaseQuimioterapiaReinduccion"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_6_UsuarioRecibiCorteFaseQuimioterapiaMantenimiento"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_7_UsuarioRecibioCorteFaseQuimioterapiaMantenimientoL"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR46_8_UsuarioRecibiCorteOtraFaseQuimioterapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió (aplica únicamente para los CIE 10 C835, C910, C920, C924 y C925)" },
                { v: "97", t: "97: No Aplica (no es leucemia linfoide o mieloide aguda ni linfoma linfoblástico)" }
        ];

        window.SELECT_OPTIONS["VAR48_UbicacionTemporalPrimerCicloRelacionOncologico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Neoadyuvancia (manejo inicial prequirúrgico)" },
                { v: "2", t: "2: Tratamiento inicial curativo sin cirugía sugerida (por ejemplo, sería una opción frecuente en caso de leucemias o linfomas, u otros cánceres a quienes no se les hizo cirugía)" },
                { v: "3", t: "3: Adyuvancia (manejo inicial postquirúrgico)" },
                { v: "11", t: "11: Manejo de recaída" },
                { v: "12", t: "12: Manejo de enfermedad metastásica" },
                { v: "13", t: "13: Manejo paliativo (sin manejo de recaída ni enfermedad metastásica)" },
                { v: "98", t: "98: No Aplica (en la variable 45 seleccionó la opción 98)" }
        ];

        window.SELECT_OPTIONS["VAR57_RecibioQuimioterapiaIntratecalPrimerCiclo"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió " },
                { v: "98", t: "98: No Aplica (no tuvo ningún esquema de quimioterapia, en variable 45 seleccionó 98: No aplica)" }
        ];

        window.SELECT_OPTIONS["VAR59_CaracteristicasActualesPrimerCicloCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Finalizado, esquema completo según medicamentos programados" },
                { v: "2", t: "2: Finalizado, esquema incompleto pero finalizado por algún motivo" },
                { v: "3", t: "3: No finalizado, esquema incompleto, pero aún bajo tratamiento (ejemplo: hormonoterapia o esquema no finalizado)" },
                { v: "98", t: "98: No Aplica (no tuvo ningún esquema de terapia sistémica y en la variable 45 seleccionó la opción 98)" }
        ];

        window.SELECT_OPTIONS["VAR60_MotivoFinalizacionPrimerCiclo"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Toxicidad de uno o más medicamentos" },
                { v: "2", t: "2: Otros motivos médicos" },
                { v: "3", t: "3: Muerte" },
                { v: "4", t: "4: Cambio de EAPB" },
                { v: "5", t: "5: Decisión del usuario, abandonó la terapia" },
                { v: "6", t: "6: No hay disponibilidad de medicamentos" },
                { v: "7", t: "7: Otros motivos administrativos" },
                { v: "8", t: "8: Otras causas no contempladas" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR61_UbicacionTemporalUltimoCicloCorteOncologico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Neoadyuvancia (manejo inicial prequirúrgico)" },
                { v: "2", t: "2: Tratamiento inicial curativo sin cirugía sugerida (por ejemplo, sería una opción frecuente en caso de leucemias o linfomas, u otros cánceres a quienes no se les hizo cirugía)" },
                { v: "3", t: "3: Adyuvancia (manejo inicial postquirúrgico)" },
                { v: "11", t: "11: Manejo de progresión o recaída" },
                { v: "12", t: "12: Manejo de enfermedad metastásica" },
                { v: "13", t: "13: Cambio por toxicidad" },
                { v: "14", t: "14: Manejo paliativo (sin manejo de recaída ni enfermedad metastásica)" },
                { v: "97", t: "97: Solo recibió un esquema de quimioterapia en este periodo y en la variable 45 seleccionó la opción 1. (verifique que las variables 62 a 73 registren No Aplica)" },
                { v: "98", t: "98: No Aplica (en la variable 45 seleccionó la opción 98)" }
        ];

        window.SELECT_OPTIONS["VAR70_RecibioQuimioterapiaIntratecalUltimoCicloCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió" },
                { v: "2", t: "2: No recibió " },
                { v: "98", t: "98: No Aplica (no tuvo ningún esquema de quimioterapia, en variable 45 seleccionó 98: No aplica)" }
        ];

        window.SELECT_OPTIONS["VAR72_CaracteristicasActualesUltimoCicloCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Finalizado, esquema completo según medicamentos programados" },
                { v: "2", t: "2: Finalizado, esquema incompleto pero finalizado por algún motivo" },
                { v: "3", t: "3: No finalizado, esquema incompleto, pero aún bajo tratamiento (ejemplo: hormonoterapia o esquema no finalizado)" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR73_MotivoFinalizacionPrematuraUltimoCiclo"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Toxicidad de uno o más medicamentos" },
                { v: "2", t: "2: Otros motivos médicos" },
                { v: "3", t: "3: Muerte" },
                { v: "4", t: "4: Cambio de EAPB" },
                { v: "5", t: "5: Decisión del usuario, abandonó la terapia" },
                { v: "6", t: "6: No hay disponibilidad de medicamentos" },
                { v: "7", t: "7: Otros motivos administrativos" },
                { v: "8", t: "8: Otras causas no contempladas" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR74_SometidoUsuarioCirugiasCurativasPaliativas"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Si fue sometido al menos a una cirugía durante este periodo" },
                { v: "2", t: "2: No recibió cirugía" }
        ];

        window.SELECT_OPTIONS["VAR79_UbicacionTemporalPrimeraCirugiaOncologico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Parte del manejo inicial para el cáncer (tratamiento inicial curativo)" },
                { v: "5", t: "5: Manejo de recaída" },
                { v: "6", t: "6: Manejo de enfermedad metastásica" },
                { v: "98", t: "98: No Aplica (seleccionó la opción 2 en la variable 74)." }
        ];

        window.SELECT_OPTIONS["VAR81_MotivoHaberRealizadoUltimaIntervencionQuirurgica"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Complementar tratamiento quirúrgico del cáncer no asociado a complicaciones de la primera cirugía" },
                { v: "2", t: "2: Complicaciones debida a la primera cirugía o siguientes" },
                { v: "3", t: "3: Complicaciones por otras condiciones médicas no relacionadas a la cirugía (por ejemplo, comorbilidad)" },
                { v: "5", t: "5: 1 y 3" },
                { v: "6", t: "6: 2 y 3" },
                { v: "98", t: "98: No Aplica (sólo hubo una intervención en este periodo o no hubo cirugías en este periodo)" }
        ];

        window.SELECT_OPTIONS["VAR84_UbicacionTemporalUltimaCirugiaOncologico"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Parte del manejo inicial para el cáncer (manejo inicial curativo)" },
                { v: "5", t: "5: Manejo de recaída" },
                { v: "6", t: "6: Manejo de enfermedad metastásica" },
                { v: "98", t: "98: No Aplica (sólo hubo una intervención en este periodo o seleccionó la opción 2 en la variable 74)" }
        ];

        window.SELECT_OPTIONS["VAR85_EstadoVitalFinalizarUnicaUltimaCirugia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Vivo" },
                { v: "2", t: "2: Fallecido" },
                { v: "98", t: "98: No Aplica (seleccionó la opción 2 en la variable 74)" }
        ];

        window.SELECT_OPTIONS["VAR86_RecibioUsuarioAlgunTipoRadioterapiaCorteActual"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Si recibió algún tipo de radioterapia" },
                { v: "98", t: "98: No aplica (verifique que en las variables 87 a 105 se registre no Aplica) " }
        ];

        window.SELECT_OPTIONS["VAR89_UbicacionTemporalPrimerUnicoEsquemaRadioterapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Neoadyuvancia (manejo inicial prequirúrgico)" },
                { v: "2", t: "2: Tratamiento inicial curativo sin cirugía sugerida (por ejemplo, solo algunos cánceres que se curan con radioterapia exclusiva)" },
                { v: "3", t: "3: Adyuvancia (manejo inicial postquirúrgico)" },
                { v: "11", t: "11: Manejo de recaída" },
                { v: "12", t: "12: Manejo de enfermedad metastásica" },
                { v: "13", t: "13: Manejo paliativo (sin manejo de recaída ni enfermedad metastásica)" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR95_EstadoVitalFinalizarUnicaUltimaCirugia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Finalizado, dosis completa de radioterapia prescrita" },
                { v: "2", t: "2: Finalizado, dosis incompleta pero finalizada por algún motivo" },
                { v: "3", t: "3: No finalizado, dosis incompleta, pero aún bajo tratamiento" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR96_MotivoFinalizacionPrimerEsquemaRadioterapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Toxicidad" },
                { v: "2", t: "2: Otros motivos médicos" },
                { v: "3", t: "3: Muerte" },
                { v: "4", t: "4: Cambio de EAPB" },
                { v: "5", t: "5: Decisión del usuario, abandonó la terapia" },
                { v: "6", t: "6: Otros motivos administrativos" },
                { v: "7", t: "7: Otras causas no contempladas" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR98_UbicacionTemporalUltimoEsquemaRadioterapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Neoadyuvancia (manejo inicial prequirúrgico)" },
                { v: "2", t: "2: Tratamiento inicial curativo sin cirugía sugerida (por ejemplo, Solo algunos cánceres que se curan con radioterapia exclusiva)" },
                { v: "3", t: "3: Adyuvancia (manejo inicial postquirúrgico)" },
                { v: "11", t: "11: Manejo de recaída " },
                { v: "12", t: "12: Manejo de enfermedad metastásica" },
                { v: "13", t: "13: Manejo paliativo (sin manejo de recaída ni enfermedad metastásica)" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR104_CaracteristicasActualesUltimoEsquemaRadioterapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Finalizado, dosis completa de radioterapia prescrita" },
                { v: "2", t: "2: Finalizado, dosis incompleta pero finalizada por algún motivo" },
                { v: "3", t: "3: No finalizado, esquema incompleto, pero aún bajo tratamiento" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR105_MotivoFinalizacionUltimoEsquemaRadioTerapia"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Toxicidad" },
                { v: "2", t: "2: Otros motivos médicos" },
                { v: "3", t: "3: Muerte" },
                { v: "4", t: "4: Cambio de EAPB" },
                { v: "5", t: "5: Decisión del usuario, abandonó la terapia" },
                { v: "6", t: "6: Otros motivos administrativos" },
                { v: "7", t: "7: Otras causas no contempladas" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR106_RecibioUsuarioTrasplanteCelulasProgenitoras"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Si recibió" },
                { v: "98", t: "98: No Aplica (verifique que en las variables 107 a 110 se registra No Aplica)" }
        ];

        window.SELECT_OPTIONS["VAR107_TipoTrasplanteRecibido"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Autólogo" },
                { v: "2", t: "2: Alogénico de donante idéntico relacionado" },
                { v: "3", t: "3: Alogénico de donante no idéntico relacionado" },
                { v: "4", t: "4: Alogénico de donante idéntico no relacionado" },
                { v: "5", t: "5: Alogénico de donante no idéntico no relacionado" },
                { v: "6", t: "6: Alogénico de cordón umbilical idéntico familiar" },
                { v: "7", t: "7: Alogénico de cordón umbilical idéntico no familiar" },
                { v: "8", t: "8: Alogénico de cordón no idéntico no familiar" },
                { v: "9", t: "9: Alogénico de dos unidades de cordón" },
                { v: "98", t: "98: No Aplica (respondió 2 o 98 en la pregunta anterior)" }
        ];

        window.SELECT_OPTIONS["VAR108_UbicacionTemporalTrasplanteOncologico"] = [
                { v: "", t: "Selecciona..." },
                { v: "95", t: "95: Recaída" },
                { v: "96", t: "96: Refractariedad" },
                { v: "97", t: "97: Esquema de consolidación" },
                { v: "98", t: "98: No Aplica" }
        ];

        window.SELECT_OPTIONS["VAR111_UsuarioRecibioCirugiaReconstructiva"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí recibió cirugía" },
                { v: "98", t: "98: No Aplica (No recibió este tipo de cirugía, verifique que en las variables 112 y 113 se registra No Aplica)" }
        ];

        window.SELECT_OPTIONS["VAR114_UsuarioValoradoConsultaProcedimientoPaliativo"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_1_UsuarioRecibioConsultaProcedimientoCuidadoPaliativ"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_2_UsuarioRecibioConsultaCuidadoPaliativo"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_3_UsuarioRecibioConsultaPaliativoEspecialista"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_4_UsuarioRecibioConsultaPaliativoGeneral"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_5_UsuarioRecibioConsultaPaliativoTrabajoSocial"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR114_6_UsuarioRecibioConsultaPaliativoNoEspecializado"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No recibió" }
        ];

        window.SELECT_OPTIONS["VAR117_HaSidoValoradoUsuarioPorServicioPsiquiatria"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No, se ordenó, pero está pendiente" },
                { v: "98", t: "98: No aplica, no se ha ordenado valoración por psiquiatría" }
        ];

        window.SELECT_OPTIONS["VAR120_FueValoradoUsuarioPorProfesionalNutricion"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Sí fue valorado" },
                { v: "2", t: "2: No, se ordenó, pero está pendiente" },
                { v: "98", t: "98: No aplica, no se ha ordenado valoración por nutrición" }
        ];

        window.SELECT_OPTIONS["VAR123_UsuarioRecibioSoporteNutricional"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Si recibió soporte nutricional enteral" },
                { v: "2", t: "2: Si recibió soporte nutricional, parenteral" },
                { v: "3", t: "3: Si recibió soporte nutricional enteral y parenteral (opciones:1 y 2)" },
                { v: "4", t: "4: No recibió soporte nutricional" }
        ];

        window.SELECT_OPTIONS["VAR124_UsuarioRecibidoTerapiasComplementariasRehabilitaci"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Si, Terapia física" },
                { v: "2", t: "2: Si, terapia de lenguaje" },
                { v: "3", t: "3: Si, Terapia ocupacional" },
                { v: "5", t: "5: 1 y 2" },
                { v: "6", t: "6: 1 y 3" },
                { v: "7", t: "7: 2 y 3" },
                { v: "8", t: "8: 1, 2 y 3" },
                { v: "98", t: "98: No aplica, no se han ordenado terapias" },
        ];

        window.SELECT_OPTIONS["VAR125_TipoTratamientoRecibiendoUsuarioFechaCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Radioterapia" },
                { v: "2", t: "2: Terapia sistémica (incluye quimioterapia, anticuerpos monoclonales, terapia biológica, terapia hormonal)" },
                { v: "3", t: "3: Cirugía (reporte SOLO cuando el procedimiento se haya realizado a partir del 1 de noviembre de 2024)" },
                { v: "4", t: "4: 1 y 2" },
                { v: "5", t: "5: 1 y 3" },
                { v: "6", t: "6: 2 y 3" },
                { v: "7", t: "7: Manejo expectante pretratamiento" },
                { v: "8", t: "8: En seguimiento, luego de tratamiento durante el periodo" },
                { v: "9", t: "9: Antecedente de cáncer (no recibió ningún tratamiento, pero tiene como mínimo una consulta de seguimiento relacionada con el cáncer dentro del periodo)" },
                { v: "10", t: "10: 1, 2 y 3" },
                { v: "11", t: "11: Manejo de cuidado paliativo o terapia complementaria" },
                { v: "98", t: "98: No Aplica (paciente se encuentra fallecido, abandonó el tratamiento, alta voluntaria o se encuentra desafiliado)" },
        ];

        window.SELECT_OPTIONS["VAR126_ResultadoFinalManejoOncologicoCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Pseudoprogresión (aplica solo para inmunoterapia)" },
                { v: "2", t: "2: Progresión o recaída" },
                { v: "3", t: "3: Respuesta parcial" },
                { v: "4", t: "4: Respuesta completa" },
                { v: "5", t: "5: Enfermedad estable" },
                { v: "6", t: "6: Abandono del tratamiento o alta voluntaria" },
                { v: "7", t: "7: Paciente en seguimiento por antecedente de cáncer" },
                { v: "8", t: "8: Pendiente iniciar el tratamiento luego del diagnóstico (fue definido por especialista o aún está pendiente por valoración oncológica inicial, en la cual se defina el tratamiento)" },
                { v: "97", t: "97: No aplicable en este periodo, aún bajo tratamiento inicial" },
                { v: "98", t: "98: No aplicable en este periodo, aún bajo tratamiento de recaída" },
                { v: "99", t: "99: No aplica, el paciente se encuentra fallecido, o se encuentra desafiliado" },
        ];

        window.SELECT_OPTIONS["VAR127_EstadoVitalFinalizarCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Vivo" },
                { v: "2", t: "2: Fallecido" },
                { v: "99", t: "99: Desconocido" }
        ];

        window.SELECT_OPTIONS["VAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: no presenta novedad con respecto al reporte anterior (vivo y afiliado a la entidad)." },
                { v: "1", t: "1: usuario ingresó a la EAPB en el periodo de reporte y ya tenía el diagnóstico de cáncer" },
                { v: "2", t: "2: usuario con un nuevo diagnóstico de cáncer entre el 2 de enero de 2024 y el 1 de enero de 2025" },
                { v: "3", t: "3: usuario con diagnóstico antiguo de cáncer que no había sido incluido en el reporte anterior" },
                { v: "4", t: "4: usuario que falleció" },
                { v: "5", t: "5: usuario que se desafilió" },
                { v: "6", t: "6: usuario para eliminar de la base de datos por corrección luego de auditoría interna o de CAC" },
                { v: "7", t: "7: usuario que firmó alta voluntaria del tratamiento" },
                { v: "8", t: "8: usuario con cambio de tipo o número de ID" },
                { v: "9", t: "9: usuario abandonó el tratamiento y es imposible de ubicar" },
                { v: "10", t: "10: usuario no incluido en reporte anterior y está fallecido en el momento del reporte actual" },
                { v: "11", t: "11: trasladado de IPS" },
                { v: "12", t: "12: usuario que es notificado con dos o más cánceres en este periodo" },
                { v: "13", t: "13: usuario no incluido en reporte anterior y está desafiliado en el momento del reporte actual" },
                { v: "15", t: "15: Comunidad migrante de la República de Venezuela" },
                { v: "16", t: "16: Usuario con cambio de CIE-10: aplica para casos con cánceres secundarios o no especificados en los que se define el primario o se especifica el tipo de cáncer." },
                { v: "17", t: "17: Usuario identificado por cruce con fuentes externas, con diagnóstico de cáncer no gestionado por la EAPB." },
                { v: "18", t: "18: Usuario identificado por cruce con fuentes externas, con diagnóstico descartado por la EAPB o fallecido /desafiliado no gestionado por la entidad sin diagnóstico confirmado de cáncer." },
                { v: "19", t: "19: Paciente trasladado que fue glosado en periodo anterior, que no fue gestionado por la entidad en el periodo actual." }
        ];

        window.SELECT_OPTIONS["VAR129_NovedadClinicaUsuarioFechaCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Usuario que está en manejo inicial curativo" },
                { v: "3", t: "3: Usuario que finalizó tratamiento inicial y está en seguimiento" },
                { v: "8", t: "8: Abandono de tratamiento" },
                { v: "9", t: "9: Usuario firmó alta voluntaria" },
                { v: "10", t: "10: Usuario en manejo expectante antes de tratamiento" },
                { v: "11", t: "11: Usuario que está en manejo paliativo (incluye manejo de metástasis o de recaída)" },
                { v: "12", t: "12: Usuario fallecido o desafiliado" }
        ];

        window.SELECT_OPTIONS["VAR132_CausaMuerte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Muerte asociada al cáncer" },
                { v: "2", t: "2: Muerte por patología clínica no relacionada al cáncer" },
                { v: "3", t: "3: Muerte por causa externa" },
                { v: "4", t: "4: Muerte por causa no conocida" },
                { v: "98", t: "98: No Aplica, usuario vivo o se desconoce su estado vital" }
        ];

        window.SELECT_OPTIONS["VAR5_TipoIdentificacion"] = [
                { v: "", t: "Selecciona..." },
                { v: "CC", t: "CC: Cédula de Ciudadanía" },
                { v: "CE", t: "CE: Cédula de Extranjería" },
                { v: "CD", t: "CD: Carné diplomático" },
                { v: "PA", t: "PA: Pasaporte" },
                { v: "SC", t: "SC: Salvoconducto de permanencia" },
                { v: "PT", t: "PT: Permiso temporal de permanencia" },
                { v: "PE", t: "PE: Permiso especial de permanencia" },
                { v: "RC", t: "RC: Registro Civil" },
                { v: "TI", t: "TI: Tarjeta de Identidad" },
                { v: "CN", t: "CN: Certificado de nacido vivo" },
                { v: "AS", t: "AS: Adulto sin identificar (Solo para el Régimen Subsidiado)" },
                { v: "MS", t: "MS: Menor sin identificar (Solo para el Régimen Subsidiado)" },
                { v: "DE", t: "DE: Documento extranjero" },
                { v: "SI", t: "SI: Sin identificación" }
        ];

        window.SELECT_OPTIONS["VAR10_RegimenAfiliacionSGSSS"] = [
                { v: "", t: "Selecciona..." },
                { v: "C", t: "C: Régimen Contributivo" },
                { v: "S", t: "S: Régimen Subsidiado" },
                { v: "P", t: "P: Regímenes de excepción" },
                { v: "E", t: "E: Régimen especial" },
                { v: "N", t: "N: No asegurado" },
                { v: "I", t: "I: Fondo Atención en Salud para PPL" }
        ];

        window.SELECT_OPTIONS["VAR9_Ocupacion"] = [
                { v: "", t: "Selecciona..." },
                { v: "9996", t: "9996: Sin ocupación, persona dependiente" },
                { v: "9997", t: "9997 = Estudiante" },
                { v: "9998", t: "9998 = No aplica" },
                { v: "9999", t: "9999 = No existe información" }
        ];

        window.SELECT_OPTIONS["VAR10_Regimen"] = [
                { v: "", t: "Selecciona..." },
                { v: "C", t: "C: Régimen Contributivo" },
                { v: "S", t: "S: Régimen Subsidiado" },
                { v: "P", t: "P: Regímenes de excepción" },
                { v: "E", t: "E: Régimen especial" },
                { v: "N", t: "N: No asegurado" },
                { v: "I", t: "I: Fondo Atención en Salud para PPL" }
        ];

        window.SELECT_OPTIONS["VAR13_idGrupoPoblacional"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Población habitante de calle" },
                { v: "2", t: "2: Población infantil a cargo del ICBF" },
                { v: "3", t: "3: Madres comunitarias" },
                { v: "4", t: "4: Artistas, autores, compositores" },
                { v: "5", t: "5: Otro grupo poblacional" },
                { v: "6", t: "6: Recién Nacidos" },
                { v: "8", t: "8: Desmovilizados" },
                { v: "9", t: "9: Desplazados" },
                { v: "12", t: "12: Población en centros psiquiátricos" },
                { v: "13", t: "13: Migratorio diferente a la comunidad migrante de Venezuela" },
                { v: "14", t: "14: Población en centros carcelarios" },
                { v: "15", t: "15: Población rural no migratoria" },
                { v: "31", t: "31: Adulto mayor" },
                { v: "32", t: "32: Cabeza de familia" },
                { v: "33", t: "33: Mujer embarazada" },
                { v: "34", t: "34: Mujer lactante" },
                { v: "35", t: "35: Trabajador urbano" },
                { v: "36", t: "36: Trabajador rural" },
                { v: "37", t: "37: Víctima de violencia armada" },
                { v: "38", t: "38: Jóvenes vulnerables rurales" },
                { v: "39", t: "39: Jóvenes vulnerables urbanos" },
                { v: "50", t: "50: Persona en situación de discapacidad del sistema nervioso" },
                { v: "51", t: "51: Persona en situación de discapacidad de los ojos" },
                { v: "52", t: "52: Persona en situación de discapacidad de los oídos" },
                { v: "53", t: "53: Persona en situación de discapacidad de los demás órganos de los sentidos (olfato, tacto y gusto)" },
                { v: "54", t: "54: Persona en situación de discapacidad de la voz y el habla" },
                { v: "55", t: "55: Persona en situación de discapacidad del sistema cardiorrespiratorio y las defensas" },
                { v: "56", t: "56: Persona en situación de discapacidad de la digestión, el metabolismo, las hormonas" },
                { v: "57", t: "57: Persona en situación de discapacidad del sistema genital y reproductivo" },
                { v: "58", t: "58: Persona en situación de discapacidad del movimiento del cuerpo, manos, brazos, piernas" },
                { v: "59", t: "59: Persona en situación de discapacidad de la piel" },
                { v: "60", t: "60: Persona en situación de discapacidad de otro tipo" },
                { v: "61", t: "61: No definido" },
                { v: "63", t: "63: Comunidad migrante de la República de Venezuela" }
        ];

        window.SELECT_OPTIONS["VAR17_GestacionAlCorte"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Sí" },
                { v: "3", t: "3: No aplica (paciente de sexo masculino)" }
        ];

        window.SELECT_OPTIONS["VAR18_EnPlanificacion"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Planificación" },
                { v: "1", t: "1: Consejería genética" },
                { v: "2", t: "2: Planificación y consejería genética" },
                { v: "3", t: "3: No aplica, niño o niña menor de 12 años" },
                { v: "4", t: "4: Ninguno (Incluye mujeres en menopausia que no utilizan método de planificación)" }
        ];

        window.SELECT_OPTIONS["VAR20_MotivoPruebaDx"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Madre portadora conocida" },
                { v: "1", t: "1: Otro historial familiar" },
                { v: "2", t: "2: Síntoma hemorrágico" },
                { v: "3", t: "3: Otro" },
                { v: "4", t: "4: Desconocido" }
        ];

        window.SELECT_OPTIONS["VAR23_TipoDeficienciaDiagnosticada"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Factor VIII (Hemofilia A, factor ocho)" },
                { v: "1", t: "1: Factor IX (Hemofilia B, factor nueve)" },
                { v: "2", t: "2: Portadora" },
                { v: "3", t: "3: Von Willebrand" },
                { v: "4", t: "4: Fibrinógeno (factor uno)" },
                { v: "5", t: "5: Protrombina (factor dos)" },
                { v: "6", t: "6: FV (factor cinco)" },
                { v: "7", t: "7: FV y FVIII (factor cinco y ocho)" },
                { v: "8", t: "8: FVII (factor siete)" },
                { v: "9", t: "9: FX (factor diez)" },
                { v: "10", t: "10: FXI (factor once)" },
                { v: "11", t: "11: FXIII (factor trece)" }
        ];

        window.SELECT_OPTIONS["VAR24_SeveridadSegunNivelFactor"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Hemofilia leve" },
                { v: "1", t: "1: Hemofilia moderado" },
                { v: "2", t: "2: Hemofilia severo" },
                { v: "3", t: "3: EvW No clasificado" },
                { v: "4", t: "4: EvW tipo I" },
                { v: "5", t: "5: EvW tipo II" },
                { v: "6", t: "6: EvW tipo III" },
                { v: "7", t: "7: Portadora" },
                { v: "9999", t: "9999: No aplica (coagulopatía diferente a hemofilia, portadora o EvW)" }
        ];

        window.SELECT_OPTIONS["VAR26_AntecedentesFamiliares"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Si" },
                { v: "1", t: "1: No" },
                { v: "2", t: "2: Desconocido" }
        ];

        window.SELECT_OPTIONS["VAR27_FactorRecibidoTtoIni"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Concentrado de factor VIII" },
                { v: "1", t: "1: Concentrado de factor IX" },
                { v: "2", t: "2: Plasma fresco congelado" },
                { v: "3", t: "3: Crioprecipitado" },
                { v: "4", t: "4: Desconocido" },
                { v: "5", t: "5: Ninguno" },
                { v: "6", t: "6: Concentrado de Factor de von Willebrand" },
                { v: "8", t: "8: Desmopresina/Acido tranexámico" },
                { v: "9", t: "9: Factor VIII + Factor de von Willebrand" },
                { v: "10", t: "10: Emicizumab" },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." },
        ];

        window.SELECT_OPTIONS["VAR28_EsquemaTtoIni"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: A demanda" },
                { v: "1", t: "1: Profilaxis" },
                { v: "5", t: "5: No ha recibido tratamiento" },
                { v: "6", t: "6: Desconocido" },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR30_FactorRecibidoTtoAct"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Concentrado de factor VIII (ocho)" },
                { v: "1", t: "1: Concentrado de factor IX (nueve)" },
                { v: "2", t: "2: rFVIIa (factor siete recombinante activado)" },
                { v: "3", t: "3: CCPa (concentrado de complejo de protrombina activado)" },
                { v: "4", t: "4: Plasma fresco congelado" },
                { v: "5", t: "5: Crioprecipitado" },
                { v: "6", t: "6: Desmopresina/Acido tranexámico" },
                { v: "7", t: "7: Paciente con hemofilia, portadora o EvW a demanda que no recibió tratamiento." },
                { v: "8", t: "8: Concentrado Factor VIII + rFVIIa" },
                { v: "9", t: "9: Concentrado Factor VIII + CCPa" },
                { v: "10", t: "10: Concentrado Factor IX+ rFVIIa" },
                { v: "11", t: "11: Concentrado Factor IX + CCPa" },
                { v: "12", t: "12: Concentrado Factor de von Willebrand (puro)" },
                { v: "15", t: "15: Emicizumab" },
                { v: "16", t: "16: Emicizumab + Concentrado Factor VIII" },
                { v: "17", t: "17: Emicizumab + rFVIIa" },
                { v: "18", t: "18: Emicizumab + CCPa" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR31_EsquemaTtoAct"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: A demanda o episódica" },
                { v: "1", t: "1: Profilaxis primaria" },
                { v: "2", t: "2: Profilaxis secundaria o terciaria" },
                { v: "3", t: "3: Sólo inmunotolerancia (ITI)" },
                { v: "4", t: "4: ITI + Profilaxis" },
                { v: "6", t: "6: A demanda, pero no requirió tratamiento durante el periodo." },
                { v: "7", t: "7: Profilaxis intermitente" },
                { v: "8", t: "8: Profilaxis para EvW" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR32_2_FrecuenciaPorSemana"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No aplica, usuario hemofílico no recibe profilaxis. Paciente con tratamiento a demanda." },
                { v: "1", t: "1: Una vez por semana" },
                { v: "2", t: "2: Dos veces por semana" },
                { v: "3", t: "3: Tres veces por semana" },
                { v: "4", t: "4: Cuatro veces por semana" },
                { v: "5", t: "5: 5 o más veces por semana" },
                { v: "6", t: "6: Intervalo de frecuencia de más de una semana (ej.: factor de vida media extendida)." },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9997", t: "9997: Paciente solo en ITI" },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR33_ModalidadAplicacionTratamiento"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Institucional" },
                { v: "1", t: "1: Domiciliario" },
                { v: "2", t: "2: Mixto" },
                { v: "3", t: "3: Autoadministrado" },
                { v: "4", t: "4: No recibió ningún tratamiento durante el período" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR34_ViaDeAdministracion"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Acceso venoso periférico" },
                { v: "1", t: "1: Acceso venoso central" },
                { v: "2", t: "2: No recibió tratamiento durante el período" },
                { v: "3", t: "3: Vía Subcutánea." },
                { v: "4", t: "4: Vía oral" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW" }
        ];

        window.SELECT_OPTIONS["VAR40_Hemartrosis"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR48_PresenciaDeInhibidor"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Paciente hemofílico con inhibidor de Baja respuesta" },
                { v: "1", t: "1: Paciente hemofílico con inhibidor de Alta respuesta" },
                { v: "2", t: "2: Paciente hemofílico que no presenta inhibidores" },
                { v: "3", t: "3: Paciente sin prueba de inhibidores en el periodo (hemofílico)" },
                { v: "4", t: "4: No se realizó porque no se requiere (hemofílico)" },
                { v: "5", t: "5: Paciente con EvW con toma de inhibidores" },
                { v: "6", t: "6: Paciente con EvW sin toma de inhibidores" },
                { v: "9996", t: "9996: Paciente hemofílico o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia y diferente a EvW (las portadoras también deben reportar esta opción)." }
        ];

        window.SELECT_OPTIONS["VAR48_2_HaRecibidoITI"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia." }
        ];

        window.SELECT_OPTIONS["VAR48_3_EstaRecibiendoITI"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No ha recibido ITI durante el período" },
                { v: "1", t: "1: Recibió ITI durante el periodo, pero actualmente no se encuentra en ITI" },
                { v: "2", t: "2: A la fecha de corte se encuentra en ITI" },
                { v: "9996", t: "9996: Paciente hemofílico en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia." }
        ];

        window.SELECT_OPTIONS["VAR49_ArtropatiaHemofilicaCronica"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia y diferente a EvW (incluye portadoras)." }
        ];

        window.SELECT_OPTIONS["VAR50_UsuarioInfectadoPorVhc"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW" }
        ];

        window.SELECT_OPTIONS["VAR52_UsuarioInfectadoPorVih"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR53_Pseudotumores"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR54_Fracturas"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR55_Anafilaxis"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No" },
                { v: "1", t: "1: Si" },
                { v: "9996", t: "9996: Paciente hemofílico, portadora o EvW en abandono." },
                { v: "9999", t: "9999: No aplica, usuario con coagulopatía diferente a hemofilia, diferente a portadora y diferente a EvW." }
        ];

        window.SELECT_OPTIONS["VAR56_EspecialidadMedicoTratante"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: Hematólogo" },
                { v: "2", t: "2: Medico familiar" },
                { v: "3", t: "3: Médico internista" },
                { v: "4", t: "4: Ortopedista" },
                { v: "5", t: "5: Pediatra" },
                { v: "9996", t: "9996: Paciente que abandonó el tratamiento." }
        ];

        window.SELECT_OPTIONS["VAR64_Novedades"] = [
                { v: "", t: "Selecciona..." },
                { v: "0", t: "0: No presenta novedad (vivo y afiliado a la entidad)." },
                { v: "1", t: "1: Usuario que ingresó a la EAPB con diagnóstico de hemofilia u otras coagulopatías" },
                { v: "2", t: "2: Usuario a quien se le realizó nuevo diagnóstico de hemofilia u otras coagulopatías." },
                { v: "3", t: "3: Usuario con diagnóstico antiguo de hemofilia u otras coagulopatías que no había sido incluido en reporte anterior." },
                { v: "4", t: "4: Usuario que falleció." },
                { v: "5", t: "5: Usuario que se desafilió." },
                { v: "6", t: "6: Usuario para eliminar de la base de datos por corrección luego de auditoría interna o de CAC." },
                { v: "7", t: "7: Usuario que firmó alta voluntaria del tratamiento." },
                { v: "8", t: "8: Usuario con cambio de tipo o número de ID (mismo usuario con nuevo ID)." },
                { v: "9", t: "9: Usuario con diagnóstico confirmado, que abandonó el tratamiento y es imposible de ubicar." },
                { v: "10", t: "10: Usuario no incluido en reporte anterior y que está fallecido en el momento del reporte actual." },
                { v: "12", t: "12: Población migrante de la república de Venezuela." },
                { v: "13", t: "13: Paciente trasladado de EAPB, que fue glosado en periodo anterior y no fue gestionado por la entidad (receptora) en el periodo actual." },
                { v: "14", t: "14: Usuario identificado por cruce con fuentes externas, con diagnóstico de déficit de factores de la coagulación, no confirmado o no gestionado por la EAPB." },
                { v: "15", t: "15: Usuario identificado por cruce con fuentes externas, con diagnóstico descartado por la EAPB o fallecido / desafiliado que no fue gestionado por la EAPB en quien no se confirmó diagnóstico." },
                { v: "16", t: "16: Usuario que se fue al extranjero." }
        ];

        window.SELECT_OPTIONS["VAR64_1_CausaMuerte"] = [
                { v: "", t: "Selecciona..." },
                { v: "1", t: "1: Complicación de la hemofilia o de la coagulopatía." },
                { v: "2", t: "2: Enfermedad cardiovascular" },
                { v: "3", t: "3: Cáncer" },
                { v: "4", t: "4: Infección" },
                { v: "5", t: "5: Por causa diferente a las descritas en 1, 2, 3 y 4 (otra enfermedad)" },
                { v: "6", t: "6: Causa Externa" },
                { v: "98", t: "98: No aplica, el usuario no ha fallecido" },
                { v: "99", t: "99: Sin información sobre la causa de muerte." }
        ];

        // =========================================================
        // 🟢 FUNCIONES AUXILIARES GLOBALES (FUERA DEL MOTOR)
        // =========================================================
        window.__correccionesCount = 0;

        const smartSet = (k, v) => {
                const el = document.getElementById(`f_${k}`);
                if (!el) return;
                const valActual = String(el.value || "").trim();
                const valNuevo = String(v || "").trim();

                if (valActual !== valNuevo) {
                        el.value = valNuevo;
                        // Solo contamos si el cambio es sustancial (no de vacío a vacío)
                        if (valActual !== "" || valNuevo !== "") {
                                window.__correccionesCount++;
                        }
                        el.dispatchEvent(new Event("change", { bubbles: true }));
                }
        };

        // =========================================================
        // 📝 VALIDACIÓN DE FORMULARIO (RESUMEN UNIFICADO)
        // =========================================================


        // ===== HEADER OFICIAL SISCAD CÁNCER (TAB-SEPARADO) =====
        const SISCAD_HEADER_CANCER =
                "VAR1_PrimerNombreUsuario\tVAR2_SegundoNombreUsuario\tVAR3_PrimerApellidoUsuario\tVAR4_SegundoApellidoUsuario\tVAR5_TipoIdentificacionUsuario\tVAR6_NumeroIdentificacionUsuario\tVAR7_FechaNacimiento\tVAR8_Sexo\tVAR9_Ocupacion\tVAR10_RegimenAfiliacionSGSSS\tVAR11_idEPS\tVAR12_CodigoPertenenciaEtnica\tVAR13_GrupoPoblacional\tVAR14_MunicipioResidencia\tVAR15_NumeroTelefonicopaciente\tVAR16_FechaAfiliacionEPSRegistra\tVAR17_NombreNeoplasia\tVAR18_FechaDx\tVAR19_FechaNotaRemisionMedico\tVAR20_FechaIngresoInstitucionRealizo\tVAR21_TipoEstudioRealizoDiagnostico\tVAR22_MotivoUsuarioNOTuvoDiagnostico\tVAR23_FechaRecoleccionMuestraEstudioHistopatologico\tVAR24_FechaInformHistopatologicoValido\tVAR25_CodigoValidoHabilitacionIPS\tVAR26_FechaPrimeraConsultaMedicoTratante\tVAR27_HistologiaTumorMuestraBiopsia\tVAR28_GradoDiferenciacionTumorSolidoMaligno\tVAR29_SiEsTumorSolido\tVAR30_FechaRealizoEstaEstadificacion\tVAR31_ParaCancerMama\tVAR32_ParaCancerMamaFechaRealizacion\tVAR33_ParaCancerMamaResultadoPrimera\tVAR34_ParaCancerColorrectalEstadificacionDukes\tVAR35_FechaEstadificacionDukes\tVAR36_EstadificacionLinfomaClinicaHodgkin\tVAR37_CancerProstataValorClasificacionGleason\tVAR38_ClasificacionRiesgoLeucemiasLinfomas\tVAR39_FechaClasificacionRiesgo\tVAR40_ObjetivoTratamientoMedicoInic\tVAR41_ObjetivoIntervencionMedicaPeriodoReporte\tVAR42_TieneAntecedenteOtroCancerPrimario\tVAR43_FechaDiagnosticoOtroCancerPrimario\tVAR44_TipoCancerAntecedente\tVAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual\tVAR46_FaseQuimioterapiaRecibioUsuarioCorte\tVAR46_1_UsuarioRecibioCorteQuimioterapiaPrefase\tVAR46_2_UsuarioRecibioCorteFaseQuimioterapiaInduccion\tVAR46_3_UsuarioRecibioCorteFaseQuimioterapIntensificacion\tVAR46_4_UsuarioRecibioCorteFaseQuimioterapiaConsolidacion\tVAR46_5_UsuarioRecibioCorteFaseQuimioterapiaReinduccion\tVAR46_6_UsuarioRecibiCorteFaseQuimioterapiaMantenimiento\tVAR46_7_UsuarioRecibioCorteFaseQuimioterapiaMantenimientoL\tVAR46_8_UsuarioRecibiCorteOtraFaseQuimioterapia\tVAR47_NumeroCiclosIniciadosPeriodoReporteActual\tVAR48_UbicacionTemporalPrimerCicloRelacionOncologico\tVAR49_FechaInicioPrimerCicloQuimioterapiaCorte\tVAR50_NumeroIPSPrimerCicloCorte\tVAR51_CodigoIPS1PrimerCicloCorte\tVAR52_CodigoIPS2PrimerCicloCorte\tVAR53_MedicamentosAntineoplasicosPrimerCicloCorte\tVAR53_1_Medicamentoadm1PrimerEsquema\tVAR53_2_Medicamentoadm2PrimerEsquema\tVAR53_3_Medicamentoadm3PrimerEsquema\tVAR53_4_Medicamentoadm4PrimerEsquema\tVAR53_5_Medicamentoadm5PrimerEsquema\tVAR53_6_Medicamentoadm6PrimerEsquema\tVAR53_7_Medicamentoadm7PrimerEsquema\tVAR53_8_Medicamentoadm8PrimerEsquema\tVAR53_9_Medicamentoadm9PrimerEsquema\tVAR54_MedicamentoNoPOS1AdministradoUsuarioPrimerCiclo\tVAR55_MedicamentoNoPOS2AdministradoUsuarioPrimerCiclo\tVAR56_MedicamentoNoPOS3AdministradoUsuarioPrimerCiclo\tVAR57_RecibioQuimioterapiaIntratecalPrimerCiclo\tVAR58_FechaFinalizacionPrimerCicloCorte\tVAR59_CaracteristicasActualesPrimerCicloCorte\tVAR60_MotivoFinalizacionPrimerCiclo\tVAR61_UbicacionTemporalUltimoCicloCorteOncologico\tVAR62_FechaInicioUltimoCicloQuimioterapiaCorte\tVAR63_NumeroIPSSuministranUltimoCicloCorte\tVAR64_CodigoIPS1SuministraUltimoCicloReporte\tVAR65_CodigoIPS2SuministraUltimoCicloReporte\tVAR66_MedicamentosAntineoplasicosEspecialistaCancer\tVAR66_1_Medicamentoadm1UltimoEsquema\tVAR66_2_Medicamentoadm2UltimoEsquema\tVAR66_3_Medicamentoadm3UltimoEsquema\tVAR66_4_Medicamentoadm4UltimoEsquema\tVAR66_5_Medicamentoadm5UltimoEsquema\tVAR66_6_Medicamentoadm6UltimoEsquema\tVAR66_7_Medicamentoadm7UltimoEsquema\tVAR66_8_Medicamentoadm8UltimoEsquema\tVAR66_9_Medicamentoadm9UltimoEsquema\tVAR67_MedicamentoNoPOS1AdministradoUsuarioUltimoCiclo\tVAR68_MedicamentoNoPOS2AdministradoUsuarioUltimoCiclo\tVAR69_MedicamentoNoPOS3AdministradoUsuarioUltimoCiclo\tVAR70_RecibioQuimioterapiaIntratecalUltimoCicloCorte\tVAR71_FechaFinalizacionCicloUltimo\tVAR72_CaracteristicasActualesUltimoCicloCorte\tVAR73_MotivoFinalizacionPrematuraUltimoCiclo\tVAR74_SometidoUsuarioCirugiasCurativasPaliativas\tVAR75_NumeroCirugiasSometidoUsuarioPeriodoReporteActual\tVAR76_FechaRealizacionPrimeraCirugiaReporte\tVAR77_CodigoIPSRealizoPrimeraCirugiaCorte\tVAR78_CodigoPrimeraCirugia\tVAR79_UbicacionTemporalPrimeraCirugiaOncologico\tVAR80_FechaRealizacionUltimoProcedimientoQuirurgico\tVAR81_MotivoHaberRealizadoUltimaIntervencionQuirurgica\tVAR82_CodigoIPSRealizaUltimoProcedimientosQuirugicos\tVAR83_CodigoUltimaCirugia\tVAR84_UbicacionTemporalUltimaCirugiaOncologico\tVAR85_EstadoVitalFinalizarUnicaUltimaCirugia\tVAR86_RecibioUsuarioAlgunTipoRadioterapiaCorteActual\tVAR87_NumeroEsquemasRadioterapiaSuministradosCorteActual\tVAR88_FechaInicioPrimerUnicoEsquemaRadioterapia\tVAR89_UbicacionTemporalPrimerUnicoEsquemaRadioterapia\tVAR90_TipoRadioterapiaAplicadaPrimerUnicoEsquema\tVAR91_NumeroIPSSuministranPrimerUnicoEsquemaRadioterapia\tVAR92_CodigoIPS1SuministraRadioterapia\tVAR93_CodigoIPS2SuministraRadioterapia\tVAR94_FechaFinalizacionPrimerUnicoEsquemaRadioterapia\tVAR95_CaracteristicasActualesPrimerEsquemaRadioterapia\tVAR96_MotivoFinalizacionPrimerEsquemaRadioterapia\tVAR97_FechaInicioUltimoEsquemaRadioterapia\tVAR98_UbicacionTemporalUltimoEsquemaRadioterapia\tVAR99_TipoRadioterapiaAplicadaUltimoEsquemaRadioterapia\tVAR100_NumeroIPSSuministranUltimoEsquemaRadioterapia\tVAR101_CodigoIPS1SuministraRadioterapia1\tVAR102_CodigoIPS2SuministraRadioterapia1\tVAR103_FechaFinalizacionUltimoEsquemaRadioterapia\tVAR104_CaracteristicasActualesUltimoEsquemaRadioterapia\tVAR105_MotivoFinalizacionUltimoEsquemaRadioTerapia\tVAR106_RecibioUsuarioTrasplanteCelulasProgenitoras\tVAR107_TipoTrasplanteRecibido\tVAR108_UbicacionTemporalTrasplanteOncologico\tVAR109_FechaTrasplante\tVAR110_CodigoIPSRealizoTrasplante\tVAR111_UsuarioRecibioCirugiaReconstructiva\tVAR112_FechaCirugia\tVAR113_CodigoIPSRealizoCirugiaReconstructiva\tVAR114_UsuarioValoradoConsultaProcedimientoPaliativo\tVAR114_1_UsuarioRecibioConsultaProcedimientoCuidadoPaliativ\tVAR114_2_UsuarioRecibioConsultaCuidadoPaliativo\tVAR114_3_UsuarioRecibioConsultaPaliativoEspecialista\tVAR114_4_UsuarioRecibioConsultaPaliativoGeneral\tVAR114_5_UsuarioRecibioConsultaPaliativoTrabajoSocial\tVAR114_6_UsuarioRecibioConsultaPaliativoNoEspecializado\tVAR115_FechaPrimeraConsultaPaliativoCorte\tVAR116_CodigoIPSRecibioPrimeraValoracionPaliativo\tVAR117_HaSidoValoradoUsuarioPorServicioPsiquiatria\tVAR118_FechaPrimeraConsultaServicioPsiquiatria\tVAR119_CodigoIPSRecibioPrimeraValoracionPsiquiatria\tVAR120_FueValoradoUsuarioPorProfesionalNutricion\tVAR121_FechaConsultaInicialNutricionCorte\tVAR122_CodigoIPSRecibioValoracionNutricion\tVAR123_UsuarioRecibioSoporteNutricional\tVAR124_UsuarioRecibidoTerapiasComplementariasRehabilitaci\tVAR125_TipoTratamientoRecibiendoUsuarioFechaCorte\tVAR126_ResultadoFinalManejoOncologicoCorte\tVAR127_EstadoVitalFinalizarCorte\tVAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior\tVAR129_NovedadClinicaUsuarioFechaCorte\tVAR130_FechaDesafiliacionEPS\tVAR131_FechaMuerte\tVAR132_CausaMuerte\tVAR133_SerialBDUA\tVAR134_V134FechaCorte";

        const SISCAD_KEYS_CANCER = SISCAD_HEADER_CANCER.split("\t"); // sin trim, sin map, sin "arreglos"

        // ===== HEADER OFICIAL SISCAD HEMOFILIA (TAB-SEPARADO) =====
        const SISCAD_HEADER_HEMO =
                "VAR1_PrimerNombre\tVAR2_SegundoNombre\tVAR3_PrimerApellido\tVAR4_SegundoApellido\tVAR5_TipoIdentificacion\tVAR6_Identificacion\tVAR7_FechaNacimiento\tVAR8_Sexo\tVAR9_Ocupacion\tVAR10_Regimen\tVAR11_idEPS\tVAR12_idPertenenciaEtnica\tVAR13_idGrupoPoblacional\tVAR14_MunicipioDeResidencia\tVAR15_TelefonoPaciente\tVAR16_FechaAfiliacion\tVAR17_GestacionAlCorte\tVAR18_EnPlanificacion\tVAR19_EdadUsuarioMomentoDx\tVAR20_MotivoPruebaDx\tVAR21_FechaDx\tVAR22_IpsRealizaConfirmacionDx\tVAR23_TipoDeficienciaDiagnosticada\tVAR24_SeveridadSegunNivelFactor\tVAR25_ActividadCoagulanteDelFactor\tVAR26_AntecedentesFamilares\tVAR27_FactorRecibidoTtoIni\tVAR28_EsquemaTtoIni\tVAR29_FechaDeIniPrimerTto\tVAR30_FactorRecibidoTtoAct\tVAR31_EsquemaTtoAct\tVAR32_Peso\tVAR32_1_Dosis\tVAR32_2_FrecuenciaPorSemana\tVAR32_3_UnidadesTotalesEnElPeriodo\tVAR32_4_AplicacionesDelFactorEnElPeriodo\tVAR33_ModalidadAplicacionTratamiento\tVAR34_ViaDeAdministracion\tVAR35_CodigoCumFactorPosRecibido\tVAR36_CodigoCumFactorNoPosRecibido\tVAR37_CodigoCumDeOtrosTratamientosUtilizadosI\tVAR38_CodigoCumDeOtrosTratamientosUtilizadosII\tVAR39_IpsSeguimientoActual\tVAR40_Hemartrosis\tVAR40_1_CantHemartrosisEspontaneasUlt12Meses\tVAR40_2_CantHemartrosisTraumaticasUlt12Meses\tVAR41_HemorragiaIlioPsoas\tVAR42_HemorragiaDeOtrosMusculosTejidos\tVAR43_HemorragiaIntracraneal\tVAR44_HemorragiaEnCuelloOGarganta\tVAR45_HemorragiaOral\tVAR46_OtrasHemorragias\tVAR47_1_CantOtrasHemorragiasEspontaneasDiffHemartrosis\tVAR47_2_CantOtrasHemorragiasTraumaticasDiffHemartrosis\tVAR47_3_CantOtrasHemorragAsocProcedimientoDiffHemartrosis\tVAR48_PresenciaDeInhibidor\tVAR48_1_FechaDeterminacionTitulosInhibidor\tVAR48_2_HaRecibidoITI\tVAR48_3_EstaRecibiendoITI\tVAR48_4_DiasEnITI\tVAR49_ArtropatiaHemofilicaCronica\tVAR49_1_CantArticulacionesComprometidas\tVAR50_UsuarioInfectadoPorVhc\tVAR51_UsuarioInfectadoPorVhb\tVAR52_UsuarioInfectadoPorVih\tVAR53_Pseudotumores\tVAR54_Fracturas\tVAR55_Anafilaxis\tVAR55_1_FactorAtribuyeReaccionAnafilactica\tVAR56_CantidadReemplazosArticulares\tVAR56_1_ReemplazosArticularesEnPeriodoDeCorte\tVAR57_LiderAtencion\tVAR57_1_ConsultasConHematologo\tVAR57_2_ConsultasConOrtopedista\tVAR57_3_IntervencionProfesionalEnfermeria\tVAR57_4_ConsultasOdontologo\tVAR57_5_ConsultasNutricionista\tVAR57_6_IntervencionTrabajoSocial\tVAR57_7_ConsultasConFisiatria\tVAR57_8_ConsultasConPsicologia\tVAR57_9_IntervencionQuimicoFarmaceutico\tVAR57_10_IntervencionFisioterapia\tVAR57_11_PrimerNombreMedicoTratantePrincipal\tVAR57_12_SegundoNombreMedicoTratantePrincipal\tVAR57_13_PrimerApellidoMedicoTratantePrincipal\tVAR57_14_SegundoApellidoMedicoTratantePrincipal\tVAR58_CantAtencionesUrgencias\tVAR59_CantEventosHospitalarios\tVAR60_CostoFactoresPos\tVAR61_CostoFactoresNoPos\tVAR62_CostoTotalManejo\tVAR63_CostoIncapacidadesLaborales\tVAR64_Novedades\tVAR64_1_CausaMuerte\tVAR64_2_FechaMuerte\tVAR65_SerialBDUA\tVAR66_V66FechaCorte";

        const SISCAD_KEYS_HEMO = SISCAD_HEADER_HEMO.split("\t"); // sin trim, sin map

        // --- VARIABLES DE ESTADO GLOBAL ---
        let currentPacienteId = "";
        let timerInterval = null;
        let startTime = null;
        let bandejaActual = 'pendiente';
        let cohorteActual = 'todos';
        let ultimaVariableEnfocada = "";
        let cohorteModalActual = 'cáncer'; // se setea al abrir ficha


        // --- FUNCIONES GLOBALES DE BANDEJAS ---
        window.cambiarBandeja = (b) => {
                window.bandejaActual = b;
                document.getElementById('tabPendientes').classList.toggle('active', b === 'pendiente');
                document.getElementById('tabValidados').classList.toggle('active', b === 'validado');
                const tabAprob = document.getElementById('tabAprobados');
                if (tabAprob) tabAprob.classList.toggle('active', b === 'aprobado');
                cargarPacientes();
        };

        window.cambiarCohorte = (c) => {
                window.cohorteActual = c;
                cohorteActual = c;
                document.querySelectorAll('.cohort-pill').forEach(p => p.classList.remove('active'));
                const pill = document.getElementById('pill-' + c);
                if (pill) pill.classList.add('active');
                cargarPacientes();
        };

        // =========================================================
        // ☑️ FUNCIONES MASIVAS Y DE CAJA FUERTE
        // =========================================================
        window.toggleAllPacientes = (el) => {
                document.querySelectorAll(".chk-paciente").forEach(chk => { chk.checked = el.checked; });
        };

        window.marcarTodosMasivo = (marcar) => {
                document.querySelectorAll(".chk-paciente").forEach(chk => { chk.checked = marcar; });
                const chkMaster = document.getElementById("chkMaster");
                if (chkMaster) chkMaster.checked = marcar;
        };

        window.verificarSeleccion = () => {
                const total = document.querySelectorAll(".chk-paciente").length;
                const marcados = document.querySelectorAll(".chk-paciente:checked").length;
                const chkMaster = document.getElementById("chkMaster");
                if (chkMaster) chkMaster.checked = (total > 0 && total === marcados);
        };

        window.marcarComoAprobadoSiscad = async (idPaciente) => {
                if (!confirm("✅ ¿Confirmas que este paciente PASÓ SIN ERRORES el validador de SISCAD? Se moverá a la caja fuerte.")) return;
                try {
                        const pActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        await updateDoc(doc(db, "pacientes_cac", idPaciente), { [`periodos.${pActual}.estado`]: "aprobado" });
                        window.cargarPacientes();
                } catch (e) { alert("Error: " + e.message); }
        };

        window.devolverAValidado = async (idPaciente) => {
                if (!confirm("¿Desea sacar a este paciente de Aprobados y regresarlo a Validados?")) return;
                try {
                        const pActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        await updateDoc(doc(db, "pacientes_cac", idPaciente), { [`periodos.${pActual}.estado`]: "validado" });
                        window.cargarPacientes();
                } catch (e) { alert("Error: " + e.message); }
        };

        window.aprobarMasivos = async () => {
                const seleccionados = Array.from(document.querySelectorAll('.chk-paciente:checked')).map(cb => cb.value);
                if (seleccionados.length === 0) return alert("⚠️ Selecciona al menos un paciente marcando la casilla.");
                if (!confirm(`¿Mover ${seleccionados.length} pacientes a la caja fuerte de Aprobados SISCAD?`)) return;

                try {
                        const pActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const promesas = seleccionados.map(id => updateDoc(doc(db, "pacientes_cac", id), { [`periodos.${pActual}.estado`]: "aprobado" }));
                        await Promise.all(promesas);
                        alert(`✅ ¡Éxito! ${seleccionados.length} pacientes aprobados.`);

                        // 🔥 CORRECCIÓN: Verificamos que el checkbox maestro exista antes de intentar desmarcarlo
                        const chkMaster = document.getElementById('chkMaster');
                        if (chkMaster) chkMaster.checked = false;

                        window.cargarPacientes();
                } catch (e) { alert("Error masivo: " + e.message); }
        };

        // =========================================================
        // ☑️ BOTONES DE SELECCIÓN MASIVA RÁPIDA
        // =========================================================
        window.marcarTodosMasivo = (marcar) => {
                // Busca todas las casillas de los pacientes y las marca o desmarca
                const checkboxes = document.querySelectorAll(".chk-paciente");
                checkboxes.forEach(chk => {
                        chk.checked = marcar;
                });

                // También actualiza visualmente el cuadrito maestro de la tabla
                const chkMaster = document.getElementById("chkMaster");
                if (chkMaster) chkMaster.checked = marcar;
        };

        // --- FUNCIÓN PARA DEVOLVER A PENDIENTES (CORREGIDA) ---
        window.cerrarModal = async () => {
                // 🔥 GUARDADO AUTOMÁTICO AL CERRAR: Sincronizar tiempo e inactividad
                if (currentPacienteId && !window.__modalReadOnly) {
                        try {
                                const idDoc = currentPacienteId;
                                const dataActual = currentPacienteData;
                                const pPeriodo = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                                
                                const tiempoSesionRelativo = window.startTime 
                                        ? Math.max(0, Math.floor((Date.now() - window.startTime) / 1000)) 
                                        : 0;

                                const tAnt = Number(dataActual?.periodos?.[pPeriodo]?.tiempo_segundos || 0);
                                const iAnt = Number(dataActual?.periodos?.[pPeriodo]?.inactividad_segundos || 0);

                                if (tiempoSesionRelativo > 0 || window.__idleSeconds > 0) {
                                        const docRef = doc(db, "pacientes_cac", idDoc);
                                        await updateDoc(docRef, {
                                                [`periodos.${pPeriodo}.tiempo_segundos`]: tAnt + Math.max(0, tiempoSesionRelativo - window.__idleSeconds),
                                                [`periodos.${pPeriodo}.inactividad_segundos`]: iAnt + window.__idleSeconds
                                        });
                                        console.log("💾 [AUDITORÍA] Progreso guardado automáticamente.");
                                }
                        } catch (e) { console.warn("Error en auto-guardado:", e); }
                }

                const modal = document.getElementById("modalPaciente");
                if (modal) modal.style.display = "none";

                currentPacienteId = null;
                cohorteModalActual = null;
                ultimaVariableEnfocada = "";
                window.__modalReadOnly = false;
                window.__originalVariables = {};
                window.startTime = null;
                const timerEl = document.getElementById("gestionTimer");
                if (timerEl) timerEl.textContent = "00:00";
                if (window.timerInterval) clearInterval(window.timerInterval);

                // Reiniciar métricas de inactividad de sesión
                window.__idleSeconds = 0;
                window.__lastActivity = Date.now();
                window.__isIdle = false;
                const overlay = document.getElementById("idleOverlay");
                if (overlay) overlay.style.display = "none";

                // 🕵️ Marcar el momento de cierre para detectar el "hueco" hasta la próxima ficha
                localStorage.setItem('__lastFichaCloseTime', Date.now().toString());

                liberarLockFicha().catch(() => { });
        };

        const __cerrarModalOriginal = window.cerrarModal;

        window.cerrarModal = async (...args) => {
                try {
                        await window.__altoCostoLocks.liberarLockFicha();
                } finally {
                        return __cerrarModalOriginal(...args);
                }
        };

        window.revertirEstado = async () => {
                if (!currentPacienteId) {
                        console.error("No se encontró el ID del paciente actual.");
                        return;
                }

                if (!confirm("¿Está seguro de devolver este paciente a la bandeja de PENDIENTES?")) return;

                try {
                        const periodoActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const elapsedSec = window.startTime ? Math.max(0, Math.floor((Date.now() - window.startTime) / 1000)) : 0;

                        const docRef = doc(db, "pacientes_cac", currentPacienteId);
                        const docSnap = await getDoc(docRef);
                        const dataExistente = docSnap.exists() ? docSnap.data() : {};

                        // 🔥 Respetamos el tipo de paciente que ya tenía
                        const tipoPacienteActual = dataExistente.periodos?.[periodoActual]?.tipo_paciente || "Nuevo";

                        const updates = {
                                ultima_actualizacion: new Date().toISOString(),
                                ultima_validacion: new Date().toISOString(),
                                validador_email: auth.currentUser.email,
                                [`periodos.${periodoActual}.estado`]: "validado",
                                [`periodos.${periodoActual}.tiempo_segundos`]: elapsedSec,
                                [`periodos.${periodoActual}.validado_el`]: new Date().toISOString(),
                                [`periodos.${periodoActual}.validador`]: auth.currentUser.email,
                                [`periodos.${periodoActual}.auditoria_errores_corregidos`]: window.__correccionesCount || 0,
                                [`periodos.${periodoActual}.tipo_paciente`]: tipoPacienteActual // 🚩 Se mantiene intacto
                        };

                        await updateDoc(docRef, updates);

                        alert("Paciente devuelto a pendientes con éxito.");
                        window.cerrarModal();
                        if (typeof window.cargarPacientes === "function") window.cargarPacientes();
                } catch (error) {
                        alert("Error de conexión: No se pudo actualizar el estado en la base de datos.");
                }
        };

        // cerrarModal ya está definido arriba con la lógica de lock — esta versión fue eliminada para evitar sobreescritura

        window.descartarCambios = () => {
                if (confirm("¿Está seguro de descartar los cambios? Se cerrará la ficha sin guardar.")) {
                        window.cerrarModal();
                }
        };

        function getPrevPeriodIdsSorted(data, currentPeriodo) {
                const all = Object.keys(data?.periodos || {});
                // Ordena YYYY-MM ascendente (string sirve si siempre es 4-2)
                all.sort((a, b) => a.localeCompare(b));
                // Devuelve los anteriores al periodo actual, en orden DESC (más reciente primero)
                return all.filter(p => p < currentPeriodo).reverse();
        }

        function getValFromPeriod(data, periodo, keyStore) {
                const v = data?.periodos?.[periodo]?.variables?.[keyStore];
                return (v === undefined || v === null) ? "" : v;
        }

        // Busca el valor más reciente (periodo anterior) donde esa variable exista y no sea vacía
        function getLastNonEmptyFromPreviousPeriods(data, currentPeriodo, keyStore) {
                const prevs = getPrevPeriodIdsSorted(data, currentPeriodo);
                for (const p of prevs) {
                        const v = getValFromPeriod(data, p, keyStore);
                        if (String(v).trim() !== "") return v;
                }
                return "";
        }

        // =========================================================
        // 🪄 4. REGLAS DE FORMATO AUTOMÁTICO (FECHAS E IPS)
        // =========================================================



        // =========================================================
        // ⚡ 5. FLUJO DE ESCRITURA EN TIEMPO REAL
        // =========================================================

        // =========================================================
        // 🚫 LISTAS DE VARIABLES VOLÁTILES (AZULES) SEGÚN MANUALES
        // =========================================================
        const VOLATILES_CANCER = [
                "VAR18_FechaDx",
                "VAR41_ObjetivoIntervencionMedicaPeriodoReporte",
                "VAR45_RecibioUsuarioQuimioterapiaPeriodoCorteActual",
                "VAR47_NumeroCiclosIniciadosPeriodoReporteActual",
                "VAR59_CaracteristicasActualesPrimerCicloCorte",
                "VAR72_CaracteristicasActualesUltimoCicloCorte",
                "VAR74_SometidoUsuarioCirugiasCurativasPaliativas",
                "VAR75_NumeroCirugiasSometidoUsuarioPeriodoReporteActual",
                "VAR86_RecibioUsuarioAlgunTipoRadioterapiaCorteActual",
                "VAR125_TipoTratamientoRecibiendoUsuarioFechaCorte",
                "VAR126_ResultadoFinalManejoOncologicoCorte",
                "VAR127_EstadoVitalFinalizarCorte",
                "VAR128_NovedadADMINISTRATIVAUsuarioReporteAnterior",
                "VAR129_NovedadClinicaUsuarioFechaCorte"
        ].map(v => v.replace(/\s+/g, ''));

        const VOLATILES_HEMO = [
                "VAR32_Peso",
                "VAR32_1_Dosis",
                "VAR32_3_UnidadesTotalesEnElPeriodo",
                "VAR32_4_AplicacionesDelFactorEnElPeriodo",
                "VAR40_1_CantHemartrosisEspontaneasUlt12Meses",
                "VAR40_2_CantHemartrosisTraumaticasUlt12Meses",
                "VAR48_3_EstaRecibiendoITI",
                "VAR57_1_ConsultasConHematologo",
                "VAR57_2_ConsultasConOrtopedista",
                "VAR58_CantAtencionesUrgencias",
                "VAR59_CantEventosHospitalarios",
                "VAR60_CostoFactoresPos",
                "VAR61_CostoFactoresNoPos",
                "VAR62_CostoTotalManejo",
                "VAR64_Novedades"
        ].map(v => v.replace(/\s+/g, ''));

        // =========================================================
        // 🔄 1. DIRECTOR DE AUDITORÍA VISUAL (CONSOLA EDUCATIVA)
        // =========================================================
        window.ejecutarAuditoriaVisual = () => {
                if (window.__modalReadOnly) return;

                const cohorteNorm = String(cohorteModalActual).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                // Arrays globales
                window.__correccionesCount = 0;
                window.__alertasCriticas = [];
                window.__erroresDuros = [];

                // 1. Limpieza total y validación primaria (Rojos y Azules)
                window.validarFormulario();

                // 2. Ejecutar motor SISCAD en vivo (Naranjas, Grises y Errores Duros)
                if (typeof window.validateSiscadRules === 'function') {
                        window.validateSiscadRules(cohorteNorm);
                }

                // 3. Recolectar la cantidad y los NOMBRES reales de los errores
                let nombresFaltantes = [];
                let nombresPorConfirmar = [];

                document.querySelectorAll("#formVariables input, #formVariables select").forEach(el => {
                        // Si el motor SISCAD lo bloqueó, ya no es un error del usuario
                        if (el.disabled) return;

                        let labelText = el.id.replace(/^f_/, ""); // Fallback
                        const labelEl = el.closest('.form-group') ? el.closest('.form-group').querySelector('label') : null;
                        if (labelEl) {
                                let clone = labelEl.cloneNode(true);
                                clone.querySelectorAll('span').forEach(s => s.remove()); // Quitar asteriscos rojos y la "i" de info
                                labelText = clone.textContent.trim();
                        }

                        if (el.classList.contains("required-empty")) {
                                nombresFaltantes.push(labelText);
                        } else if (el.getAttribute("data-volatil") === "true" && el.getAttribute("data-confirmado") === "false") {
                                nombresPorConfirmar.push(labelText);
                        }
                });

                const totalErroresQueBloquean = nombresFaltantes.length + window.__erroresDuros.length + nombresPorConfirmar.length;
                const btnG = document.getElementById("btnGuardar");
                let msgBox = document.getElementById("msgValidacion");

                if (!msgBox || !btnG) return;

                let html = "";

                // --- 🟠 SECCIÓN NARANJA (CORRECCIONES SISCAD) ---
                if (window.__alertasCriticas.length > 0) {
                        const alertasUnicas = [...new Set(window.__alertasCriticas)];
                        html += `
                        <div class="audit-section naranja">
                            <div class="audit-title">🟠 Autocorrecciones <span id="auditoriaBadge">${alertasUnicas.length}</span></div>
                            <ul>${alertasUnicas.map(a => `<li>${a}</li>`).join('')}</ul>
                        </div>`;
                }

                // --- 🛡️ LÓGICA DE BLOQUEO (REGLA RÍGIDA: ROJOS + AZULES BLOQUEAN) ---
                const camposRojos = [...nombresFaltantes, ...window.__erroresDuros];

                // REGLA CRÍTICA: Se bloquea si hay rojos O si hay azules pendientes
                if (camposRojos.length > 0 || nombresPorConfirmar.length > 0) {
                        // BLOQUEO ACTIVO
                        btnG.disabled = true;
                        btnG.style.background = "#cbd5e1";
                        btnG.style.cursor = "not-allowed";

                        if (camposRojos.length > 0) {
                                btnG.textContent = "CAMPOS REQUERIDOS";
                        } else {
                                btnG.textContent = "CONFIRMAR AZULES";
                        }

                        // Pintamos el resumen rojo si hay errores duros o vacíos obligatorios
                        if (camposRojos.length > 0) {
                                html += `
                                <div class="audit-section rojo">
                                    <div class="audit-title">🔴 Campos Requeridos <span id="auditoriaBadge">${camposRojos.length}</span></div>
                                    <div style="font-size:10px; margin-bottom:5px; opacity:0.8;">Variables vacías o inconsistencias críticas.</div>
                                    <ul>${camposRojos.map(c => `<li>${c}</li>`).join('')}</ul>
                                </div>`;
                        }
                } else {
                        // ✅ TODO CORRECTO (No hay rojos ni azules pendientes)
                        btnG.disabled = false;
                        btnG.style.cursor = "pointer";
                        btnG.style.background = (window.__correccionesCount > 0) ? "#ea580c" : "#16a34a";
                        btnG.textContent = (window.__correccionesCount > 0) ? "APLICAR REPARACIONES Y GUARDAR" : "VALIDAR Y FINALIZAR";
                }

                // --- 🔵 SECCIÓN AZUL (VOLÁTILES) ---
                if (nombresPorConfirmar.length > 0) {
                        html += `
                        <div class="audit-section azul">
                            <div class="audit-title">🔵 Confirmar datos <span id="auditoriaBadge">${nombresPorConfirmar.length}</span></div>
                            <div style="font-size:10px; margin-bottom:5px; opacity:0.8;">Vuelva a escribir los valores resaltados en azul.</div>
                            <ul>${nombresPorConfirmar.map(c => `<li>${c}</li>`).join('')}</ul>
                        </div>`;
                }

                // --- ✅ TODO OK ---
                if (html === "") {
                        html = `<div class="audit-ok">✅ Ficha validada correctamente</div>`;
                }

                msgBox.innerHTML = html;
        };

        // =========================================================
        // 🛠️ 2. EL TÚNEL DE LAVADO (Limpia y marca Rojos/Azules)
        // =========================================================
        window.validarFormulario = () => {
                const fields = document.querySelectorAll("#formVariables input, #formVariables select");
                const cohorteModalActualNorm = (cohorteModalActual || "").toString().toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                fields.forEach((el) => {
                        const nombreVariable = el.id.replace(/^f_/, "");
                        if (nombreVariable.startsWith("__ui_")) return;

                        // 🌟 LIMPIEZA ABSOLUTA DE COLOR FANTASMA
                        el.style.border = "1px solid #ccc";
                        el.style.background = "white";
                        el.classList.remove("required-empty");
                        el.disabled = false; // Desbloqueo inicial

                        const valor = (el.value || "").trim();
                        const esProhibido = (
                                cohorteModalActualNorm.includes('cancer') &&
                                nombreVariable === 'VAR17' &&
                                valor.toUpperCase() === 'C80X'
                        );
                        const necesitaConfirmar = (
                                el.getAttribute("data-volatil") === "true" &&
                                el.getAttribute("data-confirmado") === "false"
                        );

                        if (valor === "" || valor.toUpperCase() === "OBLIGATORIO" || esProhibido) {
                                el.classList.add("required-empty");
                                el.style.border = "2px solid #dc2626"; // 🔴 Rojo
                                el.style.background = "#fff1f1";
                        } else if (necesitaConfirmar) {
                                el.style.border = "2px solid #3b82f6"; // 🔵 Azul
                                el.style.background = "#eff6ff";
                        }
                });
        };

        // =========================================================
        // 🛡️ 3. MOTOR SISCAD: BLOQUEO INTELIGENTE Y REGLAS (VERSIÓN 2026)
        // =========================================================
        window.validateSiscadRules = function (cohorte) {
                const S_UNKNOWN = "1800-01-01";
                const S_NO_APPLY = "1845-01-01";

                // 📅 FECHAS VIGENCIA ACTUAL (Ajustado para el periodo 2025-2026)
                const PERIODO_INICIO = "2025-01-02";
                const EXCEPCION_NOV = "2025-11-01";

                const getEl = (varNum) => {
                        const regex = new RegExp(`^f_VAR${varNum}(?![0-9])`, 'i');
                        return Array.from(document.querySelectorAll('#formVariables input, #formVariables select')).find(el => regex.test(el.id));
                };

                const getVal = (varNum) => {
                        const el = getEl(varNum);
                        return el ? el.value.trim().toUpperCase() : "";
                };

                const enforce = (varNum, correcto, msg) => {
                        const el = getEl(varNum);
                        if (!el) return;

                        const valActual = el.value.trim().toUpperCase();
                        const valCorrecto = String(correcto).toUpperCase();

                        // 1. 🎨 SIEMPRE PINTA Y BLOQUEA VISUALMENTE (Así ya estuviera bien)
                        el.disabled = true;
                        el.style.cursor = 'not-allowed';
                        el.setAttribute("data-confirmado", "true");
                        el.classList.remove("required-empty");
                        el.style.border = "2px solid #ea580c";
                        el.style.backgroundColor = "#fff7ed";

                        if (varNum === "29" || varNum === "38") {
                                const uiPadreId = varNum === "29" ? "f___ui_estadio_cat" : "f___ui_riesgo38_cat";
                                const elPadre = document.getElementById(uiPadreId);
                                if (elPadre) {
                                        elPadre.disabled = true;
                                        elPadre.style.cursor = 'not-allowed';
                                        elPadre.style.border = "2px solid #ea580c";
                                        elPadre.style.backgroundColor = '#fff7ed';
                                }
                        }

                        // 2. 📝 SIEMPRE INCLUYE EL REPORTE EN LA LISTA INFERIOR
                        window.__alertasCriticas.push(`<b>VAR${String(varNum).replace('_', '.')}:</b> Fijado en <b>${correcto}</b> -> ${msg}`);

                        // 3. ⚙️ SOLO MODIFICA Y DISPARA EVENTOS SI EL VALOR ES DIFERENTE 
                        if (valActual !== valCorrecto) {

                                // Manejo silencioso de cascadas
                                if ((varNum === "29" || varNum === "38") && (valCorrecto === "98" || valCorrecto === "99")) {
                                        const uiPadreId = varNum === "29" ? "f___ui_estadio_cat" : "f___ui_riesgo38_cat";
                                        const elPadre = document.getElementById(uiPadreId);
                                        if (elPadre && elPadre.value !== "OTRAS") {
                                                elPadre.value = "OTRAS";
                                                const groupKey = varNum === "29" ? "VAR29_SiEsTumorSolido" : "VAR38_ClasificacionRiesgoLeucemiasLinfomas";
                                                if (window.SELECT_OPTIONS_BY_GROUP && window.SELECT_OPTIONS_BY_GROUP[groupKey]) {
                                                        const opciones = window.SELECT_OPTIONS_BY_GROUP[groupKey]["OTRAS"] || [];
                                                        el.innerHTML = "";
                                                        opciones.forEach(opt => {
                                                                const o = document.createElement("option");
                                                                o.value = opt.v; o.textContent = opt.t;
                                                                el.appendChild(o);
                                                        });
                                                }
                                        }
                                }

                                if (el.tagName === "SELECT") {
                                        const existe = Array.from(el.options).some(opt => opt.value.trim().toUpperCase() === valCorrecto);
                                        if (!existe) {
                                                const opt = document.createElement("option");
                                                opt.value = correcto;
                                                opt.text = correcto;
                                                el.appendChild(opt);
                                        }
                                }

                                el.value = correcto;
                                window.__correccionesCount++;

                                // Seguro anti-bucles para la interfaz
                                if (!window.__enBucle) {
                                        window.__enBucle = true;
                                        el.dispatchEvent(new Event("change", { bubbles: true }));
                                        setTimeout(() => { window.__enBucle = false; }, 50);
                                }
                        }
                };

                const enforceList = (list, correcto, msg) => {
                        list.forEach(v => enforce(v, correcto, msg));
                };

                const marcarErrorDuro = (varNum, msg) => {
                        const el = getEl(varNum);
                        if (el) {
                                el.style.border = "2px solid #dc2626";
                                el.style.background = "#fff1f1";
                                window.__erroresDuros.push(`<b>VAR${String(varNum).replace('_', '.')}:</b> ${msg}`);
                        }
                };

                try {
                        // --- 🔴 FECHAS CORRUPTAS GLOBALES ---
                        document.querySelectorAll('#formVariables input.date-iso, #formVariables input[placeholder="AAAA-MM-DD"]').forEach(el => {
                                const v = el.value.trim();
                                if (v.startsWith("1844") && v !== S_NO_APPLY) {
                                        el.value = S_NO_APPLY;
                                        el.style.border = "2px solid #ea580c";
                                        el.style.background = "#fff7ed";
                                        window.__alertasCriticas.push(`<b>Fecha Inválida:</b> Corregido 1844 a 1845`);
                                        window.__correccionesCount++;
                                        el.classList.remove("required-empty");
                                }
                                if (v.startsWith("1799") && v !== S_UNKNOWN) {
                                        el.value = S_UNKNOWN;
                                        el.style.border = "2px solid #ea580c";
                                        el.style.background = "#fff7ed";
                                        window.__alertasCriticas.push(`<b>Fecha Inválida:</b> Corregido 1799 a 1800`);
                                        window.__correccionesCount++;
                                        el.classList.remove("required-empty");
                                }
                        });

                        // --- 🏥 MAGIA IPS ---
                        let ipsVars = (cohorte === "cancer") ? [25, 51, 52, 64, 65, 77, 82, 92, 93, 101, 102, 110, 113, 116, 119, 122] : [22, 39];
                        ipsVars.forEach(num => {
                                const el = getEl(num);
                                if (el) {
                                        let val = el.value.trim();
                                        if (val !== "" && val.toUpperCase() !== "OBLIGATORIO" && val !== "NONE" && val !== "NOAP") {
                                                let soloNumeros = val.replace(/\D/g, '');
                                                if (soloNumeros.length === 11) {
                                                        val = "0" + soloNumeros;
                                                        el.value = val;
                                                        el.classList.remove("required-empty");
                                                        el.style.border = "2px solid #ea580c";
                                                        el.style.background = "#fff7ed";
                                                        window.__alertasCriticas.push(`<b>VAR${num}:</b> Se restauró el '0' inicial de la IPS`);
                                                        window.__correccionesCount++;
                                                }
                                                if (val !== "96" && val !== "97" && val !== "98" && val !== "99" && !(val.length === 12 && val.startsWith("0"))) {
                                                        marcarErrorDuro(num, `Código IPS inválido ("${val}"). Debe tener 12 dígitos y empezar por 0 (o ser 96/98/99).`);
                                                }
                                        }
                                }
                        });

                        // ==============================================
                        // 🎯 REGLAS HEMOFILIA
                        // ==============================================
                        if (cohorte === "hemofilia") {

                                if (getVal("8") === "M") {
                                        enforce("17", "3", "Masculino: Gestación No Aplica (Opción 3)");
                                }

                                const val23Str = getVal("23");
                                if (val23Str !== "") {
                                        const val23Num = parseInt(val23Str, 10);

                                        if (!isNaN(val23Num) && val23Num >= 2) {
                                                enforce("25", "9999", "Deficiencia no es Hemofilia A/B (VAR23 >= 2) -> Actividad factor (VAR25) DEBE SER 9999");
                                        }

                                        if (val23Num === 3) {
                                                const val24Str = getVal("24");
                                                const val24Num = parseInt(val24Str, 10);
                                                if (val24Str !== "" && (isNaN(val24Num) || val24Num < 3 || val24Num > 6)) {
                                                        marcarErrorDuro("24", "Incoherencia: Si la Deficiencia es Von Willebrand (VAR23=3), la Severidad (VAR24) DEBE SER entre 3 y 6.");
                                                }
                                        }

                                        if (!isNaN(val23Num) && val23Num >= 4) {
                                                enforce("24", "9999", "Deficiencia >= 4 -> Severidad (VAR24) DEBE SER 9999");
                                        }
                                }

                                const ttoAct = getVal("31");
                                if (ttoAct === "0" || ttoAct === "6") {
                                        enforce("32_2", "0", "Tto a demanda: Frecuencia No Aplica (Opción 0)");
                                }

                                if (getVal("40") === "0") enforceList(["40_1", "40_2"], "0", "Sin Hemartrosis -> Cantidades 0");
                                if (getVal("46") === "0") enforceList(["47_1", "47_2", "47_3"], "0", "Sin Otras Hemorragias -> Cantidades 0");

                                const inhib = getVal("48");
                                if (["2", "3", "4", "5", "6", "9999"].includes(inhib)) {
                                        enforceList(["48_2", "48_3"], "0", "Sin inhibidor o NA -> ITI = 0");
                                        enforce("48_4", "9998", "Sin inhibidor -> Días ITI No Aplica (9998)");
                                }
                                if (getVal("48_2") === "0") {
                                        enforce("48_3", "0", "No ha recibido ITI -> Estado Actual ITI = 0");
                                        enforce("48_4", "9998", "No ha recibido ITI -> Días ITI No Aplica (9998)");
                                }

                                if (getVal("49") === "0") enforce("49_1", "0", "Sin Artropatía -> Articulaciones comprometidas 0");
                                if (getVal("55") === "0") enforce("55_1", "0", "Sin Anafilaxis -> Factor atribuible 0");
                                if (getVal("56") === "0") enforce("56_1", "0", "Sin reemplazos previos -> Reemplazos en periodo 0");

                                if (getVal("64") !== "4") {
                                        enforce("64_1", "98", "No fallecido -> Causa Muerte 98 (No aplica)");
                                        enforce("64_2", S_NO_APPLY, "No fallecido -> Fecha Muerte No Aplica");
                                } else if (getVal("64") === "4") {
                                        if (getVal("64_1") === "98") marcarErrorDuro("64_1", "Incoherencia: Paciente fallecido, Causa Muerte NO puede ser 98.");
                                        if (getVal("64_2") === S_NO_APPLY) marcarErrorDuro("64_2", "Incoherencia: Paciente fallecido, Fecha Muerte NO puede ser 1845.");
                                }
                        }

                        // ==============================================
                        // 🎯 REGLAS CÁNCER (ACTUALIZADO 2026)
                        // ==============================================
                        else if (cohorte === "cancer") {
                                const val128 = getVal("128");
                                const val18 = getVal("18");
                                const val17 = getVal("17");
                                const esHematolinfatico = /^C(8[1-9]|9[0-6])/.test(val17);

                                // 🌟 1. PROTECCIÓN DE CASOS NUEVOS (NOVEDAD 2)
                                if (val128 === "2") {
                                        if (val18 !== "" && val18 !== S_UNKNOWN && val18 < PERIODO_INICIO) {
                                                marcarErrorDuro("18", `Si es Novedad 2 (Nuevo Dx), la Fecha Dx (VAR18) DEBE SER >= ${PERIODO_INICIO}.`);
                                        }
                                        if (val18 === S_UNKNOWN) marcarErrorDuro("18", "Para pacientes nuevos (Novedad 2) la Fecha Dx NO puede ser 1800-01-01.");
                                        if (getVal("24") === S_UNKNOWN) marcarErrorDuro("24", "Para pacientes nuevos (Novedad 2) la Fecha de Patología NO puede ser 1800-01-01.");
                                        if (["1", "2", "3", "4"].includes(getVal("21"))) marcarErrorDuro("21", "Las opciones 1, 2, 3 y 4 de Tipo Estudio no aplican para Novedad 2.");
                                        if (getVal("27") === "99") marcarErrorDuro("27", "La Histología (VAR27) NO puede ser 99 en pacientes nuevos.");

                                        if (val18 !== "" && val18 < EXCEPCION_NOV) {
                                                if (getVal("26") === S_UNKNOWN) marcarErrorDuro("26", `Fecha 1ra Consulta (VAR26) no puede ser 1800 si el Dx fue antes del ${EXCEPCION_NOV}.`);
                                                if (getVal("29") === "99") marcarErrorDuro("29", `La Estadificación (VAR29) no puede ser 99 si el Dx fue antes del ${EXCEPCION_NOV}.`);
                                                if (getVal("38") === "99") marcarErrorDuro("38", `El Riesgo (VAR38) no puede ser 99 si el Dx fue antes del ${EXCEPCION_NOV}.`);
                                        }
                                }

                                if (getVal("37") === "97") {
                                        enforce("21", "7", "Gleason 97 (Clínico) -> Tipo de Estudio debe ser 7 (Clínico)");
                                        enforce("24", S_NO_APPLY, "Gleason 97 (Clínico) -> Fecha Patología N.A. (1845)");
                                }

                                // 🌟 2. REGLA TIPO DE ESTUDIO (VAR21)
                                const val21 = getVal("21");
                                const val22 = getVal("22");
                                const val26 = getVal("26");

                                if (val21 !== "7" && val21 !== "") {
                                        enforce("22", "98", "Si V21 no es clínica(7) -> El motivo V22 debe ser 98");
                                } else if (val21 === "7") {
                                        if (val22 === "98") {
                                                marcarErrorDuro("22", "Si el diagnóstico es Clínico (VAR21=7), el motivo (VAR22) NO puede ser 98.");
                                        }
                                        if (val18 !== "" && val26 !== "" && val18 > val26) {
                                                marcarErrorDuro("26", "Incoherencia: Si el Dx es Clínico (VAR21=7), la Fecha Dx (VAR18) DEBE SER <= a la Fecha 1ra Consulta (VAR26).");
                                        }
                                }

                                if (val21 === "7") {
                                        enforceList(["23", "24"], S_NO_APPLY, "Estudio sin histopatología");
                                        enforce("27", "98", "No aplica histopatología");
                                        if (!esHematolinfatico) enforce("28", "98", "No aplica histopatología");
                                }

                                const val31 = getVal("31");
                                if (val31 === "2" || val31 === "98") {
                                        enforce("32", S_NO_APPLY, "HER2 no aplica/no realizado");
                                        enforce("33", "98", "HER2 no aplica/no realizado");
                                }
                                if (getVal("34") === "98" || getVal("34") === "99") {
                                        enforce("35", S_NO_APPLY, "Estadificación Dukes no aplica/desconocida");
                                }

                                // 🔥 REGLA HEMATOLINFÁTICO
                                if (val17 !== "") {
                                        const riesgoActual = getVal("38");

                                        if (!esHematolinfatico) {
                                                enforce("38", "98", "CIE-10 No Hematológico -> Riesgo N.A.");
                                                enforce("39", S_NO_APPLY, "Riesgo N.A. -> Fecha N.A.");
                                        } else {
                                                if (riesgoActual === "98") {
                                                        marcarErrorDuro("38", "Incoherencia: CIE-10 es Hematolinfático. El Riesgo (VAR38) NO puede ser 98 (No Aplica).");
                                                }
                                        }

                                        if (val17 !== "C61X") {
                                                enforce("37", "98", "No es cáncer de próstata -> Gleason N.A.");
                                        } else if (getVal("37") === "98") {
                                                marcarErrorDuro("37", "CIE-10 es Próstata (C61X). El Gleason NO puede ser 98.");
                                        }
                                }

                                const val37 = parseInt(getVal("37"));
                                if (!isNaN(val37) && val37 >= 1 && val37 <= 10) {
                                        marcarErrorDuro("37", `Gleason inválido (${val37}). Las opciones 1 a 10 ya no son permitidas. Debe ser >= 11.`);
                                }

                                const val38 = getVal("38");
                                const val39 = getVal("39");

                                if (val38 === "98") {
                                        enforce("39", S_NO_APPLY, "Riesgo no aplica -> Fecha N.A.");
                                } else if (val38 === "99") {
                                        enforce("39", S_UNKNOWN, "Riesgo desconocido -> Fecha Desconocida");
                                }

                                if (val39 === S_NO_APPLY && val38 !== "98") {
                                        if (!esHematolinfatico) {
                                                enforce("38", "98", "Si Fecha (VAR39) es 1845-01-01 -> Riesgo (VAR38) DEBE SER 98");
                                        }
                                }

                                const val41 = getVal("41");
                                if (val41 === "1" || (val41 === "3" && val45 !== "1") || val41 === "99") {
                                        enforce("45", "98", "V41 Observación/Seguimiento -> No Quimioterapia");
                                        enforce("74", "2", "V41 Observación/Seguimiento -> No Cirugía");
                                        enforce("86", "98", "V41 Observación/Seguimiento -> No Radioterapia");
                                        enforce("106", "98", "V41 Observación/Seguimiento -> No Trasplante");
                                        enforce("111", "98", "V41 Observación/Seguimiento -> No Reconstructiva");
                                        enforce("114", "2", "V41 Observación/Seguimiento -> No Paliativos");
                                }

                                // 🌟 NUEVAS REGLAS QUIMIOTERAPIA 
                                const val46 = getVal("46");

                                // 🔥 NUEVO: Detección automática y forzada para VAR46=0
                                if (val46 === "0" && val45 !== "1") {
                                        enforce("45", "98", "Si Fases (VAR46) = 0 -> No recibió Quimioterapia (VAR45=98).");
                                        enforceList(["46_1", "46_2", "46_3", "46_4", "46_5", "46_6", "46_7", "46_8"], "2", "Si Fases (VAR46) = 0 -> Subfase DEBE SER 2");
                                }

                                const val45 = getVal("45");
                                if (val45 === "2" || val45 === "98") {
                                        enforceList(["47", "48", "50", "51", "52", "53", "53_1", "53_2", "53_3", "53_4", "53_5", "53_6", "53_7", "53_8", "53_9", "54", "55", "56", "57", "59", "60", "61", "63", "64", "65", "66", "66_1", "66_2", "66_3", "66_4", "66_5", "66_6", "66_7", "66_8", "66_9", "67", "68", "69", "70", "72", "73"], "98", "No recibió Quimio (VAR45)");
                                        enforceList(["49", "58", "62", "71"], S_NO_APPLY, "Fechas Quimio no aplican");

                                        // 🔥 NUEVO: Autodetección de leucemias para llenar las fases si no hay quimio
                                        const esLeucemiaFases = ["C835", "C910", "C920", "C924", "C925"].includes(val17);
                                        if (esLeucemiaFases) {
                                                enforce("46", "0", "Leucemia específica sin Quimio -> Fases (VAR46) DEBE SER 0");
                                                enforceList(["46_1", "46_2", "46_3", "46_4", "46_5", "46_6", "46_7", "46_8"], "2", "Fases=0 -> Subfases DEBEN SER 2");
                                        } else {
                                                enforce("46", "98", "Sin Quimio (no leucemia) -> Fases (VAR46) DEBE SER 98");
                                                enforceList(["46_1", "46_2", "46_3", "46_4", "46_5", "46_6", "46_7", "46_8"], "97", "Fases=98 -> Subfases DEBEN SER 97");
                                        }

                                } else if (val45 === "1") {

                                        if (getVal("47") === "98") marcarErrorDuro("47", "Con Quimioterapia (VAR45=1), los ciclos (VAR47) NO pueden ser 98.");
                                        if (getVal("48") === "98") marcarErrorDuro("48", "Con Quimioterapia (VAR45=1), la ubicación (VAR48) NO puede ser 98.");
                                        if (getVal("50") === "98") marcarErrorDuro("50", "Con Quimioterapia (VAR45=1), número IPS (VAR50) NO puede ser 98.");
                                        if (getVal("51") === "98") marcarErrorDuro("51", "Con Quimioterapia (VAR45=1), código IPS (VAR51) NO puede ser 98.");
                                        if (getVal("53_1") === "98" || getVal("53_1") === "97") marcarErrorDuro("53_1", "Con Quimioterapia (VAR45=1), el medicamento 1 (VAR53.1) DEBE estar lleno.");
                                        if (getVal("57") === "98") marcarErrorDuro("57", "Con Quimioterapia (VAR45=1), la vía intratecal (VAR57) NO puede ser 98.");
                                        if (getVal("58") === S_NO_APPLY) marcarErrorDuro("58", "Con Quimioterapia (VAR45=1), la fecha fin (VAR58) NO puede ser 1845-01-01.");

                                        const val61 = getVal("61");
                                        if (val61 === "98") marcarErrorDuro("61", "Con Quimioterapia (VAR45=1), ubicación último ciclo (VAR61) NO puede ser 98.");

                                        const val58 = getVal("58");
                                        const val59 = getVal("59");

                                        // 🔥 REGLA DE TRATAMIENTO EN CURSO (V58 Y V59) Y V61 (ÚLTIMO CICLO)
                                        if (val58 === S_UNKNOWN) {
                                                if (val59 !== "3") enforce("59", "3", "Fecha fin 1800-01-01 -> Características (VAR59) DEBE SER 3");
                                                if (getVal("60") !== "98") enforce("60", "98", "Fecha fin 1800-01-01 -> Motivo fin (VAR60) DEBE SER 98");

                                                const v61Num = parseInt(getVal("61"), 10);
                                                if (isNaN(v61Num) || v61Num > 97) marcarErrorDuro("61", "Tratamiento en curso (V58=1800) -> Último Ciclo (VAR61) DEBE SER <= 97.");
                                        }
                                        if (val59 === "3") {
                                                if (val58 !== S_UNKNOWN) enforce("58", S_UNKNOWN, "Características 3 -> Fecha fin (VAR58) DEBE SER 1800-01-01");
                                                if (getVal("60") !== "98") enforce("60", "98", "Características 3 -> Motivo fin (VAR60) DEBE SER 98");

                                                const v61Num = parseInt(getVal("61"), 10);
                                                if (isNaN(v61Num) || v61Num > 97) marcarErrorDuro("61", "Tratamiento en curso (V59=3) -> Último Ciclo (VAR61) DEBE SER <= 97.");
                                        }

                                        let t53 = false;
                                        for (let i = 1; i <= 9; i++) {
                                                const v = getVal(`53_${i}`);
                                                if (v && v !== "98" && v !== "97" && v !== "0") t53 = true;
                                        }
                                        if (t53) {
                                                enforceList(["54", "55", "56"], "97", "Depende de VAR53.1 a 53.9");
                                        }

                                        if (val61 === "97") {
                                                enforceList(["63", "64", "65", "66", "66_1", "66_2", "66_3", "66_4", "66_5", "66_6", "66_7", "66_8", "66_9", "67", "68", "69", "72", "73"], "98", "VAR61=97 (Único esquema) -> Datos Último Esquema N.A.");
                                                enforceList(["62", "71"], S_NO_APPLY, "VAR61=97 -> Fechas Último Esquema N.A.");
                                                enforce("70", "2", "VAR61=97 -> Al no haber último esquema, NO recibió intratecal (2)");
                                        } else {
                                                const val66 = getVal("66");
                                                if (val66 === "98") {
                                                        enforceList(["66_1", "66_2", "66_3", "66_4", "66_5", "66_6", "66_7", "66_8", "66_9", "67", "68", "69"], "98", "VAR66=98 -> Medicamentos Último Esquema N.A.");
                                                } else {
                                                        let val61Num = parseInt(val61);
                                                        if (!isNaN(val61Num) && val61Num < 14) {
                                                                let t66 = false;
                                                                for (let i = 1; i <= 9; i++) {
                                                                        const v = getVal(`66_${i}`);
                                                                        if (v && v !== "98" && v !== "97" && v !== "0") t66 = true;
                                                                }
                                                                if (t66) enforceList(["67", "68", "69"], "97", "VAR61<14 con datos en VAR66");
                                                        }
                                                        if (getVal("66_9") === "97") enforce("67", "97", "VAR66.9=97 -> VAR67 DEBE SER 97");
                                                }
                                        }
                                }

                                const val74 = getVal("74");
                                if (val74 === "2" || val74 === "98") {
                                        enforceList(["75", "77", "78", "79", "81", "82", "83", "84", "85"], "98", "No sometido a Cirugía");
                                        enforceList(["76", "80"], S_NO_APPLY, "Fechas Cx no aplican");
                                }
                                if (getVal("85") === "98") enforceList(["88", "94", "97", "103"], S_NO_APPLY, "Estado Vital Cirugía=98");

                                const val86 = getVal("86");
                                if (val86 === "2" || val86 === "98") {
                                        enforceList(["87", "89", "90", "91", "92", "93", "95", "96", "98", "99", "100", "101", "102", "104", "105"], "98", "No recibió Radioterapia");
                                }

                                const val106 = getVal("106");
                                if (val106 === "2" || val106 === "98") {
                                        enforceList(["107", "108", "110"], "98", "No recibió Trasplante");
                                        enforce("109", S_NO_APPLY, "Fecha Trasplante no aplica");
                                }

                                const val114 = getVal("114");
                                if (val114 === "2" || val114 === "98") {
                                        enforceList(["114_1", "114_2", "114_3", "114_4", "114_5", "114_6"], "2", "Sin Paliativos -> Profesionales N.A.");
                                        enforce("115", S_NO_APPLY, "Sin Paliativos -> Fecha N.A.");
                                        enforce("116", "98", "Sin Paliativos -> IPS N.A.");
                                }

                                const val111 = getVal("111");
                                const val112 = getVal("112");
                                const val113 = getVal("113");

                                if (val113 === "98" && getVal("111") !== "98") enforce("111", "98", "Si IPS (VAR113) es 98 -> VAR111 DEBE SER 98");
                                if (val112 === S_NO_APPLY && getVal("111") !== "98") enforce("111", "98", "Si Fecha (VAR112) es 1845 -> VAR111 DEBE SER 98");

                                if (val111 === "1") {
                                        // CASO: SÍ hubo cirugía reconstructiva
                                        if (val112 === S_NO_APPLY) {
                                                marcarErrorDuro("111", "Incoherencia: Reportó cirugía (VAR111=1) pero la fecha (VAR112) figura como 'No Aplica'.");
                                        } else if (val112 !== "" && val112 !== S_UNKNOWN && val112 < PERIODO_INICIO) {
                                                marcarErrorDuro("112", `La fecha de cirugía (VAR112) debe ser >= ${PERIODO_INICIO}.`);
                                        }

                                        if (val113 === "98" || val113 === "55") {
                                                marcarErrorDuro("113", "Con cirugía reconstructiva (VAR111=1), la IPS no puede ser 98 ni 55 (No aplica). Indique la IPS real.");
                                        }
                                } else if (val111 === "2" || val111 === "98") {
                                        // CASO: NO hubo cirugía reconstructiva
                                        enforce("112", S_NO_APPLY, "Sin Cirugía Reconstructiva -> Fecha N.A.");
                                        enforce("113", "98", "Sin Cirugía Reconstructiva -> IPS N.A.");
                                } else if (val111 === "") {
                                        if (val113 === "98" || val112 === S_NO_APPLY) {
                                                enforce("111", "98", "Campos en N.A. -> Cirugía auto-asignada a 98");
                                        }
                                }

                                if (val18 !== "" && val18 !== S_UNKNOWN && val18 !== S_NO_APPLY && val18 < PERIODO_INICIO) {
                                        if (val128 !== "" && val128 !== "0" && val128 !== "3" && val128 !== "4" && val128 !== "5" && val128 !== "7" && val128 !== "9") {
                                                if (val128 === "2") marcarErrorDuro("128", "Dx antiguo (< 2025) NO puede tener Novedad 2.");
                                        }
                                }

                                // =========================================================
                                // 🔥 REGLAS ABSOLUTAS FINALES
                                // =========================================================

                                if (val17 === "C839" || val17 === "D45X" || val17 === "C833") {
                                        enforce("28", "95", `CIE-10 es ${val17} -> Grado de diferenciación (VAR28) DEBE SER 95`);
                                } else if (esHematolinfatico) {
                                        enforce("28", "95", `CIE-10 es ${val17} (Hematolinfático) -> Grado de diferenciación (VAR28) DEBE SER 95`);
                                }

                                if (getVal("27") === "98") {
                                        enforce("21", "7", "Si Histología (VAR27) es 98 -> Tipo de Estudio (VAR21) DEBE SER 7");
                                        enforceList(["23", "24"], S_NO_APPLY, "Si Histología (VAR27) es 98 -> Fechas de Patología DEBEN SER 1845-01-01");
                                }

                        }
                } catch (e) {
                        console.error("Error SISCAD:", e);
                }
        };

        window.controlarFlujoYLimpieza = (keyStore) => {
                const el = document.getElementById(`f_${keyStore}`);
                if (!el) return;

                // 🌟 QUITAR AZUL AL ESCRIBIR
                if (el.getAttribute("data-volatil") === "true") el.setAttribute("data-confirmado", "true");

                const elV5 = document.getElementById("f_VAR5_TipoIdentificacionUsuario") || document.getElementById("f_VAR5_TipoIdentificacion");
                const v5Antes = elV5 ? elV5.value : "";
                const isSelect = (el.tagName === "SELECT");
                if (!isSelect && el.value.trim() !== "") el.value = window.applyFieldRules(keyStore, el.value);
                if (!keyStore.includes("VAR5") && elV5 && v5Antes && elV5.value === "") elV5.value = v5Antes;

                clearTimeout(window.validationTimeout);
                window.validationTimeout = setTimeout(() => { window.ejecutarAuditoriaVisual(); }, 150);
        };

        document.addEventListener('input', function (e) {
                if (e.target && e.target.id && e.target.id.startsWith('f_VAR')) { window.controlarFlujoYLimpieza(e.target.id.replace('f_', '')); }
        });
        document.addEventListener('change', function (e) {
                if (e.target && e.target.tagName === 'SELECT' && e.target.id.startsWith('f_VAR')) { window.controlarFlujoYLimpieza(e.target.id.replace('f_', '')); }
        });

        // =========================================================
        // 🚀 5. ABRIR FICHA (Carga con inyección de estado Volátil y Cronómetro)
        // =========================================================
        window.abrirFicha = (id, data) => {
                currentPacienteId = id;
                const pSnapshot = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                window.__originalVariables = JSON.parse(JSON.stringify(data?.periodos?.[pSnapshot]?.variables || {}));

                cohorteModalActual = data.cohorte || "cáncer";
                ultimaVariableEnfocada = "";

                // 🔥 NUEVO: LÓGICA DE INACTIVIDAD POR INICIO TARDÍO (LÍMITE 7:30 AM)
                try {
                        const ahora = new Date();
                        const hoyStr = ahora.getFullYear() + '-' + (ahora.getMonth() + 1) + '-' + ahora.getDate();
                        const ultimoDiaFicha = localStorage.getItem('__lastFichaOpenDay');
                        const ultimaMarcaCierre = localStorage.getItem('__lastFichaCloseTime');

                        // 1. LÓGICA DE INICIO DE JORNADA (7:00 AM)
                        if (ultimoDiaFicha !== hoyStr && typeof horasDiaLaboral === 'function' && horasDiaLaboral(ahora) > 0) {
                                const limiteInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 7, 0, 0);
                                if (ahora > limiteInicio) {
                                        const segundosRetraso = Math.floor((ahora - limiteInicio) / 1000);
                                        window.__idleSeconds = (window.__idleSeconds || 0) + segundosRetraso;
                                        
                                        // Guardado inmediato del retraso...
                                        (async () => {
                                                try {
                                                        const pPeriodo = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                                                        const docRef = doc(db, "pacientes_cac", idDoc);
                                                        const inactAnterior = Number(data.periodos?.[pPeriodo]?.inactividad_segundos || 0);
                                                        await updateDoc(docRef, { [`periodos.${pPeriodo}.inactividad_segundos`]: inactAnterior + segundosRetraso });
                                                } catch (e) { }
                                        })();
                                }
                                localStorage.setItem('__lastFichaOpenDay', hoyStr);
                        } 
                        // 2. LÓGICA DE RASTREADOR DE HUECOS (ELIMINAR TRAMPA)
                        else if (ultimaMarcaCierre) {
                                const msCierre = parseInt(ultimaMarcaCierre);
                                const diffMs = Date.now() - msCierre;
                                
                                if (diffMs > 5000) { // Ignorar huecos menores a 5 segundos (doble clic o errores)
                                        let segundosHueco = Math.floor(diffMs / 1000);
                                        
                                        // 🥪 Ajuste de Almuerzo (Ignorar hueco entre 12 y 1pm si es muy largo)
                                        const h12 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 12, 0, 0).getTime();
                                        const h13 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 13, 0, 0).getTime();
                                        
                                        if (msCierre < h12 && Date.now() > h13) {
                                                segundosHueco = Math.max(0, segundosHueco - 3600); // Restar 1 hora de almuerzo
                                        }

                                        window.__idleSeconds = (window.__idleSeconds || 0) + segundosHueco;
                                        console.warn(`🕵️ [AUDITORÍA] Detectado hueco de ${Math.floor(segundosHueco/60)} min entre fichas. Sumado a inactividad.`);
                                }
                        }
                        // Limpiar marca de cierre porque ya estamos dentro de una ficha
                        localStorage.removeItem('__lastFichaCloseTime');
                } catch (e) {
                        console.error("Error en cálculo de inactividad inicial:", e);
                }

                const container = document.getElementById("formVariables");
                if (!container) return;
                container.innerHTML = "";

                const normCoh = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const isCancer = (normCoh(cohorteModalActual) === "cancer");
                const vars = isCancer ? VARS_CANCER : VARS_HEMO;
                const ayuda = isCancer ? AYUDA_CANCER : AYUDA_HEMATO;
                const volatilesLista = isCancer ? VOLATILES_CANCER : VOLATILES_HEMO;

                const periodoSel = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                const periodoObj = (data?.periodos?.[periodoSel] || {});
                const estadoPeriodo = String(periodoObj.estado || bandejaActual || "pendiente").toLowerCase();
                const readOnly = (estadoPeriodo === "validado");
                window.__modalReadOnly = readOnly;

                document.getElementById("modalNombre").textContent = data.nombreCompleto || "Sin Nombre";
                document.getElementById("modalID").textContent = "ID: " + (data.identificacion || "0");
                const dxEl = document.getElementById("modalDx");
                if (dxEl) dxEl.textContent = "Dx: " + (data.dx_descripcion || data.dx || "SIN DX");

                const btnGuardar = document.getElementById("btnGuardar");
                const btnDevolver = document.getElementById("btnDevolverPendiente");
                const btnNoCohorte = document.getElementById("btnNoCohorte");

                const rolActual = String(window.__userRol || "").toLowerCase().trim();
                const esAnalista = rolActual.includes("analista");
                const esAdminReal = rolActual === "master admin" || rolActual === "super admin";
                const puedeVerAyudas = esAnalista || esAdminReal || rolActual === "administrador";

                if (readOnly) {
                        if (btnGuardar) btnGuardar.style.display = "none";
                        if (btnNoCohorte) btnNoCohorte.style.display = "none";
                        if (btnDevolver) {
                                btnDevolver.style.display = (esAdminReal) ? "inline-block" : "none";
                                btnDevolver.textContent = "↩ DEVOLVER A PENDIENTES";
                        }
                } else {
                        if (btnGuardar) {
                                btnGuardar.style.display = "inline-block";
                                btnGuardar.textContent = "VALIDAR Y FINALIZAR";
                        }
                        if (btnDevolver) btnDevolver.style.display = "none";

                        if (btnNoCohorte) {
                                const yaMarcado = data?.periodos?.[periodoSel]?.no_cohorte === true;
                                const esMasterOSuper = rolActual === "master admin" || rolActual === "super admin" || rolActual === "administrador" || rolActual === "master";
                                const esAnalista = rolActual.includes("analista");

                                // 📌 Lógica EXACTA:
                                // Solo Analista puede ver el botón para marcar.
                                // El Admin solo ve el botón informativo SI YA FUE MARCADO por la analista.
                                if (esAnalista || (esMasterOSuper && yaMarcado)) {
                                        btnNoCohorte.style.display = "inline-flex";
                                        btnNoCohorte.style.alignItems = "center";
                                        btnNoCohorte.style.gap = "8px";
                                        btnNoCohorte.style.padding = "10px 18px";
                                        btnNoCohorte.style.borderRadius = "12px";
                                        btnNoCohorte.style.fontSize = "11px";
                                        btnNoCohorte.style.fontWeight = "800";
                                        btnNoCohorte.style.color = "white";
                                        btnNoCohorte.style.border = "none";
                                        btnNoCohorte.style.background = yaMarcado ? "#16a34a" : "#dc2626";
                                        btnNoCohorte.style.opacity = yaMarcado ? "0.7" : "1";
                                        btnNoCohorte.style.cursor = (esAnalista && !yaMarcado) ? "pointer" : "default";

                                        btnNoCohorte.innerHTML = yaMarcado
                                                ? `<i data-lucide="check-circle" style="width:16px;"></i> REPORTADO POR ANALISTA: NO PERTENECE A COHORTE`
                                                : `<i data-lucide="user-x" style="width:16px;"></i> MARCAR: NO PERTENECE A ESTA COHORTE`;

                                        if (esAnalista && !yaMarcado) {
                                                btnNoCohorte.onclick = () => window.marcarNoCohorte();
                                        } else {
                                                btnNoCohorte.onclick = null;
                                        }

                                        if (window.lucide) {
                                                setTimeout(() => window.lucide.createIcons({ props: { "stroke-width": 2.5 } }), 50);
                                        }
                                } else {
                                        btnNoCohorte.style.display = "none";
                                }
                        }
                }

                const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                const isFechaVar = (label, k) => (/fecha|date/i.test(label) || /fecha|date/i.test(k));

                // Para crear opciones de Selects normales
                const buildOptionsHtml = (ops, currentVal) => {
                        return (ops || []).map(({ v: code, t: label }) => {
                                const selected = (String(currentVal || "").trim().toUpperCase() === String(code).trim().toUpperCase()) ? "selected" : "";
                                return `<option value="${esc(code)}" ${selected}>${esc(label)}</option>`;
                        }).join("");
                };

                const KEY_ESTADIO = "VAR29_SiEsTumorSolido"; const KEY_CAT_UI = "__ui_estadio_cat";
                const KEY_RIESGO38 = "VAR38_ClasificacionRiesgoLeucemiasLinfomas"; const KEY_CAT38_UI = "__ui_riesgo38_cat";

                for (const v of vars) {
                        const keyStore = typeof window.canonKey === 'function' ? window.canonKey(v) : v.replace(/\s+/g, '');
                        // 🌈 CAPA VISUAL: Formateo para lectura humana sin romper la clave técnica
                        const labelUI = window.formatLabelParaHumanos ? window.formatLabelParaHumanos(v) : v;

                        const esFecha = isFechaVar(v, keyStore);
                        const esVolatil = volatilesLista.includes(keyStore);


                        let val = "";
                        const vP = data?.periodos?.[periodoSel]?.variables?.[keyStore];
                        const vB = data?.datos_base?.[keyStore];
                        const vR = data?.[keyStore];

                        // PRIORIDAD: Periodo Actual > Datos Base > Raíz Documento > Historial
                        if (vP !== undefined && vP !== null && String(vP).trim() !== "") {
                                val = vP;
                        } else if (vB !== undefined && vB !== null && String(vB).trim() !== "") {
                                val = vB;
                        } else if (vR !== undefined && vR !== null && String(vR).trim() !== "") {
                                val = vR;
                        } else if (typeof getLastNonEmptyFromPreviousPeriods === 'function') {
                                val = getLastNonEmptyFromPreviousPeriods(data, periodoSel, keyStore);
                        }

                        // Casos especiales (Identificación fallback manual si todo falla)
                        if (keyStore.includes("Identificacion") && String(val ?? "").trim() === "") {
                                val = data.identificacion || "";
                        }

                        // Si es Volátil y TRAJO datos del pasado, le ponemos la etiqueta para que se pinte azul
                        const attrVolatil = (!readOnly && esVolatil && String(val).trim() !== "") ? `data-volatil="true" data-confirmado="false"` : '';

                        // El tooltip (tip) se busca siempre con la clave técnica ORIGINAL (v)
                        // Búsqueda resiliente (Case-insensitive y sin espacios)
                        const getTip = (obj, k) => {
                                if (!obj || !k) return "";
                                // 1. Coincidencia exacta
                                if (obj[k]) return obj[k];

                                // 2. Coincidencia normalizada (Mayúsculas y sin espacios)
                                const kNorm = k.toUpperCase().replace(/\s+/g, "");
                                const found = Object.keys(obj).find(key => {
                                        return key.toUpperCase().replace(/\s+/g, "") === kNorm;
                                });
                                return found ? obj[found] : "";
                        };

                        const rawTip = (getTip(ayuda, v) || getTip(ayuda, keyStore) || "").toString().trim();
                        // Si no hay tip, mostramos un mensaje genérico para que siempre aparezca el icono 'i'
                        const tip = rawTip || "Dato obligatorio según instructivo técnico de la Cuenta de Alto Costo (CAC).";

                        // Solo mostramos icono de ayuda a Analistas y Administradores
                        const helpIconHTML = puedeVerAyudas ? `<span class="info-icon" data-tip="${esc(tip)}">i</span>` : '';
                        const labelHTML = `${esc(labelUI)} ${helpIconHTML} <span style="color:red;">*</span>`;


                        // Selects Anidados (Estadio)
                        if (keyStore === KEY_ESTADIO) {
                                const catOps = window.SELECT_OPTIONS?.[KEY_CAT_UI] || [{ v: "", t: "Selecciona categoría..." }];
                                container.innerHTML += `
                <div class="form-group">
                    <label>${labelHTML}</label>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <select id="f_${esc(KEY_CAT_UI)}" class="fp-input" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" ${readOnly ? "disabled" : ""}>${buildOptionsHtml(catOps, "")}</select>
                        <select id="f_${esc(KEY_ESTADIO)}" class="fp-input" onchange="window.controlarFlujoYLimpieza('${esc(KEY_ESTADIO)}');" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" ${readOnly ? "disabled" : ""} ${attrVolatil}><option value="">Selecciona...</option></select>
                    </div>
                </div>`;
                                continue;
                        }

                        // Selects Anidados (Riesgo Leucemias)
                        if (keyStore === KEY_RIESGO38) {
                                const catOps = window.SELECT_OPTIONS?.[KEY_CAT38_UI] || [{ v: "", t: "Selecciona categoría..." }];
                                container.innerHTML += `
                <div class="form-group">
                    <label>${labelHTML}</label>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <select id="f_${esc(KEY_CAT38_UI)}" class="fp-input" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" ${readOnly ? "disabled" : ""}>${buildOptionsHtml(catOps, "")}</select>
                        <select id="f_${esc(KEY_RIESGO38)}" class="fp-input" onchange="window.controlarFlujoYLimpieza('${esc(KEY_RIESGO38)}');" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" ${readOnly ? "disabled" : ""} ${attrVolatil}><option value="">Selecciona...</option></select>
                    </div>
                </div>`;
                                continue;
                        }

                        // Selects Normales
                        const hasSelect = window.SELECT_OPTIONS && Array.isArray(window.SELECT_OPTIONS[keyStore]) && window.SELECT_OPTIONS[keyStore].length > 0;
                        if (hasSelect) {
                                container.innerHTML += `
                <div class="form-group">
                    <label>${labelHTML}</label>
                    <select id="f_${esc(keyStore)}" class="fp-input" onchange="window.controlarFlujoYLimpieza('${esc(keyStore)}');" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:5px;" ${readOnly ? "disabled" : ""} ${attrVolatil}>${buildOptionsHtml(window.SELECT_OPTIONS[keyStore], val)}</select>
                </div>`;
                                continue;
                        }

                        // Inputs de Texto / Fechas
                        container.innerHTML += `
            <div class="form-group">
                <label>${labelHTML}</label>
                <input type="text" inputmode="${esFecha ? 'numeric' : 'text'}" id="f_${esc(keyStore)}" class="${esFecha ? 'date-iso' : ''}" value="${esc(val || '')}" oninput="window.controlarFlujoYLimpieza('${esc(keyStore)}');" placeholder="${esFecha ? 'AAAA-MM-DD' : 'Obligatorio'}" ${readOnly ? "disabled" : ""} ${attrVolatil}>
            </div>`;
                }

                document.getElementById("modalPaciente").style.display = "flex";

                if (!readOnly) {
                        // Inicializar Flatpickr
                        setTimeout(() => {
                                container.querySelectorAll("input.date-iso").forEach((inp) => {
                                        if (inp._flatpickr) inp._flatpickr.destroy();
                                        if (typeof flatpickr !== 'undefined') {
                                                flatpickr(inp, {
                                                        dateFormat: "Y-m-d", allowInput: true,
                                                        defaultDate: inp.value && /^\d{4}-\d{2}-\d{2}$/.test(inp.value) ? inp.value : null,
                                                        onChange: () => { window.controlarFlujoYLimpieza(inp.id.replace(/^f_/, "")); }
                                                });
                                        }
                                });
                        }, 0);

                        // Inicializar Selects Anidados
                        setTimeout(() => {
                                const initChain = (catId, valId, groups) => {
                                        const selCat = document.getElementById(`f_${catId}`);
                                        const selVal = document.getElementById(`f_${valId}`);
                                        if (!selCat || !selVal) return;
                                        const refill = (keep) => {
                                                const cat = selCat.value;
                                                const opts = groups[cat] || [{ v: "", t: "Selecciona..." }];
                                                selVal.innerHTML = window.buildOptionsHtml ? window.buildOptionsHtml(opts, keep ? selVal.value : "") : "";
                                        };
                                        // Hidratación con jerarquía Periodo > Base > Raíz > Historial
                                        const vP = data?.periodos?.[periodoSel]?.variables?.[valId];
                                        const vB = data?.datos_base?.[valId];
                                        const vR = data?.[valId];

                                        let actual = "";
                                        if (vP !== undefined && vP !== null && String(vP).trim() !== "") {
                                                actual = String(vP).trim();
                                        } else if (vB !== undefined && vB !== null && String(vB).trim() !== "") {
                                                actual = String(vB).trim();
                                        } else if (vR !== undefined && vR !== null && String(vR).trim() !== "") {
                                                actual = String(vR).trim();
                                        } else if (typeof getLastNonEmptyFromPreviousPeriods === 'function') {
                                                actual = String(getLastNonEmptyFromPreviousPeriods(data, periodoSel, valId)).trim();
                                        }
                                        if (actual) { for (const cat in groups) { if (groups[cat].some(o => String(o.v) === actual)) { selCat.value = cat; break; } } }
                                        refill(true);
                                        if (actual) selVal.value = actual;
                                        if (!readOnly) { selCat.addEventListener("change", () => { refill(false); window.controlarFlujoYLimpieza(valId); }); }
                                };
                                if (window.SELECT_OPTIONS_BY_GROUP) {
                                        initChain(KEY_CAT_UI, KEY_ESTADIO, window.SELECT_OPTIONS_BY_GROUP[KEY_ESTADIO] || {});
                                        initChain(KEY_CAT38_UI, KEY_RIESGO38, window.SELECT_OPTIONS_BY_GROUP[KEY_RIESGO38] || {});
                                }
                        }, 50);

                        // ⏱️ INICIO DEL CRONÓMETRO (ACUMULATIVO Y ANTI-TRAMPA)
                        const timerEl = document.getElementById("gestionTimer");
                        if (window.timerInterval) clearInterval(window.timerInterval);

                        const tiempoBaseAcumulado = Number(periodoObj?.tiempo_segundos || 0);
                        window.startTime = Date.now();
                        window.timerInterval = setInterval(() => {
                                if (window.__isIdle) return; // 🛑 No sumar tiempo si está en IDLE

                                const sesionActual = Math.floor((Date.now() - window.startTime - (window.__idleSeconds * 1000)) / 1000);
                                const totalMostrar = tiempoBaseAcumulado + sesionActual;
                                const fmtT = (s) => {
                                        const sc = Number(s) || 0;
                                        return `${Math.floor(sc / 60).toString().padStart(2, '0')}:${(sc % 60).toString().padStart(2, '0')}`;
                                };
                                if (timerEl) timerEl.textContent = fmtT(totalMostrar);
                        }, 1000);

                        setTimeout(() => {
                                window.ejecutarAuditoriaVisual();

                                // Forzar visibilidad del panel de validación
                                const validacionBandeja = document.getElementById("validacionBandeja");
                                const msgBox = document.getElementById("msgValidacion");

                                // Si msgValidacion no existe dentro de validacionBandeja, crearlo
                                if (validacionBandeja && !msgBox) {
                                        const nuevoMsg = document.createElement("div");
                                        nuevoMsg.id = "msgValidacion";
                                        nuevoMsg.style.cssText = "width:100%; display:block;";
                                        validacionBandeja.appendChild(nuevoMsg);
                                        // Re-ejecutar auditoría ahora que el elemento existe
                                        window.ejecutarAuditoriaVisual();
                                } else if (msgBox) {
                                        msgBox.style.display = "block";
                                        msgBox.style.width = "100%";
                                }
                        }, 700);
                } else {
                        const timerEl = document.getElementById("gestionTimer");
                        if (timerEl) timerEl.textContent = typeof formatTime === 'function' ? formatTime(Number(periodoObj.tiempo_segundos ?? 0)) : "00:00";
                }

                // =========================================================
                // 🔗 REPARADOR FORZADO DE SELECTORES EN CASCADA (VAR 29 y 38)
                // =========================================================
                setTimeout(() => {
                        // 1. Reparar Cascada VAR29 (Estadio)
                        const catEstadio = document.getElementById("f___ui_estadio_cat");
                        // Buscamos la VAR29 sin importar si el ID tiene el nombre largo o corto
                        const valEstadio = document.getElementById("f_VAR29_SiEsTumorSolido") || document.querySelector("select[id^='f_VAR29']");

                        if (catEstadio && valEstadio && window.SELECT_OPTIONS_BY_GROUP) {
                                catEstadio.addEventListener("change", function () {
                                        const categoria = this.value;
                                        const opciones = window.SELECT_OPTIONS_BY_GROUP["VAR29_SiEsTumorSolido"][categoria] || [{ v: "", t: "Selecciona..." }];

                                        valEstadio.innerHTML = ""; // Limpiar lista vieja
                                        opciones.forEach(opt => {
                                                const nuevaOpcion = document.createElement("option");
                                                nuevaOpcion.value = opt.v;
                                                nuevaOpcion.textContent = opt.t;
                                                valEstadio.appendChild(nuevaOpcion);
                                        });

                                        // Forzar desbloqueo visual y funcional
                                        valEstadio.disabled = false;
                                        valEstadio.style.cursor = "pointer";
                                        valEstadio.style.backgroundColor = "#ffffff";
                                });

                                // Simular un click inicial para que cargue si ya venía con datos
                                if (catEstadio.value !== "") catEstadio.dispatchEvent(new Event("change"));
                        }

                        // 2. Reparar Cascada VAR38 (Riesgo Hemato)
                        const catRiesgo = document.getElementById("f___ui_riesgo38_cat");
                        const valRiesgo = document.getElementById("f_VAR38_ClasificacionRiesgoLeucemiasLinfomas") || document.querySelector("select[id^='f_VAR38']");

                        if (catRiesgo && valRiesgo && window.SELECT_OPTIONS_BY_GROUP) {
                                catRiesgo.addEventListener("change", function () {
                                        const categoria = this.value;
                                        const opciones = window.SELECT_OPTIONS_BY_GROUP["VAR38_ClasificacionRiesgoLeucemiasLinfomas"][categoria] || [{ v: "", t: "Selecciona..." }];

                                        valRiesgo.innerHTML = ""; // Limpiar lista vieja
                                        opciones.forEach(opt => {
                                                const nuevaOpcion = document.createElement("option");
                                                nuevaOpcion.value = opt.v;
                                                nuevaOpcion.textContent = opt.t;
                                                valRiesgo.appendChild(nuevaOpcion);
                                        });

                                        valRiesgo.disabled = false;
                                        valRiesgo.style.cursor = "pointer";
                                        valRiesgo.style.backgroundColor = "#ffffff";
                                });

                                if (catRiesgo.value !== "") catRiesgo.dispatchEvent(new Event("change"));
                        }
                }, 500);
        }; // Aquí termina window.abrirFicha



        $safeAction("logoutBtn", "click", () => signOut(auth));

        // --- FUNCIONES GLOBALES DE BANDEJAS ---
        window.cambiarBandeja = (b) => {
                window.bandejaActual = b;      // ← DEBE existir esta línea
                bandejaActual = b;             // ← Y esta también (variable local del closure)
                $safeGet('tabPendientes').classList.toggle('active', b === 'pendiente');
                $safeGet('tabValidados').classList.toggle('active', b === 'validado');
                const tabAprobados = document.getElementById('tabAprobados');
                if (tabAprobados) tabAprobados.classList.toggle('active', b === 'aprobado');
                window.cargarPacientes();
        };

        window.cambiarCohorte = (c) => {
                window.cohorteActual = c;
                document.querySelectorAll('.cohort-pill').forEach(p => p.classList.remove('active'));
                $safeGet('pill-' + c).classList.add('active');
                window.cargarPacientes();
        };


        // =========================================================
        // NUEVAS FUNCIONES PARA "APROBADOS SISCAD"
        // =========================================================

        // =========================================================
        // 🔄 CARGAR PACIENTES Y DIBUJAR TABLA / DASHBOARD
        // =========================================================
        async function cargarPacientes() {
                const authedUser = await ensureAuth();
                if (!authedUser) {
                        console.warn("[ALTO_COSTO] No se puede cargar sin sesión.");
                        // No bloqueamos por si acaso, pero avisamos
                }
                const elMes = document.getElementById("filtroMes");
                const elAnio = document.getElementById("filtroAnio");
                if (!elMes || !elAnio) return;

                // Tarea 1: Valores por defecto válidos (Data Month N-1 por flujo de trabajo)
                const cDefault = getCicloOperativoHoy();
                const mes = elMes.value || String(cDefault.m).padStart(2, '0');
                const anio = elAnio.value || String(cDefault.y);
                const pPeriodo = `${anio}-${mes}`;

                // Tarea 2: Blindaje de Query (No procesar si el formato es inválido)
                const regexPeriodo = /^\d{4}-\d{2}$/;
                if (!regexPeriodo.test(pPeriodo)) {
                        console.warn("[DEBUG QUERY] Abortado: Periodo mal formado ->", pPeriodo);
                        return;
                }

                console.log("[DEBUG QUERY] Carga iniciada para Periodo:", pPeriodo);

                const $setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
                const $setWidth = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + "%"; };

                // ─── FESTIVOS COLOMBIA 2024-2027 (Ley Emiliani incluida) ───────────────
                const FESTIVOS_CO = new Set([
                        // 2025
                        "2025-01-01", "2025-01-06", "2025-03-24", "2025-04-17", "2025-04-18",
                        "2025-05-01", "2025-06-02", "2025-06-23", "2025-06-30", "2025-07-20",
                        "2025-08-07", "2025-08-18", "2025-10-13", "2025-11-03", "2025-11-17",
                        "2025-12-08", "2025-12-25",
                        // 2026
                        "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03",
                        "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-07-20",
                        "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16",
                        "2026-12-08", "2026-12-25"
                ]);

                const esFestivo = (dt) => {
                        const iso = dt.getFullYear() + "-" +
                                String(dt.getMonth() + 1).padStart(2, "0") + "-" +
                                String(dt.getDate()).padStart(2, "0");
                        return FESTIVOS_CO.has(iso);
                };

                // Horas laborales por día de semana (descontando almuerzo)
                // Lun-Jue: 7am-5pm = 9h hábiles | Vie: 7am-4pm = 8h hábiles
                const horasDiaLaboral = (dt) => {
                        const dow = dt.getDay();
                        if (esFestivo(dt)) return 0;
                        if (dow === 6 || dow === 0) return 0;
                        if (dow === 5) return 8;   // Viernes
                        return 9;                   // Lun-Jue
                };

                // Días hábiles del mes (sin festivos)
                const diasHabilesColombia = (yearStr, monthStr) => {
                        const y = parseInt(yearStr, 10), m = parseInt(monthStr, 10);
                        const last = new Date(y, m, 0).getDate();
                        const arr = [];
                        for (let day = 1; day <= last; day++) {
                                const dt = new Date(y, m - 1, day);
                                if (horasDiaLaboral(dt) > 0) arr.push(dt);
                        }
                        return arr;
                };

                const getDiasHabilesCiclo = (y, m) => {
                        const yNum = parseInt(y), mNum = parseInt(m);

                        // 1. Ciclo SIEMPRE inicia en el 5to día hábil del mes seleccionado
                        const habilesInicio = diasHabilesColombia(yNum, mNum);
                        const fechaInicioCiclo = habilesInicio[4] || habilesInicio[habilesInicio.length - 1];

                        // 2. Ciclo SIEMPRE termina en el 5to día hábil del mes siguiente
                        let nY = yNum, nM = mNum + 1;
                        if (nM > 12) { nM = 1; nY++; }
                        const habilesFin = diasHabilesColombia(nY, nM);
                        const fechaFinCiclo = habilesFin[4] || habilesFin[habilesFin.length - 1];

                        // 3. Obtener TODOS los días hábiles operativos del ciclo completo
                        const diasCiclo = [];

                        // Días desde el inicio del ciclo hasta fin de mes corriente
                        habilesInicio.forEach(d => {
                                if (d.getTime() >= fechaInicioCiclo.getTime()) diasCiclo.push(new Date(d));
                        });

                        // Días hábiles del mes siguiente hasta el cierre del ciclo
                        habilesFin.forEach(d => {
                                if (d.getTime() < fechaFinCiclo.getTime()) diasCiclo.push(new Date(d));
                        });

                        return diasCiclo;
                };




                // 🔥 HELPER PARA FECHA LOCAL (Evita el bug de las 7:00 PM y UTC)
                const getLocalYYYYMMDD = (dateVal) => {
                        if (!dateVal) return "";
                        const d = new Date(dateVal);
                        if (isNaN(d.getTime())) return "";
                        return d.getFullYear() + "-" +
                                String(d.getMonth() + 1).padStart(2, '0') + "-" +
                                String(d.getDate()).padStart(2, '0');
                };

                const hoyNatural = new Date();
                const hoySoloFecha = new Date(hoyNatural.getFullYear(), hoyNatural.getMonth(), hoyNatural.getDate());

                if (typeof window.bandejaActual === 'undefined' || !window.bandejaActual) window.bandejaActual = 'pendiente';

                // =========================================================
                // 📅 CONSTANTES DE TIEMPO (Declarar antes del onSnapshot para evitar ReferenceError)
                // =========================================================
                const ahora = new Date();
                const anoActual = ahora.getFullYear();
                const mesActual = ahora.getMonth() + 1;

                const mesesDiferencia = (anoActual * 12 + mesActual) - (parseInt(anio) * 12 + parseInt(mes));
                const esMesActivo = (mesesDiferencia <= 1);

                // 🚀 LÓGICA DE CICLO REACTIVO (N+1)
                // Los pacientes del mes N se trabajan en el ciclo operativo del mes N+1 (5 al 5)
                let anioTrabajo = parseInt(anio), mesTrabajo = parseInt(mes) + 1;
                if (mesTrabajo > 12) { mesTrabajo = 1; anioTrabajo++; }

                const habilesMesTrabajo = getDiasHabilesCiclo(anioTrabajo, mesTrabajo);
                const habilesMesDatos = habilesMesTrabajo; // Usamos el ciclo de trabajo como base para la data



                const totalHorasMes = habilesMesTrabajo.reduce((acc, dt) => acc + horasDiaLaboral(dt), 0);

                // hoyStr para comparaciones
                const hoyStr2 = ahora.getFullYear() + "-" +
                        String(ahora.getMonth() + 1).padStart(2, "0") + "-" +
                        String(ahora.getDate()).padStart(2, "0");



                window.__pacientesClasificados = [];
                window.__filtroTipo = 'todos';
                window.__textoBusqueda = '';

                window.buscarPaciente = function (texto) {
                        window.__textoBusqueda = String(texto || "").trim().toLowerCase();

                        // Mostrar/ocultar botón limpiar
                        const btnLimpiar = document.getElementById('btnLimpiarBusqueda');
                        if (btnLimpiar) btnLimpiar.style.display = texto.length > 0 ? 'block' : 'none';

                        renderizarTablaPacientes(window.__pacientesClasificados);
                };

                window.limpiarBuscador = function () {
                        const input = document.getElementById('buscadorPacientes');
                        if (input) input.value = '';
                        window.__textoBusqueda = '';
                        const btnLimpiar = document.getElementById('btnLimpiarBusqueda');
                        if (btnLimpiar) btnLimpiar.style.display = 'none';
                        renderizarTablaPacientes(window.__pacientesClasificados);
                };

                window.filtrarPorTipo = function (tipo) {
                        window.__filtroTipo = tipo;

                        ['filtroTodos', 'filtroIncidente', 'filtroPrevalente'].forEach(id => {
                                const btn = document.getElementById(id);
                                if (btn) {
                                        btn.style.background = 'white';
                                        btn.style.color = id === 'filtroTodos' ? '#6366f1' : id === 'filtroIncidente' ? '#15803d' : '#6d28d9';
                                }
                        });

                        const activo = document.getElementById(
                                tipo === 'todos' ? 'filtroTodos' :
                                        tipo === 'incidente' ? 'filtroIncidente' : 'filtroPrevalente'
                        );

                        if (activo) {
                                activo.style.background = tipo === 'todos' ? '#6366f1' :
                                        tipo === 'incidente' ? '#dcfce7' : '#ede9fe';
                                activo.style.color = tipo === 'todos' ? 'white' :
                                        tipo === 'incidente' ? '#15803d' : '#6d28d9';
                        }

                        renderizarTablaPacientes(window.__pacientesClasificados);
                };

                function renderizarTablaPacientes(pacientes) {
                        const tbody = document.getElementById("tablaPacientes");
                        if (!tbody) return;
                        tbody.innerHTML = "";

                        const pPeriodo = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const bandejaNorm = String(bandejaActual || window.bandejaActual || 'pendiente').toLowerCase();

                        let pacientesFiltrados = pacientes || [];

                        // 1. Filtro por tipo (incidente/prevalente)
                        if (window.__filtroTipo && window.__filtroTipo !== 'todos') {
                                pacientesFiltrados = pacientesFiltrados.filter(p => p.__tipo === window.__filtroTipo);
                        }

                        // 2. Filtro por búsqueda texto (Nombre o Cédula)
                        if (window.__textoBusqueda && window.__textoBusqueda.length > 0) {
                                const q = window.__textoBusqueda;
                                pacientesFiltrados = pacientesFiltrados.filter(p => {
                                        const nombre = [
                                                p?.datos_base?.VAR1_PrimerNombre,
                                                p?.datos_base?.VAR2_SegundoNombre,
                                                p?.datos_base?.VAR3_PrimerApellido,
                                                p?.datos_base?.VAR4_SegundoApellido,
                                                p?.nombreCompleto
                                        ].filter(v => v).join(" ").toLowerCase();

                                        const cedula = String(
                                                p?.datos_base?.VAR6_NumeroIdentificacionUsuario ||
                                                p?.datos_base?.VAR6_Identificacion ||
                                                p?.identificacion ||
                                                p?.id_doc ||
                                                p?.id ||
                                                ''
                                        ).toLowerCase();

                                        return nombre.includes(q) || cedula.includes(q);
                                });
                        }

                        // 3. Solo renderizar los que coincidan con la BANDEJA ACTUAL (Pendientes/Gestionados/Aprobados)
                        const pacientesBandeja = pacientesFiltrados.filter(p => {
                                const estado = String(p?.periodos?.[pPeriodo]?.estado || "pendiente").toLowerCase();
                                return estado === bandejaNorm;
                        });

                        if (pacientesBandeja.length === 0) {
                                const msg = window.__textoBusqueda
                                        ? `<tr><td colspan="6" style="text-align:center; padding:40px; color:#94a3b8;">
                                <div style="font-size:32px; margin-bottom:8px;">🔍</div>
                                <div style="font-size:14px; font-weight:600;">Sin resultados</div>
                                <div style="font-size:12px; margin-top:4px;">No se encontraron pacientes con "<strong>${window.__textoBusqueda}</strong>"</div>
                              </td></tr>`
                                        : `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #64748b;">No hay pacientes con el filtro seleccionado en la bandeja de <b>${bandejaNorm.toUpperCase()}</b>.</td></tr>`;

                                tbody.innerHTML = msg;
                                return;
                        }

                        pacientesBandeja.forEach(p => {
                                const idDoc = p.id_doc;
                                const estadoPaciente = String(p?.periodos?.[pPeriodo]?.estado || "").toLowerCase();

                                const tr = document.createElement("tr");
                                tr.style.cursor = "pointer";
                                tr.style.transition = "all 0.25s ease";

                                const idMostrar = p?.datos_base?.VAR6_NumeroIdentificacionUsuario || p?.datos_base?.VAR6_Identificacion || p?.identificacion || "---";
                                const secsPeriodo = Number(p?.periodos?.[pPeriodo]?.tiempo_segundos ?? 0) || 0;

                                const esNoCohorte = p?.periodos?.[pPeriodo]?.no_cohorte === true;
                                if (esNoCohorte) {
                                        tr.style.background = "linear-gradient(to right, #fff1f2, #ffffff)";
                                        tr.style.borderLeft = "5px solid #ef4444";
                                }

                                const vecesDevuelto = Number(p?.periodos?.[pPeriodo]?.veces_devuelto || 0);
                                let badgeCalor = "";
                                if (vecesDevuelto === 1) badgeCalor = `<span style="background:#fef08a; color:#854d0e; padding:2px 6px; border-radius:10px; font-size:10px; margin-left:5px; font-weight:bold;" title="Devuelto 1 vez">⚠️ x1</span>`;
                                else if (vecesDevuelto === 2) badgeCalor = `<span style="background:#fed7aa; color:#9a3412; padding:2px 6px; border-radius:10px; font-size:10px; margin-left:5px; font-weight:bold;" title="Devuelto 2 veces">🔥 x2</span>`;
                                else if (vecesDevuelto >= 3) badgeCalor = `<span style="background:#fecaca; color:#991b1b; padding:2px 6px; border-radius:10px; font-size:10px; margin-left:5px; font-weight:bold; border: 1px solid #ef4444;" title="¡CRÍTICO! Devuelto ${vecesDevuelto} veces">🚨 x${vecesDevuelto}</span>`;

                                const tipoPaciente = p.__tipo || (esPacienteIncidente(p) ? 'incidente' : 'prevalente');
                                const badgeTipo = tipoPaciente === 'incidente'
                                        ? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; border-radius: 999px; font-size: 10px; font-weight: 700; padding: 2px 8px; width: fit-content;">⭐ NUEVO</span>`
                                        : `<span style="background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; border-radius: 999px; font-size: 10px; font-weight: 700; padding: 2px 8px; width: fit-content;">↩ ANTIGUO</span>`;

                                let checkHtml = `<td style="width:40px;"></td>`;
                                if (estadoPaciente === "validado") {
                                        checkHtml = `<td style="text-align: center; width:40px;" onclick="event.stopPropagation()">
                                <input type="checkbox" class="chk-paciente" value="${idDoc}" onchange="window.verificarSeleccion()" style="cursor:pointer; transform:scale(1.3);" />
                             </td>`;
                                }

                                const nombrePaciente = p?.nombreCompleto ||
                                        [p?.datos_base?.VAR1_PrimerNombre, p?.datos_base?.VAR2_SegundoNombre, p?.datos_base?.VAR3_PrimerApellido, p?.datos_base?.VAR4_SegundoApellido].filter(v => v).join(" ").trim() ||
                                        "PACIENTE SIN NOMBRE";

                                const cohorteClass = String(p?.cohorte || "").toLowerCase().includes("hemo") ? "hemo" : "";
                                const estadoClass = estadoPaciente === "pendiente" ? "badge-pendiente" : estadoPaciente === "validado" ? "badge-validado" : "badge-aprobado";
                                const estadoIcon = estadoPaciente === "pendiente" ? "⏳" : estadoPaciente === "validado" ? "✅" : "🔒";
                                const tiempoClass = secsPeriodo > 0 ? "activo" : "";

                                const docsOcultos = p?.oculto_en_periodos || [];
                                const yaOculto = docsOcultos.includes(pPeriodo);

                                const rolRef = String(window.__userRol || '').toLowerCase().trim();
                                const isMaster = rolRef === 'master admin';
                                const isSuper = rolRef === 'super admin';
                                const canHide = isMaster || isSuper;
                                const esSoloLectura = rolRef === 'administrador';

                                // Señal de No Cohorte (Analista)
                                // La señal de No Cohorte ya fue calculada arriba para estilizar la fila
                                const signalNoCohorte = esNoCohorte ? `<span style="background:#fee2e2; color:#b91c1c; padding:2px 10px; border-radius:14px; font-size:10px; margin-left:8px; font-weight:900; border:2px solid #ef4444; box-shadow: 0 4px 6px -1px rgba(220, 38, 38, 0.15); display: inline-flex; align-items: center; gap: 4px;" title="Analista reporta: No pertenece a la cohorte">🚫 RECORTE: NO COHORTE</span>` : "";

                                let btnActionCell = "";
                                if (estadoPaciente === "pendiente") {
                                        // Pendientes: botón Validar + ocultar (si tiene permiso)
                                        btnActionCell = `<button class="btn-inst" style="padding:4px 10px; font-size:11px; background:#6366f1; color:white; border:none;" 
                                onclick="event.stopPropagation(); window.abrirFicha('${idDoc}', ${JSON.stringify(p).replace(/"/g, '&quot;')})">
                                Validar Ficha
                            </button>`;

                                        if (canHide) {
                                                const hideBtnStyle = esNoCohorte && !yaOculto
                                                        ? "background:#fee2e2; border:1px solid #f87171; border-radius:4px; opacity:1;"
                                                        : "background:none;border:none;opacity:0.5;";
                                                btnActionCell += `
                                <button onclick="event.stopPropagation(); window.${yaOculto ? 'restaurarPacientePeriodo' : 'ocultarPacientePeriodo'}('${idDoc}','${pPeriodo}', '${nombrePaciente.replace(/'/g, "\\'")}')"
                                    title="${yaOculto ? 'Restaurar' : (esNoCohorte ? 'Eliminar (recomendado por analista)' : 'Ocultar')}"
                                    style="cursor:pointer;font-size:16px;padding:2px 4px;${hideBtnStyle}"
                                    onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${esNoCohorte && !yaOculto ? '1' : '0.5'}'">
                                    ${yaOculto ? '👁️' : (esNoCohorte ? '🚫' : '🙈')}
                                </button>`;
                                        }

                                } else if (estadoPaciente === "validado") {
                                        // Gestionados: solo Ver Ficha (bloqueada, con opción de devolver dentro)
                                        // SIN botón ocultar
                                        btnActionCell = `<button class="btn-inst" style="padding:4px 10px; font-size:11px; background:#64748b; color:white; border:none;"
                                onclick="event.stopPropagation(); window.abrirFicha('${idDoc}', ${JSON.stringify(p).replace(/"/g, '&quot;')})">
                                Ver Ficha
                            </button>`;

                                } else if (estadoPaciente === "aprobado") {
                                        // Aprobados SISCAD: Ver Ficha + opción de devolver a validado
                                        btnActionCell = `<button class="btn-inst" style="padding:4px 10px; font-size:11px; background:#64748b; color:white; border:none; margin-right:4px;"
                                onclick="event.stopPropagation(); window.abrirFicha('${idDoc}', ${JSON.stringify(p).replace(/"/g, '&quot;')})">
                                Ver Ficha
                            </button>
                            <button class="btn-inst" style="padding:4px 10px; font-size:11px; background:#ef4444; color:white; border:none;"
                                onclick="event.stopPropagation(); window.devolverAValidado('${idDoc}')">
                                ↩ Reabrir
                            </button>`;
                                }

                                tr.innerHTML = `
                            ${checkHtml}
                            <td>
                                <div style="display:flex; flex-direction:column; gap:3px; line-height:1.3;">
                                    <span class="pac-nombre" style="font-weight:600;">${nombrePaciente} ${signalNoCohorte}</span>
                                    ${badgeTipo}
                                </div>
                            </td>
                            <td><span class="cohorte-pill ${cohorteClass}">${p?.cohorte || ""}</span></td>
                            <td>
                                <span class="badge-estado ${estadoClass}">${estadoIcon} ${estadoPaciente.toUpperCase()}</span>
                                ${badgeCalor}
                                ${signalNoCohorte}
                            </td>
                            <td><span class="tiempo-badge ${tiempoClass}">${typeof formatTime === 'function' ? formatTime(secsPeriodo) : '00:00'}</span></td>
                            <td style="white-space:nowrap;">
                                ${esSoloLectura ? '' : btnActionCell}
                            </td>
                        `;

                                // Solo Analistas, Master Admin y Super Admin pueden abrir la ficha e interactuar.
                                // El rol 'administrador' estándar es puramente de visualización de tabla.
                                if (!esSoloLectura) {
                                        tr.onclick = () => window.abrirFicha(idDoc, p);
                                        tr.style.cursor = "pointer";
                                } else {
                                        tr.style.cursor = "default";
                                }

                                tr.setAttribute('data-paciente-id', idDoc);
                                tbody.appendChild(tr);
                        });

                        // 🔒 Sincronizar bloqueos de forma no bloqueante
                        setTimeout(() => {
                                if (typeof pintarLocksEnTabla === 'function') pintarLocksEnTabla();
                        }, 100);
                }

                // =========================================================
                // 📈 VARIABLES DE PRODUCTIVIDAD (Hoisting para evitar scope errors)
                // =========================================================
                let metaHoyFinal = 0;
                let diasRestantes = 0;
                let porcentajeEjecucion = 0;
                let proyeccionAlRitmoActual = 0;
                let pacientesEsperadosHastaHoy = 0;
                let rezagoAcumulado = 0;
                let pendientesMes = 0;
                let ejecutadosHastaAyer = 0;
                let diasParaCalcular = 1;

                const collectionPath = "pacientes_cac";
                console.log("[DEBUG QUERY] Subscribing to:", collectionPath, " Filter:", pPeriodo);

                // 🛑 CANCELAR SUSCRIPCIÓN ANTERIOR (Si existe)
                if (window.__unsubPacientes) {
                        try { window.__unsubPacientes(); } catch (e) { }
                        window.__unsubPacientes = null;
                }

                window.__unsubPacientes = onSnapshot(query(collection(db, collectionPath), where("periodo_reporte", "==", pPeriodo)),
                        async (snap) => {
                                console.log("[SYNC] onSnapshot fired! Docs:", snap.size, "Periodo:", pPeriodo);
                                const tbody = document.getElementById("tablaPacientes");
                                if (!tbody) return;

                                const bandejaActual = window.bandejaActual || 'pendiente';
                                const cohorteActual = window.cohorteActual || 'todos';
                                const HOY_LOCAL = getLocalYYYYMMDD(new Date());

                                const pacientesTotalesMatch = [];
                                snap.forEach((d) => {
                                        const p = d.data();
                                        if (!p?.periodos || !p.periodos[pPeriodo]) return;

                                        const normCoh = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                                        if (cohorteActual !== 'todos' && normCoh(p?.cohorte) !== normCoh(cohorteActual)) return;

                                        pacientesTotalesMatch.push({ ...p, id_doc: d.id });
                                });

                                // MÉTRICAS ESPECÍFICAS (Búsqueda por Cohorte Normalizada)
                                let countIncidentes = 0;
                                let countPrevalentes = 0;
                                let totalCancer = 0;
                                let ocultosCancer = 0;
                                let totalHemo = 0;
                                let ocultosHemo = 0;

                                const normCoh = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                                pacientesTotalesMatch.forEach(p => {
                                        const coh = normCoh(p?.cohorte);
                                        const isHemo = coh.includes("hemo");
                                        const isCancer = coh.includes("cancer");
                                        const isHidden = (p.oculto_en_periodos || []).includes(pPeriodo);

                                        if (isCancer) {
                                                totalCancer++;
                                                if (isHidden) ocultosCancer++;
                                        }
                                        if (isHemo) {
                                                totalHemo++;
                                                if (isHidden) ocultosHemo++;
                                        }

                                        if (!isHidden) {
                                                if (esPacienteIncidente(p)) countIncidentes++;
                                                else countPrevalentes++;
                                        }
                                });

                                // PACIENTES ACTIVOS (No ocultos en este periodo)
                                const pacientesActivos = pacientesTotalesMatch.filter(p =>
                                        !(p.oculto_en_periodos || []).includes(pPeriodo)
                                );

                                // MÉTRICAS SOBRE PACIENTES ACTIVOS
                                let totalPeriodo = pacientesActivos.length;
                                let validadosPeriodo = 0; // Se redefine como 'aprobado' únicamente (Caja Fuerte)
                                let validadosHoy = 0;     // Esfuerzo hoy (validado + aprobado)
                                let gestadosPeriodo = 0;  // Suma total (validado + aprobado) para cálculos de rezago

                                // 🔥 NUEVAS MÉTRICAS DE CALIDAD (TASK turn 272/351)
                                let totalGestionesHoy = 0;
                                let totalAprobadosHoy = 0;
                                let totalDevolucionesHoy = 0;
                                let totalDevolucionesPeriodo = 0;
                                let statsCalidad = {
                                        autoCorregidos: 0,
                                        bloqueosManuales: 0,
                                        historiasLimpias: 0,
                                        correccionesHumanas: 0
                                };
                                let errorCounts = {};

                                let sumSecsMes = 0;
                                let nMes = 0;
                                let sumSecsHoy = 0;
                                let nHoy = 0;

                                // Task 2: Lógica de Conteo (ROI y Calidad)
                                window.__totalSaneados = 0;
                                window.__totalErroresHumanos = 0;
                                window.__totalDevoluciones = 0;

                                let oldestPendingDate = null;
                                let oldestPendingName = "";
                                let totalPendientes = 0;

                                pacientesActivos.forEach(p => {
                                        const per = p?.periodos?.[pPeriodo];
                                        const estado = String(per?.estado || "").toLowerCase();
                                        const fechaValidacionStr = per?.validado_el || p?.ultima_validacion || p?.ultima_actualizacion;
                                        const hov_val = (getLocalYYYYMMDD(fechaValidacionStr) === HOY_LOCAL);

                                        // 🕵️ LÓGICA DE LATENCIA: Buscar el más antiguo de los PENDIENTES
                                        if (estado === "pendiente" || estado === "") {
                                            totalPendientes++;
                                            const nombre = p.datos_base?.VAR10_NombrePaciente || p.nombre || "";
                                            const iden = p.identificacion || p.id || "";
                                            
                                            if (nombre || iden) {
                                                // Prioridad Absoluta: cargado_el del periodo actual (Task import: lines 6796/6840)
                                                const fCargaRaw = per?.cargado_el || p.fecha_carga || p.ultima_actualizacion;
                                                if (fCargaRaw) {
                                                    const dCarga = new Date(fCargaRaw);
                                                    if (!isNaN(dCarga.getTime())) {
                                                        if (!oldestPendingDate || dCarga < oldestPendingDate) {
                                                            oldestPendingDate = dCarga;
                                                            oldestPendingName = nombre || `ID: ${iden}`;
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        // Eficiencia Real: Solo Aprobados (Caja Fuerte)
                                        if (estado === "aprobado") {
                                                validadosPeriodo++;
                                                if (hov_val) totalAprobadosHoy++;
                                        }

                                        // ... esfuerzo bruto, impacto y errores se mantienen igual ...
                                        if (estado === "validado" || estado === "aprobado") {
                                                gestadosPeriodo++;
                                                if (hov_val) { validadosHoy++; totalGestionesHoy++; }
                                                const secs = Number(per?.tiempo_segundos ?? 0) || 0;
                                                if (secs > 0) {
                                                        sumSecsMes += secs; nMes++;
                                                        if (hov_val) { sumSecsHoy += secs; nHoy++; }
                                                }
                                        }
                                        const mCorregidos = Number(per?.auditoria_errores_corregidos || 0);
                                        window.__totalSaneados += mCorregidos;
                                        window.__totalDevoluciones += Number(per?.veces_devuelto || 0);
                                        if (estado === "aprobado") window.__totalErroresHumanos += Number(per?.auditoria_correcciones_humanas || 0);
                                        const hDev = per?.historial_devoluciones || [];
                                        hDev.forEach(d => { if (getLocalYYYYMMDD(d.fecha) === HOY_LOCAL) totalDevolucionesHoy++; });
                                        const alertas = per?.auditoria_detalle_alertas || [];
                                        alertas.forEach(err => { errorCounts[err] = (errorCounts[err] || 0) + 1; });
                                });

                                // 📊 CÁLCULO DE META ACELERADA (VELOCIDAD DE RECUPERACIÓN)
                                const yF = document.getElementById("filtroAnio").value;
                                const mF = document.getElementById("filtroMes").value;
                                const diasCiclo = typeof getDiasHabilesCiclo === 'function' ? getDiasHabilesCiclo(yF, mF) : [];
                                const ahoraLat = new Date();
                                let diasRestantesLatencia = diasCiclo.filter(d => d.getTime() > ahoraLat.getTime()).length || 1;
                                const metaRecomendada = Math.ceil(totalPendientes / diasRestantesLatencia);

                                // 📊 ACTUALIZAR TERMÓMETRO DE OPORTUNIDAD (LATENCIA)
                                const latenciaDiv = document.getElementById("latenciaTermometro");
                                const latenciaTexto = document.getElementById("latenciaTexto");
                                if (latenciaDiv && latenciaTexto) {
                                    if (oldestPendingDate) {
                                        const diffDias = Math.floor((ahoraLat - oldestPendingDate) / (1000 * 60 * 60 * 24));
                                        latenciaDiv.style.display = "inline-flex";
                                        latenciaDiv.style.removeProperty("display");
                                        
                                        let statusColor = "#10b981"; 
                                        let bgOpacity = "rgba(16, 185, 129, 0.2)";
                                        let icon = "🌟";
                                        let prefijo = "LATENCIA IDEAL";

                                        if (diffDias > 15) {
                                            statusColor = "#ef4444"; 
                                            bgOpacity = "rgba(239, 68, 68, 0.2)";
                                            icon = "🚨";
                                            prefijo = "RETRASO CRÍTICO";
                                        } else if (diffDias > 7) {
                                            statusColor = "#f59e0b"; 
                                            bgOpacity = "rgba(245, 158, 11, 0.2)";
                                            icon = "⚠️";
                                            prefijo = "LATENCIA OPERATIVA";
                                        }

                                        latenciaDiv.style.background = bgOpacity;
                                        latenciaDiv.style.border = `1px solid ${statusColor}`;
                                        
                                        let mensajeFinal = `${icon} <b>${prefijo}: ${diffDias} DÍAS</b>. `;
                                        if (diffDias > 7) {
                                            const faltanParaMision = Math.max(metaRecomendada - validadosHoy, 0);
                                            mensajeFinal += `Meta diaria de nivelación: <b>${metaRecomendada}</b> pacientes <b>DIARIOS</b> (Hoy llevas <b>${validadosHoy}</b>). `;
                                            if (faltanParaMision > 0) {
                                                mensajeFinal += `<span style="opacity:0.9; font-size:0.8rem; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 12px; margin-left: 5px; border: 1px solid rgba(255,255,255,0.2);">🔴 Faltan <b>${faltanParaMision}</b> para el objetivo de <b>HOY</b></span>`;
                                            } else {
                                                mensajeFinal += `<span style="opacity:0.9; font-size:0.8rem; background: rgba(16,185,129,0.3); padding: 4px 10px; border-radius: 12px; margin-left: 5px;">✅ Objetivo de hoy cumplido</span>`;
                                            }
                                        } else {
                                            mensajeFinal += `¡Meta cumplida! Sigue así para mantener la oportunidad.`;
                                        }

                                        latenciaTexto.innerHTML = mensajeFinal;
                                        latenciaDiv.title = `Para reducir la latencia a 7 días, es necesario gestionar al menos ${metaRecomendada} pacientes CADA DÍA.`;
                                    } else {
                                        latenciaDiv.style.display = "none";
                                    }
                                }

                                // PACIENTES A RENDERIZAR (aplicar filtro de "Ver Ocultos" si aplica)
                                const pacientesAmostrar = pacientesTotalesMatch.filter(p => {
                                        const estadoPaciente = String(p?.periodos?.[pPeriodo]?.estado || "pendiente").toLowerCase();
                                        const bandejaActualNorm = String(bandejaActual || window.bandejaActual || 'pendiente').toLowerCase();
                                        const coincideBandeja = (estadoPaciente === bandejaActualNorm);
                                        if (!coincideBandeja) return false;

                                        const ocultosEnPeriodos = p?.oculto_en_periodos || [];
                                        const estaOculto = ocultosEnPeriodos.includes(pPeriodo);
                                        if (estaOculto && !window.__mostrarOcultos) return false;
                                        if (!estaOculto && window.__mostrarOcultos) return false;
                                        return true;
                                });

                                // Clasificar y renderizar (Regla Clínica VAR17+)
                                const pacientesClasificados = pacientesAmostrar.map(p => ({
                                        ...p,
                                        __tipo: esPacienteIncidente(p) ? 'incidente' : 'prevalente'
                                }));
                                window.__pacientesClasificados = pacientesClasificados;
                                renderizarTablaPacientes(window.__pacientesClasificados);

                                if (tbody.innerHTML === "") {
                                        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #64748b;">No hay pacientes en la bandeja de <b>${String(bandejaActual).toUpperCase()}</b>.</td></tr>`;
                                }

                                const panelMasivo = document.getElementById("panelMasivo");
                                const chkMaster = document.getElementById("chkMaster");
                                if (panelMasivo) panelMasivo.style.display = (bandejaActual === "validado") ? "flex" : "none";
                                if (chkMaster) {
                                        chkMaster.checked = false;
                                        chkMaster.style.display = (window.bandejaActual === "validado") ? "inline-block" : "none";
                                }

                                // habiles del MES DEL FILTRO → para calcular totalHorasMes y ritmo ideal
                                // (Ya declarados arriba para evitar error de inicialización)

                                const totalPacientesMes = totalPeriodo; // se calcula más abajo en el snap

                                // ─── CÁLCULO DE META AJUSTADA EN TIEMPO REAL ───────────────────────────
                                // Lógica: distribuir los pacientes restantes entre las horas laborales restantes del mes.
                                // Si estamos en el mes activo → meta dinámica ajustada al día actual.
                                // Si estamos en un mes pasado → meta promedio fija.

                                // Fecha de referencia para cálculos: si el mes ya cerró, usar su último día hábil
                                const fechaReferencia = (() => {
                                        if (parseInt(anio) === parseInt(anoActual) && parseInt(mes) === parseInt(mesActual)) {
                                                return ahora; // mes actual: usar ahora mismo
                                        }
                                        // Mes anterior: usar el último día hábil del mes seleccionado
                                        const ultimoDia = new Date(parseInt(anio), parseInt(mes), 0); // último día del mes
                                        // Retroceder hasta encontrar un día hábil
                                        while (horasDiaLaboral(ultimoDia) === 0) {
                                                ultimoDia.setDate(ultimoDia.getDate() - 1);
                                        }
                                        ultimoDia.setHours(17, 0, 0, 0); // fin de jornada
                                        return ultimoDia;
                                })();

                                // (Ya declaradas arriba para evitar error de inicialización)
                                let horasRestantesMes = 0;

                                // ─── META DINÁMICA RECALCULADA POR REZAGO ─────────────────────────────
                                // Días hábiles restantes = desde HOY hasta fin del mes ACTUAL de trabajo

                                // Determinamos si el ciclo ya debe considerarse iniciado precozmente
                                const inicioOficial = habilesMesTrabajo[0];
                                const cicloIniciadoPrecoz = ahora < inicioOficial && totalPeriodo > 0;

                                const hoyTime = hoySoloFecha.getTime();

                                let diasHabilesTranscurridosTrabajo = habilesMesTrabajo.filter(dt => {
                                        return dt.getTime() < hoyTime;
                                }).length;

                                // ✨ AJUSTE REACTIVO: Si estamos antes del día 5 pero ya hay datos, 
                                // forzamos a que sea el Día 1 para que la meta sea visible y no haya rezago infinito.
                                if (diasHabilesTranscurridosTrabajo === 0 && totalPeriodo > 0) {
                                        diasHabilesTranscurridosTrabajo = 1;
                                }

                                // Días restantes del ciclo
                                diasRestantes = habilesMesTrabajo.filter(dt => {
                                        return dt.getTime() >= hoyTime;
                                }).length;
                                if (cicloIniciadoPrecoz) diasRestantes = habilesMesTrabajo.length;

                                // Pacientes ejecutados hasta AYER
                                ejecutadosHastaAyer = gestadosPeriodo - validadosHoy;

                                // Pendientes = total del periodo - lo ya ejecutado hasta ayer
                                pendientesMes = Math.max(totalPeriodo - ejecutadosHastaAyer, 0);

                                // Meta diaria recalculada con rezago real
                                diasParaCalcular = Math.max(diasRestantes, 1);
                                metaHoyFinal = Math.ceil(pendientesMes / diasParaCalcular);

                                // % cumplimiento hoy
                                porcentajeEjecucion = metaHoyFinal > 0
                                        ? Math.round((validadosHoy / metaHoyFinal) * 100)
                                        : 100;

                                // Rezago vs ritmo ideal del mes de datos
                                const ritmoIdealDiario = habilesMesDatos.length > 0
                                        ? totalPeriodo / habilesMesDatos.length
                                        : 0;

                                // Esperado = lo que debió gestionar en los días de trabajo ya transcurridos
                                pacientesEsperadosHastaHoy = Math.floor(ritmoIdealDiario * diasHabilesTranscurridosTrabajo);
                                rezagoAcumulado = Math.max(pacientesEsperadosHastaHoy - gestadosPeriodo, 0);

                                // Proyección al ritmo actual
                                proyeccionAlRitmoActual = ejecutadosHastaAyer + validadosHoy +
                                        (validadosHoy * Math.max(diasRestantes - 1, 0));

                                const pctGlobal = totalPeriodo > 0 ? Math.round((validadosPeriodo / totalPeriodo) * 100) : 0;
                                $setText("globalPctCard", pctGlobal + "%");
                                $setText("globalNumCircle", `${validadosPeriodo}/${totalPeriodo}`);
                                $setText("countHoyCircle", validadosHoy);

                                // ─── INDICADOR DE VENTANA DE CARGA (SEMÁFORO) ───────────────
                                const actualizarBadgeCarga = () => {
                                        let badgeCarga = document.getElementById("badgeCargaStatus");
                                        if (!badgeCarga) return;

                                        // Ajustar estilos base (por si el HTML no los tiene)
                                        badgeCarga.style.display = "inline-flex";
                                        badgeCarga.style.alignItems = "center";
                                        badgeCarga.style.padding = "6px 14px";
                                        badgeCarga.style.borderRadius = "20px";
                                        badgeCarga.style.fontSize = "0.75rem";
                                        badgeCarga.style.fontWeight = "800";
                                        badgeCarga.style.marginLeft = "15px";
                                        badgeCarga.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
                                        badgeCarga.style.textTransform = "uppercase";

                                        // 1. Calcular en qué día hábil del mes calendario estamos hoy
                                        const h = new Date();
                                        const primerDiaMes = new Date(h.getFullYear(), h.getMonth(), 1);
                                        const ultimoDiaMes = new Date(h.getFullYear(), h.getMonth() + 1, 0);
                                        const habilesDelMesCalendario = [];
                                        for (let d = 1; d <= ultimoDiaMes.getDate(); d++) {
                                                const dt = new Date(h.getFullYear(), h.getMonth(), d);
                                                if (dt.getDay() !== 0 && dt.getDay() !== 6 && !esFestivo(dt)) {
                                                        habilesDelMesCalendario.push(dt);
                                                }
                                        }

                                        const hoyLocalStr = getLocalYYYYMMDD(h);
                                        const indexHoy = habilesDelMesCalendario.findIndex(dt => getLocalYYYYMMDD(dt) === hoyLocalStr);
                                        const diaHabilActual = indexHoy !== -1 ? indexHoy + 1 : 0;

                                        // 2. Determinar estado e inyectar
                                        if (totalPeriodo > 0) {
                                                badgeCarga.innerHTML = `<span style="margin-right:5px;">✅</span> COHORTE CARGADA OK`;
                                                badgeCarga.style.background = "#dcfce7";
                                                badgeCarga.style.color = "#15803d";
                                                badgeCarga.style.border = "1px solid #bbf7d0";
                                        } else {
                                                if (diaHabilActual > 0 && diaHabilActual <= 5) {
                                                        badgeCarga.innerHTML = `<span style="margin-right:5px;">⏳</span> PENDIENTE CARGA (Día ${diaHabilActual}/5)`;
                                                        badgeCarga.style.background = "#ffedd5";
                                                        badgeCarga.style.color = "#9a3412";
                                                        badgeCarga.style.border = "1px solid #fed7aa";
                                                } else {
                                                        badgeCarga.innerHTML = `<span style="margin-right:5px;">🚨</span> MORA EN CARGA (Límite vencido)`;
                                                        badgeCarga.style.background = "#fee2e2";
                                                        badgeCarga.style.color = "#b91c1c";
                                                        badgeCarga.style.border = "1px solid #fecaca";
                                                }
                                        }
                                };
                                actualizarBadgeCarga();

                                // Actualizar nuevos counters
                                $setText("countIncidentes", countIncidentes);
                                $setText("countPrevalentes", countPrevalentes);
                                $setText("pctOcultosCancer", (totalCancer > 0 ? Math.round((ocultosCancer / totalCancer) * 100) : 0) + "%");
                                $setText("pctOcultosHemofilia", (totalHemo > 0 ? Math.round((ocultosHemo / totalHemo) * 100) : 0) + "%");

                                // --- ACTUALIZACIÓN DE NUEVOS INDICADORES REALES ---
                                let totalInactividadSegundos = 0;
                                pacientesActivos.forEach(pa => {
                                        totalInactividadSegundos += Number(pa.periodos?.[pPeriodo]?.inactividad_segundos || 0);
                                });

                                const inactividadMinHoy = Math.round((totalInactividadSegundos / 60) * 10) / 10;
                                const inactividadPctHoy = sumSecsMes > 0
                                        ? Math.round((totalInactividadSegundos / (sumSecsMes + totalInactividadSegundos)) * 100)
                                        : 0;

                                $setText("hoySubtitulo", `Inactividad: ${inactividadMinHoy} min · ${inactividadPctHoy}%`);

                                const precisionGlobal = (validadosPeriodo + totalDevolucionesPeriodo) > 0
                                        ? Math.round((validadosPeriodo / (validadosPeriodo + totalDevolucionesPeriodo)) * 100)
                                        : 100;
                                $setText("validadosSubtitulo", `Precisión: ${precisionGlobal}%`);

                                const calidadReal = (validadosPeriodo + window.__totalDevoluciones) > 0
                                        ? Math.round((validadosPeriodo / (validadosPeriodo + window.__totalDevoluciones)) * 100)
                                        : 100;

                                $setText("calidadPctCircle", calidadReal + "%");
                                $setText("calidadSubtitulo", `Saneamiento: ${window.__totalSaneados}`);

                                const cardAudit = document.getElementById("card-auditoria");
                                if (cardAudit) {
                                        cardAudit.classList.remove('card-alarm', 'card-warning', 'card-ok');
                                        if (calidadReal > 85) cardAudit.classList.add('card-ok');
                                        else if (calidadReal >= 70) cardAudit.classList.add('card-warning');
                                        else cardAudit.classList.add('card-alarm');

                                        cardAudit.onclick = () => window.abrirModalCalidad();
                                }

                                // Top Errores
                                let topErrorKey = "N/A";
                                if (Object.keys(errorCounts).length > 0) {
                                        topErrorKey = Object.keys(errorCounts).reduce((a, b) => errorCounts[a] > errorCounts[b] ? a : b);
                                }
                                $setText("rezagoSubtitulo", topErrorKey !== "N/A" ? `⚠️ Error frecuente: ${topErrorKey}` : "");

                                // ─── CÁLCULOS DE META Y PROYECCIÓN (RESTAURADOS TOTALMENTE) ───
                                const metaBaseDiaria = 5; // Tu meta base de siempre
                                const porcentajeBarraMeta = Math.round((validadosHoy / metaBaseDiaria) * 100);

                                // 1. Título Principal (Hoy: 6 / 5 pacientes) - Debe coincidir con la barra
                                $setText("metaText", `Hoy: ${validadosHoy} / ${metaBaseDiaria} pacientes`);
                                
                                // 2. Porcentaje de la BARRA (El 120% carajooo)
                                $setText("globalPctHero", porcentajeBarraMeta + "%");
                                $setWidth("globalBar", Math.min(porcentajeBarraMeta, 100));

                                // 3. Subtítulo (Tu formato exacto)
                                const faltanParaCerrar = Math.max(totalPeriodo - validadosPeriodo, 0);
                                $setText("prodStateText", `Va exactamente al ritmo ideal. Meta diaria: ${metaBaseDiaria}. Proyección cierre: ${proyeccionAlRitmoActual}/${totalPeriodo}. Faltan ${faltanParaCerrar} para cerrar el mes.`);

                                // ─── APLICAR ALARMAS VISUALES A LOS CARDS ─────────────────────
                                const aplicarAlarmaCard = (cardId, estado, badgeTexto) => {
                                        const card = document.getElementById(cardId);
                                        if (!card) return;

                                        card.classList.remove('card-alarm', 'card-warning', 'card-ok');
                                        // Remover badges anteriores dentro del card
                                        card.querySelectorAll('.alarm-badge-inner').forEach(b => b.remove());
                                        // Remover badges anteriores del body (limpieza versión vieja)
                                        document.querySelectorAll(`[data-badge-for="${cardId}"]`).forEach(b => b.remove());

                                        if (!badgeTexto) return;

                                        card.classList.add(
                                                estado === 'alarm' ? 'card-alarm' :
                                                        estado === 'warning' ? 'card-warning' : 'card-ok'
                                        );

                                        // Forzar overflow visible en el card Y en sus padres inmediatos
                                        card.style.overflow = 'visible';
                                        if (card.parentElement) card.parentElement.style.overflow = 'visible';

                                        // Badge dentro del card con posición absoluta
                                        const badge = document.createElement('div');
                                        badge.className = 'alarm-badge-inner';
                                        badge.setAttribute('data-badge-for', cardId);

                                        const icono = estado === 'alarm' ? '🚨' : estado === 'warning' ? '⚠️' : '✅';
                                        badge.textContent = icono + ' ' + badgeTexto;

                                        badge.style.cssText = `
                            position: absolute;
                            top: -18px;
                            left: 50%;
                            transform: translateX(-50%);
                            z-index: 999;
                            padding: 5px 14px;
                            border-radius: 999px;
                            font-size: 11px;
                            font-weight: 900;
                            white-space: nowrap;
                            pointer-events: none;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
                            ${estado === 'alarm'
                                                        ? 'background:#dc2626; color:white; animation: badgeShake 1.8s ease-in-out infinite;'
                                                        : estado === 'warning'
                                                                ? 'background:#f59e0b; color:white; animation: badgeBounce 2s ease-in-out infinite;'
                                                                : 'background:#16a34a; color:white;'
                                                }
                        `;

                                        // El card debe ser position:relative para que el absolute funcione
                                        card.style.position = 'relative';
                                        card.appendChild(badge);
                                };

                                // Estado de productividad con semáforo preciso
                                let estadoProd, colorProd, textoDetalle;

                                const porcentajeAvanceEsperado = habilesMesDatos.length > 0
                                        ? Math.round((diasHabilesTranscurridosTrabajo / habilesMesDatos.length) * 100)
                                        : 0;

                                if (totalPeriodo === 0) {
                                        estadoProd = "SIN DATOS";
                                        colorProd = "#94a3b8";
                                        textoDetalle = "No hay pacientes cargados en el periodo.";

                                } else if (!esMesActivo) {
                                        // Mes cerrado
                                        estadoProd = pctGlobal >= 100 ? "✅ COMPLETADO" : "📋 CERRADO";
                                        colorProd = pctGlobal >= 100 ? "#22c55e" : "#64748b";
                                        textoDetalle = `Mes cerrado. Se gestionaron ${validadosPeriodo} de ${totalPeriodo} pacientes (${pctGlobal}%).`;

                                } else if (rezagoAcumulado <= 0) {
                                        // Va adelantada o al día
                                        estadoProd = "✅ AL DÍA";
                                        colorProd = "#22c55e";
                                        const adelanto = Math.abs(rezagoAcumulado);
                                        textoDetalle = `Va ${adelanto > 0 ? adelanto + " pacientes adelantada" : "exactamente al ritmo ideal"}. Meta diaria: ${metaHoyFinal}. Proyección cierre: ${proyeccionAlRitmoActual}/${totalPeriodo}.`;

                                } else if (rezagoAcumulado <= Math.ceil(totalPeriodo * 0.05)) {
                                        // Rezago menor al 5% — en riesgo leve
                                        estadoProd = "⚠️ LEVE RETRASO";
                                        colorProd = "#f59e0b";
                                        textoDetalle = `Lleva ${gestadosPeriodo} pac. pero debería llevar ${pacientesEsperadosHastaHoy} a esta altura del mes (${porcentajeAvanceEsperado}% del tiempo transcurrido). Rezago: ${rezagoAcumulado} pacientes. Meta hoy: ${metaHoyFinal}. Faltan ${diasRestantes} días hábiles para cerrar.`;

                                } else if (rezagoAcumulado <= Math.ceil(totalPeriodo * 0.15)) {
                                        // Rezago entre 5% y 15% — retraso significativo
                                        estadoProd = "🔴 RETRASO SIGNIFICATIVO";
                                        colorProd = "#ef4444";
                                        const necesitaPorDia = diasRestantes > 0
                                                ? Math.ceil((totalPeriodo - validadosPeriodo) / diasRestantes)
                                                : totalPeriodo - validadosPeriodo;
                                        textoDetalle = `⚠️ Rezago acumulado de ${rezagoAcumulado} pacientes. Lleva ${gestadosPeriodo}/${pacientesEsperadosHastaHoy} esperados (${porcentajeAvanceEsperado}% del mes). Necesita ${necesitaPorDia} pac/día en los ${diasRestantes} días hábiles restantes para cerrar el mes.`;

                                } else {
                                        // Rezago mayor al 15% — crítico
                                        estadoProd = "🚨 GESTIÓN CRÍTICA";
                                        colorProd = "#dc2626";
                                        const necesitaPorDia = diasRestantes > 0
                                                ? Math.ceil((totalPeriodo - validadosPeriodo) / diasRestantes)
                                                : totalPeriodo - validadosPeriodo;
                                        const imposible = necesitaPorDia > (metaHoyFinal * 2.5);
                                        textoDetalle = `🚨 Rezago crítico: ${rezagoAcumulado} pacientes atrasados. Lleva ${gestadosPeriodo} de ${pacientesEsperadosHastaHoy} esperados. ${imposible ? `⛔ Al ritmo actual es matemáticamente imposible cerrar el mes.` : `Necesita gestionar ${necesitaPorDia} pacientes diarios en los últimos ${diasRestantes} días hábiles para lograr la meta.`}`;
                                }

                                // Calcular días de rezago real
                                // Días hábiles que han pasado desde el inicio del mes de trabajo
                                // en los que se debió gestionar pero el % completado está por debajo
                                const diasDeRezago = (() => {
                                        if (totalPeriodo === 0) return 0;

                                        // Ritmo ideal: cuántos pacientes por día hábil según mes de datos
                                        const metaIdealDiaria = habilesMesDatos.length > 0
                                                ? totalPeriodo / habilesMesDatos.length
                                                : 0;

                                        // Cuántos días equivale el rezago acumulado vs ritmo ideal
                                        return metaIdealDiaria > 0
                                                ? Math.round(rezagoAcumulado / metaIdealDiaria)
                                                : 0;
                                })();

                                // Actualizar el indicador
                                const prodEl = document.getElementById("prodStateCircle");
                                const rezagoSubEl = document.getElementById("rezagoSubtitulo");
                                const cardRezago = document.getElementById("card-rezago");

                                if (prodEl) {
                                        if (diasDeRezago <= 0) {
                                                prodEl.textContent = "Al día";
                                                prodEl.style.fontSize = "1.4rem";
                                                prodEl.style.color = "#16a34a";
                                                if (rezagoSubEl) rezagoSubEl.textContent = "✓ Sin atraso";
                                                if (cardRezago) {
                                                        cardRezago.classList.remove('card-alarm', 'card-warning');
                                                        cardRezago.classList.add('card-ok');
                                                }
                                        } else if (diasDeRezago <= 2) {
                                                prodEl.textContent = `+${diasDeRezago}d`;
                                                prodEl.style.color = "#f59e0b";
                                                prodEl.style.fontSize = "2rem";
                                                if (rezagoSubEl) rezagoSubEl.textContent = `≈ ${Math.round(rezagoAcumulado)} pac. sin gestionar`;
                                                aplicarAlarmaCard('card-rezago', 'warning', `${diasDeRezago} día${diasDeRezago > 1 ? 's' : ''} atrás`);
                                        } else {
                                                prodEl.textContent = `+${diasDeRezago}d`;
                                                prodEl.style.color = "#dc2626";
                                                prodEl.style.fontSize = "2rem";
                                                if (rezagoSubEl) rezagoSubEl.textContent = `≈ ${Math.round(rezagoAcumulado)} pac. sin gestionar`;
                                                aplicarAlarmaCard('card-rezago', 'alarm', `${diasDeRezago} días de atraso`);
                                        }
                                }

                                $setText("prodStateText", textoDetalle);

                                const subtituloEl = document.getElementById("prodStateText");
                                if (subtituloEl) subtituloEl.textContent = textoDetalle;

                                // Tiempos promedio
                                const avgSecsMes = nMes > 0 ? Math.round(sumSecsMes / nMes) : 0;
                                const avgSecsHoy = nHoy > 0 ? Math.round(sumSecsHoy / nHoy) : 0;

                                const fmtSafe = (s) => {
                                        const sec = Number(s) || 0;
                                        return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
                                };
                                $setText("avgTimeMonthCircle", fmtSafe(avgSecsMes));
                                $setText("avgTimeDayCircle", fmtSafe(avgSecsHoy));



                                // Aplicar a cada card según el estado calculado
                                if (totalPeriodo > 0) {
                                        // Card: Avance Global — basado en rezago acumulado, no solo % global
                                        if (esMesActivo && totalPeriodo > 0) {
                                                if (rezagoAcumulado > totalPeriodo * 0.15)
                                                        aplicarAlarmaCard('card-avance', 'alarm', '🚨 Gestión Crítica');
                                                else if (rezagoAcumulado > totalPeriodo * 0.05)
                                                        aplicarAlarmaCard('card-avance', 'alarm', '🔴 Retraso Real');
                                                else if (rezagoAcumulado > 0)
                                                        aplicarAlarmaCard('card-avance', 'warning', '⚠ Leve Retraso');
                                                else
                                                        aplicarAlarmaCard('card-avance', 'ok', '✓ Al Día');
                                        }

                                        // Card: Gestión de Hoy
                                        if (porcentajeEjecucion < 60) aplicarAlarmaCard('card-hoy', 'alarm', '🔴 Gestión Deficiente');
                                        else if (porcentajeEjecucion < 90) aplicarAlarmaCard('card-hoy', 'warning', '⚠ Revisar Ritmo');
                                        else aplicarAlarmaCard('card-hoy', 'ok', '✓ Cumpliendo');

                                        // Card: Tiempo promedio hoy (si es muy lento vs mes)
                                        if (avgSecsHoy > 0 && avgSecsMes > 0) {
                                                if (avgSecsHoy > avgSecsMes * 1.3) aplicarAlarmaCard('card-tiempo-hoy', 'alarm', '🔴 Ritmo Lento');
                                                else if (avgSecsHoy > avgSecsMes * 1.1) aplicarAlarmaCard('card-tiempo-hoy', 'warning', 'Más Lento');
                                                else aplicarAlarmaCard('card-tiempo-hoy', 'ok', '✓ Buen Ritmo');
                                        }
                                }
                        }, (err) => {
                                console.error("Firestore error:", err);
                                $setText("metaText", "Error de Firebase: " + err.message);
                        });
                if (window.__altoCostoLocks) {
                        window.__altoCostoLocks.refrescarLocksVisuales().catch(() => { });
                }
        }
        window.cargarPacientes = cargarPacientes;

        // =========================================================
        // 🔄 FUNCIÓN PARA DEVOLVER A PENDIENTES (CON AUDITORÍA)
        // =========================================================
        window.devolverAPendientes = async () => {
                if (!currentPacienteId) return;
                if (!confirm("⚠️ ¿Desea devolver este paciente a PENDIENTES? Esta acción quedará registrada en el mapa de calor de auditoría.")) return;

                try {
                        const periodoActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const docRef = doc(db, "pacientes_cac", currentPacienteId);

                        // 1. Leer cuántas veces se ha devuelto antes
                        const docSnap = await getDoc(docRef);
                        const dataActual = docSnap.exists() ? docSnap.data() : {};
                        const devolucionesPrevias = dataActual.periodos?.[periodoActual]?.veces_devuelto || 0;
                        const historialPrevio = dataActual.periodos?.[periodoActual]?.historial_devoluciones || [];

                        // 2. Crear el nuevo registro de quién lo devuelve
                        const nuevaDevolucion = {
                                fecha: new Date().toISOString(),
                                usuario: auth.currentUser ? auth.currentUser.email : "desconocido"
                        };

                        // 3. Actualizar Firebase — Conservar tiempo acumulado y registrar sesión
                        const tiempoSesionActual = window.startTime
                                ? Math.max(0, Math.floor((Date.now() - window.startTime) / 1000))
                                : 0;
                        const tiempoAcumuladoAntes = dataActual?.periodos?.[periodoActual]?.tiempo_segundos || 0;
                        const inactividadAcumuladaAntes = dataActual?.periodos?.[periodoActual]?.inactividad_segundos || 0;

                        const tiempoNuevoTotal = tiempoAcumuladoAntes + tiempoSesionActual;
                        const inactividadNuevaTotal = inactividadAcumuladaAntes + window.__idleSeconds;

                        const historialSesionesD = dataActual?.periodos?.[periodoActual]?.historial_sesiones || [];
                        historialSesionesD.push({
                                sesion: historialSesionesD.length + 1,
                                segundos: tiempoSesionActual,
                                fecha: new Date().toISOString(),
                                validador: auth.currentUser?.email || "desconocido",
                                accion: "devolucion"
                        });

                        await updateDoc(docRef, {
                                [`periodos.${periodoActual}.estado`]: "pendiente",
                                [`periodos.${periodoActual}.validador`]: null,
                                [`periodos.${periodoActual}.validado_el`]: null,
                                [`periodos.${periodoActual}.tiempo_segundos`]: tiempoNuevoTotal,
                                [`periodos.${periodoActual}.inactividad_segundos`]: inactividadNuevaTotal,
                                [`periodos.${periodoActual}.historial_sesiones`]: historialSesionesD,

                                // 🔥 MÉTRICAS DE MAPA DE CALOR
                                [`periodos.${periodoActual}.veces_devuelto`]: devolucionesPrevias + 1,
                                [`periodos.${periodoActual}.historial_devoluciones`]: [...historialPrevio, nuevaDevolucion]
                        });

                        alert(`✅ Paciente regresó a pendientes.\n🔥 Ha sido devuelto ${devolucionesPrevias + 1} vez/veces.`);
                        window.cerrarModal();

                        if (typeof window.cargarPacientes === 'function') window.cargarPacientes();
                } catch (error) {
                        alert("Error al devolver el paciente: " + error.message);
                }
        };

        // =========================================================
        // NUEVAS FUNCIONES PARA "APROBADOS SISCAD"
        // =========================================================
        window.marcarComoAprobadoSiscad = async (idPaciente) => {
                if (!confirm("✅ ¿Confirmas que este paciente PASÓ SIN ERRORES el validador de SISCAD? Se moverá a la caja fuerte de Aprobados.")) return;
                try {
                        const periodoActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const docRef = doc(db, "pacientes_cac", idPaciente);
                        await updateDoc(docRef, { [`periodos.${periodoActual}.estado`]: "aprobado" });
                        if (typeof window.cargarPacientes === 'function') window.cargarPacientes();
                } catch (error) { alert("Error al mover el paciente: " + error.message); }
        };

        window.devolverAValidado = async (idPaciente) => {
                if (!confirm("¿Desea sacar a este paciente de Aprobados y regresarlo a Validados para ser descargado nuevamente en el TXT?")) return;
                try {
                        const periodoActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const docRef = doc(db, "pacientes_cac", idPaciente);
                        await updateDoc(docRef, { [`periodos.${periodoActual}.estado`]: "validado" });
                        if (typeof window.cargarPacientes === 'function') window.cargarPacientes();
                } catch (error) { alert("Error: " + error.message); }
        };

        window.__mostrarOcultos = false;

        window.toggleMostrarOcultos = () => {
                window.__mostrarOcultos = !window.__mostrarOcultos;
                const btn = document.getElementById("btnToggleOcultos");
                if (btn) {
                        btn.innerHTML = window.__mostrarOcultos
                                ? `<i data-lucide="eye-off" style="width:15px; color:#dc2626;"></i> Ocultar Ocultos`
                                : `<i data-lucide="eye" style="width:15px; color:#6366f1;"></i> Ver Ocultos`;
                        lucide.createIcons();
                }
                window.cargarPacientes();
        };

        window.ocultarPacientePeriodo = async (idPaciente, periodo, nombrePac) => {
                const ctx = window.orbitaUser || window.OrbitaContext || {};
                const rolCtx = (ctx.rol || ctx.role || "").toLowerCase().trim();
                const esMaster = rolCtx === "master admin";
                const esSuper = rolCtx === "super admin";

                if (!esMaster && !esSuper) {
                        alert("No tienes permisos suficientes para realizar esta acción. Contacte al administrador principal.");
                        return;
                }

                if (!confirm(
                        `¿Ocultar a "${nombrePac}" del periodo ${periodo}?\n\n` +
                        `El paciente NO se borrará de la base de datos.\n` +
                        `Puedes volver a mostrarlo desde el panel de administración.`
                )) return;

                try {
                        const docRef = doc(db, "pacientes_cac", idPaciente);
                        const docSnap = await getDoc(docRef);
                        const dataActual = docSnap.exists() ? docSnap.data() : {};
                        const ocultosActuales = dataActual.oculto_en_periodos || [];

                        if (!ocultosActuales.includes(periodo)) {
                                ocultosActuales.push(periodo);
                        }

                        await updateDoc(docRef, {
                                oculto_en_periodos: ocultosActuales,
                                [`oculto_log.${periodo}`]: {
                                        oculto_el: new Date().toISOString(),
                                        oculto_por: (window.OrbitaContext?.email || "desconocido")
                                }
                        });

                        alert(`✅ Paciente ocultado del periodo ${periodo}.\nSigue existiendo en la base de datos.`);
                        window.cargarPacientes();
                } catch (error) {
                        alert("Error al ocultar el paciente: " + error.message);
                }
        };

        window.restaurarPacientePeriodo = async (idPaciente, periodo, nombrePac) => {
                if (!confirm(`¿Restaurar a "${nombrePac}" en el periodo ${periodo}?`)) return;
                try {
                        const docRef = doc(db, "pacientes_cac", idPaciente);
                        const docSnap = await getDoc(docRef);
                        const dataActual = docSnap.exists() ? docSnap.data() : {};
                        const ocultosActuales = (dataActual.oculto_en_periodos || []).filter(p => p !== periodo);

                        await updateDoc(docRef, { oculto_en_periodos: ocultosActuales });
                        alert(`✅ Paciente restaurado en el periodo ${periodo}.`);
                        window.cargarPacientes();
                } catch (error) {
                        alert("Error al restaurar: " + error.message);
                }
        };

        // =========================================================
        // 💾 BOTÓN GUARDAR (Lógica de Antiguos vs Nuevos Reparada)
        // =========================================================
        document.getElementById("btnGuardar").onclick = async () => {
                const cohorteNorm = String(cohorteModalActual).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (typeof window.validateSiscadRules === 'function') {
                        window.validateSiscadRules(cohorteNorm);
                }
                window.validarFormulario();

                const faltantes = document.querySelectorAll(".required-empty").length;
                const porConfirmar = document.querySelectorAll('[data-volatil="true"][data-confirmado="false"]').length;

                if (faltantes > 0 || window.__erroresDuros.length > 0 || porConfirmar > 0) {
                        // 🔥 LOG BLOQUEO EN FIRESTORE (Tarea 3 - bloqueosManuales)
                        try {
                                const periodoA = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                                const dRef = doc(db, "pacientes_cac", currentPacienteId);
                                const dSnap = await getDoc(dRef);
                                const dData = dSnap.exists() ? dSnap.data() : {};
                                const hSes = dData?.periodos?.[periodoA]?.historial_sesiones || [];
                                hSes.push({
                                        sesion: hSes.length + 1,
                                        segundos: 0,
                                        fecha: new Date().toISOString(),
                                        validador: auth.currentUser?.email || "desconocido",
                                        accion: "intento_fallido"
                                });
                                await updateDoc(dRef, { [`periodos.${periodoA}.historial_sesiones`]: hSes });
                        } catch (e) { console.warn("Audit log error:", e); }

                        let textErr = "❌ BLOQUEO: Aún existen campos vacíos o con errores críticos.";
                        if (porConfirmar > 0 && faltantes === 0) textErr = "❌ BLOQUEO: Existen casillas azules pendientes de confirmación/reescritura manual.";

                        alert(textErr);
                        return;
                }

                if (!confirm("¿Desea finalizar la gestión y guardar este paciente?")) return;

                try {
                        const periodoActual = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                        const elapsedSec = window.startTime ? Math.max(0, Math.floor((Date.now() - window.startTime) / 1000)) : 0;

                        // ⚡ OPTIMIZACIÓN: Cargar solo el documento necesario, no toda la colección
                        const docRef = doc(db, "pacientes_cac", currentPacienteId);
                        const snap = await getDoc(docRef);
                        const dataExistente = snap.exists() ? snap.data() : {};

                        const esCancer = (cohorteNorm === "cancer");
                        const listaVarsEval = esCancer ? VARS_CANCER : VARS_HEMO;

                        // 🚩 LÓGICA DE PACIENTE NUEVO VS ANTIGUO (Reparada Definitivamente)
                        let tipoPaciente = dataExistente.periodos?.[periodoActual]?.tipo_paciente;

                        // Si es la primera vez que se guarda, evaluamos si ya traía datos
                        if (!tipoPaciente) {
                                const datosBase = dataExistente.datos_base || {};
                                const varsPrevias = dataExistente.periodos?.[periodoActual]?.variables || {};
                                let camposLlenosBase = 0;

                                listaVarsEval.forEach(vName => {
                                        const k = typeof window.canonKey === 'function' ? window.canonKey(vName) : vName.replace(/\s+/g, '');
                                        const valB = datosBase[k] !== undefined ? String(datosBase[k]).trim() : "";
                                        const valV = varsPrevias[k] !== undefined ? String(varsPrevias[k]).trim() : "";
                                        // Si el dato existe en datos base o en variables clínicas precargadas
                                        if (valB !== "" || valV !== "") {
                                                camposLlenosBase++;
                                        }
                                });

                                // Si tiene más de 12 variables precargadas (los 8 demográficos + algo clínico), ya tiene historia
                                tipoPaciente = (camposLlenosBase > 12) ? "Antiguo" : "Nuevo";
                        }

                        const tiempoAnterior = Number(dataExistente?.periodos?.[periodoActual]?.tiempo_segundos || 0);
                        const inactividadAnterior = Number(dataExistente?.periodos?.[periodoActual]?.inactividad_segundos || 0);

                        const tiempoTotalFinal = tiempoAnterior + elapsedSec;
                        const inactividadTotalFinal = inactividadAnterior + window.__idleSeconds;

                        // Historial de sesiones individuales (para auditoría)
                        const historialSesiones = dataExistente?.periodos?.[periodoActual]?.historial_sesiones || [];
                        historialSesiones.push({
                                sesion: historialSesiones.length + 1,
                                segundos: elapsedSec,
                                fecha: new Date().toISOString(),
                                validador: auth.currentUser?.email || "desconocido",
                                accion: "validacion"
                        });

                        const alertasSaneadas = [...new Set(window.__alertasCriticas)];

                        const updates = {
                                ultima_actualizacion: new Date().toISOString(),
                                ultima_validacion: new Date().toISOString(),
                                validador_email: auth.currentUser ? auth.currentUser.email : "desconocido",
                                [`periodos.${periodoActual}.estado`]: "validado",
                                [`periodos.${periodoActual}.tiempo_segundos`]: tiempoTotalFinal,
                                [`periodos.${periodoActual}.inactividad_segundos`]: inactividadTotalFinal,
                                [`periodos.${periodoActual}.historial_sesiones`]: historialSesiones,
                                [`periodos.${periodoActual}.validado_el`]: new Date().toISOString(),
                                [`periodos.${periodoActual}.validador`]: auth.currentUser ? auth.currentUser.email : "desconocido",

                                // MÉTRICAS CALCULADAS
                                [`periodos.${periodoActual}.tipo_paciente`]: tipoPaciente,
                                [`periodos.${periodoActual}.auditoria_errores_corregidos`]: window.__correccionesCount || 0,
                                [`periodos.${periodoActual}.auditoria_detalle_alertas`]: alertasSaneadas
                        };

                        // Tarea 2: Cálculo de intervenciones humanas (cambios manuales no automáticos)
                        let manualCorrectionsCount = 0;
                        listaVarsEval.forEach(vName => {
                                const key = typeof window.canonKey === 'function' ? window.canonKey(vName) : vName.replace(/\s+/g, '');
                                const el = document.getElementById(`f_${key}`);
                                let newVal = el ? el.value.trim() : "";

                                // Si no hay valor y pusimos por defecto
                                if (newVal === "") {
                                        if (key.toLowerCase().includes("fecha")) newVal = "1845-01-01";
                                        else if (key.includes("VAR2")) newVal = "NONE";
                                        else if (key.includes("VAR4")) newVal = "NOAP";
                                        else newVal = "98";
                                }

                                const oldVal = window.__originalVariables?.[key] || "";
                                const fueAuto = (window.__alertasCriticas || []).includes(key);

                                if (newVal !== oldVal && !fueAuto) {
                                        manualCorrectionsCount++;
                                }
                                updates[`periodos.${periodoActual}.variables.${key}`] = newVal;
                        });

                        updates[`periodos.${periodoActual}.auditoria_correcciones_humanas`] = manualCorrectionsCount;

                        await updateDoc(docRef, updates);

                        alert(`✅ Guardado exitoso.\nTiempo de esta sesión: ${typeof formatTime === 'function' ? formatTime(elapsedSec) : elapsedSec + 's'}\nTipo Identificado: ${tipoPaciente}`);

                        window.cerrarModal();
                        if (typeof window.cargarPacientes === "function") window.cargarPacientes();

                } catch (error) {
                        console.error("Error al guardar:", error);
                        alert("Error crítico al guardar: " + error.message);
                }
        };

        window.exportarSISCAD = async () => {
                const p = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                const hoy = new Date();
                const fNameDate = hoy.getFullYear() + String(hoy.getMonth() + 1).padStart(2, "0") + String(hoy.getDate()).padStart(2, "0");
                const CODEAPB = "CODEAPB";

                const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const isCancer = (s) => norm(s).includes("cancer");
                const isHemo = (s) => norm(s).includes("hemofilia") || norm(s).includes("hemo");

                const snap = await getDocs(query(collection(db, "pacientes_cac"), where("periodo_reporte", "==", String(p))));
                const docsValidados = snap.docs.filter(d => norm(d.data()?.periodos?.[p]?.estado) === "validado");

                if (docsValidados.length === 0) {
                        alert("Nada validado.");
                        return;
                }

                const cohorteSel = (window.cohorteActual || cohorteActual || "todos").toString().toLowerCase().trim();

                const generarYDescargar = (docs, cohorteFmt) => {
                        const formatoEsCancer = isCancer(cohorteFmt);
                        let KEYS = formatoEsCancer ? SISCAD_KEYS_CANCER : SISCAD_KEYS_HEMO;
                        let nombreArchivo = formatoEsCancer ? `${fNameDate}_CODECSC_CANCER.txt` : `${fNameDate}_${CODEAPB}_HEM.txt`;

                        if (!KEYS) return;

                        // Deduplicación por identificación
                        const patientMap = new Map();
                        docs.forEach(d => {
                                const data = d.data() || {};
                                const identification = String(data?.periodos?.[p]?.variables?.VAR6_Identificacion || data?.datos_base?.VAR6_Identificacion || data?.identificacion || data?.VAR6_Identificacion || d.id).trim();
                                if (!patientMap.has(identification)) {
                                        patientMap.set(identification, d);
                                } else if (!formatoEsCancer) {
                                        // Scoring de completitud para Hemofilia si hay duplicados
                                        const current = patientMap.get(identification);
                                        const currentData = current.data() || {};
                                        const scoreDoc = (docData) => KEYS.reduce((acc, k) => acc + (String(docData?.periodos?.[p]?.variables?.[k] || docData?.datos_base?.[k] || docData?.[k] || "").trim() !== "" ? 1 : 0), 0);
                                        if (scoreDoc(data) > scoreDoc(currentData)) {
                                                patientMap.set(identification, d);
                                        }
                                }
                        });
                        const uniqueDocs = Array.from(patientMap.values());

                        const officialHeaderKeys = KEYS.map(k => {
                                if (k === "VAR16_FechaAfiliacionEPSRegistra") return "VAR16_FechaAiliacionEPSRegistra";
                                if (k === "VAR28_GradoDiferenciacionTumorSolidoMaligno") return "VAR28_GradoDiferenciacionTumorAolidoMaligno";
                                if (k === "VAR48_UbicacionTemporalPrimerCicloRelacionOncologico") return "VAR48_UbicacionTtemporalPrimerCicloRelacionOncologico";
                                if (k === "VAR85_EstadoVitalFinalizarUnicaUltimaCirugia") return "VAR85_EstadoVitalFinalizarUnicaOltimaCirugia";
                                if (k === "VAR106_RecibioUsuarioTrasplanteCelulasProgenitoras") return "VAR106_RecibioUsuarioTtrasplanteCelulasProgenitoras";
                                if (k === "VAR123_UsuarioRecibioSoporteNutricional") return "VAR123_UusuarioRecibioSoporteNutricional";
                                if (k === "VAR130_FechaDesafiliacionEPS") return "VAR130_FechaDesafiliaciIonEPS";
                                return k;
                        });

                        let txt = officialHeaderKeys.join("\t") + "\n";
                        uniqueDocs.forEach(d => {
                                const data = d.data();
                                const varsPeriodo = data?.periodos?.[p]?.variables || {};
                                const base = data?.datos_base || {};
                                const fila = KEYS.map(key => {
                                        let val = varsPeriodo[key] ?? base[key] ?? data[key] ?? "";
                                        val = `${val}`.trim();

                                        if (formatoEsCancer) {
                                                if (key.startsWith("VAR2_") && val === "") val = "NONE";
                                                if (key.startsWith("VAR4_") && val === "") val = "NOAP";
                                        } else if (key === "VAR32_Peso" && val !== "") {
                                                const n = Number(String(val).replace(",", "."));
                                                if (!Number.isNaN(n)) val = n.toFixed(2);
                                        }
                                        return String(val).replace(/[\t\n\r]/g, " ").trim();
                                });

                                // Descarte filas fantasma (Solo Hemofilia)
                                if (!formatoEsCancer) {
                                        const filledCount = fila.filter(v => v !== "").length;
                                        const idVal = fila[KEYS.indexOf("VAR6_Identificacion")] || "";
                                        const nomVal = fila[KEYS.indexOf("VAR1_PrimerNombre")] || "";
                                        if (filledCount < 10 && !idVal && !nomVal) return;
                                }

                                txt += fila.join("\t") + "\n";
                        });

                        const blob = new Blob([txt], { type: "text/plain;charset=ansi" });
                        const link = document.createElement("a");
                        link.href = URL.createObjectURL(blob);
                        link.download = nombreArchivo;
                        link.click();
                };

                if (cohorteSel === "todos") {
                        const bCancer = docsValidados.filter(d => isCancer(d.data().cohorte));
                        const bHemo = docsValidados.filter(d => isHemo(d.data().cohorte));
                        if (bCancer.length > 0) generarYDescargar(bCancer, "cancer");
                        if (bHemo.length > 0) generarYDescargar(bHemo, "hemofilia");
                } else if (isCancer(cohorteSel)) {
                        const b = docsValidados.filter(d => isCancer(d.data().cohorte));
                        if (b.length === 0) alert("Nada validado para Cancer.");
                        else generarYDescargar(b, "cancer");
                } else if (isHemo(cohorteSel)) {
                        const b = docsValidados.filter(d => isHemo(d.data().cohorte));
                        if (b.length === 0) alert("Nada validado para Hemofilia.");
                        else generarYDescargar(b, "hemofilia");
                }
        };

        window.exportarSISCADExcel = async () => {
                const p = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                const hoy = new Date();
                const fNameDate = hoy.getFullYear() + String(hoy.getMonth() + 1).padStart(2, "0") + String(hoy.getDate()).padStart(2, "0");

                const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const isCancer = (s) => norm(s).includes("cancer");
                const isHemo = (s) => norm(s).includes("hemofilia") || norm(s).includes("hemo");

                const snap = await getDocs(query(collection(db, "pacientes_cac"), where("periodo_reporte", "==", String(p))));
                const docsValidados = snap.docs.filter(d => String(d.data()?.periodos?.[p]?.estado || "").toLowerCase() === "validado");

                if (docsValidados.length === 0) {
                        alert("Nada validado.");
                        return;
                }

                const cohorteSel = (window.cohorteActual || cohorteActual || "todos").toString().toLowerCase().trim();

                const generarYDescargarXLSX = (docs, cohorteFmt) => {
                        const formatoEsCancer = isCancer(cohorteFmt);
                        let KEYS = formatoEsCancer ? SISCAD_KEYS_CANCER : SISCAD_KEYS_HEMO;
                        let sufijo = formatoEsCancer ? "CANCER" : "HEM";

                        if (!KEYS) return;

                        const rows = docs.map(d => {
                                const data = d.data();
                                const varsPeriodo = data?.periodos?.[p]?.variables || {};
                                const base = data?.datos_base || {};
                                const row = {};
                                KEYS.forEach(key => {
                                        let val = varsPeriodo[key] ?? base[key] ?? data[key] ?? "";
                                        val = `${val}`.trim();
                                        if (formatoEsCancer) {
                                                if (key.startsWith("VAR2_") && val === "") val = "NONE";
                                                if (key.startsWith("VAR4_") && val === "") val = "NOAP";
                                        } else if (key === "VAR32_Peso" && val !== "") {
                                                const n = Number(String(val).replace(",", "."));
                                                if (!Number.isNaN(n)) val = n.toFixed(2);
                                        }
                                        row[key] = val;
                                });
                                return row;
                        });

                        const wb = XLSX.utils.book_new();
                        const ws = XLSX.utils.json_to_sheet(rows, { header: KEYS });
                        XLSX.utils.sheet_add_aoa(ws, [KEYS], { origin: "A1" });
                        XLSX.utils.book_append_sheet(wb, ws, `SISCAD_${sufijo}`);
                        const CODE = (sufijo === "CANCER") ? "CODECSC" : "CODEAPB";
                        XLSX.writeFile(wb, `${fNameDate}_${CODE}_${sufijo}.xlsx`);
                };

                if (cohorteSel === "todos") {
                        const bCancer = docsValidados.filter(d => isCancer(d.data().cohorte));
                        const bHemo = docsValidados.filter(d => isHemo(d.data().cohorte));
                        if (bCancer.length > 0) generarYDescargarXLSX(bCancer, "cancer");
                        if (bHemo.length > 0) generarYDescargarXLSX(bHemo, "hemofilia");
                } else if (isCancer(cohorteSel)) {
                        const b = docsValidados.filter(d => isCancer(d.data().cohorte));
                        if (b.length === 0) alert("Nada validado para Cancer.");
                        else generarYDescargarXLSX(b, "cancer");
                } else if (isHemo(cohorteSel)) {
                        const b = docsValidados.filter(d => isHemo(d.data().cohorte));
                        if (b.length === 0) alert("Nada validado para Hemofilia.");
                        else generarYDescargarXLSX(b, "hemofilia");
                }
        };

        // =========================================================
        // 📊 EXPORTACIÓN EXCEL AUDITADA (Con Regla 90% y Mapas de Calor Completos)
        // =========================================================
        window.exportarProductividadExcel = async () => {
                const p = `${document.getElementById("filtroAnio").value}-${document.getElementById("filtroMes").value}`;
                const hoy = new Date();
                const fNameDate = hoy.getFullYear() + String(hoy.getMonth() + 1).padStart(2, "0") + String(hoy.getDate()).padStart(2, "0");
                const cohorteSel = window.cohorteActual || "todos";

                const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                const snap = await getDocs(query(collection(db, "pacientes_cac"), orderBy("ultima_carga", "desc")));

                const rowsResumen = [];
                const rowsDetallePacientes = [];
                const rowsAuditoriaErrores = [];
                const rowsHistorialDevoluciones = [];
                const agg = {};

                // 📅 Agrupadores para Mapa Mensual (Días 1 a 31)
                const aggMensualVal = {};
                const aggMensualDev = {};

                const initUserMensual = (obj, email) => {
                        if (!obj[email]) {
                                obj[email] = { total: 0 };
                                for (let i = 1; i <= 31; i++) obj[email][i] = 0;
                        }
                };

                // 🕒 Plantillas para Mapa Horario (Semanal)
                const baseMatriz = () => [
                        ["DÍA / HORA", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"],
                        ["Lunes", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        ["Martes", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        ["Miércoles", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        ["Jueves", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        ["Viernes", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                ];

                const matrizValidaciones = baseMatriz();
                const matrizDevoluciones = baseMatriz();

                snap.forEach((d) => {
                        const data = d.data();
                        const per = data?.periodos?.[p];

                        if (!per) return;
                        if (cohorteSel !== "todos" && norm(data?.cohorte) !== norm(cohorteSel)) return;

                        const estado = String(per.estado || "pendiente").toLowerCase();
                        const vecesDevuelto = Number(per.veces_devuelto || 0);

                        if (estado !== "validado" && estado !== "aprobado" && vecesDevuelto === 0) return;

                        const emailVal = String(per?.validador || data?.validador_email || "SISTEMA").trim().toLowerCase();
                        const idPac = data?.identificacion || data?.datos_base?.VAR6_NumeroIdentificacionUsuario || "---";
                        const nombrePac = data?.nombreCompleto || "PACIENTE";
                        const validadoEl = String(per?.validado_el || "").trim();
                        const secs = Number(per?.tiempo_segundos ?? 0) || 0;
                        const errCount = Number(per?.auditoria_errores_corregidos ?? 0) || 0;
                        const idleSecs = Number(per?.inactividad_segundos ?? 0) || 0;
                        const idleEvents = Number(per?.inactividad_eventos ?? 0) || 0;

                        // 🚩 LÓGICA CORREGIDA: Determinista según VAR17+ (Sacralidad)
                        const tipoPac = esPacienteIncidente(data) ? "Nuevo" : "Antiguo";

                        // 🔥 Procesar Devoluciones (Historial)
                        const historial = per.historial_devoluciones || [];
                        historial.forEach(dev => {
                                const devUsuario = dev.usuario || "desconocido";
                                const fechaHora = dev.fecha.split("T");
                                rowsHistorialDevoluciones.push({
                                        Periodo: p,
                                        Paciente_ID: idPac,
                                        Paciente: nombrePac,
                                        Fecha_Devolucion: fechaHora[0],
                                        Hora_Devolucion: fechaHora[1]?.substring(0, 8) || "",
                                        Auditor_Que_Devolvio: devUsuario
                                });

                                const dtDev = new Date(dev.fecha);
                                const diaNumDev = dtDev.getDay();
                                const horaDev = dtDev.getHours();
                                const diaMesDev = dtDev.getDate();

                                // Mapa Horario
                                if (diaNumDev >= 1 && diaNumDev <= 5 && horaDev >= 7 && horaDev <= 17) {
                                        matrizDevoluciones[diaNumDev][horaDev - 6]++;
                                }

                                // 📅 Mapa Mensual
                                initUserMensual(aggMensualDev, devUsuario);
                                aggMensualDev[devUsuario][diaMesDev]++;
                                aggMensualDev[devUsuario].total++;
                        });

                        // 🔥 Procesar Validaciones Exitosas
                        let esAM = false;
                        if ((estado === "validado" || estado === "aprobado") && per.validado_el) {
                                const dt = new Date(per.validado_el);
                                const diaNum = dt.getDay();
                                const hora = dt.getHours();
                                const diaMesVal = dt.getDate();

                                if (hora < 12) esAM = true;

                                // Mapa Horario
                                if (diaNum >= 1 && diaNum <= 5 && hora >= 7 && hora <= 17) {
                                        matrizValidaciones[diaNum][hora - 6]++;
                                }

                                // 📅 Mapa Mensual
                                initUserMensual(aggMensualVal, emailVal);
                                aggMensualVal[emailVal][diaMesVal]++;
                                aggMensualVal[emailVal].total++;
                        }

                        // 🔥 EXPORTAR AUTOCORRECCIONES Y ERRORES AL EXCEL
                        if (estado === "validado" || estado === "aprobado") {
                                const alertas = per.auditoria_detalle_alertas || [];

                                alertas.forEach(alertaHtml => {
                                        // Limpiamos las etiquetas HTML (las negritas <b>) para que el Excel quede limpio
                                        const alertaLimpia = alertaHtml.replace(/<[^>]*>?/gm, '');

                                        // Separamos la variable de la regla que la corrigió
                                        const partes = alertaLimpia.split(":");
                                        const variable = partes[0] ? partes[0].trim() : "Regla del Sistema";
                                        const detalle = partes.slice(1).join(":").trim();

                                        rowsAuditoriaErrores.push({
                                                Fecha_Validacion: validadoEl ? validadoEl.split("T")[0] : "Desconocida",
                                                Validador: emailVal,
                                                Paciente_ID: idPac,
                                                Nombre_Paciente: nombrePac,
                                                Tipo_Intervencion: "AUTOCORRECCIÓN SISCAD (Naranja)",
                                                Variable_Corregida: variable,
                                                Detalle_del_Error: detalle
                                        });
                                });
                        }

                        rowsDetallePacientes.push({
                                Periodo: p,
                                Estado: estado.toUpperCase(),
                                Identificacion: idPac,
                                Paciente: nombrePac,
                                Tipo_Paciente: tipoPac,
                                Veces_Devuelto: vecesDevuelto,
                                Validador: emailVal,
                                Fecha_Validacion: validadoEl ? validadoEl.replace("T", " ").substring(0, 19) : "En proceso...",
                                Segundos_Gestion: secs,
                                Minutos_Gestion: Math.round((secs / 60) * 100) / 100,
                                Errores_Saneados: errCount
                        });

                        if (!agg[emailVal]) {
                                agg[emailVal] = {
                                        email: emailVal,
                                        totalValidados: 0,
                                        sumSecs: 0,
                                        sumErr: 0,
                                        sumIdleSecs: 0,
                                        sumIdleEvents: 0,
                                        am: 0,
                                        pm: 0,
                                        nuevos: 0,
                                        antiguos: 0,
                                        totalDevueltos: 0
                                };
                        }

                        agg[emailVal].totalDevueltos += vecesDevuelto;

                        if (estado === "validado" || estado === "aprobado") {
                                agg[emailVal].totalValidados++;
                                agg[emailVal].sumSecs += secs;
                                agg[emailVal].sumErr += errCount;
                                agg[emailVal].sumIdleSecs += idleSecs;
                                agg[emailVal].sumIdleEvents += idleEvents;
                                if (esAM) agg[emailVal].am++; else agg[emailVal].pm++;
                                if (tipoPac === "Nuevo") agg[emailVal].nuevos++; else agg[emailVal].antiguos++;
                        }
                });

                if (rowsDetallePacientes.length === 0) {
                        alert("No hay información de pacientes validados ni devueltos para exportar.");
                        return;
                }

                const rowsResumenFinal = Object.values(agg).map(r => {
                        const tMins = Math.round((r.sumSecs / 60) * 100) / 100;
                        const pMins = r.totalValidados > 0
                                ? Math.round((tMins / r.totalValidados) * 100) / 100
                                : 0;

                        const idleMins = Math.round((r.sumIdleSecs / 60) * 100) / 100;
                        const idlePromMins = r.totalValidados > 0
                                ? Math.round((idleMins / r.totalValidados) * 100) / 100
                                : 0;

                        const activeSecs = Math.max(0, r.sumSecs - r.sumIdleSecs);
                        const activeMins = Math.round((activeSecs / 60) * 100) / 100;

                        const idlePct = r.sumSecs > 0
                                ? Math.round((r.sumIdleSecs / r.sumSecs) * 10000) / 100
                                : 0;

                        const efectividad = r.totalValidados > 0
                                ? (1 - (r.sumErr / (r.totalValidados * 134))) * 100
                                : 0;

                        return {
                                Validador: r.email,
                                Fichas_Validadas_Exitosas: r.totalValidados,
                                Pacientes_Nuevos: r.nuevos,
                                Pacientes_Antiguos: r.antiguos,
                                Total_Devoluciones_Recibidas: r.totalDevueltos,

                                Tiempo_Total_Minutos: tMins,
                                Tiempo_Activo_Minutos: activeMins,
                                Tiempo_Promedio_Minutos: pMins,

                                Inactividad_Total_Minutos: idleMins,
                                Inactividad_Promedio_Minutos: idlePromMins,
                                Inactividad_Porcentaje: `${idlePct.toFixed(2)}%`,
                                Eventos_Inactividad: r.sumIdleEvents,

                                Jornada_AM: r.am,
                                Jornada_PM: r.pm,
                                Total_Errores_Saneados_Auto: r.sumErr,
                                Calidad_Dato_Inicial: r.totalValidados > 0 ? efectividad.toFixed(2) + "%" : "N/A",
                                Estado_Productividad:
                                        r.totalValidados === 0
                                                ? "SIN VALIDACIONES"
                                                : (idlePct >= 30 ? "ALTA INACTIVIDAD" : (efectividad < 85 ? "CRÍTICO" : "ACEPTABLE"))
                        };
                }).sort((a, b) => b.Fichas_Validadas_Exitosas - a.Fichas_Validadas_Exitosas);
                // 🔥 1. Construcción del Mapa de Calor Horario (Semanal)
                const matrizUnificadaHoraria = [
                        ["🟢 MAPA HORARIO: VALIDACIONES EXITOSAS (Productividad)"],
                        ...matrizValidaciones,
                        [],
                        ["🔴 MAPA HORARIO: DEVOLUCIONES (Errores y Re-procesos)"],
                        ...matrizDevoluciones
                ];

                // 🔥 2. Construcción del Mapa de Calor Mensual (Días 1 a 31)
                const buildMatrizMensual = (aggObj, titulo) => {
                        const header = [titulo, ...Array.from({ length: 31 }, (_, i) => String(i + 1)), "TOTAL"];
                        const matriz = [header];

                        Object.keys(aggObj).sort().forEach(email => {
                                const row = [email];
                                for (let i = 1; i <= 31; i++) row.push(aggObj[email][i]);
                                row.push(aggObj[email].total);
                                matriz.push(row);
                        });
                        return matriz;
                };

                const matrizMensualVal = buildMatrizMensual(aggMensualVal, "🟢 VALIDADOR (ÉXITOS) / DÍA");
                const matrizMensualDev = buildMatrizMensual(aggMensualDev, "🔴 AUDITOR (DEVOLUCIONES) / DÍA");

                const matrizUnificadaMensual = [
                        ["📅 MAPA DE CALOR MENSUAL - PRODUCTIVIDAD DIARIA (Días 1 al 31)"],
                        ...matrizMensualVal,
                        [],
                        ["📅 MAPA DE CALOR MENSUAL - DEVOLUCIONES DIARIAS (Días 1 al 31)"],
                        ...matrizMensualDev
                ];

                // 📕 Generación del Libro
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsResumenFinal), "1. Resumen_Productividad");
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsDetallePacientes), "2. Detalle_Pacientes");
                if (rowsHistorialDevoluciones.length > 0) {
                        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsHistorialDevoluciones), "3. Historial_Devoluciones");
                }
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsAuditoriaErrores), "4. Auditoria_Variables_Vacias");
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizUnificadaHoraria), "5. Mapa_Calor_Horario");

                // 🔥 ESTA ES LA MAGIA: LA HOJA CON LOS DÍAS DEL MES
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizUnificadaMensual), "6. Mapa_Calor_Mensual");

                XLSX.writeFile(wb, `${fNameDate}_PRODUCTIVIDAD_AUDITADA_${p}.xlsx`);
        };

        // --- CARGUE UNIFICADO: CÁNCER (por posición como ya funciona) + HEMOFILIA (por encabezado) ---
        const excelField = document.getElementById('excelInput');
        if (excelField) {
                excelField.addEventListener('change', function (e) {
                        const file = e.target.files[0];
                        if (!file) return;

                        const cohorte = document.getElementById('tipoCargue').value;
                        const reader = new FileReader();

                        reader.onload = async (event) => {
                                try {
                                        const data = new Uint8Array(event.target.result);
                                        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                                        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                                        // --- Helper: Excel/Date/serial -> ISO AAAA-MM-DD ---
                                        const toISO = (v) => {
                                                if (v === null || v === undefined || String(v).trim() === "") return "";

                                                // Si ya viene Date (por cellDates:true)
                                                if (v instanceof Date && !isNaN(v)) {
                                                        const Y = v.getFullYear();
                                                        const M = String(v.getMonth() + 1).padStart(2, "0");
                                                        const D = String(v.getDate()).padStart(2, "0");
                                                        return `${Y}-${M}-${D}`;
                                                }

                                                // Si viene serial Excel (número)
                                                if (typeof v === "number" && isFinite(v)) {
                                                        const dc = XLSX.SSF.parse_date_code(v);
                                                        if (dc && dc.y && dc.m && dc.d) {
                                                                const Y = String(dc.y).padStart(4, "0");
                                                                const M = String(dc.m).padStart(2, "0");
                                                                const D = String(dc.d).padStart(2, "0");
                                                                return `${Y}-${M}-${D}`;
                                                        }
                                                        return String(v);
                                                }

                                                // Si viene string DD/MM/AAAA
                                                const s = String(v).trim();
                                                const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                                                if (m) return `${m[3]}-${m[2]}-${m[1]}`;

                                                // Si ya viene ISO, perfecto
                                                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

                                                return s;
                                        };

                                        if (!rows || rows.length < 2) {
                                                alert("El archivo no tiene filas para cargar.");
                                                return;
                                        }

                                        const pAnio = document.getElementById("filtroAnio").value;
                                        const pMes = document.getElementById("filtroMes").value;
                                        const periodo = `${pAnio}-${pMes}`;

                                        const cohorteNorm = String(cohorte || "").toLowerCase();
                                        const esCancer = /cancer|cáncer|onc|neo/.test(cohorteNorm);

                                        // ====== helpers solo para HEMO (no tocan cáncer) ======
                                        const normHeader = (h) => String(h ?? "").trim().replace(/\s+/g, '');
                                        const headerRow = rows[0] || [];
                                        const H = Object.create(null);
                                        headerRow.forEach((h, idx) => {
                                                const k = normHeader(h);
                                                if (k && H[k] === undefined) H[k] = idx;
                                        });
                                        const cellBy = (fila, ...keys) => {
                                                for (const kRaw of keys) {
                                                        const k = normHeader(kRaw);
                                                        const idx = H[k];
                                                        if (idx !== undefined) {
                                                                const v = fila[idx];
                                                                const s = (v !== undefined && v !== null) ? String(v).trim() : "";
                                                                if (s !== "") return s;
                                                        }
                                                }
                                                return "";
                                        };

                                        let batch = writeBatch(db);
                                        let countBatch = 0;
                                        let totalProcesados = 0;

                                        // Indicador de carga
                                        const btnOriginalText = e.target.labels?.[0]?.textContent || "Cargar";
                                        if (e.target.labels?.[0]) e.target.labels[0].textContent = "⚙️ Procesando...";

                                        for (let i = 1; i < rows.length; i++) {
                                                const fila = rows[i];
                                                if (!fila || fila.length < 7) continue;

                                                // =========================================================
                                                // ✅ RAMA 1: CÁNCER
                                                // =========================================================
                                                if (esCancer) {
                                                        const v1 = fila[1] ? fila[1].toString().trim().toUpperCase() : "";
                                                        const v3 = fila[3] ? fila[3].toString().trim().toUpperCase() : "";
                                                        const v6 = fila[6] ? fila[6].toString().trim() : "";
                                                        if (!v6) continue;

                                                        const dxIndex = rows[0].findIndex(h => h && h.toString().toLowerCase() === 'dx');
                                                        const valorDx = dxIndex !== -1 ? fila[dxIndex] : fila[fila.length - 1];
                                                        const dxLimpio = valorDx ? valorDx.toString().trim().toUpperCase() : "SIN_DX";

                                                        const idIdent = v6.toString().trim().replace(/\D/g, '');
                                                        const idDx = dxLimpio.replace(/[^A-Z0-9]/g, '_');
                                                        const docId = `${idIdent}_${idDx}`;

                                                        const pacienteDoc = {
                                                                identificacion: idIdent,
                                                                periodo_reporte: periodo,
                                                                tipo_identificacion: fila[5]?.toString().trim() || "",
                                                                nombreCompleto: `${v1} ${v3}`.trim().toUpperCase(),
                                                                cohorte: cohorte,
                                                                dx: idDx,
                                                                dx_descripcion: valorDx?.toString().trim() || "Sin descripción",
                                                                ultima_carga: new Date().toISOString(),
                                                                periodo_ultima_carga: periodo,
                                                                datos_base: {
                                                                        VAR1_PrimerNombreUsuario: v1 || "",
                                                                        VAR2_SegundoNombreUsuario: fila[2]?.toString().trim().toUpperCase() || "NONE",
                                                                        VAR3_PrimerApellidoUsuario: v3 || "",
                                                                        VAR4_SegundoApellidoUsuario: fila[4]?.toString().trim().toUpperCase() || "NOAP",
                                                                        VAR5_TipoIdentificacionUsuario: fila[5]?.toString().trim() || "",
                                                                        VAR6_NumeroIdentificacionUsuario: idIdent || "",
                                                                        VAR7_FechaNacimiento: toISO(fila[7]),
                                                                        VAR8_Sexo: fila[8]?.toString().trim().toUpperCase() || ""
                                                                },
                                                                periodos: {
                                                                        [periodo]: {
                                                                                cargado_el: new Date().toISOString(),
                                                                                estado: "pendiente",
                                                                                variables: {}
                                                                        }
                                                                }
                                                        };

                                                        rows[0].forEach((header, index) => {
                                                                const key = header?.toString().trim().replace(/\s+/g, '');
                                                                if (key && !/^(VAR1|VAR2|VAR3|VAR4|VAR5|VAR6|VAR7|VAR8)(\D|$)/.test(key)) {
                                                                        pacienteDoc.periodos[periodo].variables[key] = (fila[index] ?? "").toString().trim();
                                                                }
                                                        });

                                                        batch.set(doc(db, "pacientes_cac", docId), pacienteDoc, { merge: true });
                                                } else {
                                                        // ✅ RAMA 2: HEMOFILIA
                                                        const v1h = cellBy(fila, "VAR1_PrimerNombre");
                                                        const v3h = cellBy(fila, "VAR3_PrimerApellido");
                                                        const v6h = cellBy(fila, "VAR6_Identificacion");
                                                        const idIdentH = String(v6h || "").trim().replace(/\D/g, "");
                                                        
                                                        if (!idIdentH) continue;

                                                        const docIdH = `${idIdentH}_HEMO`;
                                                        const pacienteDocH = {
                                                                identificacion: idIdentH,
                                                                nombreCompleto: `${v1h} ${v3h}`.trim().toUpperCase(),
                                                                periodo_reporte: periodo,
                                                                cohorte: cohorte,
                                                                dx: "HEMO",
                                                                ultima_carga: new Date().toISOString(),
                                                                datos_base: {
                                                                        VAR1_PrimerNombre: v1h,
                                                                        VAR2_SegundoNombre: cellBy(fila, "VAR2_SegundoNombre") || "NONE",
                                                                        VAR3_PrimerApellido: v3h,
                                                                        VAR4_SegundoApellido: cellBy(fila, "VAR4_SegundoApellido") || "NOAP",
                                                                        VAR5_TipoIdentificacion: cellBy(fila, "VAR5_TipoIdentificacion"),
                                                                        VAR6_Identificacion: idIdentH,
                                                                        VAR7_FechaNacimiento: toISO(cellBy(fila, "VAR7_FechaNacimiento")),
                                                                        VAR8_Sexo: (cellBy(fila, "VAR8_Sexo") || "").toUpperCase()
                                                                },
                                                                periodos: { 
                                                                    [periodo]: { 
                                                                        cargado_el: new Date().toISOString(), 
                                                                        estado: "pendiente", 
                                                                        variables: {} 
                                                                    } 
                                                                }
                                                        };

                                                        rows[0].forEach((header, index) => {
                                                                const key = header?.toString().trim().replace(/\s+/g, '');
                                                                if (key) {
                                                                        let valor = (fila[index] ?? "").toString().trim();
                                                                        if (typeof isDateKey === "function" && isDateKey(key)) valor = toISO(fila[index]);
                                                                        pacienteDocH.periodos[periodo].variables[key] = valor;
                                                                }
                                                        });
                                                        batch.set(doc(db, "pacientes_cac", docIdH), pacienteDocH, { merge: true });
                                                }

                                                countBatch++;
                                                totalProcesados++;

                                                if (countBatch >= 400) {
                                                        await batch.commit();
                                                        batch = writeBatch(db);
                                                        countBatch = 0;
                                                }
                                        }

                                        if (countBatch > 0) {
                                                await batch.commit();
                                        }

                                        // Restaurar botón y alertar
                                        if (e.target.labels?.[0]) e.target.labels[0].textContent = btnOriginalText;
                                        alert(`Sincronización completa: ${totalProcesados} pacientes procesados correctamente.`);
                                        cargarPacientes();

                                } catch (err) {
                                        console.error("Error en correlación:", err);
                                        alert("Error al organizar la base de datos: " + err.message);
                                        if (e.target.labels?.[0]) e.target.labels[0].textContent = btnOriginalText;
                                }
                        };

                        reader.readAsArrayBuffer(file);
                });
        }

        window.manejarEnter = (event, variableActualLabel) => {
                if (event.key !== "Enter") return;
                event.preventDefault();

                const esCancer = (cohorteModalActual === "cáncer");
                const varsLabels = esCancer ? VARS_CANCER : VARS_HEMO;

                const varsKeys = varsLabels.map(canonKey);
                const currentKey = canonKey(variableActualLabel);
                const currentIndex = varsKeys.indexOf(currentKey);

                for (let i = currentIndex + 1; i < varsKeys.length; i++) {
                        const k = varsKeys[i];
                        const el = document.getElementById(`f_${k}`);
                        if (el && !el.readOnly && !el.disabled) {
                                el.focus();
                                if (typeof el.select === "function") el.select();
                                return;
                        }
                }

                document.getElementById("btnGuardar")?.focus();
        };

        function formatTime(sec) { return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`; }

        // Escuchar OrbitaContext en vez de verificar correos hardcodeados
        const aplicarPermisos = (ctx) => {
                if (!ctx) return;

                const rol = (ctx.rol || ctx.role || "").toLowerCase().trim();
                window.__userRol = rol;
                const email = (ctx.email || "").toLowerCase().trim();

                const adminSection = document.getElementById("adminSection");
                const elVivo = document.getElementById("sistemaVivo");

                // Roles normalizados según requerimientos de seguridad
                const isMaster = rol === "master admin";
                const isSuper = rol === "super admin";
                const isAnalista = rol.includes("analista");
                const esSoloLectura = rol === "administrador";

                if (adminSection) {
                        if (isMaster || isSuper || isAnalista) {
                                adminSection.style.display = 'flex';
                                if (elVivo) elVivo.textContent = "SISTEMA EN VIVO v1.1";

                                const selectCargue = document.getElementById("tipoCargue");
                                const btnImportar = adminSection.querySelector("button[onclick*='excelInput']");
                                const btnSiscadXlsx = adminSection.querySelector("button[onclick*='exportarSISCADExcel']");
                                const btnProdXlsx = adminSection.querySelector("button[onclick*='exportarProductividadExcel']");
                                const btnTxt = adminSection.querySelector("button[onclick*='exportarSISCAD()']");
                                const btnToggleOcultos = document.getElementById("btnToggleOcultos");

                                // Master Admin y Super Admin tienen acceso completo
                                const accesoTotal = isMaster || isSuper;

                                if (selectCargue) selectCargue.style.display = accesoTotal ? 'inline-block' : 'none';
                                if (btnImportar) btnImportar.style.display = accesoTotal ? 'inline-block' : 'none';
                                if (btnSiscadXlsx) btnSiscadXlsx.style.display = accesoTotal ? 'inline-block' : 'none';
                                if (btnProdXlsx) btnProdXlsx.style.display = accesoTotal ? 'inline-block' : 'none';
                                if (btnTxt) btnTxt.style.display = 'inline-block'; // siempre visible para analista
                                if (btnToggleOcultos) btnToggleOcultos.style.display = accesoTotal ? 'flex' : 'none';

                        } else {
                                adminSection.style.display = 'none';
                        }
                }

                // Global helper for toggling hidden records view (Refactored to Button Toggle)
                window.toggleMostrarOcultos = () => {
                        window.__mostrarOcultos = !window.__mostrarOcultos;

                        // Update UI of the toggle button if it exists
                        const btn = document.getElementById("btnToggleOcultos");
                        if (btn) {
                                if (window.__mostrarOcultos) {
                                        btn.style.background = "#6366f1";
                                        btn.style.color = "white";
                                        btn.innerHTML = '<i data-lucide="eye-off" style="width:15px; color:white;"></i> Ocultar Ocultos';
                                } else {
                                        btn.style.background = "white";
                                        btn.style.color = "#334155";
                                        btn.innerHTML = '<i data-lucide="eye" style="width:15px; color:#6366f1;"></i> Ver Ocultos';
                                }
                                if (window.lucide) window.lucide.createIcons();
                        }

                        cargarPacientes();
                };

                // Mostrar correo del usuario actual
                const userEmailEl = document.getElementById("userEmail");
                if (userEmailEl) userEmailEl.textContent = email;

                cargarPacientes();
        };

        // 🔄 ESCUCHA DE CONTEXTO REPARADA (Sincronizada con layout.html)
        const initContextListener = () => {
                const triggerInit = (u) => {
                        if (!u) return;
                        console.log("[ALTO-COSTO] Contexto detectado:", u.email);
                        window.OrbitaContext = u; // Compatibilidad legacy 
                        aplicarPermisos(u);
                };

                // Opción A: Escuchar evento reactivo del layout (disparado con 100ms lag)
                window.addEventListener('user-ready', (e) => triggerInit(e.detail));

                // Opción B: Si el script carga lento y el evento ya pasó
                if (window.orbitaUser) triggerInit(window.orbitaUser);

                // Opción C: Soporte legacy OrbitaContextReady si algún otro módulo lo emite
                window.addEventListener('OrbitaContextReady', (e) => triggerInit(e.detail));
        };

        // Iniciar el listener de contexto
        initContextListener();

        // Notificar cambio de estado (sin redirección agresiva que cause loops)
        onAuthStateChanged(auth, u => {
                if (u) {
                        console.log("✅ [ALTOCOSTO] Firebase Session active:", u.email);
                } else {
                        console.warn("⚠️ [ALTOCOSTO] Firebase Session not found on this page load.");
                        // No redireccionamos aquí, ya que Spring Security protege la página a nivel de servidor.
                }
        });

        // ─── SISTEMA DE TOOLTIPS DE AYUDA (DELEGACIÓN GLOBAL) ─────────
        window.initTooltips = () => {
                let tooltipEl = document.getElementById('tooltip-ayuda-global');
                if (!tooltipEl) {
                        tooltipEl = document.createElement('div');
                        tooltipEl.id = 'tooltip-ayuda-global';
                        tooltipEl.className = 'tooltip-ayuda';
                        document.body.appendChild(tooltipEl);
                }

                if (window.__tooltipsInitialized) return;
                window.__tooltipsInitialized = true;

                // Delegación en document.body para máxima resiliencia ante cambios de DOM
                document.body.addEventListener('mouseover', (e) => {
                        const icon = e.target.closest('.info-icon');
                        if (!icon) return;

                        const tip = icon.getAttribute('data-tip');
                        if (!tip) return;

                        tooltipEl.textContent = tip;
                        tooltipEl.classList.add('visible');

                        const rect = icon.getBoundingClientRect();
                        let top = rect.bottom + 8;
                        let left = rect.left;

                        if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
                        if (top + 100 > window.innerHeight) top = rect.top - (tooltipEl.offsetHeight || 40) - 8;

                        tooltipEl.style.top = top + 'px';
                        tooltipEl.style.left = left + 'px';
                }, true);

                document.body.addEventListener('mouseout', (e) => {
                        if (e.target.closest('.info-icon')) {
                                tooltipEl.classList.remove('visible');
                        }
                }, true);

                // Ocultar si se hace scroll o click en cualquier parte
                window.addEventListener('scroll', () => tooltipEl.classList.remove('visible'), true);
                document.addEventListener('mousedown', () => tooltipEl.classList.remove('visible'), true);
        };

        // Inicializar tooltips cada vez que se abre una ficha
        const originalAbrirFicha = window.abrirFicha;
        window.abrirFicha = function (...args) {
                originalAbrirFicha.apply(this, args);
                setTimeout(initTooltips, 200);
        };

        const __abrirFichaOriginal = window.abrirFicha;

        window.abrirFicha = async (idDoc, p, ...rest) => {
                const lockResult = await window.__altoCostoLocks.tomarLockFicha(idDoc);

                if (!lockResult.ok) {
                        alert(lockResult.message || 'No fue posible abrir la ficha.');
                        return;
                }

                return await __abrirFichaOriginal(idDoc, p, ...rest);
        };


        window.abrirModalCalidad = () => {
                const modalId = 'modal-auditoria-custom';
                if (document.getElementById(modalId)) document.getElementById(modalId).remove();

                const html = `
              <div id="${modalId}" style="position:fixed; inset:0; background:rgba(15,23,42,0.7); backdrop-filter:blur(12px); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; font-family:sans-serif;">
                <div style="background:white; border-radius:2.5rem; padding:40px; max-width:550px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); position:relative; border: 1px solid rgba(255,255,255,0.3);">
                  <button onclick="document.getElementById('${modalId}').remove()" style="position:absolute; top:20px; right:20px; background:none; border:none; font-size:24px; cursor:pointer; color:#94a3b8;">&times;</button>
                  <h2 style="font-weight:900; color:#1e293b; margin-bottom:25px; display:flex; align-items:center; gap:12px; font-size:1.5rem;">📊 Auditoría de Impacto Humano</h2>
                  
                  <div style="display:grid; gap:15px;">
                    <div style="padding:20px; background:#f0fdf4; border-radius:1.5rem; border-left:6px solid #22c55e;">
                      <small style="color:#166534; font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:10px;">Eficiencia del Sistema (ROI)</small>
                      <div style="font-size:22px; font-weight:900; color:#166534;">${window.__totalSaneados || 0} Errores Autocorregidos</div>
                      <p style="margin:0; font-size:12px; opacity:0.8; color:#166534;">Tareas automáticas que el sistema resolvió sin intervención.</p>
                    </div>

                    <div style="padding:20px; background:#eff6ff; border-radius:1.5rem; border-left:6px solid #3b82f6;">
                      <small style="color:#1e40af; font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:10px;">Intervención Manual (Error Humano)</small>
                      <div style="font-size:22px; font-weight:900; color:#1e40af;">${window.__totalErroresHumanos || 0} Cambios de Criterio</div>
                      <p style="margin:0; font-size:12px; opacity:0.8; color:#1e40af;">Ajustes manuales realizados por el analista tras el análisis clínico.</p>
                    </div>

                    <div style="padding:20px; background:#fff1f1; border-radius:1.5rem; border-left:6px solid #dc2626;">
                      <small style="color:#991b1b; font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:10px;">Reprocesos Totales</small>
                      <div style="font-size:22px; font-weight:900; color:#dc2626;">${window.__totalDevoluciones || 0} Incidencias de Devolución</div>
                      <p style="margin:0; font-size:12px; opacity:0.8; color:#991b1b;">Persistencia de inconsistencias detectadas en el periodo.</p>
                    </div>
                  </div>
                  
                  <div style="margin-top:25px; padding:15px; background:#f8fafc; border-radius:1rem; font-size:13px; color:#64748b; font-weight:600; line-height:1.4; text-align:center;">
                    "El sistema ahorró el <b>${Math.round(((window.__totalSaneados || 1) / ((window.__totalSaneados || 1) + (window.__totalErroresHumanos || 1))) * 100)}%</b> del esfuerzo operativo. Se requiere análisis manual en el resto por falta de reglas programables."
                  </div>
                </div>
              </div>`;
                document.body.insertAdjacentHTML('beforeend', html);
        };

        window.marcarNoCohorte = async () => {
                if (!currentPacienteId) return;

                const nombrePac = document.getElementById("modalNombre")?.innerText || "el paciente";
                const confirmMsg = `❓ ¿CONFIRMA QUE "${nombrePac}" NO PERTENECE A LA COHORTE seleccionada?\n\nEsta marca será visible para el Super Admin y el paciente aparecerá resaltado en rojo.`;

                // 🛡️ Bloqueo explícito de cancelación
                const userConfirmed = window.confirm(confirmMsg);
                if (userConfirmed !== true) {
                        console.log("🚫 [ALTO-COSTO] Operación cancelada por el analista.");
                        return;
                }

                const btn = document.getElementById("btnNoCohorte");
                if (btn) {
                        btn.disabled = true;
                        btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Marcando...`;
                }

                try {
                        const anio = document.getElementById("filtroAnio").value;
                        const mes = document.getElementById("filtroMes").value;
                        const periodoSel = `${anio}-${mes}`;
                        const docRef = doc(db, "pacientes_cac", currentPacienteId);

                        await updateDoc(docRef, {
                                [`periodos.${periodoSel}.no_cohorte`]: true,
                                [`periodos.${periodoSel}.no_cohorte_marcado_el`]: new Date().toISOString(),
                                [`periodos.${periodoSel}.no_cohorte_marcado_por`]: (auth.currentUser ? auth.currentUser.email : "analista_local")
                        });

                        alert("✅ Marca 'No pertenece a cohorte' registrada exitosamente.");
                        window.cerrarModal();
                        if (typeof window.cargarPacientes === 'function') {
                                await window.cargarPacientes();
                        }
                } catch (error) {
                        console.error("❌ Error al marcar cohorte:", error);
                        alert("Error al marcar registro: " + error.message);
                        if (btn) {
                                btn.disabled = false;
                                btn.innerHTML = `<i data-lucide="user-x" style="width: 16px;"></i> MARCAR: NO PERTENECE A ESTA COHORTE`;
                                if (window.lucide) lucide.createIcons();
                        }
                }
        };

        // ⚡ Carga inmediata de la tabla
        window.cargarPacientes();

        setTimeout(() => {
                iniciarRefreshLocks();
        }, 1500);
})();