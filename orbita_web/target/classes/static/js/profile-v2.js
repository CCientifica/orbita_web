/**
 * 👤 ORBITA PROFILE V3.2 - Identidad Visual Institucional
 * Corrige sincronización temprana, lectura segura desde Firestore y persistencia de avatar/nombre.
 */
if (typeof window.OrbitaProfile === 'undefined') {
    window.OrbitaProfile = (function () {
        const AVATAR_SEEDS = [
            'Easton', 'Eliza', 'Riley', 'Andrea', 'Liliana', 'Christian', 'Brian', 'Jameson',
            'Alexander', 'Abigail', 'Angel', 'Bentley', 'Brooklyn', 'Caleb', 'Claire', 'Daniel',
            'Daisy', 'Ethan', 'Evelin', 'Finn', 'George', 'Harry', 'Iris', 'Jack', 'Kylie'
        ];

        const AVATAR_COLLECTION = 'adventurer-neutral';
        const DEFAULT_BG = 'f1f5f9';

        let currentContext = {
            email: null,
            displayName: null,
            role: null,
            avatar: 'default',
            telefono: ''
        };

        let firestoreReady = false;
        let authResolved = false;
        let firebaseUser = null;

        async function init() {
            console.log("👤 OrbitaProfile: Inicializando módulo de identidad...");

            await waitForFirestoreShim();
            setupEventListeners();
            bindIdentityEvents();

            if (window.orbitaUser) {
                mergeSpringUser(window.orbitaUser);
                renderNavbarProfile();
            }

            await waitForFirebaseAuthResolution();

            if (firebaseUser?.email) {
                mergeFirebaseUser(firebaseUser);
            }

            renderNavbarProfile();
            await syncIdentity();
        }

        function bindIdentityEvents() {
            window.addEventListener('firebase-auth-resolved', async (e) => {
                authResolved = true;
                firebaseUser = e.detail?.user || null;

                if (firebaseUser?.email) {
                    mergeFirebaseUser(firebaseUser);
                }

                renderNavbarProfile();
                await syncIdentity();
            });

            window.addEventListener('user-ready', async (e) => {
                const detail = e.detail || {};
                if (detail.email && detail.role) {
                    mergeSpringUser(detail);
                    renderNavbarProfile();

                    if (authResolved) {
                        await syncIdentity();
                    }
                }
            });

            window.addEventListener('firebase-user-ready', async (e) => {
                const user = e.detail || null;
                if (user?.email) {
                    mergeFirebaseUser(user);
                    renderNavbarProfile();
                    await syncIdentity();
                }
            });
        }

        async function waitForFirestoreShim() {
            let count = 0;
            while ((!window.firebaseFirestore || !window.firebaseCloudDb) && count < 100) {
                await new Promise(r => setTimeout(r, 100));
                count++;
            }
            firestoreReady = !!window.firebaseFirestore;
        }

        async function waitForFirebaseAuthResolution() {
            let count = 0;
            while ((!window.firebaseCloudDb || !window.firebaseCloudDb.authResolved) && count < 100) {
                await new Promise(r => setTimeout(r, 100));
                count++;
            }

            authResolved = !!window.firebaseCloudDb?.authResolved;
            firebaseUser = window.firebaseCloudDb?.currentUser || null;
        }

        function mergeSpringUser(user) {
            currentContext.email = normalizeEmail(user.email || currentContext.email);
            currentContext.displayName = user.displayName || currentContext.displayName || user.email || currentContext.email;
            currentContext.role = user.role || currentContext.role;
        }

        function mergeFirebaseUser(user) {
            currentContext.email = normalizeEmail(user.email || currentContext.email);
            currentContext.displayName = currentContext.displayName || user.displayName || user.email;
        }

        function normalizeEmail(email) {
            return (email || '').toString().toLowerCase().trim();
        }

        async function syncIdentity() {
            if (!firestoreReady || !currentContext.email) return;

            renderNavbarProfile();

            if (!authResolved) {
                console.warn("⚠️ OrbitaProfile: Firebase Auth aún no está resuelto.");
                return;
            }

            if (!firebaseUser) {
                console.warn("⚠️ OrbitaProfile: No hay usuario autenticado en Firebase. Se mostrará fallback local.");
                return;
            }

            try {
                const { doc, getDoc } = window.firebaseFirestore;
                const docRef = doc(null, 'usuarios_permitidos', currentContext.email);
                const snap = await getDoc(docRef);

                if (!snap.exists()) {
                    console.warn(`⚠️ OrbitaProfile: No existe documento en usuarios_permitidos/${currentContext.email}`);
                    return;
                }

                const data = snap.data() || {};

                const institutionalName = data.nombre || data.Nombre || data.displayName || data.name || '';
                const avatar = data.avatar || data.Avatar || 'default';
                const telefono = data.telefono || data.Telefono || '';

                if (institutionalName) {
                    currentContext.displayName = institutionalName.toUpperCase().trim();
                }

                currentContext.avatar = avatar;
                currentContext.telefono = telefono;

                reflectNameChanges(currentContext.displayName || currentContext.email);
                reflectAvatarChanges(currentContext.avatar);

                console.log("✅ OrbitaProfile: Identidad sincronizada desde Firestore.");
            } catch (e) {
                console.error("❌ OrbitaProfile: Error sincronizando identidad:", e);
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

                document.addEventListener('click', (e) => {
                    if (!avatarWrapper.contains(e.target) && !avatarDropdown.contains(e.target)) {
                        avatarDropdown.classList.remove('open');
                    }
                });
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
                if (!btn) return;

                btn.onclick = (e) => {
                    if (btn === profileModalOverlay) {
                        if (e.target === profileModalOverlay) {
                            profileModalOverlay.classList.remove('open');
                        }
                    } else {
                        profileModalOverlay.classList.remove('open');
                    }
                };
            });

            if (saveProfileBtn) {
                saveProfileBtn.onclick = handleSaveProfile;
            }
        }

        function renderNavbarProfile() {
            const display = currentContext.displayName || currentContext.email || 'Usuario';
            const roleRaw = currentContext.role || '';
            const role = roleRaw.toLowerCase().trim();

            reflectNameChanges(display);

            const badge = document.getElementById('userRoleBadge');
            if (badge) {
                badge.textContent = roleRaw.replace('ROLE_', '').toUpperCase();
                applyRoleStyles(badge, role);
            }

            if (!currentContext.avatar || currentContext.avatar === 'default') {
                reflectInitials(display);
            } else {
                reflectAvatarChanges(currentContext.avatar);
            }
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

            if (emailInput) emailInput.value = currentContext.email || '';
            if (nameInput) nameInput.value = currentContext.displayName || '';
            if (phoneInput) phoneInput.value = currentContext.telefono || '';
            if (roleLabel) roleLabel.textContent = (currentContext.role || '').toUpperCase();

            updateModalAvatarPreview(currentContext.avatar);
            buildAvatarPicker(currentContext.avatar);
        }

        function buildAvatarPicker(selectedSeed) {
            const picker = document.getElementById('avatarPicker');
            if (!picker) return;

            picker.innerHTML = '';
            picker.dataset.selectedSeed = selectedSeed || currentContext.avatar || 'default';

            AVATAR_SEEDS.forEach(seed => {
                const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${DEFAULT_BG}`;
                const img = document.createElement('img');

                img.src = url;
                img.className = 'picker-avatar-option' + (seed === selectedSeed ? ' selected' : '');
                img.dataset.seed = seed;
                img.alt = `Avatar ${seed}`;

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
                const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${DEFAULT_BG}`;
                modalAvatar.innerHTML = `<img src="${url}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
            } else {
                const initials = getInitial(currentContext.displayName || currentContext.email || 'U');
                modalAvatar.innerHTML = `<span>${initials}</span>`;
            }
        }

        async function handleSaveProfile() {
            const saveBtn = document.getElementById('saveProfileBtn');
            const profileNameInput = document.getElementById('profileName');
            const profilePhoneInput = document.getElementById('profilePhone');
            const picker = document.getElementById('avatarPicker');

            const newName = profileNameInput?.value?.trim() || '';
            const newPhone = profilePhoneInput?.value?.trim() || '';
            const newAvatar = picker?.dataset?.selectedSeed || currentContext.avatar || 'default';

            if (!newName) {
                alert("El nombre completo es requerido.");
                return;
            }

            if (!authResolved || !firebaseUser) {
                alert("No existe una sesión activa de Firebase. Debes autenticar al usuario también en Firebase antes de guardar perfil.");
                return;
            }

            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Sincronizando...';

                const { doc, setDoc, serverTimestamp } = window.firebaseFirestore;
                const docRef = doc(null, 'usuarios_permitidos', currentContext.email);

                await setDoc(docRef, {
                    nombre: newName.toUpperCase(),
                    telefono: newPhone,
                    avatar: newAvatar,
                    email: currentContext.email,
                    updatedAt: serverTimestamp()
                }, { merge: true });

                currentContext.displayName = newName.toUpperCase();
                currentContext.avatar = newAvatar;
                currentContext.telefono = newPhone;

                reflectNameChanges(currentContext.displayName);
                reflectAvatarChanges(newAvatar);

                const modal = document.getElementById('profileModalOverlay');
                if (modal) modal.classList.remove('open');

                showToast("✨ Identidad actualizada correctamente");
            } catch (e) {
                console.error("❌ Fallo en actualización de perfil:", e);

                const msg = (e?.message || '').toLowerCase();

                if (msg.includes('permission') || msg.includes('missing or insufficient permissions')) {
                    alert("Error de permisos en Firestore. El usuario autenticado en Firebase no tiene autorización para leer o editar su documento.");
                } else {
                    alert("Error al sincronizar con el servidor de identidad.");
                }
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-lucide="save" style="width:16px;"></i> Guardar Identidad';
                if (window.lucide) lucide.createIcons();
            }
        }

        function reflectAvatarChanges(seed) {
            if (!seed || seed === 'default') {
                reflectInitials(currentContext.displayName || currentContext.email || 'U');
                return;
            }

            const url = `https://api.dicebear.com/7.x/${AVATAR_COLLECTION}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${DEFAULT_BG}`;

            ['userAvatarCircle', 'avatarDropdownAvatar', 'profileModalAvatar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.innerHTML = `<img src="${url}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
                }
            });
        }

        function reflectInitials(value) {
            const initial = getInitial(value);

            ['userAvatarCircle', 'avatarDropdownAvatar', 'profileModalAvatar'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.innerHTML = `<span>${initial}</span>`;
                }
            });
        }

        function reflectNameChanges(name) {
            const cleanName = (name || '').toString().trim().toUpperCase();
            
            // Regla Institucional: Si el nombre contiene '@' no es un nombre real cargado, es un fallback a email
            // Solo sobrescribimos si el nombre es 'limpio' (sin @ y no es el placeholder)
            document.querySelectorAll('.user-name, .avatar-dropdown-name').forEach(el => {
                if (cleanName && !cleanName.includes('@')) {
                    el.textContent = cleanName;
                } else if (el.textContent === 'Nombre Usuario' || el.textContent === '' || !el.textContent) {
                    el.textContent = cleanName || 'USUARIO';
                }
            });
        }

        function getInitial(value) {
            return (value || 'U').toString().trim().charAt(0).toUpperCase();
        }

        function showToast(msg) {
            const toast = document.createElement('div');
            toast.style = "position:fixed;bottom:20px;right:20px;background:#22c55e;color:white;padding:12px 24px;border-radius:12px;z-index:10001;font-weight:800;box-shadow:0 10px 15px rgba(0,0,0,0.1);animation:fadeInUp 0.3s ease-out;";
            toast.innerHTML = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        return { init };
    })();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.OrbitaProfile.init());
} else {
    window.OrbitaProfile.init();
}
