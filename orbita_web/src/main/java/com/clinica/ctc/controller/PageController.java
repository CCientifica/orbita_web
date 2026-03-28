package com.clinica.ctc.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    @GetMapping("/")
    public String index() {
        return "login";
    }

    @GetMapping("/home")
    public String home() {
        return "home";
    }

    @GetMapping("/cronogramagpc")
    public String cronogramagpc() {
        return "cronogramagpc";
    }

    @GetMapping("/plananual-gpc")
    public String plananualGpc() {
        return "plananual-gpc";
    }

    @GetMapping("/altocosto")
    public String altocosto() {
        return "altocosto";
    }

    @GetMapping("/porfiria")
    public String porfiria() {
        return "porfiria";
    }

    @GetMapping("/rcf")
    public String rcf() {
        return "rcf";
    }

    @GetMapping({"/auxiliares-enf-rcf", "/auxiliares_enf_rcf.html"})
    public String auxiliaresEnfRcf() {
        return "auxiliares_enf_rcf";
    }

    @GetMapping({"/medicos-gen-rcf", "/medicos_gen_rcf.html"})
    public String medicosGenRcf() {
        return "medicos_gen_rcf";
    }

    @GetMapping({"/ams", "/ams.html"})
    public String ams() {
        return "ams";
    }

    @GetMapping({"/isa", "/isa.html"})
    public String isa() {
        return "isa";
    }

    @GetMapping({"/dasheco", "/dasheco.html"})
    public String dasheco() {
        return "dasheco";
    }

    @GetMapping({"/otroseco", "/otroseco.html"})
    public String otroseco() {
        return "otroseco";
    }

    @GetMapping("/consulta-cx-imdx")
    public String consultaCxImdx() {
        return "consulta-cx-imdx";
    }

    @GetMapping({"/estadistica-diaria", "/estadistica_diaria", "/estadistica-diaria.html", "/estadistica_diaria.html"})
    public String estadisticaDiaria() {
        return "estadistica_diaria";
    }

    @GetMapping("/acumulado-mensual")
    public String acumuladoMensual() {
        return "Acumulado_mensual";
    }

    @GetMapping("/predictor-los")
    public String predictorLos() {
        return "predictor-los";
    }

    @GetMapping("/historico-los")
    public String historicoLos() {
        return "historico-los";
    }

    @GetMapping("/usuarios")
    public String usuarios() {
        return "usuarios";
    }

    @GetMapping("/dashboard-citas-cx-imx")
    public String dashboardCitasCxImx() {
        return "dashboard-citas_cx_imx";
    }

    @GetMapping("/eco-digital")
    public String ecoDigital() {
        return "eco-digital";
    }

    @GetMapping("/ecosistema")
    public String ecosistema() {
        return "ecosistema";
    }
}
