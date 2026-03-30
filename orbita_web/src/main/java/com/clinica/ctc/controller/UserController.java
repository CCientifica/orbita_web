package com.clinica.ctc.controller;

import com.clinica.ctc.model.Usuario;
import com.clinica.ctc.repository.UsuarioRepository;
import com.clinica.ctc.repository.UsuarioPermitidoRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private UsuarioPermitidoRepository usuarioPermitidoRepository;

    @GetMapping
    @PreAuthorize("hasAnyAuthority('master admin', 'super admin', 'admin')")
    public List<Map<String, Object>> getAllUsers() {
        return usuarioRepository.findAll().stream().map(usuario -> {
            Map<String, Object> map = new HashMap<>();
            map.put("id", usuario.getEmail()); // Usuario uses email as ID
            map.put("nombre", usuario.getNombre());
            map.put("email", usuario.getEmail());
            map.put("activo", true); // Or whatever field it has
            map.put("rol", usuario.getRol());
            return map;
        }).collect(Collectors.toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> saveUser(@RequestBody Map<String, Object> userData) {
        String email = Objects.requireNonNull((String) userData.get("email"), "email cannot be null");
        String nombre = (String) userData.get("nombre");
        String rolName = (String) userData.get("rol");

        // 1. Sincronización en Tabla Principal (usuarios)
        Optional<Usuario> existingUser = usuarioRepository.findByEmail(email);
        Usuario usuario = existingUser.orElseGet(() -> {
            System.out.println("🌱 [AUTH-SESSION] Creando registro local (cache) para: " + email);
            Usuario newUsuario = new Usuario();
            newUsuario.setEmail(email);
            // Fuente de verdad es Firebase Auth / Cloud Firestore
            newUsuario.setPassword("{noop}FIREBASE_EXTERNAL_AUTHENTICATION");
            return newUsuario;
        });

        usuario.setNombre(nombre);
        usuario.setRol(rolName);
        usuarioRepository.save(usuario);

        // 2. Nota: La sincronización con Firestore Real se realiza a través de la consola de Firebase 
        // o mediante el SDK de cliente. El repositorio local UsuarioPermitidoRepository no se usa para auth.

        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }

    @DeleteMapping("/{email}")
    @PreAuthorize("hasAuthority('master admin')")
    public ResponseEntity<?> deleteUser(@PathVariable @org.springframework.lang.NonNull String email) {
        if ("coordcientifico@clinicasagradocorazon.com.co".equals(email)) {
            return ResponseEntity.badRequest().body("No se puede eliminar la cuenta maestra institucional.");
        }

        usuarioRepository.findByEmail(email).ifPresent(usuarioRepository::delete);
        usuarioPermitidoRepository.deleteById(email);
        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }
}
