import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const API_KEY = process.env.GEMINI_API_KEY;

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash";

const BACKUP_MODEL =
  process.env.GEMINI_BACKUP_MODEL || "gemini-2.5-flash-lite";

const ai = API_KEY
  ? new GoogleGenAI({ apiKey: API_KEY })
  : null;

// 將 Gemini 回傳內容中的 SVG 取出
function extractSVG(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const start = text.search(/<svg\b/i);
  const endMatch = /<\/svg\s*>/gi;
  let match;
  let end = -1;

  while ((match = endMatch.exec(text)) !== null) {
    end = match.index + match[0].length;
  }

  if (start < 0 || end <= start) {
    return null;
  }

  let svg = text.slice(start, end).trim();

  // 移除可能存在的危險元素
  if (
    /<script\b/i.test(svg) ||
    /<foreignObject\b/i.test(svg) ||
    /<image\b/i.test(svg) ||
    /<use\b/i.test(svg) ||
    /<iframe\b/i.test(svg) ||
    /<!DOCTYPE/i.test(svg) ||
    /<!ENTITY/i.test(svg) ||
    /\bon[a-z]+\s*=/i.test(svg) ||
    /(?:href|src)\s*=/i.test(svg)
  ) {
    return null;
  }

  if (!/^<svg\b/i.test(svg)) {
    return null;
  }

  // 確保 SVG 有 namespace
  if (!/\bxmlns\s*=/.test(svg)) {
    svg = svg.replace(
      /<svg\b/i,
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }

  return svg;
}

function buildPrompt(idea, simpler = false) {
  return `
You are an SVG illustrator.

Create ONE ORIGINAL SVG background based on this child's idea:

"${idea}"

IMPORTANT:
- Output SVG code ONLY.
- No markdown.
- No JSON.
- No explanations.
- The first characters must be <svg.
- The last characters must be </svg>.
- Use width="800" height="450".
- Use viewBox="0 0 800 450".
- Use xmlns="http://www.w3.org/2000/svg".
- Draw a colorful, cute, child-friendly environment.
- Do NOT draw any characters, humans or animals.
- The child's physical clay character will be added later.
- Use only basic SVG elements:
  rect, circle, ellipse, path, polygon, line.
- Use solid fill colors.
- No gradients.
- No filters.
- No CSS.
- No animation.
- No text.
- No external images.
- No <defs>.
- No <g>.
- No comments.
- No attributes beginning with on.
- Close every element correctly.
- Do not use self-closing svg root.
- Keep the SVG very short.
- Maximum ${simpler ? 12 : 20} shapes.
- Maximum ${simpler ? 1800 : 2800} characters.
- Prioritize valid, complete SVG over detail.

Return the complete SVG now.
`.trim();
}

async function generateWithModel(model, prompt) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.3,
      maxOutputTokens: 4096
    }
  });

  const text = response.text || "";
  const svg = extractSVG(text);

  if (!svg) {
    const error = new Error(
      "Gemini 沒有回傳完整且符合規則的 SVG"
    );
    error.code = "INVALID_SVG";
    throw error;
  }

  return svg;
}

// 健康檢查
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "mindspace-simple-v2",
    hasApiKey: Boolean(API_KEY),
    primaryModel: PRIMARY_MODEL,
    backupModel: BACKUP_MODEL
  });
});

// AI 生成 SVG
app.post("/api/generate-svg", async (req, res) => {
  const idea = String(req.body?.idea || "").trim();

  if (!idea) {
    return res.status(400).json({
      ok: false,
      error: "請先輸入或說出想像的世界"
    });
  }

  if (idea.length > 300) {
    return res.status(400).json({
      ok: false,
      error: "描述請控制在 300 字以內"
    });
  }

  if (!ai) {
    return res.status(500).json({
      ok: false,
      error: "伺服器尚未設定 GEMINI_API_KEY"
    });
  }

  const attempts = [
    {
      model: PRIMARY_MODEL,
      simpler: false
    },
    {
      model: PRIMARY_MODEL,
      simpler: true
    },
    {
      model: BACKUP_MODEL,
      simpler: true
    }
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      console.log(
        `[Mindspace] Generating with ${attempt.model}`
      );

      const prompt = buildPrompt(
        idea,
        attempt.simpler
      );

      const svg = await generateWithModel(
        attempt.model,
        prompt
      );

      console.log(
        `[Mindspace] SVG generated: ${svg.length} chars`
      );

      return res.json({
        ok: true,
        svg,
        model: attempt.model
      });

    } catch (error) {
      console.error(
        `[Mindspace] ${attempt.model}:`,
        error.message
      );

      errors.push(
        `${attempt.model}: ${error.message}`
      );
    }
  }

  return res.status(502).json({
    ok: false,
    error: "Gemini 生成 SVG 失敗",
    details: errors
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mindspace running on port ${PORT}`);
  console.log(`Primary model: ${PRIMARY_MODEL}`);
});
