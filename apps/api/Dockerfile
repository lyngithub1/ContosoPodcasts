# Multi-stage build for the domain API (Fastify, Node 20).
# Build context is apps/api (self-contained workspace package).
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Compile TypeScript to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies for the runtime image.
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Container Apps ingress targets port 8080.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
