
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const {
  DOMParser,
  XMLSerializer
} = require('@xmldom/xmldom');

const PORT = Number(process.env.PORT) || 3000;
const MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY || '';

const MAX_BODY = 8192;

function send(res, status, obj) {
  if (res.headersSent || res.destroyed) return;

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let done = false;

    req.on('data', b => {
      size += b.length;

      if (size > MAX_BODY) {
        done = true;
        reject(new Error('輸入太長'));
        req.destroy();
        return;
      }

      chunks.push(b);
    });

    req.on('end', () => {
      if (done) return;

      try {
        resolve(
          JSON.parse(
            Buffer.concat(chunks).toString('utf8')
          )
        );
      } catch {
        reject(new Error('輸入格式不正確'));
      }
    });

    req.on('error', reject);
  });
}

// ---------- SVG 安全白名單 ----------

const TAGS = new Set([
  'svg',
  'g',
  'circle',
  'ellipse',
  'rect',
  'path',
  'polygon',
  'polyline',
  'line',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop'
]);

const ATTRS = new Set([
  'xmlns',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'fx',
  'fy',
  'spreadMethod',
  'id'
]);

const REF =
  /^url\(#([A-Za-z][\w-]{0,39})\)$/;

const NUM =
  /^-?(?:\d+\.?\d*|\.\d+)(?:[ ,.-]+(?:\d+\.?\d*|\.\d+))*$/;

// ---------- 檢查並整理 SVG ----------

function safeSVG(input) {
  const match = String(input || '').match(
    /<svg\b[\s\S]*?<\/svg\s*>/i
  );

  if (!match) {
    throw new Error('AI 未回傳完整 SVG');
  }

  const raw = match[0];

  if (raw.length > 30000) {
    throw new Error('SVG 過大，請重試');
  }

  let bad = false;

  const parser = new DOMParser({
    onError: () => {
      bad = true;
    },
    onWarning: () => {}
  });

  const doc = parser.parseFromString(
    raw,
    'image/svg+xml'
  );

  if (
    bad ||
    !doc.documentElement ||
    doc.documentElement.localName !== 'svg'
  ) {
    throw new Error('SVG 格式有誤');
  }

  let nodes = 0;
  const ids = new Set();
  const refs = [];

  function walk(node) {
    if (node.nodeType === 3) {
      if (node.nodeValue.trim()) {
        throw new Error(
          'SVG 含有非圖形文字'
        );
      }
      return;
    }

    if (node.nodeType !== 1) {
      throw new Error(
        'SVG 含有不支援的內容'
      );
    }

    nodes++;

    if (nodes > 120) {
      throw new Error('SVG 圖形太多');
    }

    if (!TAGS.has(node.nodeName)) {
      throw new Error(
        'SVG 包含不支援的圖形：' +
        node.nodeName
      );
    }

    for (
      let i = 0;
      i < node.attributes.length;
      i++
    ) {
      const a = node.attributes.item(i);
      const name = a.name;
      const value = a.value.trim();

      if (
        !ATTRS.has(name) ||
        value.length > 5000
      ) {
        throw new Error(
          'SVG 屬性不允許：' + name
        );
      }

      if (name === 'xmlns') {
        if (
          value !==
          'http://www.w3.org/2000/svg'
        ) {
          throw new Error(
            'SVG 命名空間錯誤'
          );
        }
        continue;
      }

      if (name === 'id') {
        if (
          !/^[A-Za-z][\w-]{0,39}$/.test(value)
        ) {
          throw new Error(
            'SVG ID 不合法'
          );
        }

        ids.add(value);
        continue;
      }

      if (
        name === 'fill' ||
        name === 'stroke'
      ) {
        const m = value.match(REF);

        if (m) {
          refs.push(m[1]);
          continue;
        }

        if (
          !/^(none|transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(value)
        ) {
          throw new Error(
            'SVG 顏色不合法'
          );
        }
        continue;
      }

      if (name === 'stop-color') {
        if (
          !/^#[0-9a-fA-F]{3,8}$/.test(value)
        ) {
          throw new Error(
            '漸層顏色不合法'
          );
        }
        continue;
      }

      if (
        name === 'd' ||
        name === 'points' ||
        name === 'transform' ||
        name === 'gradientTransform'
      ) {
        if (
          !/^[\d\s,\.\-+eE a-zA-Z()]*$/.test(value) ||
          /url|script|matrix3d/i.test(value)
        ) {
          throw new Error(
            'SVG 路徑不合法'
          );
        }
        continue;
      }

      if (name === 'viewBox') {
        if (value !== '0 0 1000 600') {
          throw new Error(
            'SVG 尺寸不符'
          );
        }
        continue;
      }

      if (
        name === 'offset' &&
        /^(?:100|[0-9]{1,2})%$/.test(value)
      ) {
        continue;
      }

      if (!NUM.test(value)) {
        throw new Error(
          'SVG 數值不合法：' + name
        );
      }
    }

    for (
      let child = node.firstChild;
      child;
      child = child.nextSibling
    ) {
      walk(child);
    }
  }

  walk(doc.documentElement);

  for (const ref of refs) {
    if (!ids.has(ref)) {
      throw new Error(
        'SVG 漸層引用不存在'
      );
    }
  }

  doc.documentElement.setAttribute(
    'xmlns',
    'http://www.w3.org/2000/svg'
  );

  doc.documentElement.setAttribute(
    'viewBox',
    '0 0 1000 600'
  );

  return new XMLSerializer()
    .serializeToString(
      doc.documentElement
    );
}

// ---------- 黏土風格 AI 提示詞 ----------

function prompt(idea) {
  return `
你是兒童互動藝術作品 Mindspace 的場景設計師。

孩子自己捏的實體黏土生物是主角；
你只創造它周圍的夢幻環境，不畫人物或主角。

孩子的想像：
「${idea}」

畫風：
高質感手捏黏土 clay art / polymer clay，
圓潤厚實、粉嫩糖果色、層疊的花朵、
蘑菇、雲朵、柔和立體光澤與陰影。

SVG 無法真的呈現材質貼圖，
所以用 2～3 層橢圓與圓形、
高光、漸層，模擬立體黏土感。

構圖：
1000×600 透明底。
中間 x=350～650、y=180～520
留空給真實黏土角色。
左右和上方有豐富場景。
不能蓋滿中央。

嚴格規格：
只輸出一個完整 SVG。
根節點必須是：
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">

允許元素：
svg,g,defs,linearGradient,radialGradient,stop,
circle,ellipse,rect,path,polygon,polyline,line

漸層 id 只能是英文字母數字。
fill 可以使用 url(#id)。

允許屬性：
xmlns,viewBox,width,height,x,y,x1,x2,y1,y2,
cx,cy,r,rx,ry,d,points,fill,stroke,
stroke-width,stroke-linecap,stroke-linejoin,
opacity,fill-opacity,stroke-opacity,transform,
offset,stop-color,stop-opacity,gradientUnits,
gradientTransform,fx,fy,spreadMethod,id

禁止：
style、class、文字、濾鏡、圖片、
script、foreignObject、動畫、外部網址。

請控制在 35～65 個 SVG 元素，
以及 12000 字元內。

優先畫完並閉合 SVG。
使用柔和配色，讓物件具有陰影和高光。

不要 Markdown，不要解說。
`;
}

// ---------- 呼叫 Gemini ----------

async function gemini(idea) {
  const ctl = new AbortController();

  const timer = setTimeout(
    () => ctl.abort(),
    90000
  );

  try {
    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(MODEL) +
      ':generateContent';

    const r = await fetch(endpoint, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt(idea)
              }
            ]
          }
        ],
        generationConfig: {
          temperature: .65,
          maxOutputTokens: 8192
        }
      })
    });

    const raw = await r.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        'Gemini 回傳格式不正確 (HTTP ' +
        r.status +
        ')'
      );
    }

    if (!r.ok) {
      const e = new Error(
        'Gemini HTTP ' +
        r.status +
        '：' +
        (data.error?.message || '未知錯誤')
      );

      e.status = r.status;
      throw e;
    }

    const output = (
      data.candidates?.[0]?.content?.parts || []
    )
      .map(p => p.text || '')
      .join('');

    if (!output) {
      throw new Error(
        'Gemini 沒有產生圖形，原因：' +
        (
          data.candidates?.[0]?.finishReason ||
          '未知'
        )
      );
    }

    return safeSVG(output);

  } finally {
    clearTimeout(timer);
  }
}

// ---------- HTTP 伺服器 ----------

const server = http.createServer(
  async (req, res) => {
    const pathname = new URL(
      req.url,
      'http://localhost'
    ).pathname;

    if (pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        geminiKeyConfigured: !!API_KEY,
        model: MODEL
      });
    }

    if (pathname === '/api/generate-svg') {
      if (req.method !== 'POST') {
        return send(res, 405, {
          ok: false,
          error: '請使用 POST'
        });
      }

      if (!API_KEY) {
        return send(res, 503, {
          ok: false,
          error:
            'Render 尚未設定 GEMINI_API_KEY'
        });
      }

      let body;

      try {
        body = await readBody(req);
      } catch (e) {
        return send(res, 400, {
          ok: false,
          error: e.message
        });
      }

      const idea = String(body.idea || '')
        .trim()
        .slice(0, 240);

      if (idea.length < 2) {
        return send(res, 400, {
          ok: false,
          error:
            '請說出至少兩個字的想像'
        });
      }

      try {
        const svg = await gemini(idea);

        console.log(
          'SVG generated',
          svg.length
        );

        return send(res, 200, {
          ok: true,
          svg,
          model: MODEL
        });

      } catch (e) {
        console.error(
          'Gemini generation error:',
          e.message
        );

        return send(
          res,
          e.status && e.status < 500
            ? e.status
            : 502,
          {
            ok: false,
            error:
              e.name === 'AbortError'
                ? 'AI 超過 90 秒未回應，請縮短想像內容重試'
                : e.message
          }
        );
      }
    }

    if (req.method !== 'GET') {
      return send(res, 405, {
        ok: false,
        error: '不支援的方法'
      });
    }

    const files = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/sketch.js': 'sketch.js'
    };

    const filename = files[pathname];

    if (!filename) {
      return send(res, 404, {
        ok: false,
        error: 'Not Found'
      });
    }

    fs.readFile(
      path.join(__dirname, filename),
      (err, data) => {
        if (err) {
          return send(res, 404, {
            ok: false,
            error: '找不到檔案'
          });
        }

        res.writeHead(200, {
          'Content-Type':
            filename.endsWith('.js')
              ? 'text/javascript; charset=utf-8'
              : 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });

        res.end(data);
      }
    );
  }
);

server.requestTimeout = 130000;

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      'Mindspace ready on',
      PORT,
      'model',
      MODEL
    );
  }
);
