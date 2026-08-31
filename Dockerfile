# Node 22 (Active LTS). The previous node:19 went end-of-life in June 2023 and was
# a non-LTS line, so the image shipped an unpatched runtime — and CI tested on a
# different major than production ran.
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/lkaesberg/EmailVerify"

WORKDIR /usr/app/

# python3/make/g++ are needed only to build sqlite3's native addon when no prebuilt
# binary matches; they are dropped again in the same layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a source-only change reuses this layer.
# `npm ci` installs exactly what package-lock.json pins — `npm install` re-resolved
# every semver range on each build, which made images unreproducible.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . /usr/app/

# NOTE: this still runs as root, deliberately. The base image ships an unprivileged
# `node` user and switching to it would be an improvement, but config/ is an existing
# named volume whose files are root-owned from every previous release — adding
# `USER node` here makes the running bot unable to write config/bot.db on the next
# deploy. Doing it safely means stopping the app and running
# `chown -R 1000:1000` over the volume first; until then, root it is.

CMD ["npm", "start"]
