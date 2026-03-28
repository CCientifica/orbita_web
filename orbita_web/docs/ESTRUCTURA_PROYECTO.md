# 📂 Estructura del Proyecto - ÓrbitA

A continuación se detalla la estructura física y lógica del repositorio del proyecto **ÓrbitA**, proporcionando un mapa claro para la localización de componentes.

## 📁 Directorio Raíz (`/`)

*   `docs/`: Documentación oficial, técnica y funcional del sistema (**Fuente de Verdad**).
*   `prediccion/`: Módulos especializados en inteligencia artificial y modelos predictivos (LOS, etc.).
*   `src/`: Código fuente principal de la aplicación.
*   `data/`: Archivos de configuración o datasets locales utilizados por el backend.
*   `mvnw`, `mvnw.cmd`: [Maven Wrapper](https://maven.apache.org/wrapper/index.html) para asegurar la compatibilidad de versiones de construcción.
*   `pom.xml`: Archivo de configuración de Maven con todas las dependencias del proyecto.
*   `firebase.json`: Configuración para despliegues estáticos y hosting de Firebase.

---

## ☕ Estructura del Backend: `src/main/java`

La lógica reside bajo el paquete base `com.clinica.ctc`, estructurada de la siguiente forma:

*   **`CtcApplication.java`**: Clase principal de arranque de Spring Boot.
*   **`config/`**:
    *   `SecurityConfig.java`: Configuración de Spring Security, filtros de red, filtros por autoridad y login.
    *   `DataInitializer.java`: Componente que garantiza la existencia de usuarios de prueba y roles al iniciar el sistema.
*   **`controller/`**:
    *   `PageController.java`: Orquestación y carga de las vistas HTML de Thymeleaf.
    *   `AuthController.java`: Gestión de procesos de inicio y cierre de sesión.
    *   `UserController.java`: Endpoints para administración y perfil de usuario.
    *   `FirestoreController.java`: Puente de comunicación con la base de datos de Firebase.
    *   `AiController.java`: Gestión de las interfaces y modelos de inteligencia artificial.
*   **`model/`**:
    *   `User.java`, `Role.java`: Definición de las entidades fundamentales del sistema.
    *   `PacienteCac.java`: Modelo de datos enfocado en el seguimiento de pacientes de Alto Costo.
*   **`repository/`**: Interfaces JPA (`UserRepository`, `RoleRepository`, etc.) para interactuar con la base de datos persistente.
*   **`security/`**:
    *   `CustomUserDetailsService.java`: Lógica personalizada para cargar el perfil del usuario durante la autenticación.
*   **`scheduler/`**: Tareas automáticas programadas (p. ej., generación de reportes).

---

## 🎨 Estructura del Frontend: `src/main/resources`

El frontend de ÓrbitA está integrado nativamente con el backend de Spring:

*   **`templates/`**:
    *   `layout.html`: **Estructura base (Master Page)**. Contiene el sidebar, navbar y fragmentos comunes.
    *   `home.html`: Dashboard principal después del login.
    *   `login.html`: Interfaz de acceso al sistema.
    *   `ctc.html`, `altocosto.html`, `dasheco.html`: Vistas principales de los módulos operativos.
    *   `predictor-los.html`, `historico-los.html`: Vistas de los módulos predictivos.
    *   `usuarios.html`: Interfaz de administración de cuentas (exclusiva para `master admin`).
*   **`static/`**:
    *   `css/`: Archivos de estilo personalizados (aplica el branding institucional).
    *   `js/`: Lógica de interactividad del lado del cliente (Firebase integration, Charts, UI Effects).
    *   `assets/`: Imágenes, logotipos y multimedia institucional.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
