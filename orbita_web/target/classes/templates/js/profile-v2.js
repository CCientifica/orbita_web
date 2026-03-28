/**
 * 👤 ORBITA PROFILE V2 - Centralizado
 * Gestiona el perfil del usuario, dropdown del navbar y modal de edición.
 * Sincronizado con docs/AVATARES_Y_PERFILES.md
 */
const OrbitaProfile = (function() {
    // Colección Adventurer Neutral (20 Avatares)
    const AVATAR_SEEDS = [
        'Easton', 'Eliza', 'Riley', 'Andrea', 'Liliana', 'Christian', 'Brian', 'Jameson',
        'Alexander', 'Abigail', 'Angel', 'Bentley', 'Brooklyn', 'Caleb', 'Claire', 'Daniel', 
        'Daisy', 'Ethan', 'Evelin', 'Finn'
    ];
    const AVATAR_COLLECTION = 'adventurer-neutral';
    const DEFAULT_BG = 'f1f5f9';

    let currentContext = null;

    /**
     * Inicialización central con espera reactiva para Firebase
     */
    async function init() {
        console.log("👤 OrbitaProfile: Inicializando módulo...");
        
        // Esperar a que el Shim de Firebase esté listo (inyectado por layout.html como módulo)
        let attempts = 0;
        while (!window.firebaseInstance && !window.firebaseFirestore && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        if (!window.firebaseFirestore || !window.firebaseInstance) {
            console.error("👤 [FIREBASE] Error: No se detectó el shim de Firebase.");
            return;
        }

        // 1. Escuchar el evento de usuario listo
        window.addEventListener('user-ready', (e) => {
            currentContext = e.detail;
            renderNavbarProfile();
            loadProfileData();
        });

        // Fallback si el usuario ya está cargado en window.orbitaUser
        if (window.orbitaUser) {
            currentContext = window.orbitaUser;
            renderNavbarProfile();
            loadProfileData();
        }

        setupEventListeners();
    }


    /**
     * Configura los listeners de UI
     */
    function setupEventListeners() {
        const avatarWrapper = document.getElementById('avatarWrapper');
        const avatarDropdown = document.getElementById('avatarDropdown');
        const openProfileBtn = document.getElementById('openProfileBtn');
        const closeProfileBtn = document.getElementById('closeProfileBtn');
        const cancelProfileBtn = document.getElementById('cancelProfileBtn');
        const saveProfileBtn = document.getElementById('saveProfileBtn');
        const profileModalOverlay = document.getElementById('profileModalOverlay');

        // Toggle Dropdown del Avatar
        if (avatarWrapper && avatarDropdown) {
            avatarWrapper.onclick = (e) => {
                e.stopPropagation();
                avatarDropdown.classList.toggle('open');
            };
            document.addEventListener('click', () => avatarDropdown.classList.remove('open'));
        }

        // Abrir Modal de Perfil
        if (openProfileBtn && profileModalOverlay) {
            openProfileBtn.onclick = (e) => {
                e.preventDefault();
                populateProfileModal();
                profileModalOverlay.classList.add('open');
                if (avatarDropdown) avatarDropdown.classList.remove('open');
            };
        }

        // Cerrar Modal
        [closeProfileBtn, cancelProfileBtn].forEach(btn => {
            if (btn) {
                btn.onclick = () => profileModalOverlay.classList.remove('open');
            }
        });

        // Cerrar al clickear fuera del modal
        if (profileModalOverlay) {
            profileModalOverlay.onclick = (e) => {
                if (e.target === profileModalOverlay) {
                    profileModalOverlay.classList.remove('open');
                }
            };
        }

        // Guardar Cambios
        if (saveProfileBtn) {
            saveProfileBtn.onclick = handleSaveProfile;
        }
    }

    /**
     * Renderiza los elementos estáticos del Navbar según el contexto
     */
    function renderNavbarProfile() {
        if (!currentContext) return;

        const role = (currentContext.role || '').toLowerCase().trim();
        const badge = document.getElementById('userRoleBadge');
        if (badge) {
            badge.textContent = currentContext.role.toUpperCase();
            applyRoleStyles(badge, role);
        }

        // Datos del Dropdown
        const dropdownName = document.querySelector('.avatar-dropdown-name');
        const dropdownRole = document.querySelector('.avatar-dropdown-role');
        if (dropdownName) dropdownName.textContent = currentContext.displayName || currentContext.email;
        if (dropdownRole) dropdownRole.textContent = currentContext.role.toUpperCase();
    }

    /**
     * Estilos de Rol (Mantiene consistencia con user-ui.js)
     */
    function applyRoleStyles(element, role) {
        element.className = 'role-badge'; 
        if (role.includes('master admin')) element.classList.add('role-master');
        else if (role.includes('super admin')) element.classList.add('role-super');
        else if (role.includes('administrador') || role === 'admin') element.classList.add('role-admin');
        else if (role.includes('analista')) element.classList.add('role-analista');
        else if (role.includes('auditor')) element.classList.add('role-auditor');
    }

    /**
     * Carga de datos extendidos desde Firestore (vía shim)
     */
    async function loadProfileData() {
        if (!currentContext || !currentContext.email) return;

        try {
            const email = currentContext.email.toLowerCase().trim();
            const docRef = window.firebaseFirestore.doc(null, 'usuarios_permitidos', email);
            const snap = await window.firebaseFirestore.getDoc(docRef);

            if (snap.exists()) {
                const data = snap.data();
                
                // Prioridad al Avatar (Seed)
                if (data.avatar && data.avatar !== 'default') {
                    currentContext.avatar = data.avatar;
                    reflectAvatarChanges(data.avatar);
                }
                
                if (data.nombre) {
                    currentContext.displayName = data.nombre;
                    reflectNameChanges(data.nombre);
                }
                
                if (data.telefono) currentContext.telefono = data.telefono;
            }
        } catch (e) {
            console.error("👤 OrbitaProfile: Error al cargar perfil persistente:", e);
        }
    }

    /**
     * Prepara el modal de edición
     */
    function populateProfileModal() {
        const emailInput = document.getElementById('profileEmail');
        const nameInput = document.getElementById('profileName');
        const phoneInput = document.getElementById('profilePhone');
        const roleLabel = document.getElementById('profileModalRole');

        if (emailInput) emailInput.value = currentContext.email;
        if (nameInput) nameInput.value = currentContext.displayName || '';
        if (phoneInput) phoneInput.value = currentContext.telefono || '';
        if (roleLabel) roleLabel.textContent = currentContext.role.toUpperCase();

        // Cargar Visual Preview inicial del modal
        if (currentContext.avatar && currentContext.avatar !== 'default') {
            const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${currentContext.avatar}&backgroundColor=${DEFAULT_BG}`;
            const modalAvatar = document.getElementById('profileModalAvatar');
            if (modalAvatar) {
                modalAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
            }
        } else {
            const initials = (currentContext.displayName || currentContext.email).substring(0, 1).toUpperCase();
            const modalAvatar = document.getElementById('profileModalAvatar');
            if (modalAvatar) modalAvatar.textContent = initials;
        }

        buildAvatarPicker(currentContext.avatar);
    }

    /**
     * Construye la cuadrícula de selección
     */
    function buildAvatarPicker(selectedSeed) {
        const picker = document.getElementById('avatarPicker');
        if (!picker) return;

        picker.innerHTML = '';
        AVATAR_SEEDS.forEach(seed => {
            const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${seed}&backgroundColor=${DEFAULT_BG}`;
            const img = document.createElement('img');
            img.src = url;
            img.className = 'picker-avatar-option';
            img.dataset.seed = seed;
            if (seed === selectedSeed) img.classList.add('selected');

            img.onclick = () => {
                picker.querySelectorAll('.picker-avatar-option').forEach(i => i.classList.remove('selected'));
                img.classList.add('selected');
                picker.dataset.selectedSeed = seed;
                
                // Preview modal
                const modalAvatar = document.getElementById('profileModalAvatar');
                if (modalAvatar) {
                    modalAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
                }
            };
            picker.appendChild(img);
        });
    }

    /**
     * Persiste los cambios (Dual-Write no requerido aquí ya que Spring lee desde el OIDC, 
     * pero actualizamos Firestore para que los módulos administrativos y el navbar vean el cambio).
     */
    async function handleSaveProfile() {
        const saveBtn = document.getElementById('saveProfileBtn');
        const name = document.getElementById('profileName').value;
        const phone = document.getElementById('profilePhone').value;
        const picker = document.getElementById('avatarPicker');
        const seed = picker.dataset.selectedSeed || currentContext.avatar;

        if (!name) {
            alert("El nombre institucional es obligatorio.");
            return;
        }

        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Guardando...';

            const email = currentContext.email.toLowerCase().trim();
            const docRef = window.firebaseFirestore.doc(null, 'usuarios_permitidos', email);
            
            // Actualización en Firestore (Shared Source of Truth para UI)
            await window.firebaseFirestore.updateDoc(docRef, {
                nombre: name,
                telefono: phone,
                avatar: seed,
                updatedAt: new Date().toISOString()
            });

            // Actualizar contexto local
            currentContext.displayName = name;
            currentContext.telefono = phone;
            currentContext.avatar = seed;

            // Reflejar cambios REALES en UI inmediata
            reflectAvatarChanges(seed);
            reflectNameChanges(name);

            // Cerrar y notificar
            document.getElementById('profileModalOverlay').classList.remove('open');
            console.log(`👤 OrbitaProfile: Perfil de ${email} actualizado con éxito.`);
            
        } catch (e) {
            console.error("❌ Error al guardar perfil:", e);
            alert("Error al guardar perfil: " + (e.message || "Error desconocido"));
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="save" style="width:14px;"></i> Guardar Cambios';
            if (window.lucide) lucide.createIcons();
        }
    }

    /**
     * Aplica el avatar por seed a todos los contenedores visuales
     */
    function reflectAvatarChanges(seed) {
        if (!seed || seed === 'default') return;
        
        const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${seed}&backgroundColor=${DEFAULT_BG}`;
        const containers = ['userAvatarCircle', 'avatarDropdownAvatar', 'profileModalAvatar'];

        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
            }
        });
    }

    /**
     * Refleja el nombre en el navbar y dropdown
     */
    function reflectNameChanges(name) {
        const targets = document.querySelectorAll('.user-name, .avatar-dropdown-name');
        targets.forEach(el => { el.textContent = name; });
    }

    return {
        init: init
    };
})();

// Auto-inicialización con protección de estado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', OrbitaProfile.init);
} else {
    OrbitaProfile.init();
}
