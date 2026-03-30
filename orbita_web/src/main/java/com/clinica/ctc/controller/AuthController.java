package com.clinica.ctc.controller;

import com.clinica.ctc.security.CustomUserDetailsService;
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

import org.springframework.security.core.GrantedAuthority;
import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private CustomUserDetailsService userDetailsService;

    // API Key de Firebase (debe coincidir con la del frontend)
    private static final String FIREBASE_API_KEY = "AIzaSyD-kkAwT7iGI8jJc1wosV--TA4BjOaoH-Q";
    private static final String FIREBASE_VERIFY_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=" + FIREBASE_API_KEY;

    @PostMapping("/session")
    public ResponseEntity<?> establishSession(@RequestBody Map<String, String> payload, HttpServletRequest request) {
        String email = payload.get("email");
        String idToken = payload.get("idToken");
        
        if (email == null || idToken == null) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Email e idToken son requeridos"));
        }

        System.out.println("🌐 [AUTH-FIREBASE] Iniciando validación de sesión para: " + email);

        try {
            // 1. VALIDACIÓN REAL: Consultar a Google si el token es válido
            org.springframework.web.client.RestTemplate restTemplate = new org.springframework.web.client.RestTemplate();
            Map<String, String> verifyRequest = Collections.singletonMap("idToken", idToken);
            
            org.springframework.http.HttpEntity<Map<String, String>> entity = new org.springframework.http.HttpEntity<>(verifyRequest);
            
            ResponseEntity<Map<String, Object>> verifyResponse = restTemplate.exchange(
                FIREBASE_VERIFY_URL, 
                org.springframework.http.HttpMethod.POST, 
                entity, 
                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {}
            );
            
            Map<String, Object> body = verifyResponse.getBody();
            if (!verifyResponse.getStatusCode().is2xxSuccessful() || body == null) {
                System.err.println("❌ [AUTH-DENY] Fallo en la validación del token con Firebase");
                throw new RuntimeException("Token de Firebase inválido");
            }

            // 2. Extraer y verificar el email devuelto por Google/Firebase
            @SuppressWarnings("unchecked")
            java.util.List<Map<String, Object>> users = (java.util.List<Map<String, Object>>) body.get("users");
            if (users == null || users.isEmpty()) {
                throw new RuntimeException("No se encontró información de usuario en el token");
            }
            
            String googleVerifiedEmail = ((String) users.get(0).get("email")).toLowerCase().trim();
            if (!googleVerifiedEmail.equals(email.toLowerCase().trim())) {
                System.err.println("❌ [AUTH-DENY] Spoofing detectado: Email solicitado (" + email + ") != Firebase (" + googleVerifiedEmail + ")");
                throw new RuntimeException("Discrepancia de identidad en la autenticación");
            }

            System.out.println("✅ [AUTH-FIREBASE] Autenticación Firebase exitosa para: " + googleVerifiedEmail);

            // 3. Cargamos el usuario local (esto aplica filtrado por usuarios_permitidos y normalización de roles)
            UserDetails userDetails = userDetailsService.loadUserByUsername(googleVerifiedEmail);

            // 4. Establecemos la autenticación en Spring Security
            Authentication auth = new UsernamePasswordAuthenticationToken(
                    userDetails, 
                    null, 
                    userDetails.getAuthorities()
            );

            SecurityContextHolder.getContext().setAuthentication(auth);
            HttpSession session = request.getSession(true);
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, SecurityContextHolder.getContext());

            System.out.println("✅ [AUTH-SESSION] Sesión Spring creada para: " + googleVerifiedEmail);
            
            String assignedRoles = userDetails.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.joining(", "));
            System.out.println("🚩 [AUTH-ROLE] Rol final asignado: [" + assignedRoles + "]");

            return ResponseEntity.ok(Collections.singletonMap("success", true));

        } catch (Exception e) {
            System.err.println("❌ [AUTH-DENY] Acceso denegado: " + e.getMessage());
            return ResponseEntity.status(401).body(Collections.singletonMap("error", "Acceso denegado: " + e.getMessage()));
        }
    }
}
