package com.clinica.ctc.config;

import org.springframework.stereotype.Component;

/**
 * CONFIGURACIÓN GLOBAL DE ÓRBITA
 * Centraliza parámetros de autorización y negocio.
 */
@Component
public class GlobalConfig {

    private final OrbitaProperties orbitaProperties;

    public GlobalConfig(OrbitaProperties orbitaProperties) {
        this.orbitaProperties = orbitaProperties;
    }

    private static final java.util.List<String> AUTHORIZED_ROLES = java.util.List.of(
        "master admin", "super admin", "admin", "analista", "auditor"
    );

    public String getAuthorizedDomain() {
        return orbitaProperties.getAuthorizedDomain();
    }

    public String getMasterEmail() {
        return orbitaProperties.getMasterEmail();
    }

    public java.util.List<String> getAuthorizedRoles() {
        return AUTHORIZED_ROLES;
    }

    public boolean isAuthorized(String email) {
        if (email == null) return false;
        String emailLower = email.toLowerCase().trim();
        String mEmail = orbitaProperties.getMasterEmail().toLowerCase().trim();
        String domain = orbitaProperties.getAuthorizedDomain().toLowerCase().trim();
        
        // Soporte para desarrollo local y dominio institucional
        return emailLower.equals(mEmail) || 
               emailLower.endsWith(domain) || 
               emailLower.endsWith("@localhost");
    }
}
