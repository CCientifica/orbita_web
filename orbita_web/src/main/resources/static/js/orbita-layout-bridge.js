/**
 * 🛰️ ÓRBITA LAYOUT BRIDGE & ATTRIBUTE TRANSLATOR
 * ---------------------------------------------
 * Versión 1.5: Resiliencia Total para Entornos Estáticos (Firebase).
 * Garantiza paridad visual institucional sin romper la lógica local.
 */

(function() {
    const isStatic = window.location.protocol === 'file:' || 
                     window.location.hostname.includes('firebaseapp.com') || 
                     window.location.hostname.includes('web.app') ||
                     (window.location.hostname === 'localhost' && 
                      window.location.port !== '8080' && 
                      window.location.port !== '8081');

    // 1. Traductor Universal de Atributos
    function translateAttributes(container = document) {
        // Traducir th:src, th:href y th:text a sus equivalentes nativos
        const elements = container.querySelectorAll('[th\\:src], [th\\:href], [th\\:text]');
        elements.forEach(el => {
            const thSrc = el.getAttribute('th:src');
            const thHref = el.getAttribute('th:href');
            const thText = el.getAttribute('th:text');

            const resolvePath = (val) => {
                if (!val) return null;
                // Maneja @{/path} -> /path
                return val.replace(/@\{(.+?)\}/, '$1').split('(')[0];
            };

            if (thSrc) {
                const path = resolvePath(thSrc);
                if (path && !el.src) el.setAttribute('src', path);
            }
            if (thHref) {
                const path = resolvePath(thHref);
                // Si ya tiene un href estático válido, no lo pisamos a menos que esté vacío
                if (path && (!el.getAttribute('href') || el.getAttribute('href').startsWith('th:'))) {
                     el.setAttribute('href', path);
                }
            }
            if (thText && isStatic && !el.innerText) {
                // Si es un literal tipo 'Texto', lo asignamos
                const literalMatch = thText.match(/'(.+?)'/);
                if (literalMatch) el.textContent = literalMatch[1];
            }
        });
    }

    // 2. Inyección de Shell Institucional (Sidebar, Navbar, Footer)
    async function injectShell() {
        if (!isStatic) return;

        console.log("⚓ Orbita Bridge: Restaurando Shell Institucional...");

        try {
            const response = await fetch('/layout.html');
            if (!response.ok) return;

            const html = await response.text();
            const parser = new DOMParser();
            const layoutDoc = parser.parseFromString(html, 'text/html');

            // Mapeo de Fragmentos Oficiales
            const fragments = {
                sidebar: layoutDoc.querySelector('[th\\:fragment="sidebar"]') || layoutDoc.querySelector('#sidebar'),
                navbar: layoutDoc.querySelector('[th\\:fragment^="navbar"]') || layoutDoc.querySelector('.navbar'),
                footer: layoutDoc.querySelector('[th\\:fragment="footer"]') || layoutDoc.querySelector('.dashboard-footer'),
                scripts: layoutDoc.querySelector('[th\\:fragment="ui-scripts"]') || layoutDoc.querySelector('#ui-scripts')
            };

            // Inyectar Sidebar
            const sidebarTarget = document.querySelector('aside[th\\:replace*="sidebar"]');
            if (sidebarTarget && fragments.sidebar) {
                sidebarTarget.innerHTML = fragments.sidebar.innerHTML;
                sidebarTarget.className = fragments.sidebar.className;
                sidebarTarget.id = fragments.sidebar.id || 'sidebar';
                translateAttributes(sidebarTarget);
            }

            // Inyectar Navbar
            const navbarTarget = document.querySelector('nav[th\\:replace*="navbar"]');
            if (navbarTarget && fragments.navbar) {
                const customTitle = navbarTarget.getAttribute('th:replace').match(/'(.+?)'/);
                navbarTarget.innerHTML = fragments.navbar.innerHTML;
                navbarTarget.className = fragments.navbar.className;
                if (customTitle && navbarTarget.querySelector('.navbar-page-title')) {
                    navbarTarget.querySelector('.navbar-page-title').innerText = customTitle[1];
                }
                translateAttributes(navbarTarget);
            }

            // Inyectar Footer
            const footerTarget = document.querySelector('footer[th\\:replace*="footer"]');
            if (footerTarget && fragments.footer) {
                footerTarget.innerHTML = fragments.footer.innerHTML;
                footerTarget.className = fragments.footer.className;
                footerTarget.style.cssText = fragments.footer.style.cssText;
                translateAttributes(footerTarget);
            }

            // Inyectar Scripts y Modal de Perfil
            const scriptsTarget = document.querySelector('div[th\\:replace*="scripts"]');
            if (scriptsTarget && fragments.scripts) {
                const scriptsContainer = document.createElement('div');
                scriptsContainer.innerHTML = fragments.scripts.innerHTML;
                scriptsTarget.parentNode.replaceChild(scriptsContainer, scriptsTarget);
                
                // Ejecución segura de scripts inyectados
                translateAttributes(scriptsContainer);
                scriptsContainer.querySelectorAll('script').forEach(oldScript => {
                    const newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                    if (oldScript.src) newScript.src = oldScript.src;
                    else newScript.textContent = oldScript.textContent;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });
            }

            // Refrescar iconos Lucide
            if (window.lucide) lucide.createIcons();

        } catch (err) {
            console.error("❌ Orbita Bridge Error:", err);
        }
    }

    // 3. Bridge de Autenticación para Entornos Estáticos
    function initAuthBridge() {
        if (!isStatic) return;

        window.addEventListener('firebase-ready', async (e) => {
            const user = e.detail;
            try {
                // Esperar a firestore mediante el shim
                let wait = 0;
                while (!window.firebaseFirestore && wait < 20) {
                    await new Promise(r => setTimeout(r, 100));
                    wait++;
                }

                if (!window.firebaseFirestore) return;

                const db = window.firebaseFirestore;
                const docRef = db.doc(null, 'usuarios_permitidos', user.email.toLowerCase().trim());
                const snap = await db.getDoc(docRef);

                let orbitaUser = {
                    email: user.email,
                    displayName: user.displayName || user.email.split('@')[0],
                    role: 'invitado'
                };

                if (snap.exists()) {
                    const data = snap.data();
                    orbitaUser.role = data.rol || orbitaUser.role;
                    if (data.nombre) orbitaUser.displayName = data.nombre;
                }

                window.orbitaUser = orbitaUser;
                window.dispatchEvent(new CustomEvent('user-ready', { detail: orbitaUser }));

            } catch (err) {
                console.warn("⚠️ Auth Bridge falló:", err);
            }
        });
    }

    // Ejecución inicial rápida
    translateAttributes();
    if (isStatic) {
        injectShell().then(initAuthBridge);
    }

})();
