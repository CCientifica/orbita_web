# 📄 Páginas y Funciones - ÓrbitA

Este documento proporciona una descripción detallada de la interfaz de ÓrbitA, permitiendo un entendimiento profundo de la operatividad de cada vista según el rol del usuario institucional.

---

## 1. 🏠 Página Principal (Home)
*   **Nombre**: Inicio / Hub de Monitoreo del Ecosistema.
*   **Ruta**: `/home` (Vista: `home.html`).
*   **Objetivo Funcional**: Punto de entrada centralizado y **Centro de Control Operacional**. Presenta las capacidades del sistema organizadas modularmente por dominios (Gestión, Analítica, Predicción).

---

## 2. 🔑 Página de Acceso (Login Institucional)
*   **Nombre**: Acceso Institucional.
*   **Ruta**: `/login` (Vista: `login.html`).
*   **Objetivo Funcional**: Puerta de seguridad para autenticar la identidad del usuario mediante credenciales corporativas (Google Auth). Solo se permite el dominio `@clinicasagradocorazon.com.co`.

---

## 3. 👥 Gestión de Usuarios
*   **Nombre**: Administración de Usuarios y Facultades.
*   **Ruta**: `/usuarios` (Vista: `usuarios.html`).
*   **Acceso**: **Exclusivo para `master admin`**.

---

## 4. 🚑 Alto Costo (Programa CAC)
*   **Nombre**: Seguimiento Alto Costo.
*   **Ruta**: `/altocosto` (Vista: `altocosto.html`).
*   **Gestión de Datos**: Sincronización en tiempo real con Firestore y lógica determinista de clasificación Nuevo vs Antiguo.

---

## 5. 🏥 Gestión CTC (Módulos Independientes)

El área de Gestión CTC se divide en dos herramientas estratégicas complementarias pero funcionalmente **independientes**:

### A. Cronograma Institucional GPC
*   **Vista**: `cronograma-gpc.html` (Ruta: `/cronograma-gpc`).
*   **Objetivo**: Gestión del inventario y planificación de la actualización de Guías y Protocolos.
*   **Estructura de Trabajo**:
    1.  **01. Inventario GPC**: Maestro de documentos vigentes con control de última versión, ajustes y descartes.
    2.  **02. Planificación Anual**: Cronograma dinámico de acciones (Crear/Actualizar) distribuidas por meses fiscales.
    3.  **03. Seguimiento Mensual**: Monitor de carga de evidencias y cumplimiento de la planificación.
*   **Aesthetics**: **Advanced Glassmorphism** con sistema de tarjetas flotantes (Card-based UI).

### B. Plan Anual de Auditoría (Estrategia de Adherencia)
*   **Vista**: `plan-anual-gpc.html` (Ruta: `/plan-anual-gpc`).
*   **Objetivo**: Monitoreo dinámico del cumplimiento y adherencia clínica a las estrategias institucionales.
*   **Funcionalidades**:
    *   **Dashboard de Adherencia**: Visualización del % observado y estado de cumplimiento.
    *   **Centro de Auditoría**: Ejecución de auditorías de campo con cálculo de indicadores en tiempo real.
    *   **Semaforización**: Clasificación automática (Óptima, En Evaluación, Crítica).
*   **Acceso**: **Exclusivo para `master admin`**.

---

## 6. 🔮 Predictor LOS (IA)
*   **Nombre**: Predicción de Estancia (Length of Stay).
*   **Ruta**: `/predictor-los` (Vista: `predictor-los.html`).

---

## 7. 📊 Estadística Diaria
*   **Nombre**: KPIs Diarios.
*   **Ruta**: `/estadistica-diaria` (Vista: `estadistica_diaria.html`).
*   **Estructura**: Cuatro grillas ejecutivas con Inteligencia Analítica de Periodo (DoD/WoW) y proyecciones de cierre.

---

## 8. 👤 Gestión de Perfil (Navbar)
*   **Acciones**: Personalización de Nombre Institucional y Avatar (DiceBear Adventurer Neutral).

---

## 9. 🔌 Infraestructura Firebase Shim
*   **Objetivo**: Garantizar la interoperabilidad entre el SDK de Firebase (Multi-versión) y la lógica de negocio mediante el puente de compatibilidad `firebase-shim.js`.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
