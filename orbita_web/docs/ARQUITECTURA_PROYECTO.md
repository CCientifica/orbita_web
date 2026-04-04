# 🏛️ Arquitectura del Proyecto - ÓrbitA

La plataforma **ÓrbitA** ha sido concebida como un ecosistema técnico-científico unificado, diseñado sobre la robustez de **Spring Boot** y el dinamismo de **Thymeleaf**. Su arquitectura está estructurada para garantizar escalabilidad, mantenibilidad y un control de acceso centralizado.

## 🏗️ Marco Tecnológico

El sistema se fundamenta en un stack tecnológico moderno y estándar:
*   **Core**: [Spring Boot](https://spring.io/projects/spring-boot) (Framework principal).
*   **Motor de Plantillas**: [Thymeleaf](https://www.thymeleaf.org/) (Frontend embebido con renderizado en servidor).
*   **Seguridad**: [Spring Security](https://spring.io/projects/spring-security) (Autenticación y RBAC).
*   **Persistencia**: [Spring Data JPA](https://spring.io/projects/spring-data-jpa) con Hibernate.
*   **UI/UX**: [Bootstrap 5](https://getbootstrap.com/) y CSS nativo (Advanced Glassmorphism tier).
*   **Integración**: Conectividad nativa con **Firebase/Firestore** para persistencia de datos y gestión de usuarios en tiempo real.
*   **Robustez de UI**: Empleo de listeners seguros para la gestión de bandejas (Pendientes, Validados, Aprobados) y cierre de sesión sincronizado.

## 📐 Patrón de Diseño: MVC (Model-View-Controller)

El proyecto sigue estrictamente el patrón **MVC**, separando las preocupaciones del sistema en tres capas lógicas:

1.  **Modelo (Model/Entity)**:
    *   Ubicación: `com.clinica.ctc.model`
    *   Representa la estructura de datos del sistema (Usuarios, Roles, Pacientes, etc.).
    *   **Dualidad de Datos**: Los usuarios se gestionan como una entidad en la base relacional local (H2) para el motor de autenticación, pero se sincronizan obligatoriamente con **Firebase / Cloud Firestore** (`usuarios_permitidos`) como fuente de verdad institucional para la identidad y visibilidad global.

2.  **Vista (View)**:
    *   Ubicación: `src/main/resources/templates`
    *   Utiliza archivos `.html` enriquecidos con etiquetas de Thymeleaf (`th:`, `sec:`).

3.  **Controlador (Controller)**:
    *   Ubicación: `com.clinica.ctc.controller`
    *   Actúan como el cerebro de la aplicación.

## 🛠️ Organización en Capas (Layering)

Para asegurar el principio de **Responsabilidad Única (SOLID)**, la lógica se distribuye así:

*   **Capa de Acceso a Datos (Repository)**: Interfaces que extienden de `JpaRepository` para operaciones CRUD directas.
*   **Capa de Lógica de Negocio (Service)**: Se encarga de procesar datos complejos, integraciones con Firebase y cálculos de IA/Estadística.
*   **Capa de Configuración (Config/Security)**: Centraliza la lógica de arranque, seguridad y personalización del framework.

## 🚀 Principios de Escalabilidad y Mantenibilidad

1.  **Modularidad**: Cada componente (GTC, Programas, IA) está aislado lógicamente.
2.  **Seguridad Centralizada**: Toda autorización se gestiona desde `SecurityConfig.java`.
3.  **Frontend Basado en Layouts**: El uso de `layout.html` asegura la fidelidad visual global.

### 🔌 Interoperabilidad & Firebase Version-Safe Execution
El sistema integra mecanismos críticos para garantizar la funcionalidad en despliegues híbridos:

1.  **Firebase Shim (`firebase-shim.js`)**: Actúa como un puente de compatibilidad y **centralizador de versiones**.
    *   **Política de Unificación**: Para evitar conflictos entre versiones del SDK (e.g., v10.8.0 vs v10.13.2), todos los módulos deben utilizar exclusivamente los objetos y funciones expuestos en `window.firebaseInstance` y `window.firebaseFirestore`.
    *   **Modular Initialization**: Implementa un patrón de inicialización defensiva (`initModule`) que reintenta la carga hasta que el Shim está disponible, evitando errores de tipo durante el arranque.
2.  **Orbita Layout Bridge (`orbita-layout-bridge.js`)**: Es el encargado de la **Fidelidad Visual**. 
    *   Inyecta dinámicamente los fragmentos de `layout.html` (Sidebar, Navbar, Footer) mediante `fetch`.
    *   **Bridge de Roles**: Sincroniza la sesión de Firebase con el Navbar institucional para mostrar identidad y permisos en tiempo real.

Este blindaje garantiza que la interfaz institucional sea resiliente y visualmente idéntica en cualquier entorno.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
