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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
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

    @Autowired
    @org.springframework.context.annotation.Lazy
    private PasswordEncoder passwordEncoder;

    private static final String OFFICIAL_DOMAIN = "@clinicasagradocorazon.com.co";
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
            String rawRole = node.has("rol") ? node.get("rol").asText() : "auditor";
            String displayName = node.has("nombre") ? node.get("nombre").asText() : up.getEmail();
            
            String normalizedRole = RoleNormalizationUtils.normalize(rawRole);
            System.out.println("✨ [Auth-Debug] Provisionando nuevo usuario desde lista permitida: " + up.getEmail() + " | Rol: " + normalizedRole);

            return saveNewUser(up.getEmail(), displayName, normalizedRole);
        } catch (Exception e) {
            System.out.println("⚠️ [Auth-Debug] Error parseando datos de permitidos para " + up.getEmail() + ": " + e.getMessage());
            return saveNewUser(up.getEmail(), up.getEmail().split("@")[0], "auditor");
        }
    }

    private User saveNewUser(String email, String displayName, String roleName) {
        User newUser = new User();
        newUser.setUsername(email);
        newUser.setEmail(email);
        newUser.setName(displayName);
        newUser.setEnabled(true);
        
        // Para login social, generamos un password aleatorio
        newUser.setPassword(passwordEncoder.encode(java.util.UUID.randomUUID().toString()));

        Set<Role> roles = new HashSet<>();
        String normalizedRoleName = RoleNormalizationUtils.normalize(roleName);
        roleRepository.findByName(normalizedRoleName).ifPresent(roles::add);
        
        if (roles.isEmpty()) {
            Role newRole = roleRepository.save(new Role(normalizedRoleName));
            roles.add(newRole);
        }
        
        newUser.setRoles(roles);
        return userRepository.save(newUser);
    }
}
