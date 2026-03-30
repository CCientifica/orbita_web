package com.clinica.ctc.config;

import com.clinica.ctc.model.Usuario;
import com.clinica.ctc.repository.UsuarioRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class DataInitializer implements CommandLineRunner {

    private final UsuarioRepository usuarioRepository;

    public DataInitializer(UsuarioRepository usuarioRepository) {
        this.usuarioRepository = usuarioRepository;
    }

    @Override
    public void run(String... args) {
        // Crear Usuario MASTER_ADMIN (si no existe)
        crearUsuarioSiNoExiste("coordcientifico@gmail.com", "Coordinador Científico", "MASTER_ADMIN");

        // Crear Usuario SUPER_ADMIN (para pruebas locales)
        crearUsuarioSiNoExiste("admin@clinica.com", "Super Administrador", "SUPER_ADMIN");

        // Crear Usuario ANALISTA_AC (para pruebas locales)
        crearUsuarioSiNoExiste("analista@clinica.com", "Analista de Alto Costo", "ANALISTA_AC");

        System.out.println("[ORBITA DATA INITIALIZER] Usuarios base listos en base de datos local.");
    }

    private void crearUsuarioSiNoExiste(String email, String nombre, String rol) {
        if (!usuarioRepository.existsByEmail(email)) {
            Usuario u = new Usuario();
            u.setEmail(email);
            u.setNombre(nombre);
            u.setRol(rol);
            // Sin contraseña local real. La autenticación es externa (Firebase).
            u.setPassword("{noop}FIREBASE_EXTERNAL_AUTHENTICATION");
            usuarioRepository.save(u);
        }
    }
}
