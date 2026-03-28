package com.clinica.ctc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
public class CtcApplication {

	public static void main(String[] args) {
		SpringApplication.run(CtcApplication.class, args);
	}

}
