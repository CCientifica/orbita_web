# 🎨 Identidad Visual Oficial - ÓrbitA

Este documento establece los lineamientos estéticos y de diseño oficiales del proyecto **ÓrbitA**. La coherencia visual es fundamental para proyectar la excelencia técnica y científica de la **Clínica Sagrado Corazón**.

---

## 🏛️ Principios Visuales Generales

1.  **Estética Premium**: El sistema debe sentirse como una herramienta de alta gama. Se utilizan sombras sutiles, bordes redondeados (12px a 24px) y tipografía moderna.
2.  **Enfoque Corporativo e Institucional**: Los colores deben ser sobrios (Navy, Slate, White) con acentos vibrantes solo en elementos de accion o estados (Blue, Emerald, Rose).
3.  **Apariencia Limpia (Clean Design)**: Se prioriza el espacio en blanco para reducir la carga cognitiva del personal médico y administrativo.
4.  **Consistencia entre Módulos**: No se permite la improvisación visual. Cada nuevo módulo debe heredar el layout, sidebar y navbar oficiales definidos en `layout.html`.

---

## 📐 Elementos Base (Intocables)

Existen tres componentes que constituyen la **Base Visual Oficial** del sistema y no deben rediseñarse ni reinterpretarse libremente:

1.  **Pantalla de Inicio / Login**: Reflejo de la identidad institucional y puerta de seguridad.
2.  **Sidebar Institucional**: Columna vertebral de la navegación modular.
3.  **Navbar Institucional**: Centro de información del usuario y contexto de navegación.

Cualquier propuesta de cambio sobre estos elementos debe ser justificada técnicamente, revisada y documentada en sus archivos específicos en `/docs`.

---

## 🎨 Paleta de Colores y Tipografía

*   **Color Primario (Navy)**: `#1e293b` (Sidebar, Títulos fuertes).
*   **Color de Acento (Blue)**: `#3b82f6` (Botones primarios, Enlaces activos).
*   **Fondos (Slate/White)**: `#f8fafc` (Fondo general), `#ffffff` (Tarjetas y Paneles).
*   **Tipografía**: **Inter** y **Outfit**. Son familias tipográficas modernas que garantizan legibilidad en entornos de gestión de datos.
*   **Identidad de Roles (Badges)**:
    *   **MASTER ADMIN**: `#ef4444` (Rojo/Rose - Alta Visibilidad).
    *   **SUPER ADMIN**: `#2563eb` (Azul Operativo).
    *   **ADMIN**: `#06b6d4` (Cyan Directivo).
    *   **ANALISTA**: `#f97316` (Naranja Técnico).
    *   **AUDITOR**: `#8b5cf6` (Violeta Auditoría).
*   **Identidad del Personal (Avatares)**: Se utiliza la biblioteca **DiceBear** para la representación visual de colaboradores. Para más detalles técnicos y el inventario oficial de semillas, consultar la guía de [AVATARES_Y_PERFILES.md](file:///c:/Users/coordcientifico/OneDrive%20-%20NUEVA%20CLINICA%20SAGRADO%20CORAZON/Escritorio/orbita_web%20%282%29/orbita_web/orbita_web/docs/AVATARES_Y_PERFILES.md).
*   **Tableros Administrativos**: Las tablas deben utilizar el estándar `table-modern` (definido en el módulo de usuarios) con encabezados en capitalización forzada, espaciado generoso y jerarquía clara mediante el uso de `Slate` para textos secundarios.
*   **Modo de Lectura Premium**: En formularios con alta densidad de datos técnicos (Ej: Alto Costo), las etiquetas deben ser presentadas en formato **Legible para Humanos** (Ej: `VAR1: Primer Nombre` en lugar de `VAR1_PrimerNombre`), manteniendo siempre la integridad de los identificadores técnicos subyacentes.

---

## ⚖️ Reglas de Validación Estética

> **Antes de cerrar un cambio, se debe verificar:**
1.  **Formateo Humano**: Las variables en modales técnicos (ej. Alto Costo) usan `formatLabelParaHumanos`.
2.  **Sombras y Bordes**: Los componentes usan las clases de sombras suaves y bordes redondeados oficiales.
3.  **Jerarquía de Textos**: Los títulos usan `Outfit` peso 800 y los cuerpos `Inter`.
4.  **Consistencia de Color**: No se han introducido colores fuera de la paleta oficial (Navy, Blue, Slate).

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
