package com.clinica.ctc.security;

public class RoleNormalizationUtils {

    /**
     * Unifica los nombres de roles en todo el sistema basándose en la matriz oficial.
     * Roles finales permitidos:
     * - master admin
     * - super admin
     * - admin
     * - analista
     * - auditor
     */
    public static String normalize(String role) {
        if (role == null) return "auditor";
        String lowerRole = role.toLowerCase().trim();
        
        // 1. MASTER ADMIN PATTERNS
        if (lowerRole.contains("master") || 
            lowerRole.equals("administrador maestro") || 
            lowerRole.equals("coordinador científico")) {
            return "master admin";
        }
        
        // 2. SUPER ADMIN PATTERNS
        if (lowerRole.contains("super") || 
            lowerRole.equals("super administrador")) {
            return "super admin";
        }
        
        // 3. ADMIN PATTERNS
        if (lowerRole.equals("admin") || 
            lowerRole.equals("administrador") || 
            lowerRole.equals("gerencia")) {
            return "admin";
        }
        
        // 4. ANALISTA PATTERNS
        if (lowerRole.contains("analista") || 
            lowerRole.equals("analista de alto costo") ||
            lowerRole.equals("analista de datos")) {
            return "analista";
        }
        
        // 5. AUDITOR PATTERNS
        if (lowerRole.contains("auditor") || 
            lowerRole.equals("auditoría") || 
            lowerRole.equals("revisor")) {
            return "auditor";
        }
        
        // Fallback: Si no coincide con patrones conocidos, devolver el original limpio
        return lowerRole;
    }
}
