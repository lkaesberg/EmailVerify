const crypto = require("crypto")


module.exports = function md5hash(value) {
    return crypto.createHash("md5").update(value).digest("base64")
}