FROM node:19

LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/lkaesberg/EmailVerify"

WORKDIR /usr/app/

RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev  && rm -rf /var/lib/apt/lists/*

COPY . /usr/app/

RUN ls /usr/app/

RUN ls /usr/app/language

RUN npm install

CMD ["npm", "start"]
