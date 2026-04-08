package com.clinica.ctc.controller;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class BroadcastController {

    @GetMapping("/broadcast")
    @PreAuthorize("hasAuthority('master admin')")
    public String broadcast() {
        return "broadcast-center";
    }
}
