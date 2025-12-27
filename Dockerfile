# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && \
    apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create directories for database storage
RUN mkdir -p /app/.pensieve /root/.claude-pensieve

# The MCP server uses stdio transport
# Run with: docker run -i --rm -v ... pensieve
CMD ["node", "dist/index.js"]
