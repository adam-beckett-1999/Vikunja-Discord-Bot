FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only runtime files.
COPY deploy-commands.js ./
COPY src ./src

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/data"]

# Run as the non-root node user provided by the base image.
USER node

CMD ["npm", "run", "start:docker"]
