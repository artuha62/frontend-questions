#!/usr/bin/env node

/**
 * Генерирует search-index.json из index.json + всех файлов с вопросами.
 *
 * Использование:
 *   node generate-search-index.js
 *
 * По умолчанию ищет index.json в текущей папке и читает пути вопросов
 * относительно неё. Результат пишет рядом с index.json.
 *
 * Опционально можно передать путь до папки:
 *   node generate-search-index.js ./frontend-questions
 */

const fs = require("fs");
const path = require("path");

// ─── Аргументы ────────────────────────────────────────────────────────────────

const baseDir = path.resolve(process.argv[2] || ".");
const manifestPath = path.join(baseDir, "index.json");
const outputPath = path.join(baseDir, "search-index.json");

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function subcatTitleFromPath(filePath) {
  return path
    .basename(filePath, ".json")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ");
}

function processFile({
  filePath,
  categoryName,
  topicName,
  subtopicName,
  index,
}) {
  const absPath = path.join(baseDir, filePath);

  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch (e) {
    console.warn(`  ⚠ Не удалось прочитать: ${absPath}`);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn(`  ⚠ Невалидный JSON: ${absPath}`);
    return;
  }

  const subcatTitle = subcatTitleFromPath(filePath);
  const questions = data.questions || [];

  for (const q of questions) {
    index.push({
      id: q.id,
      title: q.title,
      categoryName,
      topicName,
    });
  }
}

// ─── Основная логика ──────────────────────────────────────────────────────────

console.log(`📂 Базовая папка: ${baseDir}`);
console.log(`📄 Манифест: ${manifestPath}\n`);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
} catch (e) {
  console.error("❌ Не удалось прочитать index.json:", e.message);
  process.exit(1);
}

const index = [];

for (const cat of manifest.categories) {
  const categoryName = cat.name;
  console.log(`📁 Категория: ${categoryName}`);

  for (const topic of cat.topics) {
    const topicName = topic.name;
    console.log(`  📂 Топик: ${topicName}`);

    // Прямые файлы топика
    if (topic.files) {
      for (const fileObj of topic.files) {
        processFile({
          filePath: fileObj.path,
          categoryName,
          topicName,
          subtopicName: null,
          index,
        });
      }
    }

    // Сабтопики
    if (topic.subtopics) {
      for (const sub of topic.subtopics) {
        console.log(`    📂 Сабтопик: ${sub.name}`);
        for (const fileObj of sub.files) {
          processFile({
            filePath: fileObj.path,
            categoryName,
            topicName,
            subtopicName: sub.name,
            index,
          });
        }
      }
    }
  }
}

// ─── Запись результата ────────────────────────────────────────────────────────

fs.writeFileSync(outputPath, JSON.stringify(index, null, 2), "utf-8");

console.log(`\n✅ Готово! Записано ${index.length} вопросов`);
console.log(`📄 Файл: ${outputPath}`);
console.log(
  `📦 Размер: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`,
);
