package com.clinica.ctc.config;

import com.clinica.ctc.model.Role;
import com.clinica.ctc.model.User;
import com.clinica.ctc.repository.RoleRepository;
import com.clinica.ctc.repository.UserRepository;
import com.clinica.ctc.repository.UsuarioPermitidoRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

/**
 * MATRIZ OFICIAL DE ROLES DE ÓRBITA
 *
 * Fuente de verdad:
 * Los roles se leen desde Firebase con estos valores reales:
 * - master admin
 * - super admin
 * - admin
 * - analista
 * - auditor
 *
 * master admin:
 *   Control total del sistema. Usuarios, edición, descargas y Gestión CTC.
 *
 * super admin:
 *   Edición y descargas en casi todos los módulos, excepto Gestión CTC. Sin usuarios.
 *
 * admin:
 *   Visualización y descarga en casi todos los módulos, sin edición, sin usuarios y sin Gestión CTC.
 *
 * analista:
 *   Solo Alto Costo. Puede editar Alto Costo, pero no cargar Excel ni descargar productividad.
 *
 * auditor:
 *   Solo visualización de Predicción y Datos y Estadística.
 *
 * IMPORTANTE:
 * No usar ROLE_MEDICO ni roles inventados que no existan en Firebase.
 */
@Configuration
public class DataInitializer {

    @Bean
    public CommandLineRunner initData(RoleRepository roleRepository, UserRepository userRepository, 
                                    UsuarioPermitidoRepository usuarioPermitidoRepository,
                                    PasswordEncoder passwordEncoder) {
        return args -> {
            System.out.println("🚀 [DATA-INIT] Arrancando inicialización de datos de seguridad y emulación de Firestore...");
            /** 
             * FUENTE DE VERDAD: Strings exactos de Firebase.
             */
            String[] officialRoles = {"master admin", "super admin", "admin", "analista", "auditor"};
            for (String roleName : officialRoles) {
                if (roleRepository.findByName(roleName).isEmpty()) {
                    roleRepository.save(new Role(roleName));
                }
            }

            // CREACIÓN DE USUARIOS DE PRUEBA ALINEADOS CON CUENTA INSTITUCIONAL DEL WORKSPACE (@clinicasagradocorazon.com.co)
            createTestUser(userRepository, usuarioPermitidoRepository, roleRepository, passwordEncoder, "coordcientifico@clinicasagradocorazon.com.co", "master admin", "Master Admin Institucional");
            createTestUser(userRepository, usuarioPermitidoRepository, roleRepository, passwordEncoder, "superadmin@clinicasagradocorazon.com.co", "super admin", "Super Admin Institucional");
            createTestUser(userRepository, usuarioPermitidoRepository, roleRepository, passwordEncoder, "admin@clinicasagradocorazon.com.co", "admin", "Admin Institucional");
            createTestUser(userRepository, usuarioPermitidoRepository, roleRepository, passwordEncoder, "analista@clinicasagradocorazon.com.co", "analista", "Analista Institucional");
            createTestUser(userRepository, usuarioPermitidoRepository, roleRepository, passwordEncoder, "auditor@clinicasagradocorazon.com.co", "auditor", "Auditor Institucional");
        };
    }

    private void createTestUser(UserRepository userRepo, UsuarioPermitidoRepository upRepo, RoleRepository roleRepo, 
                                PasswordEncoder encoder, @org.springframework.lang.NonNull String username, 
                                @org.springframework.lang.NonNull String roleName, String displayName) {
        
        Optional<User> userOpt = userRepo.findByUsername(username);
        User user = userOpt.orElseGet(() -> {
            User newUser = new User();
            newUser.setUsername(username);
            newUser.setEmail(username);
            newUser.setPassword(encoder.encode(username + "123"));
            return newUser;
        });

        // Asegurar nombre y estado
        user.setName(displayName);
        user.setEnabled(true);
        
        // Resetear y asignar el rol oficial ÚNICO
        Set<Role> roles = new HashSet<>();
        roleRepo.findByName(roleName).ifPresent(roles::add);
        user.setRoles(roles);
        userRepo.save(user);

        // SINCRONIZAR TABLA DE "FIRESTORE EMULADO" (Para evitar 404 en el shim)
        String safeUsername = java.util.Objects.requireNonNull(username, "Username cannot be null");
        com.clinica.ctc.model.UsuarioPermitido up = upRepo.findById(safeUsername).orElseGet(() -> {
            com.clinica.ctc.model.UsuarioPermitido newUp = new com.clinica.ctc.model.UsuarioPermitido();
            newUp.setEmail(username);
            return newUp;
        });

        // Re-generar JSON para asegurar cumplimiento con la Matriz Oficial
        up.setDataJson(String.format("{\"email\":\"%s\",\"nombre\":\"%s\",\"rol\":\"%s\",\"activo\":true}", 
                       username, displayName, roleName));
        up.setUpdatedAt(java.time.LocalDateTime.now());
        upRepo.save(up);
        
        System.out.println("✅ [USER-READY] " + username + " sincronizado como " + roleName);
    }
}
