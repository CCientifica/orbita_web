package com.clinica.ctc.repository;

import com.clinica.ctc.model.UsuarioPermitido;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface UsuarioPermitidoRepository extends JpaRepository<UsuarioPermitido, String> {
}
