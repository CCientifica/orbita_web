package com.clinica.ctc.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "usuarios_permitidos")
public class UsuarioPermitido {

    @Id
    private String email;

    @Column(columnDefinition = "TEXT")
    private String dataJson;

    private LocalDateTime updatedAt;

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getDataJson() { return dataJson; }
    public void setDataJson(String dataJson) { this.dataJson = dataJson; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
