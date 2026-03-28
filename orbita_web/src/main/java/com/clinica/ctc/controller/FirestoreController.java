package com.clinica.ctc.controller;

import com.clinica.ctc.model.PacienteCac;
import com.clinica.ctc.model.UsuarioPermitido;
import com.clinica.ctc.repository.PacienteCacRepository;
import com.clinica.ctc.repository.UsuarioPermitidoRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/firestore")
public class FirestoreController {

    @Autowired
    private PacienteCacRepository pacienteRepository;

    @Autowired
    private UsuarioPermitidoRepository usuarioRepository;
    
    private final ObjectMapper mapper = new ObjectMapper();

    @GetMapping("/{collection}")
    public List<Map<String, Object>> getDocs(@PathVariable String collection) {
        if (collection == null) return Collections.emptyList();
        
        if ("pacientes_cac".equals(collection)) {
            return pacienteRepository.findAll().stream().map(p -> mapData(p.getEmail(), p.getDataJson())).collect(Collectors.toList());
        } else if ("usuarios_permitidos".equals(collection)) {
            return usuarioRepository.findAll().stream().map(p -> mapData(p.getEmail(), p.getDataJson())).collect(Collectors.toList());
        }
        return Collections.emptyList();
    }

    @GetMapping("/{collection}/{id}")
    public ResponseEntity<Map<String, Object>> getDoc(
            @PathVariable String collection, 
            @PathVariable String id) {
        if (collection == null || id == null) return ResponseEntity.badRequest().build();

        if ("pacientes_cac".equals(collection)) {
            return pacienteRepository.findById(id).map(p -> ResponseEntity.ok(mapFromData(p.getDataJson()))).orElse(ResponseEntity.notFound().build());
        } else if ("usuarios_permitidos".equals(collection)) {
            return usuarioRepository.findById(id).map(u -> ResponseEntity.ok(mapFromData(u.getDataJson()))).orElse(ResponseEntity.notFound().build());
        }
        return ResponseEntity.notFound().build();
    }

    @PostMapping("/{collection}/{id}")
    public ResponseEntity<?> setDoc(@PathVariable String collection, @PathVariable String id, @RequestBody Map<String, Object> data) {
        if (collection == null || id == null) return ResponseEntity.badRequest().build();

        try {
            data.remove("id");
            String json = mapper.writeValueAsString(data);
            if ("pacientes_cac".equals(collection)) {
                PacienteCac p = pacienteRepository.findById(id).orElseGet(() -> {
                    PacienteCac np = new PacienteCac();
                    np.setEmail(id);
                    return np;
                });
                p.setDataJson(json);
                p.setUpdatedAt(LocalDateTime.now());
                pacienteRepository.save(p);
            } else if ("usuarios_permitidos".equals(collection)) {
                UsuarioPermitido u = usuarioRepository.findById(id).orElseGet(() -> {
                    UsuarioPermitido nu = new UsuarioPermitido();
                    nu.setEmail(id);
                    return nu;
                });
                u.setDataJson(json);
                u.setUpdatedAt(LocalDateTime.now());
                usuarioRepository.save(u);
            } else {
                return ResponseEntity.badRequest().build();
            }
            return ResponseEntity.ok(Collections.singletonMap("success", true));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(e.getMessage());
        }
    }

    @DeleteMapping("/{collection}/{id}")
    public ResponseEntity<?> deleteDoc(@PathVariable String collection, @PathVariable String id) {
        if (collection == null || id == null) return ResponseEntity.badRequest().build();

        if ("pacientes_cac".equals(collection)) {
            pacienteRepository.deleteById(id);
        } else if ("usuarios_permitidos".equals(collection)) {
            usuarioRepository.deleteById(id);
        } else {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(Collections.singletonMap("success", true));
    }

    private Map<String, Object> mapData(String id, String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = mapper.readValue(json, Map.class);
            data.put("id", id);
            return data;
        } catch (Exception e) {
            Map<String, Object> fallback = new HashMap<>();
            fallback.put("id", id);
            return fallback;
        }
    }

    private Map<String, Object> mapFromData(String json) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> data = mapper.readValue(json, Map.class);
            return data;
        } catch (Exception e) {
            return new HashMap<>();
        }
    }
}
