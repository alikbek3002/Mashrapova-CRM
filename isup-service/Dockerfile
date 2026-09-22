# ISUP 5.0 listen-service for Hikvision face terminals (DS-K1T670MX).
# Native Hikvision libs are linux/x86_64 only -> image must run on amd64.
#
# Build:  docker build -t uniqum/isup-service .
# (on Apple Silicon build with:  docker build --platform linux/amd64 ...)

# ---------- build stage ----------
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

# ---------- runtime stage ----------
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app

# Hikvision ISUP SDK native libraries (see NOTICE.md for provenance)
COPY sdk/linux/ /app/sdk/linux/
ENV LD_LIBRARY_PATH=/app/sdk/linux
ENV ISUP_SDK_DIR=/app/sdk/linux

COPY --from=build /build/target/isup-service.jar /app/isup-service.jar

# 7660  - CMS registration/listen (terminal connects here), tcp+udp
# 7332  - Alarm listen (events)
# 8080  - local HTTP API (/healthz, /enroll)
EXPOSE 7660/tcp 7660/udp 7332/tcp 8080/tcp

ENTRYPOINT ["java", "-jar", "/app/isup-service.jar"]
