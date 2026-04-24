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
*   **Gestión de Estado (Locks)**: Sistema de concurrencia **In-Memory** gestionado en el servidor Spring (sin persistencia en DB) para evitar colisiones entre analistas de Alto Costo.
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

### 🔐 Gestión de Secretos y Configuración Dinámica (Cloud Secrets)
Para garantizar la máxima seguridad y agilidad operativa, **ÓrbitA** implementa un modelo de **Secretos como Servicio (SaaS)** utilizando FireStore como bóveda centralizada:

1.  **Bóveda de Configuración (`config/ia_params`)**: Las credenciales sensibles (ej. API Keys de Groq/LLama3) nunca residen en el código fuente ni en archivos de propiedades estáticas. Se almacenan en una colección protegida en la nube.
2.  **Aprovisionamiento Master Admin**: Solo los perfiles de **Master Admin** poseen la interfaz dinámica para inyectar o rotar llaves API en tiempo real sin necesidad de realizar nuevos despliegues de código o reinicios de servidor.
3.  **Inyección en Tiempo de Ejecución (Runtime Injection)**: Los módulos de IA realizan peticiones asíncronas durante el `init()` para recuperar e inyectar las credenciales necesarias, asegurando que el repositorio de Git permanezca 100% libre de secretos y cumpliendo con los estándares de **Secret Scanning**.

Este blindaje garantiza que la interfaz institucional sea resiliente y visualmente idéntica en cualquier entorno.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
