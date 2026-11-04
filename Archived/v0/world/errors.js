// Errors carry an HTTP status so the API layer can report them directly.

class WorldError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new WorldError(400, msg, details);
const notFound = (msg) => new WorldError(404, msg);
const conflict = (msg) => new WorldError(409, msg);

module.exports = { WorldError, badRequest, notFound, conflict };
