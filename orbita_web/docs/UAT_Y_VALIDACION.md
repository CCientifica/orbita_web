# 📋 Matriz de Pruebas UAT y Protocolo de Validación — ÓrbitA

Este documento establece el marco oficial de **Aceptación del Usuario (UAT)** para la plataforma ÓrbitA. Ningún cambio, ajuste o despliegue se considera finalizado sin la ejecución y aprobación satisfactoria de los casos de prueba aquí definidos.

---

## 🎯 1. Objetivo de la Matriz
Garantizar la excelencia técnica, la integridad visual institucional y el cumplimiento estricto de la seguridad basada en roles (RBAC) en entornos de producción (Spring Boot + Thymeleaf), evitando regresiones y fallos de visualización en despliegue real.

## 🧭 2. Alcance
Cubre todos los módulos operativos documentados en `/docs`, incluyendo:
- Login Institucional, Home, Sidebar, Navbar y Modal de Perfil.
- Administración de Usuarios y Gestión CTC.
- Programas Críticos: Alto Costo y PorfirIA.
- Ecosistema Digital (RCF Médicos/Auxiliares, DashEco, AMS, ISA).
- Análisis de Datos: Consulta Cx, Imágenes DX, Estadística Diaria y Acumulado Mensual.
- Estancia Predictiva: Predictor LOS e Histórico LOS.

## ✅ 3. Definition of Done (Criterios de Cierre)
Un cambio solo se marca como "Terminado" si supera:
1.  **Prueba Local**: Funcionalidad correcta en entorno de desarrollo.
2.  **Prueba en Despliegue**: Los assets se resuelven mediante `th:src` y `th:href` (No rutas absolutas).
3.  **Prueba Visual**: El layout institucional (Sidebar/Navbar) permanece intacto.
4.  **Prueba por Rol**: El acceso y visibilidad coinciden con la Matriz de Seguridad oficial.
5.  **Prueba de URL Directa**: Las rutas restringidas bloquean el acceso al escribir la URL manualmente.
6.  **Prueba de No Regresión**: El ajuste no afecta la operatividad de módulos existentes.
7.  **Documentación**: Se actualizan los documentos correspondientes en `/docs`.

---

## 🛡️ 4. Matriz de Pruebas UAT (Instrumento de Validación)

Esta tabla está diseñada para ser copiada a Excel para su ejecución formal.

| ID | Módulo / Página | Rol | Objetivo | Precondiciones | Pasos | Resultado Esperado | Severidad | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UAT-01** | Login | Anónimo | Autenticación Segura | Estar fuera de sesión | 1. Clic en botón Google 2. Usar cuenta @clinicasagradocorazon.com.co | Abre Popup Real, valida dominio y redirige al dashboard con rol asignado. | Bloqueante | Pendiente |
| **UAT-02** | Login | Anónimo | Bloqueo Dominio Externo | Estar fuera de sesión | Intentar login con @gmail.com o similar | El sistema muestra alerta de error y prohíbe el acceso. | Alta | Pendiente |
| **UAT-03** | Sidebar | Analista | Visibilidad Restringida | Loguear como Analista | Observar opciones en Sidebar | Solo deben verse: Inicio y Alto Costo. GTC y Usuarios deben estar ocultos. | Crítica | Pendiente |
| **UAT-04** | Navbar | Todos | Identidad Visual (Badge) | Sesión iniciada | Observar el badge de rol junto al avatar | El color y texto del badge debe coincidir con el rol (Ej. Master=Rose, Super=Blue). | Media | Pendiente |
| **UAT-05** | Perfil | Todos | Persistencia Avatar | Sesión iniciada | 1. Abrir perfil 2. Cambiar semilla 3. Guardar | El avatar en Navbar y Sidebar se actualiza instantáneamente en el DOM. | Media | Pendiente |
| **UAT-06** | Usuarios | Super Admin | Bloqueo URL Directa | Sesión iniciada | Escribir manualmente `/usuarios` en la URL | Redirección automática a página 403 o Login (Acceso Denegado). | Crítica | Pendiente |
| **UAT-07** | Alto Costo | Analista | Restricción Botones | Estar en Alto Costo | Intentar ver botones de "Cargar Excel" u "Productividad" | Los botones no deben existir (eliminados vía `sec:authorize`). | Alta | Pendiente |
| **UAT-08** | Alto Costo | Todos | Formateo Humano | Estar en Ficha Paciente | Observar etiquetas de variables técnicas | Deben verse como `VAR# : Título` (Ej. Fecha de Ingreso) no pegadas. | Baja | Pendiente |
| **UAT-09** | Gestión CTC | Master Admin | Acceso Total GTC | Sesión iniciada | Acceder a `/cronogramagpc` | Acceso exitoso, visualización de planes anuales y cronogramas. | Alta | Pendiente |
| **UAT-10** | Predictivo | Auditor | Solo Lectura LOS | Estar en Predictor LOS | Intentar realizar cambios o cargas | Visualización de predicciones activa, pero sin opciones de modificación. | Alta | Pendiente |
| **UAT-11** | General | Todos | Resolución de Assets (WAR/JAR) | Entorno desplegado | Abrir cualquier página | Logo (CSS/JS) cargan sin errores 404. Verificable en consola F12. | Crítica | Pendiente |
| **UAT-12** | General | Todos | No Regresión Sidebar | Navegar entre módulos | Observar el sidebar al cambiar de página | El sidebar no parpadea ni desaparece; se mantiene estable durante el ruteo. | Crítica | Pendiente |

---

## 🛠️ 5. Bloques de Validación Específicos

### 📊 A. Validación de Despliegue Real
- **Assets**: Verificar que en el código fuente (F12) las rutas de imágenes y scripts comiencen por el context path generado por Thymeleaf (generalmente `/` o el contexto local).
- **Fragments**: Asegurar que Sidebar y Navbar provienen del fragmento `layout.html` y no son copias locales.
- **Filtros Spring**: Validar que las redirecciones de seguridad se ejecutan en el servidor antes del renderizado del cliente.

### 👤 B. Validación por Rol (UAT Detallado)
- **Master Admin**: Debe validar la sincronización dual (Firebase + Spring) al crear un usuario.
- **Analista**: Debe validar que el script `altocosto.js` inicializa correctamente su contexto sin errores de puntero nulo.
- **Auditores**: Deben validar que no tienen acceso a módulos de carga de datos clínicos (CAC/GTC).

### 🎨 C. Validación Visual Institucional
- **Login**: Fondo `app-bg.png` con gradiente Navy, bordes de 120px en el panel blanco, Logo oficial centrado.
- **Sidebar**: Fondo Navy `#1e293b`, iconos Lucide alineados, Tagline "Ecosistema Científico" presente.
- **Navbar**: Badge de rol vibrante, nombre del usuario proveniente de `@authentication`, estatus "SERVIDOR ONLINE" activo.

---

## ⚖️ 6. Criterios de Aceptación y Rechazo

- **Aceptación**: El 100% de las pruebas identificadas como "Crítica" o "Bloqueante" deben estar en estado **Aprobado**.
- **Rechazo**: Un solo fallo en la resolución de assets institucional (Logos rotos) o en el bloqueo de URL directa es motivo de rechazo inmediato de la versión.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
