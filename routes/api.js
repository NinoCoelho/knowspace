const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const matter = require('gray-matter');
const Fuse = require('fuse.js');

const KNOWSPACE_CONFIG = path.join(os.homedir(), '.knowspace', 'config.json');

function getVaultBase(clientSlug) {
  let vaultPath;
  try {
    const config = JSON.parse(fs.readFileSync(KNOWSPACE_CONFIG, 'utf8'));
    if (config.vaultPath && config.slug === clientSlug) {
      vaultPath = config.vaultPath;
    }
  } catch {
    // config not found or invalid — fall through
  }
  if (!vaultPath) {
    vaultPath = path.join(os.homedir(), clientSlug, 'workspace', 'vault');
  }
  // Resolve symlinks so path comparisons work correctly (e.g. /Users → /private/Users on macOS)
  try {
    return fs.realpathSync(vaultPath);
  } catch {
    return vaultPath; // path doesn't exist yet
  }
}

function safeResolvePath(vaultBase, filePath) {
  const full = path.resolve(vaultBase, filePath);
  try {
    return fs.realpathSync(full);
  } catch {
    return full; // file doesn't exist yet (e.g. new file being saved)
  }
}

function isInsideVault(fullPath, vaultBase) {
  return fullPath.startsWith(vaultBase + path.sep) || fullPath === vaultBase;
}

// Get chat history
router.get('/chat/history', (req, res) => {
  const clientSlug = req.clientSlug;
  const historyPath = path.join(getVaultBase(clientSlug), 'chat-history.json');
  
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
  const vaultPath = getVaultBase(clientSlug);
  
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

  const vaultBase = getVaultBase(clientSlug);
  const fullPath = safeResolvePath(vaultBase, filePath);

  if (!isInsideVault(fullPath, vaultBase)) {
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

  const vaultBase = getVaultBase(clientSlug);
  const fullPath = safeResolvePath(vaultBase, filePath);

  if (!isInsideVault(fullPath, vaultBase)) {
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

  const vaultBase = getVaultBase(clientSlug);
  const fullPath = safeResolvePath(vaultBase, filePath);

  if (!isInsideVault(fullPath, vaultBase)) {
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

// Move vault file
router.post('/vault/move', (req, res) => {
  const clientSlug = req.clientSlug;
  const { from, to } = req.body;

  if (!from || !to) return res.status(400).json({ error: 'from and to paths required' });

  const vaultBase = getVaultBase(clientSlug);
  const fullFrom = safeResolvePath(vaultBase, from);
  const fullTo = safeResolvePath(vaultBase, to);

  if (!isInsideVault(fullFrom, vaultBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!isInsideVault(fullTo, vaultBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (!fs.existsSync(fullFrom)) return res.status(404).json({ error: 'Source file not found' });
    const destDir = path.dirname(fullTo);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(fullFrom, fullTo);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error moving file:', error);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

// Get all tags across vault files
router.get('/vault/tags', (req, res) => {
  const clientSlug = req.clientSlug;
  const vaultPath = getVaultBase(clientSlug);

  const textExts = ['.md', '.markdown', '.txt'];

  try {
    const tagIndex = {}; // tag -> [{path, preview}]

    function indexFile(filePath) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const tags = content.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/g) || [];
        if (tags.length === 0) return;

        const cleanPath = filePath.replace(vaultPath + path.sep, '');
        const preview = content.replace(/^#.*$/gm, '').replace(/[#*_`[\]]/g, '').trim().slice(0, 120);

        tags.forEach(tag => {
          const normalized = tag.slice(1).toLowerCase();
          if (!tagIndex[normalized]) tagIndex[normalized] = [];
          tagIndex[normalized].push({ path: cleanPath, preview });
        });
      } catch (e) {}
    }

    function walkTags(basePath, relativePath) {
      const fullPath = path.join(basePath, relativePath);
      if (!fs.existsSync(fullPath)) return;
      const items = fs.readdirSync(fullPath);
      items.forEach(item => {
        const itemPath = path.join(fullPath, item);
        const itemRelative = path.join(relativePath, item);
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
          walkTags(basePath, itemRelative);
        } else {
          const ext = path.extname(item).toLowerCase();
          if (textExts.includes(ext)) indexFile(itemPath);
        }
      });
    }

    walkTags(vaultPath, '');
    res.json({ tags: tagIndex });
  } catch (error) {
    console.error('Error indexing tags:', error);
    res.status(500).json({ error: 'Failed to index tags' });
  }
});

// Search vault files
router.get('/vault/search', (req, res) => {
  const clientSlug = req.clientSlug;
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }

  const vaultPath = getVaultBase(clientSlug);
  const files = [];
  const textExts = ['.md', '.markdown', '.txt'];

  try {
    walkDirectory(vaultPath, '', files);

    // Read content for all text files (for tag + content search)
    const filesWithContent = files.map(f => {
      if (!textExts.includes(path.extname(f.path).toLowerCase())) return f;
      try {
        const fullPath = path.join(vaultPath, f.path);
        const content = fs.readFileSync(fullPath, 'utf8');
        return { ...f, content };
      } catch {
        return f;
      }
    });

    // Tag query: #something
    if (query.startsWith('#')) {
      const tag = query.slice(1).toLowerCase();
      const tagPattern = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const matched = filesWithContent.filter(f => f.content && tagPattern.test(f.content));
      const results = matched.map(f => ({ path: f.path, size: f.size, modified: f.modified }));
      return res.json({ results });
    }

    // Fuzzy search on path + content
    const fuse = new Fuse(filesWithContent, {
      keys: ['path', 'content'],
      threshold: 0.4,
      includeScore: true,
      shouldSort: true
    });

    const results = fuse.search(query).map(result => ({
      path: result.item.path,
      size: result.item.size,
      modified: result.item.modified
    }));
    res.json({ results });
  } catch (error) {
    console.error('Error searching vault:', error);
    res.status(500).json({ error: 'Failed to search vault' });
  }
});

// List kanban boards
router.get('/kanban/list', (req, res) => {
  const clientSlug = req.clientSlug;
  const kanbanDir = path.join(getVaultBase(clientSlug), 'kanban');

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
  const kanbanPath = path.join(getVaultBase(clientSlug), 'kanban', safe);

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
  const kanbanDir = path.join(getVaultBase(clientSlug), 'kanban');
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
  const kanbanPath = path.join(getVaultBase(clientSlug), 'kanban', safe);

  try {
    if (fs.existsSync(kanbanPath)) fs.unlinkSync(kanbanPath);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting kanban:', error);
    res.status(500).json({ error: 'Failed to delete kanban' });
  }
});

// Prompt Library endpoints
const PROMPTS_FILE = path.join(os.homedir(), '.knowspace', 'prompts.json');

function getPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading prompts:', e);
  }
  // Return default prompts
  return [
    {
      id: 'summarize',
      title: 'Summarize Conversation',
      content: 'Summarize our conversation so far, highlighting the key points, decisions made, and any action items.',
      category: 'conversation',
      icon: 'fa-align-left'
    },
    {
      id: 'extract-tasks',
      title: 'Extract Action Items',
      content: 'Extract all action items and tasks from our discussion and format them as a checklist.',
      category: 'productivity',
      icon: 'fa-check-square'
    },
    {
      id: 'brainstorm',
      title: 'Brainstorm Ideas',
      content: 'Help me brainstorm ideas for {topic}. Be creative and think outside the box.',
      category: 'creativity',
      icon: 'fa-lightbulb'
    },
    {
      id: 'explain-code',
      title: 'Explain Code',
      content: 'Explain how this code works, step by step. What does each part do?',
      category: 'code',
      icon: 'fa-code'
    },
    {
      id: 'improve-writing',
      title: 'Improve Writing',
      content: 'Review and improve this text for clarity, grammar, and style. Preserve the original meaning.',
      category: 'writing',
      icon: 'fa-pen-fancy'
    },
    {
      id: 'research',
      title: 'Research Topic',
      content: 'Provide an overview of {topic}, including key concepts, important facts, and relevant resources.',
      category: 'research',
      icon: 'fa-search'
    }
  ];
}

function savePrompts(prompts) {
  try {
    const dir = path.dirname(PROMPTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving prompts:', e);
    return false;
  }
}

// Get all prompts
router.get('/prompts', (req, res) => {
  try {
    const prompts = getPrompts();
    res.json({ prompts });
  } catch (error) {
    console.error('Error getting prompts:', error);
    res.status(500).json({ error: 'Failed to get prompts' });
  }
});

// Save a prompt
router.post('/prompts', (req, res) => {
  const { prompt } = req.body;

  if (!prompt || !prompt.title || !prompt.content) {
    return res.status(400).json({ error: 'Prompt title and content required' });
  }

  try {
    const prompts = getPrompts();
    const existingIndex = prompts.findIndex(p => p.id === prompt.id);

    if (existingIndex >= 0) {
      prompts[existingIndex] = { ...prompts[existingIndex], ...prompt };
    } else {
      prompts.push({
        id: prompt.id || Date.now().toString(),
        title: prompt.title,
        content: prompt.content,
        category: prompt.category || 'custom',
        icon: prompt.icon || 'fa-robot',
        createdAt: new Date().toISOString()
      });
    }

    savePrompts(prompts);
    res.json({ success: true, prompts });
  } catch (error) {
    console.error('Error saving prompt:', error);
    res.status(500).json({ error: 'Failed to save prompt' });
  }
});

// Delete a prompt
router.delete('/prompts', (req, res) => {
  const id = req.query.id;

  if (!id) {
    return res.status(400).json({ error: 'Prompt ID required' });
  }

  try {
    const prompts = getPrompts();
    const filtered = prompts.filter(p => p.id !== id);

    if (filtered.length === prompts.length) {
      return res.status(404).json({ error: 'Prompt not found' });
    }

    savePrompts(filtered);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({ error: 'Failed to delete prompt' });
  }
});

// Vault graph data — nodes for each .md file, links from [[wiki-links]] and #tags
router.get('/vault/graph', (req, res) => {
  const clientSlug = req.clientSlug;
  const vaultPath = getVaultBase(clientSlug);
  const textExts = ['.md', '.markdown', '.txt'];

  try {
    if (!fs.existsSync(vaultPath)) return res.json({ nodes: [], links: [] });

    const nodes = [];
    const links = [];
    const nodeIndex = {}; // path -> index

    // Collect all text files as nodes
    function collectNodes(base, rel) {
      const full = rel ? path.join(base, rel) : base;
      if (!fs.existsSync(full)) return;
      for (const item of fs.readdirSync(full)) {
        const itemPath = path.join(full, item);
        const itemRel = rel ? rel + '/' + item : item;
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          collectNodes(base, itemRel);
        } else {
          const ext = path.extname(item).toLowerCase();
          if (textExts.includes(ext)) {
            const id = itemRel.replace(/\.(md|markdown|txt)$/, '');
            const label = item.replace(/\.(md|markdown|txt)$/, '');
            const folder = rel || '';
            nodeIndex[id] = nodes.length;
            nodeIndex[itemRel] = nodes.length;
            nodes.push({ id, label, path: itemRel, folder });
          }
        }
      }
    }

    collectNodes(vaultPath, '');

    // Parse links from file content
    function parseLinks(base, rel) {
      const full = rel ? path.join(base, rel) : base;
      if (!fs.existsSync(full)) return;
      for (const item of fs.readdirSync(full)) {
        const itemPath = path.join(full, item);
        const itemRel = rel ? rel + '/' + item : item;
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) { parseLinks(base, itemRel); continue; }

        const ext = path.extname(item).toLowerCase();
        if (!textExts.includes(ext)) continue;

        const srcId = itemRel.replace(/\.(md|markdown|txt)$/, '');
        const srcIdx = nodeIndex[srcId];
        if (srcIdx === undefined) continue;

        try {
          const content = fs.readFileSync(itemPath, 'utf8');

          // [[wiki-links]]
          const wikiLinks = content.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g);
          for (const m of wikiLinks) {
            let target = m[1].trim();
            // Try to resolve target to a known node
            let targetIdx = nodeIndex[target]
              ?? nodeIndex[target + '.md']
              ?? nodeIndex[target.replace(/\.(md|markdown|txt)$/, '')];
            // Fuzzy: find node whose label or id ends with target name
            if (targetIdx === undefined) {
              const base = target.split('/').pop().replace(/\.(md|markdown|txt)$/, '');
              for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].label === base || nodes[i].id.endsWith('/' + base)) {
                  targetIdx = i;
                  break;
                }
              }
            }
            if (targetIdx !== undefined && targetIdx !== srcIdx) {
              links.push({ source: srcIdx, target: targetIdx });
            }
          }

          // #tags create implicit links between files sharing the same tag
          const tags = content.matchAll(/(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g);
          const fileTags = new Set();
          for (const m of tags) fileTags.add(m[1].toLowerCase());

          // We'll create tag-cluster links after all files are parsed
          if (fileTags.size > 0) {
            itemRel; // store for second pass
            if (!parseLinks._tagMap) parseLinks._tagMap = new Map();
            parseLinks._tagMap.set(srcIdx, fileTags);
          }
        } catch {}
      }
    }

    parseLinks(vaultPath, '');

    // Create tag-based links (files sharing same tag get linked)
    const tagMap = parseLinks._tagMap || new Map();
    const existingLinks = new Set(links.map(l => `${Math.min(l.source, l.target)}-${Math.max(l.source, l.target)}`));

    for (const [idxA, tagsA] of tagMap) {
      for (const [idxB, tagsB] of tagMap) {
        if (idxA >= idxB) continue;
        const shared = [...tagsA].some(t => tagsB.has(t));
        if (shared) {
          const key = `${Math.min(idxA, idxB)}-${Math.max(idxA, idxB)}`;
          if (!existingLinks.has(key)) {
            existingLinks.add(key);
            links.push({ source: idxA, target: idxB });
          }
        }
      }
    }

    res.json({ nodes, links });
  } catch (error) {
    console.error('Error building graph:', error);
    res.status(500).json({ error: 'Failed to build graph' });
  }
});

// Create folder
router.post('/vault/folder', (req, res) => {
  const clientSlug = req.clientSlug;
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'Folder path required' });

  const vaultBase = getVaultBase(clientSlug);
  const fullPath = safeResolvePath(vaultBase, folderPath);

  if (!isInsideVault(fullPath, vaultBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error creating folder:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Batch delete
router.post('/vault/batch-delete', async (req, res) => {
  const clientSlug = req.clientSlug;
  const { paths } = req.body;
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths array required' });
  }

  const vaultBase = getVaultBase(clientSlug);
  const deleted = [];
  const errors = [];

  for (const p of paths) {
    const fullPath = safeResolvePath(vaultBase, p);
    if (!isInsideVault(fullPath, vaultBase)) { errors.push({ path: p, error: 'Access denied' }); continue; }
    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
        deleted.push(p);
      }
    } catch (e) {
      errors.push({ path: p, error: e.message });
    }
  }

  res.json({ deleted, errors });
});

// Batch move
router.post('/vault/batch-move', async (req, res) => {
  const clientSlug = req.clientSlug;
  const { paths, destination } = req.body;
  if (!Array.isArray(paths) || paths.length === 0 || !destination) {
    return res.status(400).json({ error: 'paths array and destination required' });
  }

  const vaultBase = getVaultBase(clientSlug);
  const destFull = safeResolvePath(vaultBase, destination);
  if (!isInsideVault(destFull, vaultBase)) {
    return res.status(403).json({ error: 'Destination access denied' });
  }

  try {
    if (!fs.existsSync(destFull)) fs.mkdirSync(destFull, { recursive: true });
  } catch (e) {
    return res.status(500).json({ error: 'Cannot create destination folder' });
  }

  const moved = [];
  const errors = [];

  for (const p of paths) {
    const srcFull = safeResolvePath(vaultBase, p);
    if (!isInsideVault(srcFull, vaultBase)) { errors.push({ path: p, error: 'Access denied' }); continue; }
    try {
      const filename = path.basename(p);
      const targetPath = path.join(destFull, filename);
      fs.renameSync(srcFull, targetPath);
      moved.push(p);
    } catch (e) {
      errors.push({ path: p, error: e.message });
    }
  }

  res.json({ moved, errors });
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
