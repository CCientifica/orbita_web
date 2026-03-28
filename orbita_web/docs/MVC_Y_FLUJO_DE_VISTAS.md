# 🔄 MVC y Flujo de Vistas - ÓrbitA

ÓrbitA utiliza el motor de plantillas **Thymeleaf** integrado con **Spring Boot** para renderizar interfaces dinámicas. Este documento explica cómo una petición del usuario se transforma en una página visual en el navegador.

## 🏁 Ciclo de Vida de una Petición (Request Lifecycle)

1.  **Entrada**: El navegador solicita una URL (p. ej., `/altocosto`).
2.  **Identificación**: Spring Security valida que el usuario esté autenticado y tenga la autoridad adecuada.
3.  **Controlador**: `PageController.java` mapea la ruta solicita.
    ```java
    @GetMapping("/altocosto")
    public String showAltoCosto(Model model) {
        // Lógica de negocio opcional (pre-poblado de combos o filtros)
        return "altocosto"; 
    }
    ```
4.  **Resolución**: Spring Boot busca el archivo `src/main/resources/templates/altocosto.html`.
5.  **Renderizado**: Thymeleaf procesa el archivo:
    *   Sustituye variables dinámicas (`${user.name}`).
    *   Incluye fragmentos compartidos (Navbar, Sidebar).
    *   Evalúa condiciones de seguridad (`sec:authorize`).
6.  **Salida**: El servidor genera un archivo HTML puro que se envía al cliente.

---

## 🏗️ Arquitectura de Vistas: Layout y Fragments

Para evitar duplicidad de código y asegurar la coherencia visual, ÓrbitA implementa una arquitectura basada en **fragmentos** dentro del archivo `layout.html`.

### Archivo Maestro: `layout.html`
Este archivo actúa como la "plantilla de plantillas". Contiene:
*   `header`: Definición de `<head>`, metadatos, CSS y fuentes.
*   `sidebar`: Menú lateral interactivo con lógica de visibilidad por rol.
*   `navbar`: Barra superior con el nombre de la página activa, perfil de usuario y cierre de sesión.
*   `footer`: Pie de página institucional.
*   `scripts`: Inclusión de bibliotecas globales y lógica de UI (Lucide icon setup).

### Uso en Páginas Hijas
Cada página del sistema (p. ej., `predictor-los.html`) invoca estos fragmentos:
```html
<head th:replace="~{layout :: header('Título de la Página')}"></head>
<body class="dashboard-layout fade-in">
    <aside th:replace="~{layout :: sidebar}"></aside>
    <div class="content-wrapper">
        <nav th:replace="~{layout :: navbar('Título de la Página')}"></nav>
        <!-- CONTENIDO PROPIO DE LA PÁGINA -->
        <footer th:replace="~{layout :: footer}"></footer>
    </div>
    <div th:replace="~{layout :: scripts}"></div>
</body>
```

---

## 🧭 Navegación y Controladores Principales

| Controlador | Responsabilidad |
| :--- | :--- |
| **`PageController`** | **Navegación General**. Carga todas las vistas principales de los módulos (Dashboard, CTC, Programas, Datos, Predicción). |
| **`AuthController`** | **Sesiones**. Gestiona el acceso al `/login` y el proceso de `/logout`. |
| **`UserController`** | **Cuentas**. Carga la vista de `/usuarios` y perfil personalizado. |
| **`FirestoreController`** | **Datos en Tiempo Real**. Expone endpoints internos para que el frontend interactúe con Firebase vía API. |

---

## 🎨 Principio de Diseño: "Natural Templates"
Thymeleaf permite que ÓrbitA sea fácil de depurar por diseñadores frontend, ya que las vistas pueden abrirse directamente en Chrome sin necesidad del servidor Spring. El servidor simplemente reemplaza los valores de prueba por datos reales en tiempo de ejecución.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
