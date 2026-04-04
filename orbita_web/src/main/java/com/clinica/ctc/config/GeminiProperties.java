package com.clinica.ctc.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import lombok.Data;

/**
 * MAPPING DE PROPIEDADES DE GEMINI API
 * Soporta 'gemini.api.key' y 'gemini.api.url'.
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "gemini")
public class GeminiProperties {

    private Api api = new Api();

    @Data
    public static class Api {
        /**
         * API Key de Google Gemini.
         */
        private String key;

        /**
         * URL del endpoint de Gemini.
         */
        private String url;
    }
}
