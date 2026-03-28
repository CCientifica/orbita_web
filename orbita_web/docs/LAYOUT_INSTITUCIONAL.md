# 📑 Layout Institucional - Sidebar y Navbar

Este documento describe la estructura visual oficial del **Sidebar** y el **Navbar** de ÓrbitA. Estos dos componentes forman el **Layout Base** del sistema y deben ser consistentes en cada una de las páginas.

---

## 🏛️ Sidebar Institucional (Columna Vertebral)

El Sidebar es una columna fija a la izquierda con fondo Navy (`#1e293b`) que organiza la navegación modular del sistema.

### 1. Elementos Base
*   **Branding Superior**: Logo blanco de **Clínica Sagrado Corazón** (75px) con el título **"Orbita Clínica"** en peso 800 y tag inferior **"Ecosistema Científico"**.
*   **Enlace Principal**: Botón de "Panel Principal" (`/home`) siempre en la parte superior.
*   **Navegación Modular**: Agrupación lógica de módulos (**Gestión CTC**, **Programas**, **Ecosistema Digital** (incluyendo RCF), **Análisis de Datos**).
*   **Reglas de Visibilidad**: Implementa la **Matriz de Roles** (ej. solo el `master admin` ve "Usuarios" y "Gestión CTC").

### 2. Comportamiento Responsive
*   **Escritorio**: Ancho fijo de **280px**.
*   **Móvil/Tablet**: Se oculta mediante `translate-x(-100%)` y se activa con el botón "Hamburger" del Navbar.

### ⚠️ Regla Estructural (Sidebar):
> **No debe ser reconstruido localmente en cada página. Debe heredarse desde el fragmento oficial `th:fragment="sidebar"` en `layout.html`.**

---

## 🧭 Navbar Institucional (Contexto y Usuario)

El Navbar es una barra fija superior con estética limpia y minimalista.

### 1. Elementos Base
*   **Panel Izquierdo**: Botón "Hamburger" (solo móvil) seguido del **Título de la Página** con tipografía Outfit (1.15rem, peso 800).
*   **Status de Conexión**: Indicación visual del estado del servidor ("● SERVIDOR ONLINE").
*   **Panel Derecho (Acciones)**:
    *   Campana de notificaciones con punto de alerta dinámico.
    *   **Área de Usuario**: Correo institucional visible y **Badge de Rol** (ej. `MASTER ADMIN` en color Rose para alta visibilidad).
    *   **Avatar Interactivo**: Círculo con iniciales y gradiente Blue/Indigo que despliega el menú de perfil y cierre de sesión.

---
	
	## 👤 Modal de Perfil (Autogestión)
	
	El **Profile Modal** es un componente dinámico centralizado en `layout.html` que permite la edición de la identidad visual.
	
	### 1. Diseño y Estructura
	*   **Proporción Horizontal**: Diseñado con un ancho máximo de **820px** para aprovechar el espacio horizontal en pantallas de escritorio.
	*   **Grid de Dos Columnas**:
	    *   **Columna Izquierda**: Datos de contacto (Correo ID, Nombre, Teléfono/Extensión).
	    *   **Columna Derecha**: Cuadrícula de 20 semillas Adventurer Neutral (`avatar-picker`).
	*   **Responsividad**: En dispositivos móviles (`<768px`), el grid colapsa a una sola columna vertical.
	*   **Accesibilidad de Acción**: El cuerpo del modal implementa `overflow-y: auto` y altura máxima relativa (`90vh`), garantizando que los botones de guardado del **Footer** sean siempre visibles y utilizables en laptops o resoluciones bajas sin necesidad de zoom.
	*   **Estética**: Utiliza desenfoque de fondo (`backdrop-filter: blur(4px)`) sobre el overlay para centrar la atención del usuario.

## ⚖️ Regla Estructural Global

> **El Sidebar y el Navbar son componentes base del sistema y constituyen su shell institucional. Cualquier cambio visual sobre estos debe justificarse y documentarse en este archivo.**

---

## 🚦 Protocolo de No Regresión Visual

Para evitar que un cambio en un módulo rompa la integridad del layout, se debe verificar:
1.  **Resolución de Assets**: Comprobar que el Logo Institucional se vea en todas las rutas (uso de `th:src="@{/assets/logo.png}"`).
2.  **Badge de Rol**: El color y texto del badge en el Navbar debe coincidir con el rol autenticado (ej. Rose para `MASTER ADMIN`).
3.  **Avatar Dinámico**: El avatar debe cargar la semilla correcta desde Firestore.
4.  **Colapsibilidad**: Verificar que el Sidebar se oculte correctamente en dispositivos móviles y no deje huecos visuales.
5.  **Indicador de Servidor**: El punto "SERVER ONLINE" debe estar presente y alineado.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
