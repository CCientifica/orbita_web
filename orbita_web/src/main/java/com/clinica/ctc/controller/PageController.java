package com.clinica.ctc.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    @GetMapping("/")
    public String index() {
        return "login";
    }

    @GetMapping("/login")
    public String login() {
        return "login";
    }

    @GetMapping("/home")
    public String home() {
        return "home";
    }

    @GetMapping("/cronograma-gpc")
    public String cronogramaGpc() {
        return "cronograma-gpc";
    }

    @GetMapping("/plan-anual-gpc")
    public String planAnualGpc() {
        return "plan-anual-gpc";
    }

    @GetMapping("/alto-costo")
    public String altoCosto() {
        return "alto-costo";
    }

    @GetMapping("/observatorio-analitico")
    public String observatorioAnalitico() {
        return "observatorio-analitico";
    }

    @GetMapping("/porfiria")
    public String porfiria() {
        return "porfiria";
    }

    @GetMapping("/rcf")
    public String rcf() {
        return "rcf";
    }

    @GetMapping("/auxiliares-enf-rcf")
    public String auxiliaresEnfRcf() {
        return "auxiliares-enf-rcf";
    }

    @GetMapping("/medicos-gen-rcf")
    public String medicosGenRcf() {
        return "medicos-gen-rcf";
    }

    @GetMapping({"/ams", "/ams.html"})
    public String ams() {
        return "ams";
    }

    @GetMapping({"/isa", "/isa.html"})
    public String isa() {
        return "isa";
    }

    @GetMapping("/dash-eco")
    public String dashEco() {
        return "dash-eco";
    }

    @GetMapping("/dash-stats")
    public String dashStats() {
        return "dash-stats";
    }

    @GetMapping("/otros-eco")
    public String otrosEco() {
        return "otros-eco";
    }

    @GetMapping("/consulta-cx-imdx")
    public String consultaCxImdx() {
        return "consulta-cx-imdx";
    }

    @GetMapping("/estadistica-diaria")
    public String estadisticaDiaria() {
        return "estadistica-diaria";
    }

    @GetMapping("/acumulado-mensual")
    public String acumuladoMensual() {
        return "acumulado-mensual";
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
        return "dashboard-citas-cx-imx";
    }

    @GetMapping("/experiment-llama3")
    public String experimentLlama3() {
        return "experiment-llama3";
    }

}
