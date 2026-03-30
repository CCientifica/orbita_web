package com.clinica.ctc.controller;

import com.clinica.ctc.model.Role;
import com.clinica.ctc.model.User;
import com.clinica.ctc.model.UsuarioPermitido;
import com.clinica.ctc.repository.RoleRepository;
import com.clinica.ctc.repository.UserRepository;
import com.clinica.ctc.repository.UsuarioPermitidoRepository;
import com.clinica.ctc.security.RoleNormalizationUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RoleRepository roleRepository;

    @Autowired
    private UsuarioPermitidoRepository usuarioPermitidoRepository;

    @GetMapping
    @PreAuthorize("hasAnyAuthority('master admin', 'super admin', 'admin')")
    public List<Map<String, Object>> getAllUsers() {
        return userRepository.findAll().stream().map(user -> {
            Map<String, Object> map = new HashMap<>();
            map.put("id", user.getId());
            map.put("username", user.getUsername());
            map.put("email", user.getEmail());
            map.put("nombre", user.getName());
            map.put("activo", user.isEnabled());
            
            String roleName = user.getRoles().stream()
                    .map(Role::getName)
                    .findFirst()
                    .orElse("auditor");
            map.put("rol", roleName);
            
            return map;
        }).collect(Collectors.toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> saveUser(@RequestBody Map<String, Object> userData) {
        String email = Objects.requireNonNull((String) userData.get("email"), "email cannot be null");
        String nombre = (String) userData.get("nombre");
        String rolName = (String) userData.get("rol");
        boolean activo = (boolean) userData.get("activo");

        // 1. Sincronización en Tabla Principal (users)
        Optional<User> existingUser = userRepository.findByEmail(email);
        User user = existingUser.orElseGet(() -> {
            System.out.println("🌱 [AUTH-SESSION] Creando registro local (JPA) para: " + email);
            User newUser = new User();
            newUser.setEmail(email);
            newUser.setUsername(email);
            // Placeholder técnico, la autenticación es externa (Firebase)
            newUser.setPassword("{noop}EXTERNAL_AUTH_FIREBASE_" + java.util.UUID.randomUUID());
            return newUser;
        });

        // La fuente de verdad de credenciales es Firebase Auth. 
        // Se ignoran cambios de password locales.

        user.setName(nombre);
        user.setEnabled(activo);

        Set<Role> roles = new HashSet<>();
        // Normalizamos el rol antes de guardarlo para mantener la consistencia
        String normRole = RoleNormalizationUtils.normalize(rolName);
        roleRepository.findByName(normRole).orElseGet(() -> {
            System.out.println("🔧 [User-Service] Rol no encontrado, creando: " + normRole);
            return roleRepository.save(new Role(normRole));
        });
        
        roleRepository.findByName(normRole).ifPresent(roles::add);
        user.setRoles(roles);
        userRepository.save(user);

        System.out.println("💾 [User-Service] Usuario guardado correctamente: " + email + " con rol: " + normRole);

        // 2. Sincronización en Tabla de Permitidos (usuarios_permitidos - Emulación Firestore)
        UsuarioPermitido up = usuarioPermitidoRepository.findById(email).orElseGet(() -> {
            UsuarioPermitido newUp = new UsuarioPermitido();
            newUp.setEmail(email);
            return newUp;
        });

        up.setDataJson(String.format("{\"email\":\"%s\",\"nombre\":\"%s\",\"rol\":\"%s\",\"activo\":%b}", 
                       email, nombre, normRole, activo));
        up.setUpdatedAt(LocalDateTime.now());
        usuarioPermitidoRepository.save(up);

        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }

    @DeleteMapping("/{email}")
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> deleteUser(@PathVariable @org.springframework.lang.NonNull String email) {
        if ("coordcientifico@clinicasagradocorazon.com.co".equals(email)) {
            return ResponseEntity.badRequest().body("No se puede eliminar la cuenta maestra institucional.");
        }

        userRepository.findByEmail(email).ifPresent(userRepository::delete);
        usuarioPermitidoRepository.deleteById(email);
        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }
}
