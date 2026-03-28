package com.clinica.ctc.repository;

import com.clinica.ctc.model.PacienteCac;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PacienteCacRepository extends JpaRepository<PacienteCac, String> {
}
