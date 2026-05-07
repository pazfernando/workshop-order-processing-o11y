function write(level, message, context = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (message, context) => write("INFO", message, context),
  warn: (message, context) => write("WARN", message, context),
  error: (message, context) => write("ERROR", message, context),
};

