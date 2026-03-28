# 🏛️ Arquitectura del Proyecto - ÓrbitA

La plataforma **ÓrbitA** ha sido concebida como un ecosistema técnico-científico unificado, diseñado sobre la robustez de **Spring Boot** y el dinamismo de **Thymeleaf**. Su arquitectura está estructurada para garantizar escalabilidad, mantenibilidad y un control de acceso centralizado.

## 🏗️ Marco Tecnológico

El sistema se fundamenta en un stack tecnológico moderno y estándar:
*   **Core**: [Spring Boot](https://spring.io/projects/spring-boot) (Framework principal).
*   **Motor de Plantillas**: [Thymeleaf](https://www.thymeleaf.org/) (Frontend embebido con renderizado en servidor).
*   **Seguridad**: [Spring Security](https://spring.io/projects/spring-security) (Autenticación y RBAC).
*   **Persistencia**: [Spring Data JPA](https://spring.io/projects/spring-data-jpa) con Hibernate.
*   **UI/UX**: [Bootstrap 5](https://getbootstrap.com/) y CSS nativo (Glassmorphism design).
*   **Integración**: Conectividad nativa con **Firebase/Firestore** para persistencia de datos y gestión de usuarios en tiempo real.
*   **Robustez de UI**: Empleo de listeners seguros para la gestión de bandejas (Pendientes, Validados, Aprobados) y cierre de sesión sincronizado.

## 📐 Patrón de Diseño: MVC (Model-View-Controller)

El proyecto sigue estrictamente el patrón **MVC**, separando las preocupaciones del sistema en tres capas lógicas:

1.  **Modelo (Model/Entity)**:
    *   Ubicación: `com.clinica.ctc.model`
    *   Representa la estructura de datos del sistema (Usuarios, Roles, Pacientes, etc.).
    *   **Dualidad de Datos**: Los usuarios se gestionan como una entidad en la base relacional local (H2) para el motor de autenticación, pero se sincronizan obligatoriamente con **Firebase / Cloud Firestore** (`usuarios_permitidos`) como fuente de verdad institucional para la identidad y visibilidad global.
    *   Utiliza anotaciones JPA para el mapeo con la base de datos relacional y clases simples para el mapeo con Firestore/Firebase.

2.  **Vista (View)**:
    *   Ubicación: `src/main/resources/templates`
    *   Utiliza archivos `.html` enriquecidos con etiquetas de Thymeleaf (`th:`, `sec:`).
    *   Las vistas son "naturales": pueden abrirse en un navegador sin servidor y mostrar contenido estático, pero cobran vida al ser procesadas por Spring Boot.

3.  **Controlador (Controller)**:
    *   Ubicación: `com.clinica.ctc.controller`
    *   Actúan como el cerebro de la aplicación.
    *   Reciben peticiones HTTP, invocan servicios de lógica y seleccionan qué vista retornar al usuario, inyectando los datos necesarios en el `Model` de Spring.

## 🛠️ Organización en Capas (Layering)

Para asegurar el principio de **Responsabilidad Única (SOLID)**, la lógica se distribuye así:

*   **Capa de Acceso a Datos (Repository)**: Interfaces que extienden de `JpaRepository` para operaciones CRUD directas.
*   **Capa de Lógica de Negocio (Service)**: (Actualización pendiente en documentación de servicios). Se encarga de procesar datos complejos, integraciones con Firebase y cálculos de IA/Estadística.
*   **Capa de Configuración (Config/Security)**: Centraliza la lógica de arranque, seguridad y personalización del framework.

## 🚀 Principios de Escalabilidad y Mantenibilidad

1.  **Modularidad**: Cada componente (GTC, Programas, IA) está aislado lógicamente para permitir expansiones sin afectar el núcleo del sistema.
2.  **Seguridad Centralizada**: Toda autorización se gestiona desde `SecurityConfig.java`, evitando validaciones dispersas en el código.
3.  **Frontend Basado en Layouts**: El uso de `layout.html` y fragmentos asegura que cambios en el diseño se propaguen automáticamente a todas las páginas.

### 📦 Blindaje de Nodos ($safeGet / $safeAction)
Para asegurar que los scripts funcionen tanto en el entorno dinámico de Spring Boot (Thymeleaf) como en el estático de Firebase, se ha implementado un patrón de **Blindaje de Nodos**. Esto evita el error común de `TypeError: Cannot read properties of null` mediante:
- `$safeGet(id)`: Devuelve un elemento real o un "mock object" con clases y estilos vacíos si el ID no existe.
- `$safeAction(id, event, callback)`: Ejecuta el listener solo si el elemento existe en el DOM actual.

### 🔌 Interoperabilidad: Firebase Shim & Layout Bridge
El sistema integra dos componentes críticos para garantizar la funcionalidad en despliegues estáticos (Firebase Hosting):

1.  **Firebase Shim (`firebase-shim.js`)**: Actúa como un puente de compatibilidad entre los módulos robustos (como Alto Costo) y el SDK de Firebase v10+. Emula firmas modulares y sincroniza la autenticación.
2.  **Orbita Layout Bridge (`orbita-layout-bridge.js`)**: Es el encargado de la **Fidelidad Visual**. 
    *   Inyecta dinámicamente los fragmentos de `layout.html` (Sidebar, Navbar, Footer) mediante `fetch`.
    *   Traduce atributos técnicos de Thymeleaf (`th:src`, `th:href`, `th:text`) a estándares web.
    *   **Bridge de Roles**: En modo estático, escucha el evento `firebase-ready`, consulta el rol del usuario en la colección `usuarios_permitidos` de Firestore y dispara el evento global `user-ready`, permitiendo que el Navbar muestre el avatar, nombre y rol institucional correctos sin necesidad de un servidor Spring Boot.

Esto garantiza que la interfaz institucional sea resiliente y visualmente idéntica en cualquier entorno.

---

## 🚦 Validación de Despliegue Real (Checklist)

Para considerar un módulo como "Listo para Despliegue", debe pasar estas validaciones:
1.  **Context Path**: El sistema debe funcionar tanto en `/` como en subrutas heredadas por el servidor de aplicaciones (Tomcat/Jetty).
2.  **Asset Resolution**: No debe haber rutas absolutas a archivos físicos de Windows (ej. `C:/Users/...`). Todo debe ser `/css/styles.css` u obtenerse vía `th:src`.
3.  **Template Fragmenting**: Los fragmentos Thymeleaf deben renderizar el contenido dinámico del `Model` local antes de activar la lógica reactiva de Firebase/JS.
4.  **Matriz de Seguridad**: Cada endpoint del controlador debe tener una protección `@PreAuthorize` o estar definido en `SecurityConfig.java` según la matriz institucional.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
