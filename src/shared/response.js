function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

module.exports = {
  ok: (body, headers) => json(200, body, headers),
  created: (body, headers) => json(201, body, headers),
  badRequest: (body, headers) => json(400, body, headers),
  notFound: (body, headers) => json(404, body, headers),
  internalError: (body, headers) => json(500, body, headers),
};
