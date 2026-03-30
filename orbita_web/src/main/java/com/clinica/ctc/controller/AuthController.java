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

        System.out.println("🌐 [AUTH-FIREBASE] Handshake iniciado para: " + email);

        try {
            RestTemplate restTemplate = new RestTemplate();
            
            // 1. Verificación de Identidad (Firebase Auth)
            Map<String, String> verifyRequest = Collections.singletonMap("idToken", idToken);
            @SuppressWarnings("unchecked")
            ResponseEntity<Map<String, Object>> verifyResponse = (ResponseEntity<Map<String, Object>>) (ResponseEntity<?>) 
                restTemplate.postForEntity(FIREBASE_VERIFY_URL, verifyRequest, Map.class);
            
            if (!verifyResponse.getStatusCode().is2xxSuccessful() || verifyResponse.getBody() == null) {
                throw new RuntimeException("Token de Firebase inválido");
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> users = (List<Map<String, Object>>) verifyResponse.getBody().get("users");
            if (users == null || users.isEmpty()) {
                throw new RuntimeException("No se encontró el usuario en el token");
            }
            
            String verifiedEmail = ((String) users.get(0).get("email")).toLowerCase().trim();
            
            if (!verifiedEmail.equals(email.toLowerCase().trim())) {
                throw new RuntimeException("Email no coincide con el token");
            }

            // 2. Verificación de Autorización (Firestore Cloud)
            String firestoreUrl = "https://firestore.googleapis.com/v1/projects/cood-tc/databases/(default)/documents/usuarios_permitidos/" + verifiedEmail;
            
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

                if (firestoreResponse.getBody() == null) throw new RuntimeException("Respuesta de Firestore vacía");
                
                @SuppressWarnings("unchecked")
                Map<String, Object> fields = (Map<String, Object>) firestoreResponse.getBody().get("fields");
                if (fields == null) throw new RuntimeException("Campos de Firestore no encontrados");
                
                boolean active = false;
                if (fields.containsKey("activo")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> activeField = (Map<String, Object>) fields.get("activo");
                    active = (boolean) activeField.get("booleanValue");
                }

                if (!active) {
                    System.err.println("❌ [AUTH-DENY] Usuario inactivo: " + verifiedEmail);
                    return ResponseEntity.status(403).body(Collections.singletonMap("error", "Usuario inactivo en el sistema."));
                }

                String rawRole = "auditor";
                if (fields.containsKey("rol")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> roleField = (Map<String, Object>) fields.get("rol");
                    rawRole = (String) roleField.get("stringValue");
                }

                String normRole = RoleNormalizationUtils.normalize(rawRole);
                System.out.println("✅ [AUTH-ROLE] Autorizado: " + verifiedEmail + " | Rol: " + normRole);

                // 3. Crear Sesión Spring
                userDetailsService.syncUserRole(verifiedEmail, normRole);
                UserDetails userDetails = userDetailsService.loadUserByUsername(verifiedEmail);

                Authentication auth = new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());
                SecurityContextHolder.getContext().setAuthentication(auth);
                
                HttpSession session = request.getSession(true);
                session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, SecurityContextHolder.getContext());

                System.out.println("✅ [AUTH-SESSION] Sesión establecida para: " + verifiedEmail);
                return ResponseEntity.ok(Collections.singletonMap("success", true));

            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                System.err.println("❌ [AUTH-DENY] No autorizado en Firestore: " + verifiedEmail);
                return ResponseEntity.status(403).body(Collections.singletonMap("error", "No tienes permisos de acceso."));
            }

        } catch (Exception e) {
            System.err.println("❌ [AUTH-DENY] Error general: " + e.getMessage());
            return ResponseEntity.status(401).body(Collections.singletonMap("error", "Autenticación fallida o error en el handshake."));
        }
    }
}
