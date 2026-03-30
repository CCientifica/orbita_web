package com.clinica.ctc.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "usuarios")
public class Usuario {

    @Id
    @Column(length = 100, nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String nombre;

    @Column(nullable = false)
    private String password;

    @Column(length = 50, nullable = false)
    private String rol; // MASTER_ADMIN, SUPER_ADMIN, ADMINISTRADOR, ANALISTA_AC, AUDITORIA, GENERAL

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Column(name = "fecha_creacion")
    private LocalDateTime fechaCreacion;

    @PrePersist
    protected void onCreate() {
        fechaCreacion = LocalDateTime.now();
    }

    // Getters y Setters
    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getNombre() {
        return nombre;
    }

    public void setNombre(String nombre) {
        this.nombre = nombre;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getRol() {
        return rol;
    }

    public void setRol(String rol) {
        this.rol = rol;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public void setAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
    }

    public LocalDateTime getFechaCreacion() {
        return fechaCreacion;
    }
}
