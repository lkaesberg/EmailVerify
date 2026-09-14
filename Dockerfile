# node:19 was EOL and its Debian bullseye base no longer resolves in the
# security pool -- apt 404s on libsqlite3-0, which broke every release build.
# node:22 is the current LTS (bookworm) and also clears the EOL runtime.
FROM node:22

LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/lkaesberg/EmailVerify"

WORKDIR /usr/app/

RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev  && rm -rf /var/lib/apt/lists/*

COPY . /usr/app/

RUN ls /usr/app/

RUN ls /usr/app/language

# sqlite3 v6 publishes prebuilt bindings linked against glibc 2.38, which is
# newer than bookworm's 2.36 -- loading one fails with "GLIBC_2.38 not found".
# Compile against the system libsqlite3 installed above instead, which is what
# libsqlite3-dev was always here for and keeps the image independent of whatever
# glibc the upstream prebuilds happen to target.
RUN npm install --build-from-source=sqlite3 --sqlite=/usr

CMD ["npm", "start"]
