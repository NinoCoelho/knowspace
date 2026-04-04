const fs = require('fs');
const path = require('path');

function loadSessionHistory(clientSlug) {
  try {
    const sessionsPath = path.join(process.env.HOME || '/home/nino', '.openclaw', 'agents', clientSlug, 'sessions', 'sessions.json');
    console.log('Sessions path:', sessionsPath);
    
    if (fs.existsSync(sessionsPath)) {
      const sessionsData = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const latestSession = sessionsData.sessions?.find(s => s.key === `agent:${clientSlug}:main`);
      console.log('Latest session:', latestSession?.sessionId);
      
      if (latestSession) {
        const sessionPath = path.join(process.env.HOME || '/home/nino', '.openclaw', 'agents', clientSlug, 'sessions', `${latestSession.sessionId}.jsonl`);
        console.log('Session file:', sessionPath);
        console.log('Exists:', fs.existsSync(sessionPath));
        
        if (fs.existsSync(sessionPath)) {
          const content = fs.readFileSync(sessionPath, 'utf8');
          const lines = content.trim().split('\n');
          console.log('Total lines:', lines.length);
          
          const messages = [];
          lines.forEach((line, i) => {
            try {
              const entry = JSON.parse(line);
              if (entry.type === 'message' && entry.message && entry.message.content) {
                const role = entry.message.role;
                let text = '';
                
                if (Array.isArray(entry.message.content)) {
                  entry.message.content.forEach(block => {
                    if (block.type === 'text') {
                      text += block.text;
                    }
                  });
                }
                
                if (text && (role === 'user' || role === 'assistant')) {
                  if (role === 'user') {
                    text = text.replace(/^\[[\w\s:-]+\]\s*/, '');
                  }
                  messages.push({ role, content: text });
                }
              }
            } catch (e) {
              console.log('Parse error on line', i);
            }
          });
          
          console.log('Extracted messages:', messages.length);
          return messages.slice(-10);
        }
      }
    }
    return [];
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}

const history = loadSessionHistory('nino');
console.log('Final history:', JSON.stringify(history, null, 2));
