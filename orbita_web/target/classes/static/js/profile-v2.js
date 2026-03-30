/**
 * 👤 ORBITA PROFILE V3.1 - Identidad Visual Institucional
 * Gestiona el perfil del usuario, dropdown del navbar y modal de edición.
 * Implementa la selección de avatares DiceBear y persistencia en Firestore.
 */
if (typeof window.OrbitaProfile === 'undefined') {
    window.OrbitaProfile = (function() {
        const AVATAR_SEEDS = [
            'Easton', 'Eliza', 'Riley', 'Andrea', 'Liliana', 'Christian', 'Brian', 'Jameson',
            'Alexander', 'Abigail', 'Angel', 'Bentley', 'Brooklyn', 'Caleb', 'Claire', 'Daniel', 
            'Daisy', 'Ethan', 'Evelin', 'Finn', 'George', 'Harry', 'Iris', 'Jack', 'Kylie'
        ];
        const AVATAR_COLLECTION = 'adventurer-neutral';
        const DEFAULT_BG = 'f1f5f9';

        let currentContext = null;

        async function init() {
            console.log("👤 OrbitaProfile: Inicializando módulo de identidad...");
            
            let attempts = 0;
            while (!window.firebaseFirestore && attempts < 50) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }

            if (!window.firebaseFirestore) return;

            window.addEventListener('user-ready', (e) => {
                currentContext = e.detail;
                syncIdentity();
            });

            if (window.orbitaUser) {
                currentContext = window.orbitaUser;
                syncIdentity();
            }

            setupEventListeners();
        }

        async function syncIdentity() {
            if (!currentContext || !currentContext.email) return;
            renderNavbarProfile();

            try {
                const email = currentContext.email.toLowerCase().trim();
                const docRef = window.firebaseFirestore.doc(null, 'usuarios_permitidos', email);
                const snap = await window.firebaseFirestore.getDoc(docRef);

                if (snap.exists()) {
                    const data = snap.data();
                    if (data.nombre) currentContext.displayName = data.nombre;
                    if (data.avatar && data.avatar !== 'default') currentContext.avatar = data.avatar;
                    if (data.telefono) currentContext.telefono = data.telefono;
                    reflectNameChanges(currentContext.displayName);
                    reflectAvatarChanges(currentContext.avatar);
                }
            } catch (e) {
                console.warn("⚠️ OrbitaProfile: Sincronización limitada por permisos o red.");
            }
        }

        function setupEventListeners() {
            const avatarWrapper = document.getElementById('avatarWrapper');
            const avatarDropdown = document.getElementById('avatarDropdown');
            const openProfileBtn = document.getElementById('openProfileBtn');
            const closeProfileBtn = document.getElementById('closeProfileBtn');
            const cancelProfileBtn = document.getElementById('cancelProfileBtn');
            const saveProfileBtn = document.getElementById('saveProfileBtn');
            const profileModalOverlay = document.getElementById('profileModalOverlay');

            if (avatarWrapper && avatarDropdown) {
                avatarWrapper.onclick = (e) => {
                    e.stopPropagation();
                    avatarDropdown.classList.toggle('open');
                };
                document.addEventListener('click', () => avatarDropdown.classList.remove('open'));
            }

            if (openProfileBtn && profileModalOverlay) {
                openProfileBtn.onclick = (e) => {
                    e.preventDefault();
                    populateProfileModal();
                    profileModalOverlay.classList.add('open');
                    if (avatarDropdown) avatarDropdown.classList.remove('open');
                };
            }

            [closeProfileBtn, cancelProfileBtn, profileModalOverlay].forEach(btn => {
                if (btn) {
                    btn.onclick = (e) => {
                        if (e.target === btn || btn !== profileModalOverlay) {
                            profileModalOverlay.classList.remove('open');
                        }
                    };
                }
            });

            if (saveProfileBtn) {
                saveProfileBtn.onclick = handleSaveProfile;
            }
        }

        function renderNavbarProfile() {
            if (!currentContext) return;
            const role = (currentContext.role || '').toLowerCase().trim();
            const badge = document.getElementById('userRoleBadge');
            if (badge) {
                badge.textContent = currentContext.role.replace('ROLE_', '').toUpperCase();
                applyRoleStyles(badge, role);
            }
            reflectNameChanges(currentContext.displayName || currentContext.email);
        }

        function applyRoleStyles(element, role) {
            element.className = 'role-badge'; 
            if (role.includes('master')) element.classList.add('role-master');
            else if (role.includes('super')) element.classList.add('role-super');
            else if (role.includes('admin')) element.classList.add('role-admin');
            else if (role.includes('analista')) element.classList.add('role-analista');
            else if (role.includes('auditor')) element.classList.add('role-auditor');
        }

        function populateProfileModal() {
            const emailInput = document.getElementById('profileEmail');
            const nameInput = document.getElementById('profileName');
            const phoneInput = document.getElementById('profilePhone');
            const roleLabel = document.getElementById('profileModalRole');

            if (emailInput) emailInput.value = currentContext.email;
            if (nameInput) nameInput.value = currentContext.displayName || '';
            if (phoneInput) phoneInput.value = currentContext.telefono || '';
            if (roleLabel) roleLabel.textContent = currentContext.role.toUpperCase();

            updateModalAvatarPreview(currentContext.avatar);
            buildAvatarPicker(currentContext.avatar);
        }

        function buildAvatarPicker(selectedSeed) {
            const picker = document.getElementById('avatarPicker');
            if (!picker) return;

            picker.innerHTML = '';
            AVATAR_SEEDS.forEach(seed => {
                const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${seed}&backgroundColor=${DEFAULT_BG}`;
                const img = document.createElement('img');
                img.src = url;
                img.className = 'picker-avatar-option' + (seed === selectedSeed ? ' selected' : '');
                img.dataset.seed = seed;

                img.onclick = () => {
                    picker.querySelectorAll('.picker-avatar-option').forEach(i => i.classList.remove('selected'));
                    img.classList.add('selected');
                    picker.dataset.selectedSeed = seed;
                    updateModalAvatarPreview(seed);
                };
                picker.appendChild(img);
            });
        }

        function updateModalAvatarPreview(seed) {
            const modalAvatar = document.getElementById('profileModalAvatar');
            if (!modalAvatar) return;

            if (seed && seed !== 'default') {
                const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${seed}&backgroundColor=${DEFAULT_BG}`;
                modalAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
            } else {
                const initials = (currentContext.displayName || currentContext.email).substring(0, 1).toUpperCase();
                modalAvatar.innerHTML = `<span>${initials}</span>`;
            }
        }

        async function handleSaveProfile() {
            const saveBtn = document.getElementById('saveProfileBtn');
            const name = document.getElementById('profileName').value;
            const phone = document.getElementById('profilePhone').value;
            const picker = document.getElementById('avatarPicker');
            const seed = picker.dataset.selectedSeed || currentContext.avatar || 'default';

            if (!name.trim()) {
                alert("El nombre completo es requerido.");
                return;
            }

            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sincronizando...';

                const email = currentContext.email.toLowerCase().trim();
                const docRef = window.firebaseFirestore.doc(null, 'usuarios_permitidos', email);
                
                await window.firebaseFirestore.updateDoc(docRef, {
                    nombre: name.toUpperCase(),
                    telefono: phone,
                    avatar: seed,
                    lastProfileUpdate: new Date().toISOString()
                });

                currentContext.displayName = name.toUpperCase();
                currentContext.avatar = seed;
                currentContext.telefono = phone;

                reflectNameChanges(currentContext.displayName);
                reflectAvatarChanges(seed);

                document.getElementById('profileModalOverlay').classList.remove('open');
                
                showToast("✨ Identidad actualizada correctamente");

            } catch (e) {
                console.error("❌ Fallo en actualización de perfil:", e);
                if (e.message && e.message.includes("permission")) {
                    alert("⚠️ Error de Permisos: Debes actualizar las reglas de Firestore para permitir que cada usuario edite su propio documento.");
                } else {
                    alert("Error al sincronizar con el servidor de identidad.");
                }
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-lucide="save" style="width:16px;"></i> Guardar Cambios';
                if (window.lucide) lucide.createIcons();
            }
        }

        function showToast(msg) {
            const toast = document.createElement('div');
            toast.style = "position:fixed; bottom:20px; right:20px; background:#22c55e; color:white; padding:12px 24px; border-radius:12px; z-index:10001; font-weight:800; box-shadow:0 10px 15px rgba(0,0,0,0.1); animation:fadeInUp 0.3s ease-out;";
            toast.innerHTML = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        function reflectAvatarChanges(seed) {
            if (!seed || seed === 'default') return;
            const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${seed}&backgroundColor=${DEFAULT_BG}`;
            ['userAvatarCircle', 'avatarDropdownAvatar', 'profileModalAvatar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>`;
            });
        }

        function reflectNameChanges(name) {
            document.querySelectorAll('.user-name, .avatar-dropdown-name').forEach(el => {
                el.textContent = name;
            });
        }

        return { init };
    })();
}

// Auto-inicialización
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.OrbitaProfile.init());
} else {
    window.OrbitaProfile.init();
}
