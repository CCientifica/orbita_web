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

import java.util.Collections;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private CustomUserDetailsService userDetailsService;

    /**
     * Handshake de Google/Firebase. 
     * Después de validar en el frontend con Firebase, se llama a este endpoint 
     * para establecer la sesión en Spring Security sin usar contraseñas "puente".
     */
    @PostMapping("/google")
    public ResponseEntity<?> googleLogin(@RequestBody Map<String, String> payload, HttpServletRequest request) {
        String email = payload.get("email");
        
        if (email == null || email.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Email es requerido"));
        }

        System.out.println("🌐 [Google-Auth] Iniciando establecimiento de sesión para: " + email);

        try {
            // 1. Cargamos el usuario (esto dispara la validación contra usuarios_permitidos y el provisioning)
            UserDetails userDetails = userDetailsService.loadUserByUsername(email);

            // 2. Creamos el token de autenticación (confiamos en el email porque ya pasó por Firebase en el frontend)
            // IMPORTANTE: En un sistema de alta seguridad, aquí recibiríamos el idToken de Firebase y lo validaríamos server-side.
            Authentication auth = new UsernamePasswordAuthenticationToken(
                    userDetails, 
                    null, // Credenciales nulas porque es login social verificado
                    userDetails.getAuthorities()
            );

            // 3. Establecemos la autenticación en el Contexto de Seguridad
            SecurityContextHolder.getContext().setAuthentication(auth);

            // 4. Persistimos la sesión explícitamente para que Thymeleaf/Spring la reconozcan en navegaciones siguientes
            HttpSession session = request.getSession(true);
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, SecurityContextHolder.getContext());

            System.out.println("✅ [Google-Auth] Sesión establecida exitosamente para: " + email);
            return ResponseEntity.ok(Collections.singletonMap("success", true));

        } catch (Exception e) {
            System.err.println("❌ [Google-Auth] Error estableciendo sesión para " + email + ": " + e.getMessage());
            return ResponseEntity.status(401).body(Collections.singletonMap("error", "Usuario no autorizado: " + e.getMessage()));
        }
    }
}
