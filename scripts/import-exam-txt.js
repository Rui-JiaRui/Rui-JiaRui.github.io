#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const TYPE_CONFIG = {
  '单选': { type: 'single', prefix: 'S', score: 1 },
  '多选': { type: 'multiple', prefix: 'M', score: 2 },
  '不定项': { type: 'indefinite', prefix: 'I', score: 2 },
  '主观题': { type: 'subjective', prefix: 'E', score: 0 }
};

function inputError(sourceName, lineNumber, message) {
  return new Error(`${sourceName}:${lineNumber} ${message}`);
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function parseExamText(text, sourceName = '<input>') {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const questions = [];
  let current = null;

  const finishQuestion = (answerMatch, lineNumber) => {
    if (current.type !== 'subjective' && current.options.length < 2) throw inputError(sourceName, current.startLine, '每题至少需要两个选项');
    const analysisLines = trimBlankLines(current.analysisLines);
    if (current.type !== 'subjective' && !analysisLines.some((line) => line.trim())) throw inputError(sourceName, lineNumber, '缺少答案解析');
    const answerText = (answerMatch[1] || '').trim();
    const answer = current.type === 'subjective' ? [] : [...answerText.toUpperCase()];
    if (new Set(answer).size !== answer.length) {
      throw inputError(sourceName, lineNumber, '答案选项重复');
    }
    for (const key of answer) {
      if (!current.options.some((option) => option.key === key)) {
        throw inputError(sourceName, lineNumber, `答案 ${key} 不在选项中`);
      }
    }
    const firstAttempt = (answerMatch[2] || '').trim();
    if (firstAttempt) analysisLines.push(firstAttempt);
    questions.push({
      subject: current.subject,
      type: current.type,
      stem: current.stem,
      options: current.options,
      answer,
      referenceAnswer: current.type === 'subjective' ? answerText : undefined,
      analysis: analysisLines.join('\n')
    });
    current = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headerMatch = line.match(/^【(.+?)(\d+)】.*（(.+?)）\s*$/);
    if (headerMatch) {
      if (current) throw inputError(sourceName, current.startLine, '缺少答案行，上一题尚未结束');
      const config = TYPE_CONFIG[headerMatch[3]];
      if (!config) throw inputError(sourceName, lineNumber, `不支持的题型：${headerMatch[3]}`);
      current = {
        startLine: lineNumber,
        subject: headerMatch[1].trim(),
        type: config.type,
        stem: line.trim(),
        options: [],
        analysisLines: [],
        readingAnalysis: false
      };
      return;
    }

    if (!current) {
      if (line.trim()) throw inputError(sourceName, lineNumber, '题目前存在无法识别的内容');
      return;
    }

    const answerMatch = current.type === 'subjective'
      ? line.match(/^(?:参考答案|本题答案)[：:]\s*(.+)$/)
      : line.match(/^本题答案[：:]\s*([A-Za-z]+)(?:[，,]\s*(.*))?\s*$/);
    if (answerMatch) {
      finishQuestion(answerMatch, lineNumber);
      return;
    }

    const optionMatch = !current.readingAnalysis && line.match(/^([A-Za-z])[.．、]\s*(.+)$/);
    if (optionMatch) {
      const key = optionMatch[1].toUpperCase();
      if (current.options.some((option) => option.key === key)) {
        throw inputError(sourceName, lineNumber, `选项 ${key} 重复`);
      }
      current.options.push({ key, text: optionMatch[2].trim() });
      return;
    }

    if (current.type === 'subjective' && line.trim()) current.analysisLines.push(line);
    else {
      if (current.options.length && line.trim()) current.readingAnalysis = true;
      if (current.readingAnalysis || current.options.length) current.analysisLines.push(line);
    }
  });

  if (current) throw inputError(sourceName, current.startLine, '缺少答案行');
  if (!questions.length) throw inputError(sourceName, 1, '没有识别到题目');
  return questions;
}

function buildExamFiles(paperId, parsedQuestions) {
  const counters = { single: 0, multiple: 0, indefinite: 0, subjective: 0 };
  const prefixes = { single: 'S', multiple: 'M', indefinite: 'I', subjective: 'E' };
  const scores = { single: 1, multiple: 2, indefinite: 2, subjective: 0 };
  const subjects = [];
  const answers = {};
  let totalScore = 0;

  const questions = parsedQuestions.map((question) => {
    if (!prefixes[question.type]) throw new Error(`不支持的题型：${question.type}`);
    counters[question.type] += 1;
    const id = `${prefixes[question.type]}${String(counters[question.type]).padStart(3, '0')}`;
    const score = scores[question.type];
    if (!subjects.includes(question.subject)) subjects.push(question.subject);
    totalScore += score;
    answers[id] = question.type === 'subjective'
      ? { referenceAnswer: question.referenceAnswer || '', analysis: question.analysis }
      : { answer: [...question.answer], analysis: question.analysis };
    return {
      id,
      type: question.type,
      score,
      stem: question.stem,
      ...(question.type === 'subjective' ? { maxLength: 5000 } : { options: question.options.map((option) => ({ ...option })) }),
      tags: [question.subject]
    };
  });

  return {
    paper: {
      schemaVersion: '1.1',
      paper: {
        id: paperId,
        title: `${paperId}错题回顾`,
        description: subjects.join('、'),
        durationMinutes: totalScore,
        totalScore,
        showResultAfterSubmit: true,
        hasAnswerKey: true
      },
      questions
    },
    answerKey: { paperId, version: '1.1', answers }
  };
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function importExamFile(inputPath, projectRoot = path.resolve(__dirname, '..')) {
  const resolvedInput = path.resolve(inputPath);
  if (path.extname(resolvedInput).toLowerCase() !== '.txt') throw new Error(`${inputPath}: 输入文件必须是 .txt`);
  if (!fs.existsSync(resolvedInput)) throw new Error(`${inputPath}: 输入文件不存在`);
  const paperId = path.basename(resolvedInput, path.extname(resolvedInput));
  if (!/^[A-Za-z0-9_-]+$/.test(paperId)) throw new Error(`${inputPath}: 文件名不能作为试卷 ID`);

  const parsedQuestions = parseExamText(fs.readFileSync(resolvedInput, 'utf8'), inputPath);
  const { paper, answerKey } = buildExamFiles(paperId, parsedQuestions);
  const registryPath = path.join(projectRoot, 'data', 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const account = registry.accounts?.find((item) => item.username === 'liurui');
  if (!account || !Array.isArray(account.paperIds)) throw new Error(`${registryPath}: 找不到有效的 liurui 账号`);

  const generatedDir = path.join(projectRoot, 'generate', paperId);
  const deployedDir = path.join(projectRoot, 'data', 'exams', paperId);
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(deployedDir, { recursive: true });
  writeJSON(path.join(generatedDir, 'paper.json'), paper);
  writeJSON(path.join(generatedDir, 'answer-key.json'), answerKey);
  writeJSON(path.join(deployedDir, 'paper.json'), paper);
  writeJSON(path.join(deployedDir, 'answer-key.json'), answerKey);
  if (!account.paperIds.includes(paperId)) account.paperIds.push(paperId);
  writeJSON(registryPath, registry);

  return { paperId, questionCount: parsedQuestions.length, generatedDir, deployedDir };
}

module.exports = { parseExamText, buildExamFiles, importExamFile };

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('用法：node scripts/import-exam-txt.js generate/<试卷ID>.txt');
    process.exitCode = 1;
  } else {
    try {
      const result = importExamFile(inputPath);
      console.log(`已导入试卷 ${result.paperId}：${result.questionCount} 题`);
      console.log(`生成目录：${result.generatedDir}`);
      console.log(`发布目录：${result.deployedDir}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
