/**
 * user-ui.js
 * Interfaz de Usuario para la Gestión de Usuarios - ÓrbitA Premium
 */
const userUI = (function () {
    let usersList = [];
    let userModal = null;
    let deleteModal = null;
    let emailToDelete = null;

    // Colección Adventurer Neutral (20 Avatares)
    const AVATARS = [
        { id: 'Easton', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Eliza', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Riley', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Andrea', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Liliana', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Christian', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Brian', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Jameson', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Alexander', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Abigail', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Angel', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Bentley', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Brooklyn', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Caleb', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Claire', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Daniel', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Daisy', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Ethan', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Evelin', bg: 'f1f5f9', collection: 'adventurer-neutral' },
        { id: 'Finn', bg: 'f1f5f9', collection: 'adventurer-neutral' }
    ];

    /**
     * Inicialización automática al cargar el DOM
     */
    document.addEventListener('DOMContentLoaded', function () {
        window.addEventListener('user-ready', (e) => {
            const user = e.detail;
            const role = (user.role || '').toLowerCase().trim();
            const loadingState = document.getElementById('loading-state');
            const accessDenied = document.getElementById('access-denied');
            const userUIContainer = document.getElementById('user-management-ui');

            if (!userUIContainer) return;

            if (role === 'master admin') {
                if (loadingState) loadingState.classList.add('d-none');
                if (accessDenied) accessDenied.classList.add('d-none');
                userUIContainer.classList.remove('d-none');
                init();
            } else {
                if (loadingState) loadingState.classList.add('d-none');
                if (accessDenied) accessDenied.classList.remove('d-none');
                if (userUIContainer) userUIContainer.classList.add('d-none');
            }
        });

        // REINTENTO AUTOMÁTICO: Cuando Firebase confirma sesión lista
        window.addEventListener('firebase-ready', () => {
            if (window.orbitaUser && window.orbitaUser.role.toLowerCase().trim() === 'master admin') {
                console.log('[USER-UI] Firebase listo, refrescando tabla...');
                refreshTable();
            }
        });

        // Fallback si el usuario ya está listo
        if (window.orbitaUser && document.getElementById('user-management-ui')) {
            window.dispatchEvent(new CustomEvent('user-ready', { detail: window.orbitaUser }));
        }
    });

    /**
     * Inicialización central de componentes
     */
    function init() {
        // Modales
        const userModalEl = document.getElementById('userModal');
        const deleteModalEl = document.getElementById('deleteModal');

        if (userModalEl) userModal = new bootstrap.Modal(userModalEl);
        if (deleteModalEl) deleteModal = new bootstrap.Modal(deleteModalEl);

        // Selector de Avatares (Solo una vez)
        initAvatarSelector();

        refreshTable();
    }

    /**
     * Inicializa la cuadrícula de selección de avatares
     */
    function initAvatarSelector() {
        const container = document.getElementById('avatar-selector');
        if (!container) return;

        container.innerHTML = '';
        AVATARS.forEach(item => {
            const img = document.createElement('img');
            img.src = `https://api.dicebear.com/7.x/${item.collection}/svg?seed=${item.id}&backgroundColor=${item.bg}`;
            img.className = 'avatar-option';
            img.dataset.seed = item.id;
            img.onclick = () => selectAvatar(item.id);
            container.appendChild(img);
        });
    }

    /**
     * Maneja la selección visual del avatar
     */
    function selectAvatar(seedId) {
        const item = AVATARS.find(a => a.id === seedId) || AVATARS[0];
        document.getElementById('user-avatar-id').value = seedId;
        const options = document.querySelectorAll('.avatar-option');
        options.forEach(opt => opt.classList.toggle('selected', opt.dataset.seed === seedId));

        const preview = document.getElementById('selected-avatar-preview');
        const initials = document.getElementById('initials-preview');

        preview.src = `https://api.dicebear.com/7.x/${item.collection}/svg?seed=${item.id}&backgroundColor=${item.bg}`;
        preview.classList.remove('d-none');
        initials.classList.add('d-none');
    }

    /**
     * Refresca el panel cargando datos
     */
    async function refreshTable() {
        const tbody = document.getElementById('users-table-body');
        const countText = document.getElementById('user-count-text');

        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border text-primary opacity-25" role="status"></div><p class="small text-muted mt-2">Sincronizando con Ecosistema...</p></td></tr>';

        try {
            usersList = await userManagement.loadUsers();
            if (countText) countText.textContent = `${usersList.length} registros activos en el sistema`;
            renderTable(usersList);
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-5"><i data-lucide="cloud-off" class="text-danger mb-2"></i><br><span class="text-danger font-outfit fw-bold">${error.message}</span></td></tr>`;
            if (window.lucide) lucide.createIcons();
        }
    }

    /**
     * Renderiza la tabla modernizada
     */
    function renderTable(users) {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted small">No se detectaron perfiles registrados.</td></tr>';
            return;
        }

        users.forEach(user => {
            const tr = document.createElement('tr');
            const isMaster = user.email === 'coordcientifico@clinicasagradocorazon.com.co';
            const initials = user.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            // Buscar configuración de avatar
            const config = AVATARS.find(a => a.id === user.avatar) || 
                          { id: user.avatar, bg: 'f1f5f9', collection: 'adventurer-neutral' };
            const avatarHtml = user.avatar && user.avatar !== 'default'
                ? `<img src="https://api.dicebear.com/7.x/${config.collection}/svg?seed=${config.id}&backgroundColor=${config.bg}" class="user-avatar-circle" style="object-fit: contain;">`
                : `<div class="user-avatar-circle bg-slate-200 text-slate-500">${initials}</div>`;

            tr.innerHTML = `
                <td class="ps-4 py-3">
                    <div class="d-flex align-items-center gap-3">
                        ${avatarHtml}
                        <div>
                            <div class="fw-bold text-slate-800">${user.nombre}</div>
                            <div class="text-muted x-small">${isMaster ? '<span class="text-primary fw-bold">ADMINISTRADOR MAESTRO</span>' : 'Colaborador Institucional'}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="small fw-medium text-slate-600">${user.email}</div>
                    <div class="text-muted x-small">Autenticación Google activa</div>
                </td>
                <td>${getRoleBadge(user.rol)}</td>
                <td>
                    <span class="status-badge ${user.activo ? 'bg-emerald-subtle text-emerald' : 'bg-rose-subtle text-rose'}">
                        ${user.activo ? '● ACTIVO' : '● SUSPENDIDO'}
                    </span>
                </td>
                <td class="text-end pe-4">
                    <div class="d-flex justify-content-end gap-2">
                        <button class="btn-action" onclick="userUI.openEditModal('${user.email}')" title="Editar Perfil">
                            <i data-lucide="settings-2" style="width: 14px; color: #64748b;"></i>
                        </button>
                        <button class="btn-action" onclick="userUI.openDeleteModal('${user.email}')" title="Eliminar Registro" ${isMaster ? 'disabled' : ''}>
                            <i data-lucide="user-minus" style="width: 14px; color: #ef4444;"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (window.lucide) lucide.createIcons();
    }

    /**
     * Generador de Badges con jerarquía visual de ÓrbitA
     */
    function getRoleBadge(role) {
        const r = (role || '').toLowerCase().trim();
        let bg = '', text = '', label = role.toUpperCase();

        switch (r) {
            case 'master admin':
                bg = '#1e293b'; text = '#ffffff'; label = 'MASTER ADMIN';
                break;
            case 'super admin':
                bg = '#3b82f6'; text = '#ffffff'; label = 'SUPER ADMIN';
                break;
            case 'admin':
                bg = '#0ea5e9'; text = '#ffffff'; label = 'ADMIN';
                break;
            case 'analista':
                bg = '#f59e0b'; text = '#ffffff'; label = 'ANALISTA';
                break;
            case 'auditor':
                bg = '#8b5cf6'; text = '#ffffff'; label = 'AUDITORÍA';
                break;
            default:
                bg = '#f1f5f9'; text = '#64748b'; label = role.toUpperCase();
        }
        return `<span class="badge fw-bold" style="padding: 5px 12px; font-size: 10px; border-radius: 6px; background-color: ${bg}; color: ${text}">${label}</span>`;
    }

    /**
     * Filtrado instantáneo
     */
    function filterTable() {
        const query = document.getElementById('user-search').value.toLowerCase();
        const filtered = usersList.filter(user =>
            user.nombre.toLowerCase().includes(query) ||
            user.email.toLowerCase().includes(query) ||
            user.rol.toLowerCase().includes(query)
        );
        renderTable(filtered);
    }

    /**
     * Modales
     */
    function openCreateModal() {
        document.getElementById('userModalLabel').textContent = 'Nuevo Registro';
        document.getElementById('saveBtnText').textContent = 'Crear Colaborador';
        document.getElementById('userForm').reset();
        document.getElementById('edit-original-email').value = '';
        document.getElementById('user-email').disabled = false;

        // Reset Avatar
        document.getElementById('user-avatar-id').value = 'default';
        document.getElementById('selected-avatar-preview').classList.add('d-none');
        document.getElementById('initials-preview').classList.remove('d-none');
        document.getElementById('initials-preview').textContent = '?';
        document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));

        userModal.show();
    }

    function openEditModal(email) {
        const user = usersList.find(u => u.email === email);
        if (!user) return;

        document.getElementById('userModalLabel').textContent = 'Configuración de Perfil';
        document.getElementById('saveBtnText').textContent = 'Guardar Cambios';
        document.getElementById('edit-original-email').value = email;

        document.getElementById('user-email').value = user.email;
        document.getElementById('user-email').disabled = true;
        document.getElementById('user-name').value = user.nombre;
        document.getElementById('user-rol').value = user.rol;
        document.getElementById('user-active').checked = user.activo;

        // Cargar Avatar
        if (user.avatar && user.avatar !== 'default') {
            selectAvatar(user.avatar);
        } else {
            document.getElementById('user-avatar-id').value = 'default';
            document.getElementById('selected-avatar-preview').classList.add('d-none');
            document.getElementById('initials-preview').classList.remove('d-none');
            const initials = user.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            document.getElementById('initials-preview').textContent = initials;
            document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
        }

        userModal.show();
    }

    /**
     * Persistencia Híbrida
     */
    async function handleSaveUser() {
        const form = document.getElementById('userForm');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const email = document.getElementById('user-email').value;
        const nombre = document.getElementById('user-name').value;
        const rol = document.getElementById('user-rol').value;
        const activo = document.getElementById('user-active').checked;
        const avatar = document.getElementById('user-avatar-id').value;
        const originalEmail = document.getElementById('edit-original-email').value;

        setSaveBtnLoading(true);

        try {
            if (originalEmail) {
                await userManagement.updateUser(originalEmail, {
                    nombre, rol, activo, avatar
                });
                showToast('Cambios persistidos correctamente', 'bg-success');
            } else {
                if (!userManagement.isValidDomain(email)) {
                    throw new Error('Solo se permiten correos @clinicasagradocorazon.com.co');
                }
                const exists = await userManagement.checkUserExists(email);
                if (exists) throw new Error('Este usuario ya fue registrado en el sistema');

                await userManagement.createUser(email, nombre, rol, activo, { avatar });
                showToast('Usuario incorporado exitosamente', 'bg-success');
            }

            userModal.hide();
            refreshTable();
        } catch (error) {
            showToast(error.message, 'bg-danger');
        } finally {
            setSaveBtnLoading(false);
        }
    }

    /**
     * Eliminación de Seguridad
     */
    function openDeleteModal(email) {
        emailToDelete = email;
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        confirmBtn.onclick = async () => {
            try {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
                await userManagement.deleteUser(emailToDelete);
                showToast('Acceso revocado exitosamente', 'bg-success');
                deleteModal.hide();
                refreshTable();
            } catch (error) {
                showToast(error.message, 'bg-danger');
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Eliminar';
            }
        };
        deleteModal.show();
    }

    function showToast(message, bgColor) {
        const toastEl = document.getElementById('liveToast');
        const toastBody = document.getElementById('toastMessage');
        toastEl.classList.remove('bg-success', 'bg-danger', 'bg-warning', 'bg-info');
        toastEl.classList.add(bgColor);
        toastBody.textContent = message;
        new bootstrap.Toast(toastEl, { delay: 4000 }).show();
    }

    function setSaveBtnLoading(loading) {
        const btn = document.getElementById('saveUserBtn');
        const text = document.getElementById('saveBtnText');
        const spinner = document.getElementById('saveBtnSpinner');
        btn.disabled = loading;
        text.classList.toggle('d-none', loading);
        spinner.classList.toggle('d-none', !loading);
    }

    return {
        init,
        refreshTable,
        renderTable,
        filterTable,
        openCreateModal,
        openEditModal,
        openDeleteModal,
        handleSaveUser
    };
})();
