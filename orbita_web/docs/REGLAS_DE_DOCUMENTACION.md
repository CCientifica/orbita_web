# 📜 Reglas de Documentación - ÓrbitA

La carpeta `/docs` en la raíz de este proyecto no es un repositorio estático, sino la **Fuente de Verdad (Single Source of Truth)** de la arquitectura técnico-científica de la plataforma. Para garantizar que el conocimiento no se pierda y que el sistema siga siendo mantenible, se establecen las siguientes reglas obligatorias:

---

## ⚖️ Regla de Oro
> **"Si no está documentado en `/docs`, no existe oficialmente para el sistema ÓrbitA."**

Toda modificación funcional, estructural o de seguridad que se realice en el código fuente **DEBE** ir acompañada de su correspondiente actualización en la documentación.

---

## 📋 Protocolo de Actualización Obligatoria

1.  **Cambios Estructurales**: Si se añade un nuevo paquete Java o directorio en `src`, debe actualizarse **`ESTRUCTURA_PROYECTO.md`**.
2.  **Cambios en Seguridad/RBAC**: Si se modifica un rol, se añade una autoridad o se cambia la restricción de una ruta, debe actualizarse **`SEGURIDAD_Y_ROLES.md`** y validarse contra la Matriz Oficial.
3.  **Nuevos Módulos**: Cada vez que se incorpore una nueva aplicación al ecosistema, debe listarse en **`MODULOS_DEL_SISTEMA.md`** con su propósito y alcance.
4.  **Actualización de Vistas**: Al crear una nueva página o modificar sustancialmente las funciones de una existente, debe actualizarse **`PAGINAS_Y_FUNCIONES.md`**.
5.  **Refactorización MVC**: Si cambia el flujo de cómo se solicitan o renderizan las vistas, debe actualizarse **`MVC_Y_FLUJO_DE_VISTAS.md`**.
6.  **Seguridad de Acceso (Login)**: Cualquier modificación en el flujo del login corporativo (Google Auth, validaciones, redirecciones) **DEBE** documentarse en los tres archivos principales de la carpeta `/docs` antes de considerarse exitosa.
7.  **Identidad Visual**: Cualquier reajuste estético en la pantalla de login, el sidebar o el navbar institucional **DEBE** actualizarse en **`IDENTIDAD_VISUAL.md`**, **`LOGIN_Y_ACCESO_INSTITUCIONAL.md`** o **`LAYOUT_INSTITUCIONAL.md`** antes de darse por finalizado.
8.  **Regla de Oro - Alto Costo**: Bajo NINGUNA circunstancia se puede reformatear el script `altocosto.js` de forma que afecte las estructuras de datos (VARs) o el orden de las columnas de exportación TXT. Cualquier interacción con el DOM de este módulo DEBE realizarse mediante los helpers `$safeGet` y `$safeAction` para garantizar la estabilidad sin comprometer la lógica rígida institucional.
9.  **Interoperabilidad (Firebase Shim)**: Cualquier ajuste en `firebase-shim.js` debe mantener la compatibilidad de firmas con el SDK modular de Firebase (v9+). En particular, funciones de escucha como `onAuthStateChanged` deben utilizar validaciones de tipo para soportar tanto parámetros únicos (callback) como parámetros duales (auth, callback), evitando regresiones en la inicialización de módulos robustos.

---

## ✅ 10. Definition of Done (Criterios de Cierre)

Ningún ajuste se considera finalizado si no cumple estrictamente con este checklist:

1.  **Validación en Despliegue**: Los assets (CSS, JS, Imágenes) se cargan correctamente utilizando rutas relativas de Thymeleaf (`th:src`, `th:href`).
2.  **Layout Intacto**: El Sidebar, Navbar y Logo institucional mantienen su estética original sin rupturas.
3.  **Matriz de Roles**: El usuario ve (y NO ve) exactamente lo definido en su perfil según la matriz de `SEGURIDAD_Y_ROLES.md`.
4.  **Seguridad de Navegación**: Se valida que el acceso directo por URL a rutas no autorizadas esté bloqueado.
5.  **No Regresión**: Se verifica que los módulos críticos (Login, Home, Alto Costo) sigan operando correctamente tras el ajuste.
6.  **Documentación**: Todos los cambios quedan registrados y descritos en la carpeta `/docs`.

---

## 🛠️ Calidad de Documentación

*   **Vigor**: La documentación debe mantenerse viva y sincronizada. No se permiten documentos obsoletos.
*   **Claridad**: Debe estar escrita en lenguaje técnico pero accesible para cualquier desarrollador que se incorpore al equipo.
*   **Formato**: Se debe utilizar Markdown estándar, aprovechando las capacidades de estructuración (tablas, listas, bloques de código, alertas de importancia).
*   **Ubicación**: La carpeta `/docs` **JAMÁS** debe ser movida de la raíz del proyecto.

---

Cualquier desarrollador que intervenga en el sistema asume la responsabilidad de ser guardián de esta documentación. La persistencia del conocimiento es tan importante como la persistencia de los datos en base de datos.

---

## 📝 Registro de Intervenciones Críticas (Auditoría)

### Caso: Restauración de "Cargar Datos" en Estadística Diaria (Abril 2026)

1. **Documentos leídos antes de intervenir**: Toda la carpeta `/docs`, con lectura especial de `PAGINAS_Y_FUNCIONES.md`, `MODULOS_DEL_SISTEMA.md`, `SEGURIDAD_Y_ROLES.md`, `ARQUITECTURA_PROYECTO.md`, y el presente documento (Reglas).
2. **Causa del problema**: El botón `btnAbrirCarga` no se mostraba porque el archivo JavaScript dependía del objeto obsoleto `window.OrbitaContext` que ya no se provee. Adicionalmente, existía una discrepancia entre mayúsculas y minúsculas (`'Master Admin'` vs el estandarizado `'master admin'`), y una capa débil de seguridad (botón sin protección en el servidor). Todo esto causaba un ciclo infinito (`setTimeout` infinito esperando que se definiera ese contexto antiguo), evitando que la UI terminara de inicializarse.
3. **Archivos revisados**: 
    - `estadistica_diaria.html` (Thymeleaf/Layout)
    - `estadistica-diaria.js` (Lógica de inicialización)
    - `layout.html` (Carga global de estado `window.orbitaUser`).
4. **Archivos modificados**: 
    - `estadistica-diaria.js`: Para enlazar de forma reactiva al objeto moderno `window.orbitaUser`.
    - `estadistica_diaria.html`: Para inyectar seguridad dura nativa.
    - Documentos en `/docs`: `PAGINAS_Y_FUNCIONES.md`, `MODULOS_DEL_SISTEMA.md`, `SEGURIDAD_Y_ROLES.md` y `REGLAS_DE_DOCUMENTACION.md`.
5. **Cómo se restauró la visibilidad**: En `estadistica-diaria.js`, se cambió la lógica de `inicializarVistaSegunRol` para que evalúe `window.orbitaUser.role.toLowerCase()` en vez del contexto antiguo. Adicionalmente, en `estadistica_diaria.html`, se aplicó el atributo de Thymeleaf `sec:authorize="hasAnyAuthority('master admin', 'super admin')"` para impedir el renderizado general y proteger de manipulación en navegador de usuarios rasos.
6. **Verificación de funcionalidad real**: A nivel de JavaScript, si `rol === 'master admin' || rol === 'super admin'`, el bloque aplica `btnAbrir.style.display = 'flex'` y carga el Listener para inyectar la animación y el modal, respetando la estructura del flujo preexistente.
7. **Verificación visual y lógica inalteradas**: Las clases de CSS se mantienen con el prefijo heredado, ninguna alerta o estilo se reescribió, y ambos módulos siguen apuntando estrictamente al HTML base, usando "lucide.createIcons()" tras inyectar la tabla.
8. **Verificación Spring Boot + Thymeleaf + despliegue**: Al incrustar `sec:authorize`, la renderización se bloquea directamente desde la invocación del contexto de seguridad de Spring (despliegue local o full deployment). Al estar Thymeleaf y las propiedades JS integrando a `window.orbitaUser`, este mapeo no recaba sobre funciones externas y no rompe bajo condiciones de red lentas o Firebase estático.

### Caso: Reubicación de "Ver Ocultos" y Restricción de Analista en Alto Costo (Abril 2026)

1. **Objetivo**: Mover el control "Ver Ocultos" de la franja de filtros de fecha al panel de "Administración y Flujo de Datos", restringiendo su uso a roles administrativos.
2. **Causa del problema**: Presencia de controles duplicados y fuera de lugar (interruptor en barra de filtros), lo que confundía a los usuarios y violaba la jerarquía visual del módulo. Adicionalmente, se detectó que el rol `analista` tenía acceso a exportaciones de Excel que debían ser exclusivas de roles superiores.
3. **Archivos modificados**: 
    - `altocosto.html`: Se eliminó el interruptor de los filtros superiores. Se agregaron etiquetas `sec:authorize` a los botones de Importación, SISCAD XL, Productividad y Ver Ocultos.
    - `altocosto.js`: Se refactorizó `aplicarPermisos` para ocultar programáticamente estos botones según el rol y se reescribió `window.toggleMostrarOcultos` como un toggle de botón con feedback visual (cambio de color/texto).
4. **Respeto a la Regla de Oro**: No se alteró la lógica de clasificación de pacientes ni la estructura del TXT. Se mantuvieron los helpers `$safeGet` y se respetó la visualización de la tabla.
5. **Resultado UAT**: Master/Super Admin ven el botón "Ver Ocultos" en el panel azul. Al activarlo, el botón cambia de color y muestra solo registros ocultos. El Analista solo ve el botón "TXT" en dicho panel. La barra de filtros (Año/Mes) queda limpia de interruptores.


### Caso: Corrección Quirúrgica de Cabezales SISCAD en Alto Costo (Marzo-Abril 2026)

1. **Objetivo**: Corregir 7 encabezados exactos en el archivo TXT de Cáncer para que coincidan con la plantilla oficial de SISCAD (incluyendo errores tipográficos obligatorios).
2. **Documentos leídos**: `/docs/ALTO_COSTO_REGULACION.md`, `/docs/PAGINAS_Y_FUNCIONES.md`, `/docs/SEGURIDAD_Y_ROLES.md`, `/docs/ARQUITECTURA_PROYECTO.md`, y el presente documento (Reglas).
3. **Archivo modificado**: `altocosto.js`.
4. **Respeto a la Sacralidad**: El ajuste se realizó estrictamente dentro de la función `exportarSISCAD`, mapeando las claves internas a sus versiones "oficiales" (con errores tipográficos) solo para la generación del cabezal en el TXT final. 
5. **No Regresión**: No se alteraron los nombres de las variables en los objetos `VARS_CANCER`, `OBLIG_CANCER`, ni en Firestore. Esto garantiza que la lógica de validación, persistencia y la exportación a **Excel** permanezcan intactas y funcionales.
6. **Encabezados Corregidos**:
    - `VAR16_FechaAiliacionEPSRegistra` (Ailiacion)
    - `VAR28_GradoDiferenciacionTumorAolidoMaligno` (Aolido)
    - `VAR48_UbicacionTtemporalPrimerCicloRelacionOncologico` (Ttemporal)
    - `VAR85_EstadoVitalFinalizarUnicaOltimaCirugia` (Oltima)
    - `VAR106_RecibioUsuarioTtrasplanteCelulasProgenitoras` (Ttrasplante)
    - `VAR123_UusuarioRecibioSoporteNutricional` (Uusuario)
    - `VAR130_FechaDesafiliaciIonEPS` (DesafiliaciIon)

### Caso: Validación Estructural TXT Hemofilia (Marzo-Abril 2026)

1. **Objetivo**: Verificar la integridad del archivo TXT de Hemofilia frente a la plantilla oficial de SISCAD.
2. **Conclusión de la Auditoría**: Se comparó el TXT generado por el sistema con la plantilla oficial y se confirmó que la estructura de encabezados, el orden de las columnas y el formato general coinciden al 100%.
3. **Acción**: No se realizaron ajustes en la lógica de exportación de Hemofilia, ya que la estructura actual es correcta y plenamente compatible.
4. **Directriz Futura**: Se prohíbe cualquier refactorización o "normalización" de los encabezados de Hemofilia que altere esta estructura validada, para prevenir regresiones en la carga de datos institucional.

### Caso: Motor SISCAD v2026 y Falsos Positivos de Validación (Marzo 2026)

1. **Objetivo**: Corregir el error de "variables obligatorias faltantes" que bloqueaba el guardado de fichas válidas y alinear el motor de reglas con la versión oficial 2026.
2. **Diagnóstico**: Se identificó que `validarFormulario` marcaba indiscriminadamente como `required-empty` cualquier campo vacío del formulario, sin verificar si la variable era realmente obligatoria para la cohorte seleccionada (`OBLIG_CANCER` u `OBLIG_HEMO`).
3. **Acciones Realizadas**:
   - **Alineación del Motor**: Se reemplazó la función `validateSiscadRules` por la versión oficial v2026, que incluye autodetección de leucemias, validaciones de coherencia diagnóstica y periodos de vigencia actualizados (2025-2026).
   - **Regla de Oro (Validación de Vacíos)**: La función `validarFormulario` en `altocosto.js` debe obligatoriamente cruzar el ID de la variable con los arrays `OBLIG_CANCER` o `OBLIG_HEMO` antes de marcar un campo como `required-empty`. Esta función se limita **exclusivamente** a detectar campos obligatorios que realmente estén vacíos o con el placeholder "OBLIGATORIO". Cualquier otra inconsistencia de datos (ej. incoherencias de fecha, códigos prohibidos como C80X) debe ser gestionada por el motor SISCAD como un "Error de Consistencia".
   - **Limpieza de Estados**: Se garantizó que el motor `enforce()` limpie cualquier marca de error previo al fijar valores automáticos o especiales (98, 1845, 1800).
4. **Resultado**: Reducción del 100% de los falsos positivos reportados, manteniendo la integridad de las reglas clínicas nacionales.

### Caso: Restauración de Campos Azules como Bloqueantes (Marzo 2026)

1. **Objetivo**: Restablecer el carácter obligatorio de los campos azules (datos volátiles) para la habilitación del botón de guardado final.
2. **Causa del problema**: Tras la corrección de los falsos positivos de hidratación, el sistema permitía guardar fichas que contenían datos precargados de periodos anteriores sin que el analista realizara la verificación manual obligatoria (reescritura).
3. **Archivos modificados**:
   - `altocosto.js`: Se actualizó `ejecutarAuditoriaVisual` para incluir `nombresPorConfirmar.length` en el cálculo de `totalErroresQueBloquean`. Se eliminó una definición duplicada de `validarFormulario` y se sincronizó el `.onclick` de `btnGuardar` para interceptar intentos de guardado con azules pendientes.
4. **Regla Técnica Aplicada**:
   - `Rojo` = Error/Vacío obligatorio -> Bloquea.
   - `Azul` = Precargado sin confirmar -> Bloquea.
   - El botón solo se habilita (`disabled = false`) cuando `Rojos + Azules === 0`.
5. **Resultado**: El sistema garantiza que ningún dato histórico sea aceptado en el periodo actual sin la revisión explícita del analista, cumpliendo con los estándares de calidad del Departamento de Coordinación Científica.

### Caso: Separación de Secciones en Auditoría Visual y Regla C80X (Marzo 2026)

1. **Documentos leídos**: Todos los de la carpeta `/docs`, especialmente `ALTO_COSTO_REGULACION.md`.
2. **Problema**: La sección "CAMPOS REQUERIDOS" mezclaba campos vacíos con errores de consistencia y se reportó que no debía incluir campos que ya tuvieran dato (como el código C80X en VAR17).
3. **Archivos modificados**: `altocosto.js` y documentos en `/docs`.
4. **Resumen de la corrección**:
   - Se simplificó `validarFormulario` para que solo asigne la clase `required-empty` a campos realmente vacíos de la lista obligatoria.
   - Se movió la validación de `C80X` (Cáncer VAR17) de la validación general al motor SISCAD (`validateSiscadRules`) como un `marcarErrorDuro`.
   - Se dividió la pantalla de auditoría visual en secciones independientes: **🔴 CAMPOS REQUERIDOS** (vacíos reales), **🔴 ERRORES DE CONSISTENCIA** (incoherencias detectadas por el motor), **🔵 CONFIRMAR DATOS** (azules/volátiles) y **🟠 AUTOCORRECCIONES**.
5. **Resultado**: La interfaz de usuario es ahora más clara y precisa, listando cada incidencia en su categoría correspondiente y manteniendo el bloqueo del botón de guardado mientras existan elementos en rojo o azul.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
