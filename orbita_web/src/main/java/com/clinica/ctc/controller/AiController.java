package com.clinica.ctc.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;

@RestController
@RequestMapping("/api/ai")
@CrossOrigin(origins = "*")
public class AiController {

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @PostMapping("/analyze")
    public ResponseEntity<String> analyzeData(@RequestBody Map<String, Object> data) {
        try {
            String statsString = (String) data.getOrDefault("stats", "");

            String systemPromptDefault = "Eres un analista de datos clínicos experto de la Clínica Sagrado Corazón. Analiza las estadísticas de cumplimiento. "
                    + "ESTRUCTURA OBLIGATORIA DEL REPORTE:\n"
                    + "1. Usa '## ' para un gran título central.\n"
                    + "2. Usa '### ' para títulos de secciones.\n"
                    + "3. Usa '---' para separar secciones.\n"
                    + "4. Para cada KPI crítico o logro, usa una línea que empiece con un emoji (🔴, 🟡 o 🟢) seguido del nombre y análisis. Esto creará una tarjeta visual.\n"
                    + "5. Usa listas con viñetas para recomendaciones.\n"
                    + "CRÍTICO: No inventes datos. Sé ejecutivo y profesional.";

            String systemPrompt = (String) data.getOrDefault("systemPrompt", systemPromptDefault);

            String prompt = systemPrompt + "\n\nDATOS DEL MES:\n" + statsString;

            // Prepare Gemini Request Body
            String requestBody = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(prompt) + "\"}]}]}";

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiUrl))
                    .header("Content-Type", "application/json")
                    .header("X-goog-api-key", apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                return ResponseEntity.ok(response.body());
            } else {
                return ResponseEntity.status(response.statusCode()).body("Error de la API de Gemini: " + response.body());
            }

        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Error interno del servidor: " + e.getMessage());
        }
    }

    private String escapeJson(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t");
    }
}
