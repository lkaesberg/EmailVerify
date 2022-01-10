module.exports = class UserTimeout {
    constructor() {
        this.timestamp = Date.now()
        this.waitseconds = 0
    }

    increaseWaitTime() {
        if (this.waitseconds < 300) {
            this.waitseconds *= 5
        }
        if (this.waitseconds === 0) {
            this.waitseconds = 12
        }
    }

    resetWaitTime() {
        this.waitseconds = 0
    }
}