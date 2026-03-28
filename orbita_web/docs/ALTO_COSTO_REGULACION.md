# 🛡️ Regulación Rígida: Módulo Alto Costo

El módulo **Alto Costo** es un componente crítico y de alta precisión dentro del ecosistema ÓrbitA. Debido a su impacto científico y su integración con sistemas externos de reporte (SISCAD), este módulo se define como una **Estructura Rígida e Inmodificable**.

---

## 🚫 1. Reglas Innegociables (Sacralidad)

Las siguientes estructuras son **Fuente de Verdad Absoluta** y NO pueden ser alteradas bajo ninguna circunstancia:

### 📑 Estructura de Exportación TXT (Cáncer y Hemofilia)
- **Nombres de Variables**: Los identificadores de columnas (ej. `VAR1_PrimerNombre`, `VAR17_NombreNeoplasia`, etc.) son fijos y no contienen espacios.
- **Orden de Columnas**: La secuencia de datos en el archivo de salida debe ser idéntica a la definición oficial. No se permiten reordenamientos.
- **Formato de Salida**: La codificación, tabulación y separadores esperados por el validador externo son inalterables.
- **Prohibición de "Limpieza"**: No está permitido realizar normalizaciones automáticas, cambios de capitalización o eliminación de caracteres que afecten la paridad con el estándar institucional.
- **Validación Hemofilia (Abril 2026)**: Se ha verificado que la estructura de exportación TXT de **Hemofilia** ya es plenamente coincidente con la plantilla oficial de SISCAD. Por lo tanto, NO se deben realizar ajustes en sus encabezados ni en su orden de columnas.

---

## ⚙️ 2. Lógica Funcional Blindada

La lógica interna del módulo responde a requerimientos técnicos específicos del Departamento de Coordinación Científica:
- **Validaciones Clínicas**: Los criterios de validación de campos obligatorios y tipos de datos están diseñados para cumplir con las guías de práctica clínica y no deben ser relajados ni endurecidos sin autorización expresa.
  - **Regla de Oro (Validación de Vacíos)**: La función `validarFormulario` en `altocosto.js` debe obligatoriamente cruzar el ID de la variable con los arrays `OBLIG_CANCER` o `OBLIG_HEMO` antes de marcar un campo como `required-empty`. Esta función se limita **exclusivamente** a detectar campos obligatorios que realmente estén vacíos en la ficha de usuario (incluyendo pacientes nuevos) o con el valor "OBLIGATORIO". Cualquier otra inconsistencia de datos (ej. incoherencias de fecha, códigos prohibidos como C80X) debe ser gestionada por el motor SISCAD como un "Error de Consistencia", separándose de la sección de campos requeridos vacíos.
- **Cálculos e Indicadores**: Las fórmulas para determinar el rezago, la productividad y la calidad del dato son inmodificables.
- **Persistencia**: La lectura/escritura en Firebase Firestore utiliza la colección oficial `cood-tc`, siguiendo una estructura de documentos jerarquizada por periodos (Año-Mes) que no admite cambios de esquema.
- **Campos Azules (Confirmación Obligatoria)**: Los datos precargados desde fuentes externas (historial, datos base o raíz) se consideran **volátiles**. Para habilitar la finalización de la ficha, el analista debe reescribir o confirmar manualmente cada campo azul. Mientras exista un solo campo azul sin confirmar (`data-confirmado="false"`), el botón "VALIDAR Y FINALIZAR" permanecerá bloqueado.

---

## 🎨 3. Capa de Presentación Humana (UI)

Para garantizar un equilibrio entre la **Sacralidad Técnica** y la **Usabilidad Operativa**, el sistema implementa una capa de transformación visual exclusiva para la interfaz de usuario:
-   **Formateo de Etiquetas**: Los nombres de variables técnicos (Ej: `VAR1_PrimerNombre`) se transforman mediante el helper `formatLabelParaHumanos` a un formato legible (Ej: `VAR1: Primer Nombre`) únicamente al renderizar el modal de la **Tarjeta del Paciente**.
-   **Inmutabilidad de Keys**: Esta transformación **NO afecta** los `id` de los elementos del DOM, los `keys` de almacenamiento en Firestore, ni la estructura de los objetos de datos utilizados para la lógica de negocio o la generación de archivos TXT. Su función es puramente informativa para el analista corporativo.
-   **Objetivo**: Reducir la carga cognitiva del analista y minimizar errores de interpretación de variables durante la auditoría clínica, sin comprometer el estándar oficial.

---

## 🛡️ 4. Estabilización de UI (Blindaje de Nodos)

Para evitar errores de script (`TypeError`) sin comprometer la lógica rígida, se implementa el patrón de **Blindaje de Nodos** en `altocosto.js`:
- Se utilizan los helpers `$safeGet` y `$safeAction` para interactuar con el DOM.
- Esto asegura que si un elemento (como el botón de logout o pestañas de bandeja) no está presente debido a cambios en el Layout Institucional, el script no se detenga por excepciones de puntero nulo (`null`).

---

## 📌 4. Historial de Corrección Crítica

**Fecha**: 2026-03-26
**Problema**: `Uncaught TypeError: Cannot read properties of null (reading 'addEventListener')` en `altocosto.js`.
**Causa**: Intento de asignar un listener al ID `logoutBtn` en un entorno donde el Navbar institucional es modular y el ID podría no estar presente en el momento de la carga.
**Solución**: 
- Se blindó la inicialización de `logoutBtn` utilizando `$safeAction`.
- Se blindó la gestión de clases en `window.cambiarBandeja` y `window.cambiarCohorte` utilizando `$safeGet`.
- **Verificación**: Se confirmó que las estructuras de datos `AYUDÍA_HEMATO`, `AYUDÍA_CANCER` y las funciones de exportación `generarTXT` permanecen **intactas** y **originales**.

---

© 2026 Clínica Sagrado Corazón · Departamento de Coordinación Científica
