module.exports = (req, res) => {
  console.log('[ping]', req.method, req.url);
  res.json({ pong: true, method: req.method });
};
