function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  ok: (body) => json(200, body),
  created: (body) => json(201, body),
  badRequest: (body) => json(400, body),
  notFound: (body) => json(404, body),
  internalError: (body) => json(500, body),
};

