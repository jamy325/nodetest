FROM node:20-alpine3.20

WORKDIR /app

RUN apk add --no-cache bash openssl curl

COPY package.json ./
RUN npm install

COPY index.js ws.js run.sh ./
RUN chmod +x run.sh

EXPOSE 3000

CMD ["/bin/bash", "/app/run.sh"]