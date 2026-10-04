FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY application.mjs firestore.mjs http.mjs index.mjs amazon-csv.mjs ./
USER node
ENV NODE_ENV=production
CMD ["node", "index.mjs"]
