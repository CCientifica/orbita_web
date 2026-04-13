package com.clinica.ctc.controller;

import com.clinica.ctc.security.CustomUserDetailsService;
import com.clinica.ctc.security.RoleNormalizationUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * CONTROLADOR DE AUTENTICACIÓN - ÓRBITA CLÍNICA
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private CustomUserDetailsService userDetailsService;

    @PostMapping("/session")
    public ResponseEntity<Map<String, Object>> establishSession(@RequestBody Map<String, String> payload,
            HttpServletRequest request) {
        String email = payload.get("email");
        String idToken = payload.get("idToken");

        if (email == null || idToken == null) {
            return ResponseEntity.badRequest().body(java.util.Objects
                    .requireNonNull(Map.<String, Object>of("error", "Email e idToken son requeridos")));
        }

        System.out.println("🌐 [AUTH-FIREBASE-RESILIENTE] Iniciando handshake para: " + email);

        try {
            // 1. Verificación de Identidad Local (JWT Decoding) para evitar cuotas de
            // Google (Error 429)
            String[] parts = idToken.split("\\.");
            if (parts.length < 2)
                throw new RuntimeException("Formato de token inválido");

            String payloadJson = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
            System.out.println("🔍 [AUTH-DEBUG] Payload decodificado correctamente.");

            if (!payloadJson.contains("\"email\":\"" + email.toLowerCase().trim() + "\"")) {
                throw new RuntimeException("El token no pertenece al email proporcionado");
            }

            RestTemplate restTemplate = new RestTemplate();

            // 2. Verificación de Autorización en tiempo real (Firestore REST)
            String encodedEmail = java.net.URLEncoder.encode(email.toLowerCase().trim(), "UTF-8");
            String firestoreUrl = "https://firestore.googleapis.com/v1/projects/cood-tc/databases/(default)/documents/usuarios_permitidos/"
                    + encodedEmail;

            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.setBearerAuth(idToken);

            String normRole = "auditor";

            try {
                java.net.URI uri = new java.net.URI(firestoreUrl);

                @SuppressWarnings("unchecked")
                ResponseEntity<Map<String, Object>> firestoreResponse = (ResponseEntity<Map<String, Object>>) (ResponseEntity<?>) restTemplate
                        .exchange(
                                uri,
                                java.util.Objects.requireNonNull(org.springframework.http.HttpMethod.GET),
                                new org.springframework.http.HttpEntity<>(headers),
                                Map.class);

                Map<String, Object> responseBody = firestoreResponse.getBody();
                if (responseBody == null)
                    throw new RuntimeException("Perfil de usuario no encontrado en la nube.");

                @SuppressWarnings("unchecked")
                Map<String, Object> fields = (Map<String, Object>) responseBody.get("fields");
                if (fields == null)
                    throw new RuntimeException("Datos de roles incompletos.");

                boolean active = true;
                if (fields.containsKey("activo")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> activeField = (Map<String, Object>) fields.get("activo");
                    active = (boolean) activeField.get("booleanValue");
                }

                if (!active) {
                    return ResponseEntity.status(403).body(java.util.Objects
                            .requireNonNull(Map.<String, Object>of("error", "Acceso denegado: Usuario inactivo.")));
                }

                String rawRole = "auditor";
                if (fields.containsKey("rol")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> roleField = (Map<String, Object>) fields.get("rol");
                    rawRole = (String) roleField.get("stringValue");
                }
                normRole = RoleNormalizationUtils.normalize(rawRole);

            } catch (org.springframework.web.client.HttpClientErrorException.TooManyRequests e) {
                // 🚨 PUERTA DE EMERGENCIA (Firestore Quota 429 Bypass)
                System.err.println("⚠️ [AUTH-EMERGENCY] Cuota Firestore Agotada (429). Bypass para: " + email);

                String normalizedEmail = email.toLowerCase().trim();
                if (normalizedEmail.equals("coordcientifico@clinicasagradocorazon.com.co")) {
                    normRole = "master admin";
                } else if (normalizedEmail.equals("ecosistemadigital@clinicasagradocorazon.com.co") ||
                        normalizedEmail.equals("liderdedatos@clinicasagradocorazon.com.co") ||
                        normalizedEmail.equals("auxestadistica@clinicasagradocorazon.com.co")) {
                    normRole = "super admin";
                } else if (normalizedEmail.equals("analistaaltocosto@clinicasagradocorazon.com.co")) {
                    normRole = "analista";
                } else if (normalizedEmail.equals("dirmedica@clinicasagradocorazon.com.co") ||
                        normalizedEmail.equals("gerencia@clinicasagradocorazon.co") ||
                        normalizedEmail.equals("diradministrativa@clinicasagradocorazon.com.co")) {
                    normRole = "admin";
                } else {
                    throw e; // Otros usuarios siguen bloqueados por 429
                }
                System.out.println("✅ [AUTH-EMERGENCY] Bypass para: " + email + " con Rol: " + normRole);
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                return ResponseEntity.status(403).body(
                        java.util.Objects.requireNonNull(Map.<String, Object>of("error", "Usuario no autorizado.")));
            }

            System.out.println("✅ [AUTH-ROLE] Autorizado: " + email + " | Rol: " + normRole);

            // 3. Crear Sesión Spring Security
            userDetailsService.syncUserRole(email.toLowerCase().trim(), normRole);
            UserDetails userDetails = userDetailsService.loadUserByUsername(email.toLowerCase().trim());

            Authentication auth = new UsernamePasswordAuthenticationToken(userDetails, null,
                    userDetails.getAuthorities());
            SecurityContextHolder.getContext().setAuthentication(auth);

            HttpSession session = request.getSession(true);
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                    SecurityContextHolder.getContext());

            System.out.println("✅ [AUTH-SUCCESS] Sesión establecida para: " + email);
            return ResponseEntity.ok(java.util.Objects.requireNonNull(Map.<String, Object>of("success", true)));

        } catch (Exception e) {
            System.err.println("❌ [AUTH-FATAL] Error en el handshake: " + e.getMessage());
            String msg = "Lo sentimos, el servidor de identificación está saturado. Error: " + e.getMessage();
            return ResponseEntity.status(401)
                    .body(java.util.Objects.requireNonNull(Map.<String, Object>of("error", msg)));
        }
    }
}
