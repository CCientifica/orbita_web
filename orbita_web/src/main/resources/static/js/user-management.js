/**
 * user-management.js
 * Lógica central para la gestión de usuarios conectada a Spring Boot.
 * REEMPLAZA a la versión de Firebase.
 */

const userManagement = (function() {
    const AUTHORIZED_DOMAIN = '@clinicasagradocorazon.com.co';
    const MASTER_EMAIL = 'coordcientifico@funda-bio.org';

    /**
     * Valida si un correo es de dominio autorizado
     */
    function isValidDomain(email) {
        if (email === MASTER_EMAIL) return true;
        return email.toLowerCase().endsWith(AUTHORIZED_DOMAIN);
    }

    /**
     * Carga todos los usuarios desde la Base de Datos Oficial (Firebase / Cloud)
     * Regla: Fuente de Verdad para el listado es Firestore cood-tc.
     */
    async function loadUsers() {
        console.log('[USER-MGMT] Iniciando carga de usuarios desde Firebase Cloud...');
        
        try {
            // 1. Intentar lectura desde la nube si está disponible
            if (window.firebaseCloudDb) {
                // ESPERA ACTIVA: Si el SDK está pero el Auth aún no confirma sesión (Missing or insufficient permissions)
                // Esperamos hasta 3 segundos a que isReady sea true (confirmado por onAuthStateChanged)
                let attempts = 0;
                while (!window.firebaseCloudDb.isReady && attempts < 30) {
                    await new Promise(r => setTimeout(r, 100));
                    attempts++;
                }

                if (!window.firebaseCloudDb.isReady) {
                    console.warn('[USER-MGMT] Firebase Auth no confirmó sesión a tiempo. Intentando lectura directa...');
                }

                const { db, collection, getDocs } = window.firebaseCloudDb;
                const querySnap = await getDocs(collection(db, 'usuarios_permitidos'));
                
                const users = [];
                querySnap.forEach((doc) => {
                    const data = doc.data();
                    users.push({
                        email: doc.id,
                        nombre: data.nombre || 'Sin nombre',
                        rol: data.rol || 'auditor',
                        activo: data.activo !== undefined ? data.activo : true,
                        avatar: data.avatar || 'default'
                    });
                });
                
                console.log(`[USER-MGMT] ✅ ${users.length} usuarios cargados desde Cloud Firestore.`);
                return users;
            }

            // 2. Fallback: Backend Local (H2) si el SDK no está listo o falla
            console.warn('[USER-MGMT] Firebase Cloud no disponible, usando base de datos local...');
            const response = await fetch('/api/users');
            if (!response.ok) {
                if (response.status === 403) throw new Error('No tiene permisos para ver usuarios.');
                throw new Error('Error al cargar la lista de usuarios del servidor local.');
            }
            return await response.json();
            
        } catch (error) {
            console.error('[USER-MGMT] Error fatal al cargar usuarios:', error);
            // Si el error es de permisos, explicar al usuario
            if (error.message.includes('permission')) {
                throw new Error('Error de permisos en Firebase. Asegúrese de haber iniciado sesión correctamente.');
            }
            throw error;
        }
    }

    /**
     * Verifica si un usuario ya existe (vía backend)
     */
    async function checkUserExists(email) {
        try {
            const users = await loadUsers();
            return users.some(u => u.email.toLowerCase() === email.toLowerCase());
        } catch (error) {
            return false;
        }
    }

    /**
     * Crea un nuevo usuario o actualiza datos (Cloud + Local Sync)
     */
    async function createUser(email, nombre, rol, activo = true, userData = {}) {
        if (!isValidDomain(email)) throw new Error('Dominio no autorizado. Use @clinicasagradocorazon.com.co');

        try {
            // 1. Guardar en FIREBASE CLOUD (Sincronización Maestra)
            if (window.firebaseCloudDb) {
                const { db, doc, setDoc } = window.firebaseCloudDb;
                const userDoc = doc(db, 'usuarios_permitidos', email.toLowerCase().trim());
                await setDoc(userDoc, {
                    nombre: nombre,
                    rol: rol,
                    activo: activo,
                    avatar: userData.avatar || 'default',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log('[USER-MGMT] ✅ Guardado exitoso en Firebase Cloud.');
            }

            // 2. Notificar al BACKEND LOCAL (Sincronización Spring Security)
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, nombre, rol, activo })
            });

            if (!response.ok) throw new Error('Error al sincronizar el usuario en el servidor local.');
            return await response.json();
            
        } catch (error) {
            console.error('[USER-MGMT] Save Error:', error);
            throw error;
        }
    }

    /**
     * Actualiza un usuario (Cloud + Local Sync)
     */
    async function updateUser(email, data) {
        return await createUser(email, data.nombre, data.rol, data.activo, data);
    }

    /**
     * Elimina un usuario (Cloud + Local Sync)
     */
    async function deleteUser(email) {
        try {
            // 1. Eliminar de FIREBASE CLOUD
            if (window.firebaseCloudDb) {
                const { db, doc, deleteDoc } = window.firebaseCloudDb;
                await deleteDoc(doc(db, 'usuarios_permitidos', email.toLowerCase().trim()));
                console.log('[USER-MGMT] ✅ Eliminado de Firebase Cloud.');
            }

            // 2. Eliminar de BACKEND LOCAL
            const response = await fetch(`/api/users/${encodeURIComponent(email)}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Error al eliminar el usuario del servidor local.');
            }
            return { success: true };
            
        } catch (error) {
            console.error('[USER-MGMT] Delete Error:', error);
            throw error;
        }
    }

    return {
        loadUsers,
        createUser,
        updateUser,
        deleteUser,
        checkUserExists,
        isValidDomain
    };
})();
