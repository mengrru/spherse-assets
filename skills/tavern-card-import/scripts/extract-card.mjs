#!/usr/bin/env node
/**
 * extract-card.mjs — 从 SillyTavern 酒馆角色卡提取角色数据
 *
 * 支持输入：
 *   - PNG 角色卡（tEXt / iTXt chunk，keyword = "chara"，内容为 base64 JSON；优先 spec_v2）
 *   - PNG 文件尾部直接追加的 JSON 文本（部分工具的做法）
 *   - 纯 JSON 角色卡文件
 *   - WebP（兜底尝试尾部 JSON；大多数 WebP 无卡数据）
 *
 * 用法：
 *   node extract-card.mjs <card.png|card.json> [output.json]
 *
 * 输出：
 *   - 格式化 JSON 写入 output（默认：与输入同目录，<原名>.card.json）
 *   - stdout 打印角色摘要
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node extract-card.mjs <card.png|card.json> [output.json]');
  process.exit(1);
}

const input = args[0];
const output = args[1];
const buf = fs.readFileSync(input);
const ext = path.extname(input).toLowerCase();
let jsonStr = null;

if (ext === '.json') {
  jsonStr = buf.toString('utf8');
} else if (ext === '.png') {
  jsonStr = extractFromPng(buf);
  if (!jsonStr) jsonStr = extractFromTail(buf);
} else if (ext === '.webp') {
  jsonStr = extractFromTail(buf);
} else {
  // 未知扩展名：先按 PNG 解析，再兜底尾部 JSON
  jsonStr = extractFromPng(buf);
  if (!jsonStr) jsonStr = extractFromTail(buf);
}

if (!jsonStr) {
  console.error('未找到角色卡数据。支持：PNG 内嵌 chara chunk、纯 JSON 卡、文件尾部 JSON。');
  process.exit(2);
}

let obj;
try {
  obj = JSON.parse(jsonStr);
} catch (e) {
  console.error('JSON 解析失败:', e.message);
  process.exit(3);
}

const data = obj.data || obj;
const outPath = output || input.replace(/\.[^.]+$/, '') + '.card.json';
fs.writeFileSync(outPath, jsonStr, 'utf8');

const summary = {
  spec: obj.spec || (obj.data ? 'chara_card_v1' : 'plain'),
  name: data.name || '(未命名)',
  descriptionLen: (data.description || '').length,
  personalityLen: (data.personality || '').length,
  scenarioLen: (data.scenario || '').length,
  firstMesLen: (data.first_mes || '').length,
  mesExampleLen: (data.mes_example || '').length,
  systemPromptLen: (data.system_prompt || '').length,
  postHistoryLen: (data.post_history_instructions || '').length,
  altGreetings: (data.alternate_greetings || []).length,
  tags: data.tags || [],
  creator: data.creator || '',
  avatar: data.avatar || '',
  hasCharacterBook: !!data.character_book,
  output: outPath,
};
console.log('角色卡解码完成');
console.log(JSON.stringify(summary, null, 2));

/* ---------------- helpers ---------------- */

function extractFromPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  const chunks = parsePngChunks(buf);
  const charaChunks = [];
  for (const c of chunks) {
    if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      if (nul < 0) continue;
      const kw = c.data.subarray(0, nul).toString('latin1');
      if (kw === 'chara') charaChunks.push(c.data.subarray(nul + 1).toString('utf8'));
    } else if (c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      if (nul < 0) continue;
      const kw = c.data.subarray(0, nul).toString('latin1');
      if (kw !== 'chara') continue;
      let p = nul + 1;
      const compFlag = c.data[p]; p += 1;
      p += 1; // compression method
      const langEnd = c.data.indexOf(0, p);
      if (langEnd < 0) continue;
      p = langEnd + 1;
      const transEnd = c.data.indexOf(0, p);
      if (transEnd < 0) continue;
      p = transEnd + 1;
      let text = Buffer.from(c.data.subarray(p));
      if (compFlag === 1) {
        try { text = zlib.inflateSync(text); } catch { continue; }
      }
      charaChunks.push(text.toString('utf8'));
    }
  }
  if (!charaChunks.length) return null;
  // 优先 spec_v2，其次第一个可解析的
  // tEXt/iTXt 的 chara 值可能是 base64 编码的 JSON，也可能是明文 JSON（部分工具直接写入原文）
  let best = null;
  for (const s of charaChunks) {
    try {
      let obj = null;
      try { obj = JSON.parse(s); } catch { /* 非明文 JSON */ }
      if (!obj) {
        try { obj = JSON.parse(b64decode(s)); } catch { /* 非 base64 */ }
      }
      if (obj && obj.spec === 'chara_card_v2') { best = obj; break; }
      if (!best) best = obj;
    } catch { /* 跳过坏 chunk */ }
  }
  return best ? JSON.stringify(best, null, 2) : null;
}

function extractFromTail(buf) {
  const tail = buf.subarray(Math.max(0, buf.length - 8192)).toString('utf8');
  const start = tail.indexOf('{');
  if (start < 0) return null;
  try {
    const obj = JSON.parse(tail.slice(start));
    return JSON.stringify(obj, null, 2);
  } catch {
    return null;
  }
}

function parsePngChunks(buf) {
  const chunks = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    chunks.push({ type, data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function b64decode(s) {
  let t = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}
