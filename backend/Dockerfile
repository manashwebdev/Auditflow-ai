
FROM ghcr.io/puppeteer/puppeteer:23.11.1

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

WORKDIR /app

USER root

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p shots && chown -R pptruser:pptruser /app

USER pptruser

EXPOSE 4000

CMD ["npm", "start"]