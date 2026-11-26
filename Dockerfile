FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DB_FILE=/data/quiz.sqlite
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server/start.mjs"]
