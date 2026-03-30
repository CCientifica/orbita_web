package com.clinica.ctc;

import java.sql.*;

public class CheckDb {
    public static void main(String[] args) throws Exception {
        Connection conn = DriverManager.getConnection("jdbc:h2:file:./data/orbita_db", "sa", "password");
        System.out.println("--- USERS (users table) ---");
        ResultSet rs = conn.createStatement().executeQuery("SELECT id, username, email, password FROM users");
        while(rs.next()) {
            System.out.println(rs.getLong("id") + " | " + rs.getString("username") + " | " + rs.getString("email") + " | PWD (HASH): " + rs.getString("password"));
        }
        System.out.println("--- USUARIOS PERMITIDOS ---");
        ResultSet rs2 = conn.createStatement().executeQuery("SELECT email, data_json FROM usuarios_permitidos");
        while(rs2.next()) {
            System.out.println(rs2.getString("email") + " | " + rs2.getString("data_json"));
        }
        conn.close();
    }
}
