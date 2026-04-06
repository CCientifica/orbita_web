/**
 * 🛰️ ÓRBITA LAYOUT BRIDGE & ATTRIBUTE TRANSLATOR
 * ---------------------------------------------
 * Versión 1.6: Protección contra recargas duplicadas, sobreinyección de scripts
 * y consultas repetidas a Firestore.
 * Garantiza paridad visual institucional sin romper la lógica local.
 */

(function () {
    if (window.__orbitaLayoutBridgeLoaded) {
        console.warn("⚠️ Orbita Layout Bridge ya estaba cargado. Se evita doble inicialización.");
        return;
    }
    window.__orbitaLayoutBridgeLoaded = true;

    const isStatic =
        window.location.protocol === "file:" ||
        window.location.hostname.includes("firebaseapp.com") ||
        window.location.hostname.includes("web.app") ||
        (window.location.hostname === "localhost" &&
            window.location.port !== "8080" &&
            window.location.port !== "8081");

    let authBridgeInitialized = false;
    let permissionCheckInFlight = false;
    let permissionCheckedEmail = null;

    function normalizeEmail(email) {
        return String(email || "").toLowerCase().trim();
    }

    function safeCustomTitleFromReplace(attrValue) {
        if (!attrValue) return null;
        const match = attrValue.match(/'(.+?)'/);
        return match ? match[1] : null;
    }

    function resolvePath(val) {
        if (!val) return null;
        return val.replace(/@\{(.+?)\}/, "$1").split("(")[0];
    }

    function translateAttributes(container = document) {
        const elements = container.querySelectorAll("[th\\:src], [th\\:href], [th\\:text]");

        elements.forEach((el) => {
            const thSrc = el.getAttribute("th:src");
            const thHref = el.getAttribute("th:href");
            const thText = el.getAttribute("th:text");

            if (thSrc) {
                const path = resolvePath(thSrc);
                if (path && !el.getAttribute("src")) {
                    el.setAttribute("src", path);
                }
            }

            if (thHref) {
                const path = resolvePath(thHref);
                const currentHref = el.getAttribute("href");
                if (path && (!currentHref || currentHref.startsWith("th:"))) {
                    el.setAttribute("href", path);
                }
            }

            if (thText && isStatic && !el.innerText) {
                const literalMatch = thText.match(/'(.+?)'/);
                if (literalMatch) {
                    el.textContent = literalMatch[1];
                }
            }
        });
    }

    async function waitForFirestore(maxAttempts = 20, delayMs = 100) {
        let wait = 0;
        while (!window.firebaseFirestore && wait < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs));
            wait++;
        }
        return !!window.firebaseFirestore;
    }

    async function injectShell() {
        if (!isStatic) return;

        if (window.__orbitaShellInjected) {
            console.log("ℹ️ Orbita Bridge: Shell ya inyectado, se omite reinyección.");
            return;
        }

        console.log("⚓ Orbita Bridge: Restaurando Shell Institucional...");

        try {
            const response = await fetch("/layout.html", { cache: "no-store" });
            if (!response.ok) {
                console.warn("⚠️ No se pudo cargar /layout.html");
                return;
            }

            const html = await response.text();
            const parser = new DOMParser();
            const layoutDoc = parser.parseFromString(html, "text/html");

            const fragments = {
                sidebar:
                    layoutDoc.querySelector('[th\\:fragment="sidebar"]') ||
                    layoutDoc.querySelector("#sidebar"),
                navbar:
                    layoutDoc.querySelector('[th\\:fragment^="navbar"]') ||
                    layoutDoc.querySelector(".navbar"),
                footer:
                    layoutDoc.querySelector('[th\\:fragment="footer"]') ||
                    layoutDoc.querySelector(".dashboard-footer"),
                scripts:
                    layoutDoc.querySelector('[th\\:fragment="ui-scripts"]') ||
                    layoutDoc.querySelector("#ui-scripts"),
            };

            const sidebarTarget = document.querySelector('aside[th\\:replace*="sidebar"]');
            if (sidebarTarget && fragments.sidebar && !sidebarTarget.dataset.orbitaInjected) {
                sidebarTarget.innerHTML = fragments.sidebar.innerHTML;
                sidebarTarget.className = fragments.sidebar.className;
                sidebarTarget.id = fragments.sidebar.id || "sidebar";
                sidebarTarget.dataset.orbitaInjected = "true";
                translateAttributes(sidebarTarget);
            }

            const navbarTarget = document.querySelector('nav[th\\:replace*="navbar"]');
            if (navbarTarget && fragments.navbar && !navbarTarget.dataset.orbitaInjected) {
                const customTitle = safeCustomTitleFromReplace(navbarTarget.getAttribute("th:replace"));
                navbarTarget.innerHTML = fragments.navbar.innerHTML;
                navbarTarget.className = fragments.navbar.className;
                navbarTarget.dataset.orbitaInjected = "true";

                const titleNode = navbarTarget.querySelector(".navbar-page-title");
                if (customTitle && titleNode) {
                    titleNode.innerText = customTitle;
                }

                translateAttributes(navbarTarget);
            }

            const footerTarget = document.querySelector('footer[th\\:replace*="footer"]');
            if (footerTarget && fragments.footer && !footerTarget.dataset.orbitaInjected) {
                footerTarget.innerHTML = fragments.footer.innerHTML;
                footerTarget.className = fragments.footer.className;
                footerTarget.style.cssText = fragments.footer.style.cssText;
                footerTarget.dataset.orbitaInjected = "true";
                translateAttributes(footerTarget);
            }

            const scriptsTarget = document.querySelector('div[th\\:replace*="scripts"]');
            if (scriptsTarget && fragments.scripts && !window.__orbitaScriptsInjected) {
                window.__orbitaScriptsInjected = true;

                const scriptsContainer = document.createElement("div");
                scriptsContainer.innerHTML = fragments.scripts.innerHTML;

                if (scriptsTarget.parentNode) {
                    scriptsTarget.parentNode.replaceChild(scriptsContainer, scriptsTarget);
                }

                translateAttributes(scriptsContainer);

                scriptsContainer.querySelectorAll("script").forEach((oldScript) => {
                    const src = oldScript.getAttribute("src");

                    if (src) {
                        const existing = document.querySelector(`script[src="${src}"]`);
                        if (existing) {
                            return;
                        }
                    }

                    const newScript = document.createElement("script");
                    Array.from(oldScript.attributes).forEach((attr) => {
                        newScript.setAttribute(attr.name, attr.value);
                    });

                    if (oldScript.src) {
                        newScript.src = oldScript.src;
                    } else {
                        newScript.textContent = oldScript.textContent;
                    }

                    if (oldScript.parentNode) {
                        oldScript.parentNode.replaceChild(newScript, oldScript);
                    }
                });
            }

            if (window.lucide) {
                window.lucide.createIcons();
            }

            window.__orbitaShellInjected = true;
        } catch (err) {
            console.error("❌ Orbita Bridge Error:", err);
        }
    }

    function emitUserReady(orbitaUser) {
        window.orbitaUser = orbitaUser;
        window.dispatchEvent(new CustomEvent("user-ready", { detail: orbitaUser }));
    }

    async function resolveOrbitaUser(user) {
        const normalizedEmail = normalizeEmail(user?.email);

        if (!normalizedEmail) {
            return {
                email: "",
                displayName: "Invitado",
                role: "invitado",
            };
        }

        if (
            permissionCheckedEmail === normalizedEmail &&
            window.orbitaUser &&
            window.orbitaUser.email === normalizedEmail
        ) {
            return window.orbitaUser;
        }

        const cacheKey = `orbitaUser:${normalizedEmail}`;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.email === normalizedEmail) {
                    permissionCheckedEmail = normalizedEmail;
                    return parsed;
                }
            }
        } catch (e) {
            console.warn("⚠️ No se pudo leer cache de sesión de orbitaUser:", e);
        }

        const firestoreReady = await waitForFirestore();
        if (!firestoreReady) {
            return {
                email: normalizedEmail,
                displayName: user.displayName || normalizedEmail.split("@")[0],
                role: "invitado",
            };
        }

        const db = window.firebaseFirestore;
        const docRef = db.doc(null, "usuarios_permitidos", normalizedEmail);
        const snap = await db.getDoc(docRef);

        let orbitaUser = {
            email: normalizedEmail,
            displayName: user.displayName || normalizedEmail.split("@")[0],
            role: "invitado",
        };

        if (snap.exists()) {
            const data = snap.data() || {};
            orbitaUser.role = data.rol || orbitaUser.role;
            if (data.nombre) {
                orbitaUser.displayName = data.nombre;
            }
        }

        permissionCheckedEmail = normalizedEmail;

        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(orbitaUser));
        } catch (e) {
            console.warn("⚠️ No se pudo guardar cache de sesión de orbitaUser:", e);
        }

        return orbitaUser;
    }

    function initAuthBridge() {
        if (!isStatic) return;
        if (authBridgeInitialized) {
            console.log("ℹ️ Auth Bridge ya inicializado, se evita doble listener.");
            return;
        }

        authBridgeInitialized = true;

        window.addEventListener("firebase-ready", async (e) => {
            const user = e.detail;

            if (!user || !user.email) {
                console.warn("⚠️ Evento firebase-ready sin usuario válido.");
                return;
            }

            const normalizedEmail = normalizeEmail(user.email);

            if (permissionCheckInFlight) {
                console.log("⏳ Ya hay una validación de permisos en curso. Se omite duplicado.");
                return;
            }

            if (
                permissionCheckedEmail === normalizedEmail &&
                window.orbitaUser &&
                window.orbitaUser.email === normalizedEmail
            ) {
                emitUserReady(window.orbitaUser);
                return;
            }

            permissionCheckInFlight = true;

            try {
                const orbitaUser = await resolveOrbitaUser(user);
                emitUserReady(orbitaUser);
            } catch (err) {
                console.warn("⚠️ Auth Bridge falló:", err);

                const fallbackUser = {
                    email: normalizedEmail,
                    displayName: user.displayName || normalizedEmail.split("@")[0],
                    role: "invitado",
                };

                emitUserReady(fallbackUser);
            } finally {
                permissionCheckInFlight = false;
            }
        });
    }

    translateAttributes();

    if (isStatic) {
        injectShell().then(() => {
            initAuthBridge();
        });
    }
})();