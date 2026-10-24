FROM node:22-alpine
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace @visit/api --include-workspace-root=false

COPY apps/api ./apps/api
RUN DATABASE_URL=postgresql://visit:visit_local_only@localhost:5432/visit npm run db:generate --workspace @visit/api \
  && npm run build --workspace @visit/api

EXPOSE 3000
CMD ["sh", "-c", "npm run db:deploy --workspace @visit/api && npm run start --workspace @visit/api"]
