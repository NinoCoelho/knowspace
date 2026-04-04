const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', '.tokens.json');

class AuthManager {
  constructor() {
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const data = fs.readFileSync(TOKENS_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading tokens:', error);
      return {};
    }
    return {};
  }

  saveTokens() {
    const dir = path.dirname(TOKENS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokens, null, 2));
  }

  generateToken(clientSlug) {
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    this.tokens[clientSlug] = {
      token: hashedToken,
      createdAt: new Date().toISOString(),
      lastUsed: null
    };
    
    this.saveTokens();
    
    // Return unhashed token for sharing
    return token;
  }

  rotateToken(clientSlug) {
    return this.generateToken(clientSlug);
  }

  validateToken(providedToken) {
    const hashedProvided = crypto.createHash('sha256').update(providedToken).digest('hex');
    
    for (const [clientSlug, clientData] of Object.entries(this.tokens)) {
      if (clientData.token === hashedProvided) {
        // Update last used
        clientData.lastUsed = new Date().toISOString();
        this.saveTokens();
        return clientSlug;
      }
    }
    
    return null;
  }
  
  getClientSlug(providedToken) {
    return this.validateToken(providedToken);
  }

  getTokenInfo(clientSlug) {
    if (this.tokens[clientSlug]) {
      return {
        clientSlug,
        createdAt: this.tokens[clientSlug].createdAt,
        lastUsed: this.tokens[clientSlug].lastUsed
      };
    }
    return null;
  }

  listTokens() {
    return Object.keys(this.tokens).map(slug => ({
      clientSlug: slug,
      createdAt: this.tokens[slug].createdAt,
      lastUsed: this.tokens[slug].lastUsed
    }));
  }
}

module.exports = AuthManager;
