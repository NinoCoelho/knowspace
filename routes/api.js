const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const matter = require('gray-matter');
const Fuse = require('fuse.js');

// Get chat history
router.get('/chat/history', (req, res) => {
  const clientSlug = req.clientSlug;
  const historyPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'chat-history.json');
  
  try {
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      const messages = JSON.parse(data);
      res.json({ messages });
    } else {
      res.json({ messages: [] });
    }
  } catch (error) {
    console.error('Error reading chat history:', error);
    res.json({ messages: [] });
  }
});

// Get vault files for a client
router.get('/vault', (req, res) => {
  const clientSlug = req.clientSlug;
  const vaultPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault');
  
  const files = [];
  
  try {
    if (!fs.existsSync(vaultPath)) {
      return res.json({ files: [] });
    }
    
    walkDirectory(vaultPath, '', files);
    res.json({ files });
  } catch (error) {
    console.error('Error reading vault:', error);
    res.status(500).json({ error: 'Failed to read vault' });
  }
});

// Get single file
router.get('/vault/file', (req, res) => {
  const clientSlug = req.clientSlug;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'File path required' });
  }

  const vaultBase = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault');
  const fullPath = path.resolve(vaultBase, filePath);

  // Prevent path traversal
  if (!fullPath.startsWith(vaultBase + path.sep) && fullPath !== vaultBase) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const textExts = ['.md', '.markdown', '.txt', '.json', '.csv'];

    if (textExts.includes(ext)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      res.send(content);
    } else {
      // Send binary files (images, videos) properly
      res.sendFile(fullPath);
    }
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Save vault file
router.put('/vault/file', (req, res) => {
  const clientSlug = req.clientSlug;
  const filePath = req.query.path;

  if (!filePath) return res.status(400).json({ error: 'File path required' });

  const vaultBase = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault');
  const fullPath = path.resolve(vaultBase, filePath);

  if (!fullPath.startsWith(vaultBase + path.sep) && fullPath !== vaultBase) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, req.body.content || '', 'utf8');
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete vault file
router.delete('/vault/file', (req, res) => {
  const clientSlug = req.clientSlug;
  const filePath = req.query.path;

  if (!filePath) return res.status(400).json({ error: 'File path required' });

  const vaultBase = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault');
  const fullPath = path.resolve(vaultBase, filePath);

  if (!fullPath.startsWith(vaultBase + path.sep) && fullPath !== vaultBase) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Search vault files
router.get('/vault/search', (req, res) => {
  const clientSlug = req.clientSlug;
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }
  
  const vaultPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault');
  const files = [];
  
  try {
    walkDirectory(vaultPath, '', files);
    
    // Use Fuse.js for fuzzy search
    const fuse = new Fuse(files, {
      keys: ['path'],
      threshold: 0.4
    });
    
    const results = fuse.search(query).map(result => result.item);
    res.json({ results });
  } catch (error) {
    console.error('Error searching vault:', error);
    res.status(500).json({ error: 'Failed to search vault' });
  }
});

// List kanban boards
router.get('/kanban/list', (req, res) => {
  const clientSlug = req.clientSlug;
  const kanbanDir = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'kanban');

  try {
    if (!fs.existsSync(kanbanDir)) {
      return res.json({ boards: [{ file: 'kanban.md', title: 'Kanban' }] });
    }
    const files = fs.readdirSync(kanbanDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = fs.readFileSync(path.join(kanbanDir, f), 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        return { file: f, title: titleMatch ? titleMatch[1] : f.replace('.md', '') };
      });
    if (files.length === 0) files.push({ file: 'kanban.md', title: 'Kanban' });
    res.json({ boards: files });
  } catch (error) {
    console.error('Error listing kanbans:', error);
    res.json({ boards: [{ file: 'kanban.md', title: 'Kanban' }] });
  }
});

// Get kanban
router.get('/kanban', (req, res) => {
  const clientSlug = req.clientSlug;
  const file = req.query.file || 'kanban.md';
  const safe = path.basename(file);
  const kanbanPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'kanban', safe);

  try {
    if (fs.existsSync(kanbanPath)) {
      const content = fs.readFileSync(kanbanPath, 'utf8');
      const kanban = parseKanbanMarkdown(content);
      res.json({ kanban, file: safe });
    } else {
      const defaultKanban = createDefaultKanban();
      res.json({ kanban: defaultKanban, file: safe });
    }
  } catch (error) {
    console.error('Error reading kanban:', error);
    res.status(500).json({ error: 'Failed to read kanban' });
  }
});

// Save kanban
router.post('/kanban', (req, res) => {
  const clientSlug = req.clientSlug;
  const { kanban } = req.body;
  const file = req.query.file || 'kanban.md';
  const safe = path.basename(file);
  const kanbanDir = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'kanban');
  const kanbanPath = path.join(kanbanDir, safe);

  try {
    if (!fs.existsSync(kanbanDir)) fs.mkdirSync(kanbanDir, { recursive: true });
    const markdown = serializeKanbanMarkdown(kanban);
    fs.writeFileSync(kanbanPath, markdown, 'utf8');
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving kanban:', error);
    res.status(500).json({ error: 'Failed to save kanban' });
  }
});

// Delete kanban
router.delete('/kanban', (req, res) => {
  const clientSlug = req.clientSlug;
  const file = req.query.file || '';
  const safe = path.basename(file);
  if (!safe) return res.status(400).json({ error: 'file required' });
  const kanbanPath = path.join(process.env.HOME || '/home/nino', clientSlug, 'workspace', 'vault', 'kanban', safe);

  try {
    if (fs.existsSync(kanbanPath)) fs.unlinkSync(kanbanPath);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting kanban:', error);
    res.status(500).json({ error: 'Failed to delete kanban' });
  }
});

// Helper functions
function walkDirectory(basePath, relativePath, files) {
  const fullPath = path.join(basePath, relativePath);
  
  if (!fs.existsSync(fullPath)) {
    return;
  }
  
  const items = fs.readdirSync(fullPath);
  
  items.forEach(item => {
    const itemPath = path.join(fullPath, item);
    const itemRelativePath = path.join(relativePath, item);
    const stats = fs.statSync(itemPath);
    
    if (stats.isDirectory()) {
      walkDirectory(basePath, itemRelativePath, files);
    } else {
      files.push({
        path: itemRelativePath,
        size: stats.size,
        modified: stats.mtime
      });
    }
  });
}

function parseKanbanMarkdown(content) {
  const lines = content.split('\n');
  const kanban = { title: 'Kanban', lanes: [] };

  let currentLane = null;
  let currentCard = null;
  let bodyLines = [];
  let inFrontmatter = false;
  let inObsidianBlock = false;
  let laneUsesHeaders = false;

  function pushCard() {
    if (currentCard && currentLane) {
      currentCard.body = bodyLines.join('\n').trim();
      currentLane.cards.push(currentCard);
    }
    bodyLines = [];
  }

  lines.forEach(line => {
    // Skip frontmatter
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      return;
    }
    if (inFrontmatter) return;

    // Skip Obsidian settings block
    if (line.trim().startsWith('%%')) {
      inObsidianBlock = !inObsidianBlock;
      return;
    }
    if (inObsidianBlock) return;

    // Board title: # Title
    if (/^# /.test(line) && !line.startsWith('## ') && !line.startsWith('### ')) {
      kanban.title = line.replace(/^# /, '').trim();
    }
    // Lane header: ## Lane Title
    else if (line.startsWith('## ')) {
      pushCard();
      if (currentLane) kanban.lanes.push(currentLane);

      currentLane = {
        id: line.replace('## ', '').trim().toLowerCase().replace(/\s+/g, '-'),
        title: line.replace('## ', '').trim(),
        cards: []
      };
      currentCard = null;
      laneUsesHeaders = false;
    }
    // Card header: ### Card Title
    else if (line.startsWith('### ') && currentLane) {
      pushCard();
      laneUsesHeaders = true;
      currentCard = {
        id: Date.now().toString() + Math.random(),
        title: line.replace('### ', '').trim(),
        body: ''
      };
    }
    // Legacy card: non-indented bullet "- Card Title" (old format, only when lane has no ### cards)
    else if (/^- /.test(line) && !/^[\t ]/.test(line) && currentLane && !laneUsesHeaders) {
      pushCard();
      currentCard = {
        id: Date.now().toString() + Math.random(),
        title: line.replace(/^- (\[[ x]\] )?/, '').trim(),
        body: ''
      };
    }
    // Card body content
    else if (currentCard) {
      bodyLines.push(line);
    }
  });

  pushCard();
  if (currentLane) kanban.lanes.push(currentLane);

  return kanban;
}

function serializeKanbanMarkdown(kanban) {
  let markdown = `---\nkanban-plugin: basic\n---\n\n# ${kanban.title}\n\n`;

  kanban.lanes.forEach(lane => {
    markdown += `## ${lane.title}\n\n`;

    lane.cards.forEach(card => {
      markdown += `### ${card.title}\n`;
      if (card.body) {
        markdown += card.body + '\n';
      }
      markdown += '\n';
    });
  });

  return markdown;
}

function createDefaultKanban() {
  return {
    title: 'Kanban',
    lanes: [
      { id: 'todo', title: 'To Do', cards: [] },
      { id: 'in-progress', title: 'In Progress', cards: [] },
      { id: 'done', title: 'Done', cards: [] }
    ]
  };
}

module.exports = router;
