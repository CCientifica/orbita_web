package com.clinica.ctc.controller;

import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.web.bind.annotation.*;
import java.util.Base64;
import java.util.Map;

@RestController
@RequestMapping("/api/email")
@CrossOrigin(origins = "*")
public class EmailController {

    @Autowired
    private JavaMailSender mailSender;

    @org.springframework.context.annotation.Lazy
    @Autowired(required = false)
    private com.clinica.ctc.scheduler.ReporteScheduler reporteScheduler;

    private static final String[] TO = {
        "gerencia@clinicasagradocorazon.com.co",
        "coordcientifico@clinicasagradocorazon.com.co",
        "dirmedica@clinicasagradocorazon.com.co",
        "diradministrativa@clinicasagradocorazon.com.co",
        "jvalencia@clinicasagradocorazon.com.co",
        "calidad@clinicasagradocorazon.com.co"
    };

    private static final String[] CC = {
        "uniqt@clinicasagradocorazon.com.co",
        "coordcirugia@clinicasagradocorazon.com.co",
        "enfermeriauci@clinicasagradocorazon.com.co",
        "lidercostos@clinicasagradocorazon.com.co",
        "urgencias@clinicasagradocorazon.com.co",
        "estadistica@clinicasagradocorazon.com.co",
        "coordurgencias@clinicasagradocorazon.com.co",
        "auditorconcurrente@clinicasagradocorazon.com.co",
        "auditoraenfermera@clinicasagradocorazon.com.co",
        "imagenesdiagnosticas@clinicasagradocorazon.com.co",
        "coorenfermeria@clinicasagradocorazon.com.co",
        "coordinadorlaboratorio@clinicasagradocorazon.com.co"
    };

    @PostMapping("/enviar-reporte")
    public ResponseEntity<Map<String, String>> enviarReporte(@RequestBody Map<String, Object> body) {
        try {
            String mes    = (String) body.getOrDefault("mes", "");
            String anio   = (String) body.getOrDefault("anio", "");
            String fecha  = (String) body.getOrDefault("fecha", "");
            String png1B64 = ((String) body.getOrDefault("png1", "")).replaceAll("^data:image/png;base64,", "");
            String png2B64 = ((String) body.getOrDefault("png2", "")).replaceAll("^data:image/png;base64,", "");

            boolean esAutomatico = Boolean.TRUE.equals(body.get("esAutomatico")) || png1B64.isEmpty();
            boolean esCierreMes = Boolean.TRUE.equals(body.get("esCierreMes"));

            byte[] png1Bytes = png1B64.isEmpty() ? null : Base64.getDecoder().decode(png1B64);
            byte[] png2Bytes = png2B64.isEmpty() ? null : Base64.getDecoder().decode(png2B64);

            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom("liderdedatos@clinicasagradocorazon.com.co",
                           "Líder de Datos · Clínica Sagrado Corazón");

            // Saneamiento de arrays para garantizar @NonNull y que no haya elementos nulos
            String[] cleanTo = TO != null ? java.util.Arrays.stream(TO)
                .filter(email -> email != null && !email.trim().isEmpty())
                .toArray(String[]::new) : new String[0];
                
            String[] cleanCc = CC != null ? java.util.Arrays.stream(CC)
                .filter(email -> email != null && !email.trim().isEmpty())
                .toArray(String[]::new) : new String[0];

            helper.setTo(java.util.Objects.requireNonNull(cleanTo.length > 0 ? cleanTo : new String[]{"soporte@clinicasagradocorazon.com.co"}));
            if (cleanCc.length > 0) {
                helper.setCc(java.util.Objects.requireNonNull(cleanCc));
            }

            String asunto = esCierreMes
                ? "Informe de Cierre de Mes · " + mes + " " + anio + " · Clínica Sagrado Corazón"
                : esAutomatico
                    ? "⚠ Reporte pendiente de carga · " + fecha + " · Clínica Sagrado Corazón"
                    : "Estadísticas Diarias · " + fecha + " · Clínica Sagrado Corazón";

            helper.setSubject(asunto);

            String intro = esCierreMes
                ? "Se adjunta el <strong>Informe de Cierre del mes de " + mes + " " + anio + "</strong> en formato PDF, junto con los reportes gráficos del día <strong>" + fecha + "</strong>."
                : esAutomatico
                    ? "Este es un recordatorio automático. A las 4:00 p.m. los reportes del día <strong>" + fecha + "</strong> aún no han sido enviados con los archivos adjuntos. Por favor, ingrese a la plataforma <strong>Orbita Clínica</strong> y envíe el reporte manualmente con las gráficas actualizadas."
                    : "Se adjuntan los reportes gráficos de estadísticas operacionales correspondientes al día <strong>" + fecha + "</strong>.";

            String html = """
                <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #0b365a, #253d5b); padding: 28px 32px; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 800;">Estadísticas Diarias</h1>
                    <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 14px;">
                      Clínica Sagrado Corazón &nbsp;·&nbsp; %s %s &nbsp;·&nbsp; %s
                    </p>
                  </div>
                  <div style="background: #f8fafc; padding: 28px 32px; border: 1px solid #e2e8f0;">
                    <p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 20px;">
                      Estimados,<br><br>
                      %s
                    </p>
                    <ul style="color: #334155; font-size: 14px; line-height: 2;">
                      <li><strong>Reporte 1:</strong> Cumplimiento de metas mensuales por servicio</li>
                      <li><strong>Reporte 2:</strong> Vista mensual consolidada con ejecución diaria</li>
                    </ul>
                    <p style="color: #64748b; font-size: 12px; margin: 24px 0 0; border-top: 1px solid #e2e8f0; padding-top: 16px;">
                      Generado automáticamente desde Orbita Clínica · Ecosistema Técnico-Científico.
                    </p>
                  </div>
                  <div style="background: #0b365a; padding: 14px 32px; border-radius: 0 0 12px 12px; text-align: center;">
                    <p style="color: rgba(255,255,255,0.5); font-size: 11px; margin: 0;">
                      Clínica Sagrado Corazón · NIT 900408220-1 · Uso interno confidencial
                    </p>
                  </div>
                </div>
                """.formatted(mes, anio, fecha, intro);

            // Proveer un string explícitamente no nulo para resolver el warning @NonNull
            helper.setText(java.util.Objects.requireNonNull(html != null ? html : "Contenido no disponible"), true);
            if (png1Bytes != null) {
                helper.addAttachment("Metas_Diarias_" + fecha.replace("/", "-") + ".png",
                    () -> new java.io.ByteArrayInputStream(png1Bytes), "image/png");
            }
            if (png2Bytes != null) {
                helper.addAttachment("Vista_Mensual_" + fecha.replace("/", "-") + ".png",
                    () -> new java.io.ByteArrayInputStream(png2Bytes), "image/png");
            }

            mailSender.send(message);

            // Marcar que ya se envió hoy para evitar duplicado automático
            if (reporteScheduler != null) reporteScheduler.marcarEnvioManual();

            return ResponseEntity.ok(Map.of("status", "ok", "mensaje", "Reporte enviado correctamente."));

        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                .body(Map.of("status", "error", "mensaje", e.getMessage()));
        }
    }
}
