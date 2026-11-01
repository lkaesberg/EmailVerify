// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2021-2026 Lars Benedikt Kaesberg
//
// This file is part of EmailVerify, a Discord email verification bot.
// EmailVerify is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. See the LICENSE file for details.

// Encryption at rest for the bot database.
//
// With a key configured, config/bot.db is a SQLCipher 4 file (AES-256, every page
// authenticated with HMAC-SHA512): the Docker image builds the sqlite3 driver
// against libsqlcipher, and Database.js keys each connection before its first
// statement. The key comes from the DB_ENCRYPTION_KEY environment variable, or
// `databaseEncryptionKey` in config.json. Prefer the environment: config.json sits
// on the same volume as bot.db, so a copy of that volume would carry the key along.
//
// prepareDatabase() runs once in the sharder, before any shard opens the file. It
// refuses to start on a driver without SQLCipher or with a wrong key, and encrypts
// a database that predates encryption in place.

const fs = require('fs')
const sqlite3 = require('sqlite3')
const config = require('../../config/config.json')

const DB_PATH = 'config/bot.db'
// Every unencrypted SQLite file starts with these 16 bytes; an encrypted one starts with its random salt.
const PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'latin1')

/** The configured key, or null when the database is stored unencrypted. */
function databaseKey() {
    const key = process.env.DB_ENCRYPTION_KEY || config.databaseEncryptionKey
    return typeof key === 'string' && key.length > 0 ? key : null
}

/** PRAGMA key takes no bound parameters, so the passphrase goes in as a quoted literal. */
function keyPragma(key) {
    return `PRAGMA key = '${key.replace(/'/g, "''")}'`
}

/** true for an unencrypted database, false for an encrypted one, null when there is no data yet. */
function isPlaintext(path) {
    let fd
    try {
        fd = fs.openSync(path, 'r')
    } catch (e) {
        if (e.code === 'ENOENT') return null
        throw e
    }
    try {
        const header = Buffer.alloc(PLAINTEXT_HEADER.length)
        const bytesRead = fs.readSync(fd, header, 0, header.length, 0)
        // SQLite treats an empty file as an empty database, whatever the key.
        if (bytesRead === 0) return null
        return header.equals(PLAINTEXT_HEADER)
    } finally {
        fs.closeSync(fd)
    }
}

function open(path) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path, err => err ? reject(err) : resolve(db))
    })
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, err => err ? reject(err) : resolve()))
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)))
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)))
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, err => err ? reject(err) : resolve()))
}

function close(db) {
    return new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()))
}

/** SQLCipher's version, or an error if the sqlite3 driver was built against plain SQLite. */
async function sqlcipherVersion() {
    const db = await open(':memory:')
    try {
        // Plain SQLite ignores unknown pragmas, so it answers with no row at all.
        const row = await get(db, 'PRAGMA cipher_version')
        if (!row || !row.cipher_version) {
            throw new Error('A database key is set, but the sqlite3 driver is built without SQLCipher. '
                + 'Use the Docker image, or build sqlite3 against libsqlcipher (see the Dockerfile).')
        }
        return row.cipher_version
    } finally {
        await close(db)
    }
}

/** Schema version plus the row count of every table: what a faithful copy has to match. */
async function snapshot(db) {
    const { user_version: userVersion } = await get(db, 'PRAGMA user_version')
    const tables = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    const rows = {}
    for (const { name } of tables) {
        rows[name] = (await get(db, `SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`)).n
    }
    return { userVersion, rows }
}

/**
 * Replace an unencrypted database with an encrypted copy. The copy is written next
 * to it, checked against the original, and only then renamed over it, so a crash at
 * any point leaves one complete database and the next start simply tries again.
 */
async function encryptFile(path, key) {
    const tmp = `${path}.encrypting`
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}-journal`, { force: true })

    const plain = await open(path)
    let before
    try {
        // Fold the write-ahead log into the main file so the copy has every commit.
        await get(plain, 'PRAGMA wal_checkpoint(TRUNCATE)')
        before = await snapshot(plain)
        await run(plain, 'ATTACH DATABASE ? AS encrypted KEY ?', [tmp, key])
        await get(plain, "SELECT sqlcipher_export('encrypted')")
        // Database.js's migrations key off user_version, which the export does not carry over.
        await run(plain, `PRAGMA encrypted.user_version = ${Number(before.userVersion)}`)
        await run(plain, 'DETACH DATABASE encrypted')
    } finally {
        await close(plain)
    }

    const encrypted = await open(tmp)
    try {
        await exec(encrypted, keyPragma(key))
        const after = await snapshot(encrypted)
        if (JSON.stringify(after) !== JSON.stringify(before)) {
            throw new Error(`The encrypted copy does not match the original (before ${JSON.stringify(before)}, `
                + `after ${JSON.stringify(after)}). The unencrypted database was left untouched.`)
        }
    } finally {
        await close(encrypted)
    }

    // Closing the last connection already checkpointed and removed the WAL. Clear any
    // leftover anyway, so a plaintext log can never be replayed against the new file.
    fs.rmSync(`${path}-wal`, { force: true })
    fs.rmSync(`${path}-shm`, { force: true })
    fs.renameSync(tmp, path)
}

/** Fail fast on a wrong key, instead of letting every query fail with "file is not a database". */
async function checkKey(path, key) {
    const db = await open(path)
    try {
        await exec(db, keyPragma(key))
        await get(db, 'SELECT count(*) FROM sqlite_master')
    } catch (e) {
        throw new Error(`${path} cannot be opened with the configured key (${e.message}).`)
    } finally {
        await close(db)
    }
}

/**
 * Get the database ready for the shards: check the key, and encrypt an existing
 * unencrypted database. Throws when the bot must not start.
 */
async function prepareDatabase() {
    const key = databaseKey()
    const plaintext = isPlaintext(DB_PATH)

    if (!key) {
        if (plaintext === false) {
            throw new Error(`${DB_PATH} is encrypted, but no key is set (DB_ENCRYPTION_KEY).`)
        }
        console.warn('[DB] No encryption key set (DB_ENCRYPTION_KEY): the database is stored unencrypted.')
        return
    }

    const version = await sqlcipherVersion()
    if (plaintext) {
        console.log('[DB] Encrypting the existing database...')
        await encryptFile(DB_PATH, key)
        console.log('[DB] Database encrypted.')
    } else if (plaintext === false) {
        await checkKey(DB_PATH, key)
    }
    console.log(`[DB] Encryption at rest is on (SQLCipher ${version}).`)
}

module.exports = { DB_PATH, databaseKey, keyPragma, isPlaintext, prepareDatabase }
