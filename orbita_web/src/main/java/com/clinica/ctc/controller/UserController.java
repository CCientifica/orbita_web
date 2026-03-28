package com.clinica.ctc.controller;

import com.clinica.ctc.model.Role;
import com.clinica.ctc.model.User;
import com.clinica.ctc.repository.RoleRepository;
import com.clinica.ctc.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

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
    private PasswordEncoder passwordEncoder;

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
            
            // Get the first role name for simplicity in the UI table
            String roleName = user.getRoles().stream()
                    .map(Role::getName)
                    .findFirst()
                    .orElse("ROLE_GENERAL");
            map.put("rol", roleName);
            
            return map;
        }).collect(Collectors.toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> saveUser(@RequestBody Map<String, Object> userData) {
        String email = (String) userData.get("email");
        String nombre = (String) userData.get("nombre");
        String rolName = (String) userData.get("rol");
        boolean activo = (boolean) userData.get("activo");

        Optional<User> existingUser = userRepository.findByEmail(email);
        User user;

        if (existingUser.isPresent()) {
            user = existingUser.get();
        } else {
            user = new User();
            user.setEmail(email);
            user.setUsername(email.split("@")[0]); // Default username from email
            user.setPassword(passwordEncoder.encode("Orbita2026*")); // Default temporary password
        }

        user.setName(nombre);
        user.setEnabled(activo);

        Set<Role> roles = new HashSet<>();
        roleRepository.findByName(rolName).ifPresent(roles::add);
        user.setRoles(roles);

        userRepository.save(user);
        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }

    @DeleteMapping("/{email}")
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> deleteUser(@PathVariable String email) {
        // We don't delete the admin user
        if ("coordcientifico@funda-bio.org".equals(email)) {
            return ResponseEntity.badRequest().body("No se puede eliminar la cuenta maestra.");
        }

        userRepository.findByEmail(email).ifPresent(userRepository::delete);
        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }
}
