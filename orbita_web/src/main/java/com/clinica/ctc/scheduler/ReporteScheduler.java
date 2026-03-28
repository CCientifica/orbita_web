package com.clinica.ctc.scheduler;

import com.clinica.ctc.controller.EmailController;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@Component
public class ReporteScheduler {

    @org.springframework.context.annotation.Lazy
    @Autowired
    private EmailController emailController;

    // Flag para evitar envío doble en el mismo día
    private LocalDate ultimoEnvioAutomatico = null;

    // ===== Ejecutar todos los días a las 16:00 hora Colombia (UTC-5 = 21:00 UTC) =====
    @Scheduled(cron = "0 0 21 * * MON-FRI", zone = "UTC")
    public void enviarReporteAutomatico() {
        try {
            LocalDate hoy = LocalDate.now(ZoneId.of("America/Bogota"));

            // No enviar si ya se envió hoy (manualmente o automáticamente)
            if (hoy.equals(ultimoEnvioAutomatico)) {
                System.out.println("[SCHEDULER] Reporte ya enviado hoy " + hoy + ", omitiendo envío automático.");
                return;
            }

            // No enviar en festivos colombianos
            if (esFestivoColombia(hoy)) {
                System.out.println("[SCHEDULER] Hoy " + hoy + " es festivo colombiano, omitiendo envío.");
                return;
            }

            System.out.println("[SCHEDULER] Iniciando envío automático de reporte para " + hoy);

            // El envío automático no tiene PNGs (se envía sin imágenes adjuntas como recordatorio)
            // Para envío con imágenes se requiere interacción del usuario
            Map<String, Object> body = new HashMap<>();
            body.put("mes", getNombreMes(hoy.getMonthValue()));
            body.put("anio", String.valueOf(hoy.getYear()));
            body.put("fecha", hoy.getDayOfMonth() + "/" + hoy.getMonthValue() + "/" + hoy.getYear());
            body.put("png1", "");
            body.put("png2", "");
            body.put("pdf", "");
            body.put("esAutomatico", true);

            emailController.enviarReporte(body);
            ultimoEnvioAutomatico = hoy;

            System.out.println("[SCHEDULER] Reporte automático enviado exitosamente para " + hoy);

        } catch (Exception e) {
            System.err.println("[SCHEDULER] Error en envío automático: " + e.getMessage());
        }
    }

    private boolean esFestivoColombia(LocalDate fecha) {
        int y = fecha.getYear(), m = fecha.getMonthValue(), d = fecha.getDayOfMonth();
        Set<String> fijos = Set.of(
            y+"-01-01", y+"-05-01", y+"-07-20",
            y+"-08-07", y+"-12-08", y+"-12-25"
        );
        return fijos.contains(String.format("%d-%02d-%02d", y, m, d));
    }

    private String getNombreMes(int mes) {
        String[] nombres = {"","Enero","Febrero","Marzo","Abril","Mayo","Junio",
                            "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"};
        return mes >= 1 && mes <= 12 ? nombres[mes] : "";
    }

    // Método público para que EmailController marque el envío manual
    public void marcarEnvioManual() {
        this.ultimoEnvioAutomatico = LocalDate.now(ZoneId.of("America/Bogota"));
    }
}
