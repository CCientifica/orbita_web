package com.clinica.ctc.security;

import com.clinica.ctc.model.Usuario;
import com.clinica.ctc.repository.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Servicio de detalles de usuario personalizado para ÓrbitA.
 * Implementa el handshake de sesión vinculando la identidad de Firebase
 * con los roles autorizados en Firestore.
 */
@Service
public class CustomUserDetailsService implements UserDetailsService {

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Transactional
    public void syncUserRole(String email, String roleName) {
        System.out.println("🔄 [AUTH-SESSION] Sincronizando rol en sesión local para: " + email);
        Usuario usuario = usuarioRepository.findByEmail(email).orElseGet(() -> {
            Usuario newUsuario = new Usuario();
            newUsuario.setEmail(email);
            newUsuario.setNombre(email.split("@")[0]);
            // Contraseña técnica de solo lectura, la auth real es Firebase
            newUsuario.setPassword("{noop}FIREBASE_EXTERNAL_AUTHENTICATION");
            return newUsuario;
        });

        usuario.setRol(roleName);
        usuarioRepository.save(usuario);
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        System.out.println("🔍 [AUTH-SESSION] Cargando contexto de sesión para: " + username);
        
        if (username == null || username.trim().isEmpty()) {
            throw new UsernameNotFoundException("El nombre de usuario no puede estar vacío");
        }

        String email = username.toLowerCase().trim();
        
        Usuario usuario = usuarioRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("Usuario no autorizado en el sistema local: " + email));

        List<GrantedAuthority> authorities = new java.util.ArrayList<>();
        String normalizedRole = RoleNormalizationUtils.normalize(usuario.getRol());
        authorities.add(new SimpleGrantedAuthority(normalizedRole));

        // Evitar sesiones sin roles
        if (authorities.isEmpty()) {
            authorities.add(new SimpleGrantedAuthority("auditor"));
        }

        return new org.springframework.security.core.userdetails.User(
                usuario.getEmail(),
                usuario.getPassword(),
                true, // enabled
                true, true, true,
                authorities);
    }
}
