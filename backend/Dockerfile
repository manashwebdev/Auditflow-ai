
FROM ghcr.io/puppeteer/puppeteer:23.11.1

WORKDIR /home/pptruser/app

COPY --chown=pptruser:pptruser package*.json ./

RUN npm install --omit=dev

COPY --chown=pptruser:pptruser . .

RUN mkdir -p shots

EXPOSE 4000

CMD ["npm", "start"]