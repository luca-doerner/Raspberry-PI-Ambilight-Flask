# Multi-stage build für optimierte Größe
FROM python:3.11-slim-bullseye as builder

# Installiere Build-Abhängigkeiten
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libopencv-dev \
    python3-opencv \
    && rm -rf /var/lib/apt/lists/*

# Kopiere requirements und installiere Python-Abhängigkeiten
WORKDIR /tmp
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt


# Final stage
FROM python:3.11-slim-bullseye

# Installiere Runtime-Abhängigkeiten
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopencv-core4.5 \
    libopencv-imgproc4.5 \
    libopencv-highgui4.5 \
    libatlas-base-dev \
    libjasper-dev \
    libtiff-dev \
    libjasper1 \
    libharfbuzz0b \
    libwebp6 \
    libtiff5 \
    libjasper1 \
    && rm -rf /var/lib/apt/lists/*

# Kopiere installierte Python-Pakete vom Builder
COPY --from=builder /root/.local /root/.local

# Setze PATH
ENV PATH=/root/.local/bin:$PATH

# Arbeitsverzeichnis
WORKDIR /app

# Kopiere die Anwendung
COPY . .

# Exposiere Port
EXPOSE 5000

# Health Check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/').read()" || exit 1

# Starte die Flask-App
CMD ["python3", "app.py"]
