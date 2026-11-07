const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, 'mjs', 'cjs'])];

// Production bundle optimization: strip console logs, debugger statements, and comments
if (process.env.NODE_ENV === 'production') {
  config.transformer = {
    ...config.transformer,
    minifierConfig: {
      ...config.transformer?.minifierConfig,
      compress: {
        ...(config.transformer?.minifierConfig?.compress || {}),
        drop_console: true,
        drop_debugger: true,
      },
      output: {
        ...(config.transformer?.minifierConfig?.output || {}),
        comments: false,
      },
    },
  };
}

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
