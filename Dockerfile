# Stage 1: Build the Spring Boot application using Maven
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app

# The Maven project is expected to be in the 'orbita_web' subdirectory of the repo root
# copying only build files first to optimize layer caching
COPY orbita_web/.mvn/ .mvn/
COPY orbita_web/mvnw orbita_web/pom.xml ./
RUN chmod +x mvnw
RUN ./mvnw -q -DskipTests dependency:go-offline

# Copy Source and build the application
COPY orbita_web/src ./src
RUN ./mvnw clean package -DskipTests

# Stage 2: Create the runtime environment
FROM eclipse-temurin:17-jre
WORKDIR /app

# Copy the generated JAR from the build stage
COPY --from=build /app/target/*.jar app.jar

# Define port in accordance with Render injection
ENV PORT=8080
EXPOSE 8080

# The data directory for H2 as per application.properties
RUN mkdir -p data

# Run the Spring Boot application listening on the port provided by Render
ENTRYPOINT ["sh", "-c", "java -Dserver.port=$PORT -jar app.jar"]
