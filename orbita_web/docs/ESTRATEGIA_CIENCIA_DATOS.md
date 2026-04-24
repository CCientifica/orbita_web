# 📊 Observatorio Analítico ÓrbitA: Estrategia de Ciencia de Datos

Este documento define la arquitectura de las variables derivadas y los modelos de score para transformar los registros de Alto Costo (CAC) en activos de decisión clínica y operativa.

## 1. Segmentación de Cohortes (Isolación Lógica)
Aunque ambos pertenecen a Alto Costo, sus motores de inteligencia son independientes:

### 🎗️ Sub-Sistema Cáncer
*   **Variables Críticas**: Estadificación, Fecha Diagnóstico, Fecha Tratamiento, IPS participante.
*   **Enfoque**: Oportunidad de ruta y complejidad terapéutica (Sistémico/Quirúrgico/RT).

### 🩸 Sub-Sistema Hemofilia
*   **Variables Críticas**: Factor empleado, profilaxis, eventos de sangrado, artropatía.
*   **Enfoque**: Adherencia al tratamiento y prevención de daño articular (Desenlace Clínico).

---

## 2. Modelos de Score (Fase 1: Madurez y Confiabilidad)

### 📈 A. Score de Madurez del Registro (SMR)
**Propósito:** Cuantificar qué tan "terminada" está la ficha de un paciente.
*   **Completitud**: % de variables obligatorias diligenciadas.
*   **Rigurosidad**: % de variables sin comodines (999, 1999, desconocido permitido).
*   **Coherencia**: Validación cruzada de fechas y lógica clínica.

### 🔍 B. Índice de Confiabilidad Analítica (ICA)
**Propósito:** Decidir si un registro puede ser usado para proyecciones reales.
- **Elegibilidad**: Un paciente inmaduro puede servir para contar "Volumen", pero NO para promediar "Oportunidad". Esto evita que los datos incompletos ensucien tus promedios institucionales.

---

## 3. Indicadores de Carga y Flujo (Fase 2: Complejidad y Ruta)

### 🧩 C. Índice de Complejidad Asistencial (ICA-IPS)
**Carga Operativa:** Pondera el esfuerzo de la IPS según la gravedad del paciente (Estadificación + Tratamiento + Soporte).

### 🌊 D. Radar de Continuidad de Ruta
**Cuellos de Botella:** Mide el tiempo exacto entre hitos (Hitos de 1 a 6) para identificar dónde se demora el flujo (Diagnóstico -> Tratamiento).

---

## 4. Alertas Tempranas y Navegación
*   **Alertas de Desviación:** Pacientes con diagnóstico pero sin inicio de tratamiento en ventana esperada.
*   **Alertas de Calidad:** Pacientes con demasiados comodines críticos que impiden el análisis.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
