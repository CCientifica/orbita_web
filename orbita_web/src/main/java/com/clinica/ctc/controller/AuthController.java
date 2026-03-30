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

import java.util.Collections;
import java.util.Map;
import java.util.List;

/**
 * CONTROLADOR DE AUTENTICACIÓN - ÓRBITA CLÍNICA
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private CustomUserDetailsService userDetailsService;

    private static final String FIREBASE_API_KEY = "AIzaSyD-kkAwT7iGI8jJc1wosV--TA4BjOaoH-Q";
    private static final String FIREBASE_VERIFY_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=" + FIREBASE_API_KEY;

    @PostMapping("/session")
    public ResponseEntity<Map<String, Object>> establishSession(@RequestBody Map<String, String> payload, HttpServletRequest request) {
        String email = payload.get("email");
        String idToken = payload.get("idToken");
        
        if (email == null || idToken == null) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Email e idToken son requeridos"));
        }

        System.out.println("🌐 [AUTH-FIREBASE-RESILIENTE] Iniciando handshake para: " + email);

        try {
            // 1. Verificación de Identidad Local (JWT Decoding) para evitar cuotas de Google (Error 429)
            // Extraer email directamente del payload del JWT (Base64 URL)
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) throw new RuntimeException("Formato de token inválido");
            
            String payloadJson = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
            System.out.println("🔍 [AUTH-DEBUG] Payload decodificado correctamente.");

            // Verificación estricta: El email en el token DEBE coincidir con el solicitado
            if (!payloadJson.contains("\"email\":\"" + email.toLowerCase().trim() + "\"")) {
                throw new RuntimeException("El token no pertenece al email proporcionado");
            }

            RestTemplate restTemplate = new RestTemplate();
            
            // 2. Verificación de Autorización en tiempo real (Firestore REST)
            // Se usa el idToken como portador; si el token es falso, Firestore rechazará la petición (401/403).
            String encodedEmail = java.net.URLEncoder.encode(email.toLowerCase().trim(), "UTF-8");
            String firestoreUrl = "https://firestore.googleapis.com/v1/projects/cood-tc/databases/(default)/documents/usuarios_permitidos/" + encodedEmail;
            
            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.setBearerAuth(idToken);
            
            try {
                @SuppressWarnings("unchecked")
                ResponseEntity<Map<String, Object>> firestoreResponse = (ResponseEntity<Map<String, Object>>) (ResponseEntity<?>) 
                    restTemplate.exchange(
                        firestoreUrl, 
                        org.springframework.http.HttpMethod.GET, 
                        new org.springframework.http.HttpEntity<>(headers), 
                        Map.class
                    );

                if (firestoreResponse.getBody() == null) throw new RuntimeException("Perfil de usuario no encontrado en la nube.");
                
                @SuppressWarnings("unchecked")
                Map<String, Object> fields = (Map<String, Object>) firestoreResponse.getBody().get("fields");
                if (fields == null) throw new RuntimeException("Datos de roles incompletos.");
                
                boolean active = true;
                if (fields.containsKey("activo")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> activeField = (Map<String, Object>) fields.get("activo");
                    active = (boolean) activeField.get("booleanValue");
                }

                if (!active) {
                    return ResponseEntity.status(403).body(Collections.singletonMap("error", "Acceso denegado: Usuario inactivo."));
                }

                String rawRole = "auditor";
                if (fields.containsKey("rol")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> roleField = (Map<String, Object>) fields.get("rol");
                    rawRole = (String) roleField.get("stringValue");
                }

                String normRole = RoleNormalizationUtils.normalize(rawRole);
                System.out.println("✅ [AUTH-ROLE] Autorizado: " + email + " | Rol: " + normRole);

                // 3. Crear Sesión Spring Security
                userDetailsService.syncUserRole(email.toLowerCase().trim(), normRole);
                UserDetails userDetails = userDetailsService.loadUserByUsername(email.toLowerCase().trim());

                Authentication auth = new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());
                SecurityContextHolder.getContext().setAuthentication(auth);
                
                HttpSession session = request.getSession(true);
                session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, SecurityContextHolder.getContext());

                System.out.println("✅ [AUTH-SUCCESS] Sesión maestra establecida para: " + email);
                return ResponseEntity.ok(Collections.singletonMap("success", true));

            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                return ResponseEntity.status(403).body(Collections.singletonMap("error", "Usuario no autorizado para entrar al ecosistema."));
            }

        } catch (Exception e) {
            System.err.println("❌ [AUTH-FATAL] Error en el handshake resiliente: " + e.getMessage());
            return ResponseEntity.status(401).body(Collections.singletonMap("error", "Lo sentimos, el servidor de identificación está saturado. Reintente en un momento. Error: " + e.getMessage()));
        }
    }
}
