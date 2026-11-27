FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
# dist/server/index.js is generated and gitignored; build it inside the image.
RUN node scripts/build.mjs
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DB_FILE=/data/quiz.sqlite
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server/start.mjs"]
