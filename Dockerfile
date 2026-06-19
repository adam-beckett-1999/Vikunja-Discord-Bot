FROM node:22-alpine AS base

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source.
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Run as the non-root node user provided by the base image.
USER node

CMD ["npm", "run", "start:docker"]
