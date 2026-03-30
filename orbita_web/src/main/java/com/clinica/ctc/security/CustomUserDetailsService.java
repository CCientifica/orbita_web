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
        // 1. Buscar en la base de datos de usuarios ya creados/asignados
        if (username == null) {
            throw new UsernameNotFoundException("Username cannot be null");
        }
        User user = userRepository.findByUsername(username)
                .orElseGet(() -> provisionUser(username));

        List<GrantedAuthority> authorities = user.getRoles().stream()
                .map(role -> new SimpleGrantedAuthority(role.getName()))
                .collect(Collectors.toList());

        return new org.springframework.security.core.userdetails.User(
                user.getUsername(),
                user.getPassword(),
                user.isEnabled(),
                true, true, true,
                authorities);
    }

    private User provisionUser(String email) {
        if (email == null) {
            throw new UsernameNotFoundException("Email cannot be null");
        }
        // CASO A: El usuario ya tiene una asignación específica en H2 (UsuarioPermitido)
        return usuarioPermitidoRepository.findById(email)
                .map(this::createUserFromPermitido)
                .orElseGet(() -> {
                    // CASO B: El usuario no está en H2 pero tiene el dominio oficial
                    if (email.toLowerCase().endsWith(OFFICIAL_DOMAIN)) {
                        return createNewAuditor(email);
                    }
                    throw new UsernameNotFoundException("Usuario no autorizado. Debe pertenecer al dominio " + OFFICIAL_DOMAIN);
                });
    }

    private User createUserFromPermitido(UsuarioPermitido up) {
        try {
            JsonNode node = objectMapper.readTree(up.getDataJson());
            String roleName = node.has("rol") ? node.get("rol").asText() : "auditor";
            String displayName = node.has("nombre") ? node.get("nombre").asText() : up.getEmail();

            return saveNewUser(up.getEmail(), displayName, roleName);
        } catch (Exception e) {
            return createNewAuditor(up.getEmail());
        }
    }

    private User createNewAuditor(String email) {
        // Si tiene el dominio, entra automáticamente como 'auditor' por defecto
        return saveNewUser(email, email.split("@")[0], "auditor");
    }

    private User saveNewUser(String email, String displayName, String roleName) {
        User newUser = new User();
        newUser.setUsername(email);
        newUser.setEmail(email);
        newUser.setName(displayName);
        newUser.setEnabled(true);
        // Password unificada para el handshake Firebase -> Spring Security
        newUser.setPassword(passwordEncoder.encode(email + "123"));

        Set<Role> roles = new HashSet<>();
        roleRepository.findByName(roleName).ifPresent(roles::add);
        if (roles.isEmpty()) {
            roleRepository.findByName("auditor").ifPresent(roles::add);
        }
        newUser.setRoles(roles);

        return userRepository.save(newUser);
    }
}
