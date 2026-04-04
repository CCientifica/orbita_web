package com.clinica.ctc.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

/**
 * MAPPING DE PROPIEDADES PERSONALIZADAS DE ÓRBITA
 * Resuelve los avisos de 'Unknown Property' en el IDE y centraliza la configuración.
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "orbita.auth")
public class OrbitaProperties {

    /**
     * Dominio institucional autorizado para el acceso vía Google Auth.
     */
    private String authorizedDomain = "@clinicasagradocorazon.com.co";

    /**
     * Correo electrónico del Master Admin con facultades de emergencia.
     */
    private String masterEmail = "coordcientifico@funda-bio.org";

}
