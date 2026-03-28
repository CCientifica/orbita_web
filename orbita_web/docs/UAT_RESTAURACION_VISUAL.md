# 📜 Documentación de Cambios: Restauración de Integridad Visual

Este documento detalla las acciones realizadas para restaurar el **Shell Institucional** (Sidebar y Navbar) del proyecto ÓrbitA, asegurando plena compatibilidad entre el motor de plantillas **Thymeleaf (Spring Boot)** y el alojamiento estático **Firebase Hosting**.

---

## 🛠️ 1. Diagnóstico de la Incidencia
Se detectó que la visualización del Navbar y Sidebar era nula o inconsistente en varios módulos del sistema debido a:
- **Conflictos de Resolución**: Llamadas recursivas o mal formadas a los fragmentos dentro de `layout.html`.
- **Desbordamiento de Estilos**: Bloques de CSS incrustados con errores de sintaxis (etiquetas anidadas) que bloqueaban el procesamiento de estilos del Shell.
- **Inconsistencia en Carga de Assets**: Ausencia de variables de respaldo para el ancho del sidebar en entornos de carga lenta.

---

## 🔧 2. Cambios Implementados

### A. Estandarización de `layout.html`
- **Fragmentos Relativos**: Se reemplazó la sintaxis `~{layout :: fragment}` por `~{this :: fragment}` dentro del propio archivo `layout.html` para mejorar la eficiencia del motor Thymeleaf.
- **Refactorización CSS**:
    - Se centralizaron las variables `--sidebar-width` (280px) y `--navbar-height` (64px) en el bloque `:root`.
    - Se aseguró que `.dashboard-layout` y `.content-wrapper` utilicen estas variables de forma dinámica.
- **Saneamiento de Scripts**: Se refinó el fragmento `ui-scripts` para asegurar que el modal de perfil y los scripts de Firebase se carguen en el orden correcto.

### B. Restauración de Shell en Firebase Hosting (v1.5)
**Problema**: El Shell Institucional (Navbar/Sidebar) desaparecía o se veía roto (sin CSS) en Firebase Hosting.
**Diagnóstico Reconstruido**:
1.  **Omisión de Fallbacks Nativos**: Las páginas (home, altocosto, etc.) usaban exclusivamente `th:href` y `th:src` en el `<head>`. Al ser una plataforma estática, el navegador ignoraba estas etiquetas y no cargaba ni el CSS (`styles.css`) ni el script puente (`orbita-layout-bridge.js`).
2.  **Fallo de Inyección**: El puente v1.3 dependía de que el CSS estuviera cargado para renderizar correctamente el layout visual. Sin CSS, el renderizado fallaba.
3.  **Rutas de Fragments**: Los fragmentos `layout.html` ahora incluyen fallbacks nativos absolutos (`/assets/...`, `/styles.css`) para funcionamiento inmediato.

**Acciones de Corrección**:
- **Estandarización de Heads**: Se actualizaron todos los puntos de entrada para proveer un `<head>` compatible con entornos estáticos:
  ```html
  <head th:replace="layout :: header('Título')">
      <link rel="stylesheet" href="/styles.css">
      <script src="/js/orbita-layout-bridge.js"></script>
  </head>
  ```
- **Bridge v1.5**: Se optimizó la inyección de fragmentos usando `innerHTML` y se añadió traducción recursiva de atributos para todos los elementos inyectados.
- **Navegación**: Se verificó la consistencia de los enlaces del sidebar con las reglas de `firebase.json` (`cleanUrls: true`).

---

## 🚀 3. Validación de No Regresión
| Prueba | Resultado |
| :--- | :--- |
| **Visibilidad Sidebar** | ✅ Fijo a la izquierda (280px). |
| **Visibilidad Navbar** | ✅ Barra superior con título dinámico. |
| **Navegación Móvil** | ✅ Hamburger menu activa/desactiva correctamente. |
| **Estilos CSS Fallback** | ✅ Aplicados correctamente sin dependencias externas. |
| **Respuesta del Servidor** | ✅ Renderizado SSR fluido sin errores 500. |

---

## 🎨 5. Corrección de Identidad Visual: Badge MASTER ADMIN (v1.6)

**Fecha**: 2026-03-27
**Documentos Consultados**: `IDENTIDAD_VISUAL.md`, `LAYOUT_INSTITUCIONAL.md`, `SEGURIDAD_Y_ROLES.md`.
**Error Detectado**: El badge del rol **MASTER ADMIN** se visualizaba en **Azul** (estilo por defecto) en el entorno de Firebase, en lugar de su **Rojo/Rose Institucional**.

**Diagnóstico Técnico**:
- **Alcance del Estilo**: Los estilos específicos de los roles estaban definidos dentro de una etiqueta `<style>` en `layout.html`. 
- **Fallo en Static**: En Firebase Hosting, las páginas inyectadas mediante el bridge SÓLO cargan `styles.css`. No heredaban los estilos internos de `layout.html`, por lo que el badge caía al estilo genérico azul.
- **Inconsistencia**: `user-ui.js` tenía un mapeo local a Slate-900 que no correspondía a la identidad visual de "Alta Visibilidad" (Rojo) requerida para este rol superior.

**Acciones Tomadas**:
1.  **Consolidación Global**: Se trasladaron todas las definiciones de color institucional por rol (`role-master`, `role-super`, etc.) al archivo central `styles.css`.
2.  **Sincronización Funcional**: Se actualizó `user-ui.js` para usar `#ef4444` (Rojo Maestro) de forma consistente.
3.  **Paridad Total**: Se verificó que tanto en Local (Spring) como en Firebase, el badge se renderice en Rojo al detectar la cadena "master admin" (insensible a mayúsculas).

**Estado Final**: ✅ MASTER ADMIN es institucionalmente ROJO en todos los entornos.
