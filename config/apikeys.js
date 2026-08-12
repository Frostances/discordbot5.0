// config/apikeys.js — Central API key storage
// All keys are read from environment variables (Replit Secrets or .env)
// Never paste real keys here. Set them in Replit Secrets or a .env file.

function getEnv(key, required = false) {
  const value = process.env[key];
  if (required && !value) {
    console.warn(`[APIKEYS] Missing required environment variable: ${key}`);
  }
  return value || '';
}

const API_KEYS = {
  GIPHY_API_KEY:       getEnv('GIPHY_API_KEY'),
  PERSPECTIVE_API_KEY: getEnv('PERSPECTIVE_API_KEY'),
  RAWG_API_KEY:        getEnv('RAWG_API_KEY'),
  OMDB_API_KEY:        getEnv('OMDB_API_KEY'),
  OCR_API_KEY:         getEnv('OCR_API_KEY'),
  REMOVEBG_API_KEY:    getEnv('REMOVEBG_API_KEY'),
  WOLFRAM_API_KEY:     getEnv('WOLFRAM_API_KEY'),
  GROQ_API_KEY:        getEnv('GROQ_API_KEY'),
  AUDD_API_KEY:        getEnv('AUDD_API_KEY'),
};

// Optional: validate on startup
function validateKeys() {
  const missing = Object.entries(API_KEYS)
    .filter(([k, v]) => !v && !['TENOR_API_KEY', 'OPENAI_API_KEY', 'PERSPECTIVE_API_KEY', 'RAWG_API_KEY', 'OCR_API_KEY', 'WOLFRAM_API_KEY'].includes(k))
    .map(([k]) => k);
  if (missing.length) {
    console.warn('[APIKEYS] The following keys are not set (some features will be disabled):', missing.join(', '));
  }
}
validateKeys();

module.exports = API_KEYS;