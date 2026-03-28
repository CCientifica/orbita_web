package com.clinica.ctc.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "pacientes_cac")
@Getter
@Setter
public class PacienteCac {

    @Id
    private String email;

    @Lob
    @Column(columnDefinition = "CLOB")
    private String dataJson;

    private LocalDateTime updatedAt = LocalDateTime.now();

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getDataJson() { return dataJson; }
    public void setDataJson(String dataJson) { this.dataJson = dataJson; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
