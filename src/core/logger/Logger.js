const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET = "\x1b[0m";

class Logger {
  constructor(level = "info") {
    this.threshold = LEVELS[level] ?? LEVELS.info;
  }

  _write(level, message, meta) {
    if (LEVELS[level] < this.threshold) return;
    const time = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = `${COLORS[level]}[${time}] [${level.toUpperCase()}]${RESET} ${message}`;
    const stream = level === "error" || level === "warn" ? console.error : console.log;
    if (meta !== undefined) stream(line, meta);
    else stream(line);
  }

  debug(m, meta) { this._write("debug", m, meta); }
  info(m, meta) { this._write("info", m, meta); }
  warn(m, meta) { this._write("warn", m, meta); }
  error(m, meta) { this._write("error", m, meta); }
}

module.exports = Logger;
