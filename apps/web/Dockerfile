FROM node:22-slim AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm exec prisma migrate deploy
RUN pnpm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
