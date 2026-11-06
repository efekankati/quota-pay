const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, 'mjs', 'cjs'])];

// Middleware to serve Stripe Apple Pay domain verification token on tunnel/web
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/.well-known/apple-developer-merchantid-domain-association')) {
        const filePath = path.join(__dirname, 'public', '.well-known', 'apple-developer-merchantid-domain-association');
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.statusCode = 200;
          return res.end(content);
        }
      }
      return metroMiddleware(req, res, next);
    };
  },
};

module.exports = config;
