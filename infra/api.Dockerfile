FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @dah-pango/api...
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["pnpm", "start"]
