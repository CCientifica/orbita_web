# 🔐 Seguridad y Roles - ÓrbitA

La seguridad de ÓrbitA es el pilar que garantiza la confidencialidad, integridad y disponibilidad de los datos técnicos y científicos. Se implementa a través de una arquitectura robusta de **Control de Acceso Basado en Roles (RBAC)** gestionada por **Spring Security**.

---

## 🛡️ Núcleo de Seguridad: Spring Security

ÓrbitA utiliza **Spring Security 6** para proteger todas las rutas y recursos:
1.  **Autenticación Institucional (Google Workspace)**:
    *   **Acciso Único**: El sistema no permite el registro público ni el login clásico mediante usuario/contraseña para el personal clínico.
    *   **Google Auth**: Se utiliza el SDK de Firebase para invocar el **Popup Real** de selección de cuenta de Google. No se permiten ingresos silenciosos ni bypass automáticos.
    *   **Validación de Dominio**: Es obligatorio que la respuesta de Google use una cuenta del dominio `@clinicasagradocorazon.com.co`.
    *   **Autorización Interna**: Tras el éxito en Google, el sistema consulta la colección `usuarios_permitidos` en **Firestore** (Fuente de Verdad) para verificar si el usuario tiene permiso de acceso y obtener su rol real.
    *   **Mapeo de Sesión**: Solo si se superan ambos filtros, el cliente envía las credenciales validadas al backend para establecer la sesión de Spring Security.

2.  **Autorización (RBAC)**:
    *   Utiliza **Autoridades (`Authorities`)** para mapear exactamente los roles almacenados en Firebase como strings simples.
    *   **Importante**: Se utiliza `hasAuthority` en lugar de `hasRole` para evitar el prefijo automático `ROLE_` de Spring y permitir compatibilidad directa con los strings crudos de la base de datos.
    *   **Normalización**: Antes de cualquier validación, los roles de Firebase se normalizan (minúsculas, `trim()`).

---

## 📋 Matriz Institucional de Roles (5 Roles Oficiales)

ÓrbitA reconoce **única y exclusivamente** estos 5 perfiles:

| Rol (Firebase) | Authority Spring | Alcance y Visibilidad | Restricciones de Red (URL Directa) | Acciones Permitidas (Botones) |
| :--- | :--- | :--- | :--- | :--- |
| **`master admin`** | `master admin` | **Acceso Total**. Todos los módulos. | **Ninguna**. Acceso a todas las rutas. | Todas: **Gestión de Llaves IA (Nube)**, Crear, Editar, Borrar. |
| **`super admin`** | `super admin` | Gestión operativa. CAC, Auditoría IA. | **Bloqueado**: `/usuarios`, `/cronogramagpc`. | Gestión: Auditar IA, Ver, Editar, Cargar, Exportar. |
| **`admin`** | `admin` | Consulta institucional. CAC, LOS. | **Bloqueado**: `/usuarios`, `/cronogramagpc`. | Lectura: Solo Ver y Descargar Reportes. |
| **`analista`** | `analista` | Soporte técnico. **Alto Costo e IA**. | **Bloqueado**: Todo excepto `/altocosto`, `/home`. | Operatividad: **Auditoría IA (Monitoreada)**, Validar datos, Exportar TXT. |
| **`auditor`** | `auditor` | Monitoreo. **Solo Datos y Predicción**. | **Bloqueado**: `/usuarios`, `/ctc`, `/altocosto`. | Lectura: Visualización de Dashboards. |

---

---

## 🔍 Telemetría y Gestión de Productividad (Anti-Cheat)

ÓrbitA implementa un sistema de monitoreo ético para garantizar la veracidad de la gestión en el módulo de Alto Costo (SISCAD):

1.  **Detección de Salida Prematura**: El sistema monitorea el tiempo de gestión dentro de cada ficha. Si una `analista` intenta cerrar una ficha no validada tras más de 30 segundos de actividad, el sistema emite una advertencia de bloqueo indicando que su productividad no será contabilizada si abandona el registro.
2.  **Segregación de Métricas**: Para mantener la integridad de los reportes, el sistema **excluye** a los roles `master admin` y `super admin` de la telemetría de inactividad. Los administradores pueden supervisar sin afectar los KPIs de productividad del equipo.
3.  **Corte Diario de Inactividad**: Los registros de inactividad se desglosan por fecha (`YYYY-MM-DD`) en Firestore, permitiendo auditorías diarias de desempeño y evitando la acumulación errónea de tiempos entre jornadas.

---

## 🚦 Protocolo de Validación de Acceso Real

El cumplimiento de la seguridad no es solo visual. Se debe verificar:
1.  **Filtro de Servidor**: Intentar acceder a una URL restringida (ej. `/usuarios` siendo `analista`) debe resultar en una redirección a `/login` o una página de error 403.
2.  **Ocultamiento de Nodos**: Los elementos protegidos con `sec:authorize` no deben existir en el DOM final entregado al navegador.
3.  **Bypass de Consola**: El acceso a funciones globales de JS (ej. `window.borrarRegistro`) debe estar protegido internamente validando el rol del contexto antes de ejecutar la acción crítica.

---

## 🏗️ Implementación Técnica de Acceso

ÓrbitA protege el sistema en tres niveles:

### 1. Nivel de Ruta (Controller/Network)
Configurado en `SecurityConfig.java`:
```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/usuarios/**").hasAuthority("master admin")
    .requestMatchers("/ctc/**").hasAuthority("master admin")
    .requestMatchers("/altocosto/**").hasAnyAuthority("master admin", "super admin", "admin", "analista")
    .requestMatchers("/predictor-los/**", "/historico-los/**").hasAnyAuthority("master admin", "super admin", "admin", "auditor")
    .anyRequest().authenticated()
);
```

### 2. Nivel de Interfaz (Visibilidad Thymeleaf)
Controlado en `layout.html` y plantillas individuales:
```html
<div sec:authorize="hasAuthority('master admin')">
    <!-- Este bloque solo existe en el HTML si el usuario es Master Admin -->
</div>
```

### 3. Nivel de Accionable (Botones/Edición)
Incluso si el módulo es visible, ciertos botones están bloqueados:
*   **Analistas**: No ven botones de carga. Tienen telemetría de productividad obligatoria.
*   **Auditores**: Tienen visualización de solo lectura.
*   **Master Admin**: Único perfil con acceso a la **Bóveda de Configuración IA** para la gestión de llaves API.

---

## 🔐 Cifrado y Políticas
*   **Contraseñas**: Todas las claves se almacenan utilizando algoritmos de hashing unidireccional (BCrypt). Nunca se guardan ni viajan en texto plano.
*   **Sesiones**: El tiempo de vida de la sesión está configurado para expirar automáticamente tras un periodo de inactividad, forzando un nuevo login.

---
© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
