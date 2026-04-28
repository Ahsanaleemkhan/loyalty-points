FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy manifests first for layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install ALL deps (need devDeps for build)
RUN npm ci && npm cache clean --force

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# setup = prisma generate + prisma migrate deploy
# start = react-router-serve
CMD ["npm", "run", "docker-start"]
