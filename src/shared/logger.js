const LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const configuredLevel = (process.env.LOG_LEVEL || "INFO").toUpperCase();

function shouldLog(level) {
  return (LEVELS[level] || LEVELS.INFO) >= (LEVELS[configuredLevel] || LEVELS.INFO);
}

function write(level, message, context = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  console.log(JSON.stringify(entry));
}

function createLogger(baseContext = {}) {
  return {
    debug: (message, context) => write("DEBUG", message, { ...baseContext, ...context }),
    info: (message, context) => write("INFO", message, { ...baseContext, ...context }),
    warn: (message, context) => write("WARN", message, { ...baseContext, ...context }),
    error: (message, context) => write("ERROR", message, { ...baseContext, ...context }),
    child: (context) => createLogger({ ...baseContext, ...context }),
  };
}

module.exports = {
  createLogger,
  debug: (message, context) => write("DEBUG", message, context),
  info: (message, context) => write("INFO", message, context),
  warn: (message, context) => write("WARN", message, context),
  error: (message, context) => write("ERROR", message, context),
};
