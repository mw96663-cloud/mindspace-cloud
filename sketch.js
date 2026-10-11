
'use strict';

// Mindspace — p5.js clay-world stage
// Browser SpeechRecognition + Gemini SVG

let motes = [];
let orbs = [];
let scene = null;
let oldScene = null;
let transition = 1;
let clock = 0;

let speech = null;
let listening = false;
let busy = false;
let finalWords = '';
let interimWords = '';
let speechActive = false;
let submitted = false;
let silenceTimer = null;

const $ = id => document.getElementById(id);

const status = s => {
  $('status').textContent = s;
};

const transcript = s => {
  $('transcript').textContent = s;
};

function buttonState() {
  $('micBtn').disabled = busy;
  $('typeBtn').disabled = busy;
  $('stopBtn').hidden = !listening;

  $('micBtn').textContent = busy
    ? '✨ 正在捏出想像世界…'
    : listening
      ? '🎙️ 正在聆聽…'
      : '🎤 開始說出想像';
}

// ---------- p5.js 初始化 ----------

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(
    Math.min(window.devicePixelRatio || 1, 2)
  );

  seedDecor();
  initUI();
  initSpeech();
}

function seedDecor() {
  motes = Array.from(
    { length: 105 },
    () => ({
      x: random(width),
      y: random(height),
      r: random(1, 4),
      speed: random(.2, .9),
      phase: random(TWO_PI)
    })
  );

  orbs = Array.from(
    { length: 12 },
    (_, i) => ({
      x: random(width),
      y: random(height),
      r: random(50, 180),
      phase: i * .7
    })
  );
}

// ---------- 每一影格 ----------

function draw() {
  clock += .008;

  drawBackground();
  drawAtmosphere();

  if (oldScene && transition < 1) {
    push();
    tint(255, 255 * (1 - transition));
    renderScene(oldScene);
    pop();
  }

  if (scene) {
    push();
    tint(255, 255 * Math.min(1, transition));
    renderScene(scene);
    pop();
  }

  noTint();

  if (transition < 1) {
    transition = Math.min(1, transition + .015);

    if (transition >= 1) {
      oldScene = null;
    }
  }

  drawForeground();
}

// ---------- 背景 ----------

function drawBackground() {
  const ctx = drawingContext;

  const grad = ctx.createLinearGradient(
    0, 0, 0, height
  );

  grad.addColorStop(0, '#172945');
  grad.addColorStop(.55, '#315b76');
  grad.addColorStop(1, '#7f9c9d');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  noStroke();

  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];

    const xx =
      o.x + sin(clock + o.phase) * 25;

    const yy =
      o.y + cos(clock * .7 + o.phase) * 30;

    for (let j = 3; j >= 1; j--) {
      fill(195 + i * 3, 220, 240, 3);
      circle(xx, yy, o.r * j * 1.5);
    }
  }
}

// ---------- 浮動粒子 ----------

function drawAtmosphere() {
  push();
  colorMode(HSB, 360, 100, 100, 100);
  noStroke();

  for (const m of motes) {
    m.y -= m.speed;
    m.x += sin(clock + m.phase) * .25;

    if (m.y < -8) {
      m.y = height + 8;
      m.x = random(width);
    }

    fill(
      45,
      25,
      100,
      35 + 25 * sin(clock * 2 + m.phase)
    );

    circle(m.x, m.y, m.r * 2);
  }

  pop();
}

// ---------- 中央黏土角色舞台 ----------

function drawForeground() {
  push();
  noStroke();

  fill(255, 244, 228, 14);
  ellipse(
    width * .5,
    height * .83,
    width * .38,
    height * .09
  );

  fill(13, 25, 38, 35);
  ellipse(
    width * .5,
    height * .855,
    width * .27,
    height * .035
  );

  pop();
}

// ---------- 顯示 AI SVG ----------

function renderScene(img) {
  const factor = Math.min(
    width / 1000,
    height / 600
  );

  imageMode(CENTER);

  image(
    img,
    width / 2,
    height / 2,
    1000 * factor,
    600 * factor
  );
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  seedDecor();
}

// ---------- 介面事件 ----------

function initUI() {
  $('resetBtn').onclick = () => {
    oldScene = scene;
    scene = null;
    transition = 1;

    status('場景已重設，可以開始新的想像。');

    $('stageHint').classList.remove('hidden');
  };

  $('fullBtn').onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement
          .requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      status('無法全螢幕：' + e.message);
    }
  };

  $('typeBtn').onclick = () => {
    generate($('typedIdea').value);
  };

  $('typedIdea').addEventListener(
    'keydown',
    e => {
      if (e.key === 'Enter') {
        generate($('typedIdea').value);
      }
    }
  );

  $('stopBtn').onclick = () => {
    finishSpeech();
  };
}

// ---------- 真正的中文語音辨識 ----------

function initSpeech() {
  const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SR) {
    status(
      '這個瀏覽器不支援語音辨識；' +
      '請用電腦版 Chrome，或先使用打字測試。'
    );

    $('micBtn').disabled = true;
    return;
  }

  speech = new SR();

  speech.lang = 'zh-TW';
  speech.continuous = true;
  speech.interimResults = true;
  speech.maxAlternatives = 1;

  speech.onstart = () => {
    listening = true;

    status(
      '正在聆聽…說完後停頓約 3 秒'
    );

    buttonState();
  };

  speech.onresult = ev => {
    let f = '';
    let i = '';

    // 每次重新讀取所有辨識結果
    // 避免重複累加相同文字
    for (let j = 0; j < ev.results.length; j++) {
      const phrase =
        ev.results[j][0]?.transcript || '';

      if (ev.results[j].isFinal) {
        f += phrase + ' ';
      } else {
        i += phrase;
      }
    }

    finalWords = f.trim();
    interimWords = i.trim();

    transcript(
      (finalWords + ' ' + interimWords).trim()
    );

    clearTimeout(silenceTimer);

    if (
      (finalWords + interimWords).trim().length >= 2
    ) {
      silenceTimer = setTimeout(
        finishSpeech,
        3200
      );
    }
  };

  speech.onerror = ev => {
    clearTimeout(silenceTimer);

    if (submitted) return;

    if (ev.error === 'no-speech') {
      status('沒有聽到聲音，請再試一次。');
    } else if (
      ev.error === 'not-allowed' ||
      ev.error === 'service-not-allowed'
    ) {
      status(
        '麥克風未獲授權，請在網址列允許麥克風。'
      );
    } else {
      status(
        '語音辨識失敗：' +
        ev.error +
        '，也可以打字測試。'
      );
    }

    speechActive = false;
    listening = false;
    buttonState();
  };

  speech.onend = () => {
    listening = false;
    buttonState();

    if (speechActive && !submitted) {
      const words =
        (finalWords + ' ' + interimWords).trim();

      if (words.length >= 2) {
        finishSpeech();
      } else {
        speechActive = false;
        status('尚未辨識到文字，請再說一次。');
      }
    }
  };

  $('micBtn').onclick = () => {
    if (busy) return;

    if (listening) {
      finishSpeech();
      return;
    }

    clearTimeout(silenceTimer);

    finalWords = '';
    interimWords = '';
    submitted = false;
    speechActive = true;

    transcript('');

    try {
      speech.start();
    } catch (e) {
      speechActive = false;

      status(
        '無法啟動語音辨識：' +
        e.message
      );
    }
  };
}

// ---------- 結束說話 ----------

function finishSpeech() {
  if (
    !speechActive ||
    submitted ||
    busy
  ) {
    return;
  }

  const words =
    (finalWords + ' ' + interimWords).trim();

  clearTimeout(silenceTimer);

  if (words.length < 2) {
    status('請先說出想像的內容。');
    return;
  }

  submitted = true;
  speechActive = false;

  if (listening) {
    try {
      speech.stop();
    } catch (e) {}
  }

  listening = false;
  buttonState();

  generate(words);
}

// ---------- 傳送 Gemini 並載入 SVG ----------

async function generate(input) {
  const idea = String(input || '').trim();

  if (busy) return;

  if (idea.length < 2) {
    status('請說出或輸入至少兩個字。');
    return;
  }

  busy = true;
  buttonState();

  transcript('你的想像：「' + idea + '」');

  status(
    'AI 正在用黏土風格創造場景，' +
    '可能需要一些時間…'
  );

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    115000
  );

  try {
    const response = await fetch(
      '/api/generate-svg',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idea }),
        signal: controller.signal
      }
    );

    const raw = await response.text();

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error(
        '伺服器回傳格式不正確，' +
        '請確認 Render 已部署最新版本'
      );
    }

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error ||
        'HTTP ' + response.status
      );
    }

    if (
      !result.svg ||
      !result.svg.includes('<svg')
    ) {
      throw new Error('AI 沒有產生 SVG');
    }

    status(
      '正在把黏土場景放進 p5.js…'
    );

    const blob = new Blob(
      [result.svg],
      {
        type: 'image/svg+xml;charset=utf-8'
      }
    );

    const url = URL.createObjectURL(blob);

    try {
      const loaded = await new Promise(
        (resolve, reject) => {
          loadImage(
            url,
            resolve,
            () => reject(
              new Error(
                'SVG 圖片無法載入 p5.js'
              )
            )
          );
        }
      );

      oldScene = scene;
      scene = loaded;
      transition = 0;

      $('stageHint').classList.add('hidden');

      status(
        '✨ 黏土想像世界完成！' +
        '再說一次可以改變場景。'
      );

    } finally {
      URL.revokeObjectURL(url);
    }

  } catch (e) {
    console.error(
      'Mindspace generation:',
      e
    );

    status(
      e.name === 'AbortError'
        ? '等待超過 115 秒，請縮短描述後重試。'
        : '生成失敗：' + e.message
    );

  } finally {
    clearTimeout(timeout);

    busy = false;
    buttonState();
  }
}
