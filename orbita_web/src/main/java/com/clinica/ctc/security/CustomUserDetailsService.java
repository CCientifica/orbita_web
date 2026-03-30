package com.clinica.ctc.security;

import com.clinica.ctc.model.Role;
import com.clinica.ctc.model.User;
import com.clinica.ctc.model.UsuarioPermitido;
import com.clinica.ctc.repository.RoleRepository;
import com.clinica.ctc.repository.UserRepository;
import com.clinica.ctc.repository.UsuarioPermitidoRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class CustomUserDetailsService implements UserDetailsService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UsuarioPermitidoRepository usuarioPermitidoRepository;

    @Autowired
    private RoleRepository roleRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    @Transactional
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        System.out.println("🔍 [Auth-Debug] Intento de login para usuario: " + username);
        
        if (username == null || username.trim().isEmpty()) {
            throw new UsernameNotFoundException("El nombre de usuario no puede estar vacío");
        }

        String email = username.toLowerCase().trim();
        
        // 1. Buscar en la base de datos de usuarios ya sincronizados
        User user = userRepository.findByUsername(email)
                .orElseGet(() -> provisionUser(email));

        if (!user.isEnabled()) {
            System.out.println("❌ [Auth-Debug] Usuario desactivado: " + email);
            throw new UsernameNotFoundException("Usuario desactivado");
        }

        List<GrantedAuthority> authorities = user.getRoles().stream()
                .map(role -> {
                    String normRole = RoleNormalizationUtils.normalize(role.getName());
                    System.out.println("✅ [Auth-Debug] Rol detectado y normalizado: " + role.getName() + " -> " + normRole);
                    return new SimpleGrantedAuthority(normRole);
                })
                .collect(Collectors.toList());

        System.out.println("🔓 [Auth-Debug] Acceso PERMITIDO para: " + email + " con roles: " + authorities);

        return new org.springframework.security.core.userdetails.User(
                user.getUsername(),
                user.getPassword(),
                user.isEnabled(),
                true, true, true,
                authorities);
    }

    private User provisionUser(String email) {
        System.out.println("🔍 [Auth-Debug] Usuario no encontrado en 'users', verificando 'usuarios_permitidos': " + email);
        
        // La fuente de verdad SIEMPRE es usuarios_permitidos
        Objects.requireNonNull(email, "email cannot be null");
        return usuarioPermitidoRepository.findById(email)
                .map(this::createUserFromPermitido)
                .orElseThrow(() -> {
                    System.out.println("❌ [Auth-Debug] Usuario NO autorizado en 'usuarios_permitidos': " + email);
                    return new UsernameNotFoundException("Usuario no autorizado en la plataforma.");
                });
    }

    private User createUserFromPermitido(UsuarioPermitido up) {
        try {
            JsonNode node = objectMapper.readTree(up.getDataJson());
            String rawRole = "auditor";
            if (node.has("rol")) {
                JsonNode r = node.get("rol");
                if (r != null) rawRole = r.asText();
            }
            
            String displayName = up.getEmail();
            if (node.has("nombre")) {
                JsonNode n = node.get("nombre");
                if (n != null) displayName = n.asText();
            }
            
            String normalizedRole = RoleNormalizationUtils.normalize(rawRole);
            System.out.println("✨ [AUTH-FIREBASE] Provisionando registro local desde permitidos: " + up.getEmail() + " | Rol: " + normalizedRole);

            return saveNewUser(up.getEmail(), displayName, normalizedRole);
        } catch (Exception e) {
            System.out.println("⚠️ [AUTH-DENY] Error parseando datos de permitidos para " + up.getEmail() + ": " + e.getMessage());
            return saveNewUser(up.getEmail(), up.getEmail().split("@")[0], "auditor");
        }
    }

    /**
     * Sincroniza el usuario autenticado por Firebase con la base de datos local.
     * El password almacenado es un placeholder técnico ya que la autenticación real
     * sucede en el frontend/handshake via Firebase Auth.
     */
    private User saveNewUser(String email, String displayName, String roleName) {
        User newUser = new User();
        newUser.setUsername(email);
        newUser.setEmail(email);
        newUser.setName(displayName);
        newUser.setEnabled(true);
        
        // 🛡️ POLÍTICA ÓRBITA: Fuente de verdad es Firebase Auth. 
        // Este valor es un placeholder técnico requerido por la interfaz de Spring Security/JPA
        // pero NO se utiliza para validar credenciales en el servidor.
        newUser.setPassword("{noop}FIREBASE_EXTERNAL_AUTHENTICATION");

        Set<Role> roles = new HashSet<>();
        String normalizedRoleName = RoleNormalizationUtils.normalize(roleName);
        roleRepository.findByName(normalizedRoleName).ifPresent(roles::add);
        
        if (roles.isEmpty()) {
            Role newRole = roleRepository.save(new Role(normalizedRoleName));
            roles.add(newRole);
        }
        
        newUser.setRoles(roles);
        User savedUser = userRepository.save(newUser);
        System.out.println("✅ [AUTH-SESSION] Usuario sincronizado para sesión: " + email + " | Rol final: " + normalizedRoleName);
        return savedUser;
    }
}
