const fs = require('fs');
const path = require('path');

const INPUT_DIR = './questions/Инструменты_и_технологии'; // <-- меняй на нужную папку

function optimizeFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!raw.questions) return;

  const cleaned = raw.questions.map(q => {
    const c = q.current || q;

    return {
      id: c.id,
      title: c.title,
      grade: c.grade || null,
      isPopular: !!c.isPopular,
      text: c.text,
      explanation: c.explanation
    };
  });

  fs.writeFileSync(filePath, JSON.stringify({ questions: cleaned }, null, 2));
  console.log(`✅ Обработан: ${filePath}`);
}

function walkDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') {
      optimizeFile(fullPath);
    }
  }
}

walkDir(INPUT_DIR);
console.log('\n✅ Все файлы очищены');