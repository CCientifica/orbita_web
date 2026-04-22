package com.clinica.ctc.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/altocosto/locks")
public class RecordLockController {

    private final ConcurrentHashMap<String, LockInfo> activeLocks = new ConcurrentHashMap<>();
    private static final int MAX_HEARTBEAT_TIMEOUT_SECONDS = 90;

    public static class LockInfo {
        public String pacienteId;
        public String email;
        public String nombre;
        public Instant lastHeartbeat;
        public boolean isIdle;

        public LockInfo(String pacienteId, String email, String nombre, Instant lastHeartbeat, boolean isIdle) {
            this.pacienteId = pacienteId;
            this.email = email;
            this.nombre = nombre;
            this.lastHeartbeat = lastHeartbeat;
            this.isIdle = isIdle;
        }
    }

    public static class LockRequest {
        public String pacienteId;
        public String email;
        public String nombre;
        public boolean isIdle;
    }

    @PostMapping("/tomar")
    public ResponseEntity<Map<String, Object>> tomarLock(@RequestBody LockRequest req) {
        if (req.pacienteId == null || req.email == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false));
        }

        cleanExpiredLocks();
        String key = req.pacienteId.trim();
        LockInfo currentLock = activeLocks.get(key);

        if (currentLock != null && !currentLock.email.equalsIgnoreCase(req.email.trim())) {
            return ResponseEntity.status(409).body(Map.of(
                    "status", "LOCKED_BY_OTHER",
                    "lock", Map.of("email", currentLock.email, "nombre", currentLock.nombre != null ? currentLock.nombre : currentLock.email)
            ));
        }

        activeLocks.put(key, new LockInfo(req.pacienteId, req.email, req.nombre, Instant.now(), req.isIdle));
        return ResponseEntity.ok(Map.of("success", true, "lockedBy", req.email));
    }

    @PostMapping("/heartbeat")
    public ResponseEntity<Map<String, Object>> heartbeat(@RequestBody LockRequest req) {
        if (req.pacienteId == null || req.email == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false));
        }

        String key = req.pacienteId.trim();
        LockInfo currentLock = activeLocks.get(key);

        if (currentLock == null) {
            // Se perdió el lock por timeout
            return ResponseEntity.status(410).body(Map.of("success", false, "message", "El bloqueo expiró por inactividad."));
        }

        if (!currentLock.email.equalsIgnoreCase(req.email.trim())) {
            return ResponseEntity.status(409).body(Map.of("success", false, "message", "La ficha fue tomada por otro usuario."));
        }

        currentLock.lastHeartbeat = Instant.now();
        currentLock.isIdle = req.isIdle;
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PostMapping("/liberar")
    public ResponseEntity<Map<String, Object>> liberarLock(@RequestBody LockRequest req) {
        if (req.pacienteId != null) {
            LockInfo lock = activeLocks.get(req.pacienteId.trim());
            if (lock != null && lock.email.equalsIgnoreCase(req.email.trim())) {
                activeLocks.remove(req.pacienteId.trim());
            }
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    @GetMapping("/activos")
    public ResponseEntity<Object> getActivos() {
        cleanExpiredLocks();
        return ResponseEntity.ok(activeLocks.values());
    }

    private void cleanExpiredLocks() {
        Instant threshold = Instant.now().minus(MAX_HEARTBEAT_TIMEOUT_SECONDS, ChronoUnit.SECONDS);
        activeLocks.entrySet().removeIf(entry -> entry.getValue().lastHeartbeat.isBefore(threshold));
    }
}
