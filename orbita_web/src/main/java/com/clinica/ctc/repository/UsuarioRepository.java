package com.clinica.ctc.repository;

import com.clinica.ctc.model.Usuario;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UsuarioRepository extends JpaRepository<Usuario, String> {

    /**
     * Busca un usuario por su correo electrónico (ID).
     */
    Optional<Usuario> findByEmail(String email);

    /**
     * Verifica si un usuario ya existe en la base de datos local.
     */
    boolean existsByEmail(String email);
}
