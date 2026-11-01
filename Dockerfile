# node:19 was EOL and its Debian bullseye base no longer resolves in the
# security pool -- apt 404s on libsqlite3-0, which broke every release build.
# node:22 is the current LTS. The trixie variant is needed for SQLCipher 4:
# bookworm only packages SQLCipher 3.4.1, which is built on SQLite 3.15 (2016).
FROM node:22.23.4-trixie

LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/lkaesberg/EmailVerify"

WORKDIR /usr/app/

# SQLCipher instead of plain SQLite: the bot database is encrypted at rest (see
# src/database/DatabaseEncryption.js). libsqlcipher-dev ships the sqlite3.h API
# under /usr/include/sqlcipher and links as -lsqlcipher; the sqlcipher CLI is
# there to open the encrypted file by hand.
RUN apt-get update && apt-get install -y sqlcipher libsqlcipher-dev && rm -rf /var/lib/apt/lists/*

COPY . /usr/app/

RUN ls /usr/app/

RUN ls /usr/app/language

# The prebuilt sqlite3 bindings bundle plain SQLite, so compile the driver
# against the system SQLCipher installed above. CPPFLAGS puts SQLCipher's
# sqlite3.h ahead of the plain one the base image ships.
# npm ci installs exactly what package-lock.json pins, so every build gets the
# versions Dependabot reviewed instead of whatever the caret ranges resolve to.
RUN CPPFLAGS="-I/usr/include/sqlcipher" npm ci --build-from-source=sqlite3 --sqlite=/usr --sqlite_libname=sqlcipher

CMD ["npm", "start"]
