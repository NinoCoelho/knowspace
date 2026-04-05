/**
 * Interactive CLI prompt helpers using Node.js readline.
 */

const readline = require('readline');

let _rl = null;

function getRL() {
  if (!_rl) {
    _rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return _rl;
}

function close() {
  if (_rl) {
    _rl.close();
    _rl = null;
  }
}

function ask(question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    getRL().question(`    ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askSecret(question) {
  return new Promise((resolve) => {
    const rl = getRL();
    process.stdout.write(`    ${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let input = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (c === '\x7f' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\x03') {
        // Ctrl+C
        close();
        process.exit(0);
      } else {
        input += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function select(question, options) {
  return new Promise((resolve) => {
    console.log(`\n    ${question}\n`);
    options.forEach((opt, i) => {
      const label = typeof opt === 'string' ? opt : opt.label;
      const desc = typeof opt === 'string' ? '' : opt.description ? ` — ${opt.description}` : '';
      console.log(`      ${i + 1}. ${label}${desc}`);
    });
    console.log();
    getRL().question('    > ', (answer) => {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(idx);
      } else {
        // Re-ask
        resolve(select(question, options));
      }
    });
  });
}

function multiSelect(question, options, preSelected = []) {
  const selected = new Set(preSelected);

  return new Promise((resolve) => {
    function render() {
      console.log(`\n    ${question}\n`);
      options.forEach((opt, i) => {
        const label = typeof opt === 'string' ? opt : opt.label;
        const desc = typeof opt === 'string' ? '' : opt.description ? ` — ${opt.description}` : '';
        const check = selected.has(i) ? 'x' : ' ';
        console.log(`      ${i + 1}. [${check}] ${label}${desc}`);
      });
      console.log('\n    (type numbers to toggle, Enter to confirm)');
    }

    render();

    function promptLine() {
      getRL().question('    > ', (answer) => {
        const trimmed = answer.trim();
        if (trimmed === '') {
          resolve([...selected].sort());
          return;
        }
        const nums = trimmed.split(/[\s,]+/).map(n => parseInt(n, 10) - 1);
        for (const idx of nums) {
          if (idx >= 0 && idx < options.length) {
            if (selected.has(idx)) selected.delete(idx);
            else selected.add(idx);
          }
        }
        render();
        promptLine();
      });
    }

    promptLine();
  });
}

function confirm(question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    getRL().question(`    ${question} (${hint}): `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function heading(text) {
  console.log(`\n  ${text}`);
  console.log(`  ${'─'.repeat(text.length)}`);
}

function success(text) {
  console.log(`    ✓ ${text}`);
}

function warn(text) {
  console.log(`    ⚠ ${text}`);
}

function info(text) {
  console.log(`    ${text}`);
}

module.exports = {
  ask,
  askSecret,
  select,
  multiSelect,
  confirm,
  heading,
  success,
  warn,
  info,
  close,
};
