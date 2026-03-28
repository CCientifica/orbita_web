# 📄 Páginas y Funciones - ÓrbitA

Este documento proporciona una descripción detallada de la interfaz de ÓrbitA, permitiendo un entendimiento profundo de la operatividad de cada vista según el rol del usuario institucional.

---

## 1. 🏠 Página Principal (Home)
*   **Nombre**: Inicio / Hub de Monitoreo del Ecosistema.
*   **Ruta**: `/home` (Vista: `home.html`).
*   **Objetivo Funcional**: Punto de entrada centralizado y **Centro de Control Operacional**. Presenta las capacidades del sistema organizadas modularmente por dominios (Gestión, Analítica, Predicción).
*   **Secciones Visuales**:
    *   **Hero Banner**: Identidad institucional con estatus de monitoreo en tiempo real (Nodos, Sincronización).
    *   **Dashboard de Capacidades**: Mapeo visual de módulos con jerarquía según el rol.
    *   **Banner de Innovación**: Sección informativa sobre la evolución constante de la plataforma.
*   **Acciones**:
    *   Navegación directa a módulos especializados.
    *   Visualización de estatus global del ecosistema.
*   **Dependencias**: `Spring Security` para visibilidad condicional de tarjetas.

---

## 2. 🔑 Página de Acceso (Login Institucional)
*   **Nombre**: Acceso Institucional.
*   **Ruta**: `/login` (Vista: `login.html`).
*   **Objetivo Funcional**: Puerta de seguridad para autenticar la identidad del usuario mediante credenciales corporativas.
*   **Acciones**:
    *   **Google Auth**: Botón interactivo que abre el **Popup Real** de Google para la selección de cuenta.
    *   **No Bypass**: El sistema requiere interactividad y prohíbe el login silencioso al pulsar el botón.
    *   **Validación de Dominio**: Solo se permite el ingreso con cuentas `@clinicasagradocorazon.com.co`.
    *   **Verificación Interna**: Se valida que el correo institucional tenga autorización en la colección `usuarios_permitidos` en **Firestore**.
    *   **Mapeo de Roles**: Una vez autorizado, el usuario entra con su rol oficial (ej. `coordcientifico@clinicasagradocorazon.com.co` accede como `master admin`).
*   **Restricciones**:
    *   ⚠️ **PROHIBIDO EL REGISTRO PÚBLICO**.
    *   ⚠️ **PROHIBIDO EL LOGIN CLÁSICO (USUARIO/CONTRASEÑA)** para el personal.
*   **Dependencias**: `Firebase SDK (v10+)`, `Spring Security`, y `Firestore`.

---

## 3. 👥 Gestión de Usuarios
*   **Nombre**: Administración de Usuarios y Facultades.
*   **Ruta**: `/usuarios` (Vista: `usuarios.html`).
*   **Objetivo Funcional**: Control centralizado y auditoría del personal con acceso al ecosistema ÓrbitA.
*   **Interfaz Premium**: Listado modernizado con jerarquía visual de roles, estados de cuenta destacados e iconografía institucional.
*   **Gestión de Identidad**: Incluye un **Selector Visual de Avatares** (basado en semillas de DiceBear) para personalizar el perfil de cada colaborador, mejorando el reconocimiento visual en la plataforma.
*   **Acciones**: Crear, editar y suspender usuarios. Permite asignar roles de la Matriz Oficial y gestionar la identidad visual.
*   **Flujo de Datos (Dualidad de Datos)**:
    *   **Lectura**: Sincronización en tiempo real con **Firebase Cloud** (colección `usuarios_permitidos`) incluyendo atributos extendidos como `avatar`.
    *   **Escritura**: Las acciones realizan un **Dual-Write**: persisten el perfil completo (incluyendo avatar) en Firestore y notifican al backend local de **Spring Boot** para la integridad de `Spring Security`.
*   **Dependencia**: **Exclusiva para `master admin`**. Requiere SDK de Firebase activo y autenticado para la lectura maestra.

---

## 4. 🚑 Alto Costo (Programa CAC)
*   **Nombre**: Seguimiento Alto Costo.
*   **Ruta**: `/altocosto` (Vista: `altocosto.html`).
*   **Objetivo Funcional**: Gestión detallada de la cohorte de pacientes críticos que impactan financieramente la clínica.
*   **Acciones**:
    *   Carga de archivos Excel y Exportación SISCAD XL (Solo Admin/SuperAdmin).
    *   Edición de datos clínicos de pacientes (Analista/Admin).
    *   Exportación de reportes de productividad y **Toggling de Registros Ocultos** (Solo Admin/SuperAdmin - Panel "Flujo de Datos").
    *   Exportación SISCAD TXT (Disponible para Analista de Alto Costo): Implementa corrección quirúrgica de 7 cabezales (incluyendo errores tipográficos oficiales) para asegurar compatibilidad total con el validador institucional.
*   **Integración**: Conectividad nativa con **Firebase/Firestore** para persistencia de datos y gestión de usuarios en tiempo real.
*   **Sincronización de Datos**: Integración con Firebase SDK (v10) para persistencia en tiempo real de pacientes y variables clínicas.
*   **Interfaz Premium**: El modal de la tarjeta del paciente incluye una **Capa de Lectura Humana** que transforma nombres técnicos pegados en etiquetas legibles (Ej: `Fecha Nacimiento`), e incorpora el campo **Dx** (Diagnóstico) como referencia visual obligatoria.
*   **Identificación de Casos**: Implementa una lógica determinista de clasificación **Nuevo** (Incidente) vs **Antiguo** (Prevalente) basada en la presencia de datos clínicos (desde VAR17 en adelante). La validación es **exhaustiva y recursiva**: escanea el objeto raíz, los datos base y **todos los periodos históricos** del paciente en Firestore. Si se detecta cualquier valor real (incluyendo "0", "NONE", "NO" o códigos técnicos) en estas variables, el sistema lo clasifica automáticamente como **Antiguo**, garantizando la integridad de la cohorte histórica incluso ante importaciones estructuralmente variadas.
*   **Robustez de UI**: Empleo de listeners seguros ($safeAction) y gestión de bandejas escalable (Pendientes, Validados, Aprobados).

*   **Dependencia**: `FirestoreController` para lectura/escritura en tiempo real.

---

## 5. 🏥 Gestión CTC (GPC)
*   **Nombre**: Gestión de Guías de Práctica Clínica.
*   **Ruta**: `/cronogramagpc`, `/plananual-gpc` (Vistas: `cronogramagpc.html`, `plananual-gpc.html`).
*   **Objetivo Funcional**: Administración de la planeación estratégica y cronogramas de Guías de Práctica Clínica (GPC).
*   **Acciones**: Creación de cronogramas anuales, seguimiento de planes y gestión de excelencia científica.
*   **Dependencia**: **Exclusiva para `master admin`**.

---

## 6. 🔮 Predictor LOS (IA)
*   **Nombre**: Predicción de Estancia (Length of Stay).
*   **Ruta**: `/predictor-los` (Vista: `predictor-los.html`).
*   **Objetivo Funcional**: Utilizar modelos de Inteligencia Artificial para estimar cuánto tiempo permanecerá un paciente en la clínica.
*   **Acciones**:
    *   Visualización de pacientes en tiempo real con predicciones de IA.
    *   Análisis de factores de riesgo asociados a la estancia prolongada.
*   **Dependencia**: Modelos de IA cargados vía `AiController` y datos de pacientes de la capa Service.

---

## 7. 📊 Estadística Diaria
*   **Nombre**: KPIs Diarios.
*   **Ruta**: `/estadistica-diaria` (Vista: `estadistica_diaria.html`).
*   **Objetivo Funcional**: Monitor de salud institucional con datos actualizados minuto a minuto.
*   **Acciones**: Consulta de ingresos, egresos, ocupación de camas y giros de cama.
*   **Estructura Ejecutiva (Cuatro Grillas)**:
    1. **Inteligencia del Periodo**: Insights predictivos, ranking de desempeño y alertas de desviación en tiempo real.
    2. **Indicadores del Periodo**: Cuadrícula de 25 KPIs con semaforización proactiva y comparación con el día anterior.
    3. **Tabla Consolidada**: Visión estructurada tipo "Libro de Excel" para análisis detallado del mes.
    4. **Tendencias Analíticas**: Capa de gráficas con interpretación automatizada de demanda, ocupación y productividad.
*   **Inteligencia Analítica (Executive Layer)**: 
    *   **Análisis Predictivo**: Proyección de cierre de mes basada en el ritmo operativo actual. 
    *   **Detección de Desviaciones**: Cálculo automático de DoD (Día tras día) y WoW (Semana tras semana) para identificar anomalías en tiempo real.
    *   **Scorecard Operativo**: Matriz de desempeño con semáforos inteligentes por cumplimiento de metas.
    *   **Monitor de Riesgo**: Sistema de alertas automáticas para KPI con desviaciones críticas respecto al presupuesto.
*   **Carga de Datos**: Centro de control dinámico para ingresar realizados diarios (solo Master/Super Admin).
*   **Exportación Multi-formato**: Descarga de informes en PNG de alta resolución (8K) y Excel estructurado.
*   **Gating de Botones y Robustez JS**: El acceso al panel "Cargar Datos" y "Enviar Reporte" está blindado por doble capa (Thymeleaf `sec:authorize` y validación de `window.orbitaUser.role` en JS) garantizando su aparición unívoca para roles de alto nivel. El sistema emplea una arquitectura de **IDs fantasma** globales para asegurar que los scripts de monitoreo se inicialicen sin errores de tipo, independientemente de los permisos de visualización específicos del usuario.


---

## 8. 🌐 Ecosistema Digital (Incluye RCF)
*   **Nombre**: Hub de Aplicaciones y Registro Clínico.
*   **Ruta**: `/dasheco`, `/auxiliares-enf-rcf`, `/medicos-gen-rcf` (Vistas: `dasheco.html`, `auxiliares_enf_rcf.html`, `medicos_gen_rcf.html`).
*   **Objetivo Funcional**: Consolidación de herramientas operativas (RCF) y tableros de control de todo el sistema.
*   **Sub-funciones**:
    *   **RCF Médicos**: Captura estandarizada para personal médico.
    *   **RCF Auxiliares**: Registro operativo para personal de enfermería.
    *   **Monitoreo**: DashEco para telemetría de uso.
*   **Dependencia**: Conectividad directa con APIs de telemetría interna y lógica de autorización de rol.

---

## 9. 👤 Gestión de Perfil (Navbar)
*   **Nombre**: Autogestión de Identidad.
*   **Ubicación**: Acceso desde el Avatar en el Navbar superior.
*   **Objetivo Funcional**: Permitir que cada colaborador personalice su nombre institucional y su avatar para mejorar el reconocimiento en el ecosistema.
*   **Acciones**:
    *   **Edición de Nombre**: Cambio del nombre visual mostrado en la plataforma.
    *   **Cambio de Avatar**: Selección entre las 20 semillas oficiales de **Adventurer Neutral**.
*   **Sincronización**: Persistencia inmediata en la colección maestra de usuarios, con reflejo visual en tiempo real en todos los componentes del layout (Navbar, Dropdown, Modales).

---

## 10. 🔌 Infraestructura de Compatibilidad (Firebase Shim)
*   **Nombre**: Firebase Compatibility Layer.
*   **Archivo**: `firebase-shim.js`.
*   **Objetivo Funcional**: Garantizar que los módulos complejos (Alto Costo, Gestión de Usuarios) funcionen de manera transparente tanto en entornos locales (Spring Boot) como en despliegues estáticos (Firebase Hosting).
*   **Funcionalidad Crítica**:
    *   **Auth Interoperability**: Emula el objeto `auth` y la función `onAuthStateChanged`, permitiendo que el sistema de redirección de Spring Security coexista con la lógica de Firebase.
    *   **Robustez de Callback**: Implementa validación estricta de parámetros en `onAuthStateChanged`, soportando las firmas modular `(auth, callback)` y simplificada `(callback)`, evitando errores de tipo durante la inicialización del contexto.
    *   **API Mapping**: Traduce operaciones de `getDoc`, `setDoc` y `getDocs` hacia el `FirestoreController` interno, manteniendo la integridad de los datos sin requerir cambios en la lógica de negocio de los scripts originales.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
