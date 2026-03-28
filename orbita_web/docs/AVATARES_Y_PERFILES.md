# 👤 Gestión de Avatares e Identidad Visual (Adventurer Neutral)

Este documento detalla el estándar de representación visual de los colaboradores en el ecosistema **ÓrbitA**. Se ha implementado la colección **Adventurer Neutral** de DiceBear para ofrecer una estética moderna, minimalista y profesional.

---

## 🛠️ Tecnología de Generación
Se utiliza la API de **DiceBear (v7)** para la generación dinámica de gráficos vectoriales (SVG). El sistema consume el endpoint oficial:
`https://api.dicebear.com/7.x/adventurer-neutral/svg?seed=[seed]&backgroundColor=f1f5f9`

### 📦 Colección Principal
*   **Adventurer Neutral**: Estilo de caras geométricas con expresiones claras y amigables. Diseñado por Lisa Wischofsky.

---

## 🎨 Especificaciones Cromáticas
Para garantizar la integración con el diseño premium de ÓrbitA, se utiliza un fondo neutro:
*   **Fondo Institucional**: `#f1f5f9` (Slate 100). Proporciona un contraste suave y profesional.

---

## 📋 Inventario Oficial (20 Avatares)
El sistema incluye 20 semillas predefinidas para asegurar variedad en la asignación de perfiles:

| # | Semilla (Seed) | Colección | Descripción / Estilo |
| :--- | :--- | :--- | :--- |
| 1 | `Easton` | `adventurer-neutral` | Neutral / Base |
| 2 | `Eliza` | `adventurer-neutral` | Femenino / Sereno |
| 3 | `Riley` | `adventurer-neutral` | Juvenil / Dinámico |
| 4 | `Andrea` | `adventurer-neutral` | Profesional / Calma |
| 5 | `Liliana` | `adventurer-neutral` | Expresivo / Amigable |
| 6 | `Christian` | `adventurer-neutral` | Serio / Enfocado |
| 7 | `Brian` | `adventurer-neutral` | Enérgico / Sonriente |
| 8 | `Jameson` | `adventurer-neutral` | Analítico / Gafas |
| 9 | `Alexander` | `adventurer-neutral` | Ejecutivo |
| 10 | `Abigail` | `adventurer-neutral` | Creativo |
| 11 | `Angel` | `adventurer-neutral` | Gestor |
| 12 | `Bentley` | `adventurer-neutral` | Estratégico |
| 13 | `Brooklyn` | `adventurer-neutral` | Innovador |
| 14 | `Caleb` | `adventurer-neutral` | Técnico |
| 15 | `Claire` | `adventurer-neutral` | Operativo |
| 16 | `Daniel` | `adventurer-neutral` | Auditor |
| 17 | `Daisy` | `adventurer-neutral` | Soporte |
| 18 | `Ethan` | `adventurer-neutral` | Coordinación |
| 19 | `Evelin` | `adventurer-neutral` | Bienestar |
| 20 | `Finn` | `adventurer-neutral` | Logístico |

---

## 👤 Flujo de Autogestión (Perfil)
Los usuarios (independientemente de su rol) pueden gestionar su propia identidad visual desde el Navbar:
1.  **Acceso**: Clic en el avatar actual del Navbar para desplegar el menú y seleccionar **"Ver Perfil / Editar"**.
2.  **Interfaz**: Se abre un modal centralizado y **horizontal** (dos columnas) que carga la información del colaborador a la izquierda y el selector de avatares a la derecha.
3.  **Responsividad**: El modal ajusta su ancho dinámicamente (`max-width: 820px`) y utiliza un área de desplazamiento interna (`overflow-y: auto`) para garantizar que los botones de "Guardar Cambios" sean siempre visibles en pantallas de baja resolución (portátiles).
4.  **Selección**: Se presentan las 20 semillas oficiales (`Easton`, `Eliza`, etc.) en una cuadrícula optimizada.
5.  **Persistencia**: Al guardar, se actualiza el campo `avatar` en la colección `usuarios_permitidos` de Firestore.
6.  **Reflejo Inmediato**: El sistema actualiza dinámicamente el avatar del Navbar, el dropdown y el modal sin recargar la página.

## ⚖️ Reglas de Implementación
*   **Persistencia**: El valor almacenado en Firestore es la semilla (ej. `Easton`).
*   **Sincronización**: Al editar un usuario, el avatar se actualiza instantáneamente en la tabla/navbar mediante el flujo de sincronización de UI.
*   **Integridad**: El selector de avatares en `user-ui.js` y `profile-v2.js` debe mantener este orden para coincidir con la documentación.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
