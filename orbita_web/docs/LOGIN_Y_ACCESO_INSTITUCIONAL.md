# 🔐 Login y Acceso Institucional - ÓrbitA

Este documento define la **apariencia oficial** y la **lógica técnica** de la pantalla de acceso institucional. Cualquier cambio en esta vista debe respetar estrictamente esta referencia.

---

## 🎨 Identidad Visual del Login

El login de ÓrbitA utiliza una estructura de **dos columnas** con estética premium e institucional.

### 1. Panel Izquierdo: Branding Institucional (Impacto)
*   **Fondo**: Utiliza obligatoriamente `/assets/app-bg.png` con un degradado Navy (`rgba(15, 23, 42, 0.45)`) para asegurar legibilidad.
*   **Branding**: Título **"Orbita Clínica"** de gran tamaño y badge superior **"Ecosistema Técnico-Científico"** en color Blue.
*   **Descripción**: Texto descriptivo corto sobre la excelencia en el cuidado de la salud.
*   **Footer**: Logo de **Supersalud** alineado a la parte inferior izquierda.

### 2. Panel Derecho: Acceso (Limpio)
*   **Diseño**: Fondo blanco (`#ffffff`) con bordes redondeados hacia la izquierda (`border-radius: 120px`) para dar fluidez.
*   **Branding**: Logo de **Clínica Sagrado Corazón** como elemento central superior.
*   **Contenido**: Título "Acceso Institucional" con subtítulo descriptivo corporativo.
*   **Botón de Acceso**: **Botón único** de "Continuar con Google Workspace", tipo píldora, con borde sutil y sombra suave.

---

## 🏗️ Regla Visual Obligatoria

> **Este diseño es la Referencia Oficial de Inicio/Login. No debe cambiarse arbitrariamente para ajustarse a tendencias temporales o estilos individuales de módulos.**

---

## 🛡️ Regla Funcional Oficial

Para mantener la integridad del sistema, se prohíben flujos alternativos:

1.  **NO existe usuario/contraseña manual**: El sistema no tiene campos de texto para credenciales locales.
2.  **NO existe registro público**: Los usuarios son autorizados por la Coordinación Científica en Firestore.
3.  **Acceso Único**: Solo se permite mediante **Google Workspace Institucional**.
4.  **Flujo Obligatorio**:
    *   **Popup Real**: Debe abrir la ventana original de Google (no simulada ni bypass).
    *   **Dominio**: Solo se permite el ingreso con `@clinicasagradocorazon.com.co`.
    *   **Autorización**: Se valida el correo en la colección `usuarios_permitidos` en Firestore.
    *   **Roles**: El rol se asigna basándose en la autorización previa (ej. `coordcientifico@...` = `master admin`).

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
