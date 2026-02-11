# Use lightweight Node image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system deps (needed for pdf2pic / OCR)
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    ghostscript \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose service port
EXPOSE 4000

# Start the worker
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

CMD ["./start.sh"]
