// error with the HTTP status the API answers with, e.g. new HttpError(404, "Gerät nicht gefunden")
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

module.exports = HttpError;
