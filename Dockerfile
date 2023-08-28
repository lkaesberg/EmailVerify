FROM node:19

WORKDIR /usr/app/

RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev  && rm -rf /var/lib/apt/lists/*

RUN ls

RUN ls languages

COPY . /usr/app/

RUN npm install

CMD ["npm", "start"]
