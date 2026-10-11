
// Mindspace — 語音互動與 p5.js 場景

let particles = [];
let t = 0;
let sceneImage = null;

let recognition = null;
let listening = false;
let generating = false;
let finalized = "";
let interim = "";
let silenceTimer = null;
let sessionActive = false;
let submitted = false;

const SILENCE_MS = 3000;

function statusText(text) {
  document.getElementById("status").textContent = text;
}

function transcriptText(text) {
  document.getElementById("transcript").textContent = text;
}

function updateButton() {
  const button = document.getElementById("micButton");
  button.disabled = generating;
  button.textContent = generating
    ? "✨ AI 正在創造世界…"
    : listening
      ? "⏹ 結束說話並生成"
      : "🎤 開始說出想像";
}

// ---------- p5.js ----------

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(devicePixelRatio || 1, 2));
  colorMode(HSB, 360, 100, 100, 100);
  makeParticles();
  initRecognition();
}

function makeParticles() {
  particles = [];
  for (let i = 0; i < 100; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      r: random(1, 4),
      speed: random(0.3, 1.5),
      phase: random(TWO_PI)
    });
  }
}

function draw() {
  t += 0.008;
  drawWorld();

  if (sceneImage) {
    push();
    imageMode(CENTER);

    // 依照 SVG 原始 1000×600 比例縮放
    const scale = Math.min(width / 1000, height / 600);
    image(
      sceneImage,
      width / 2,
      height / 2,
      1000 * scale,
      600 * scale
    );
    pop();
  }

  drawParticles();
  drawTitle();
}

function drawWorld() {
  for (let y = 0; y < height; y += 3) {
    const k = y / height;
    stroke(lerpColor(
      color(222, 70, 18),
      color(177, 72, 46),
      k
    ));
    line(0, y, width, y);
  }

  noStroke();
  for (let i = 0; i < 7; i++) {
    const x = width * (0.15 + i * 0.12);
    const y = height * (0.35 + sin(t + i) * 0.08);
    fill(185 + i * 8, 55, 85, 5);
    circle(x, y, height * 0.4);
  }

  noFill();
  for (let j = 0; j < 4; j++) {
    stroke(180 + j * 12, 40, 90, 25 - j * 4);
    strokeWeight(1.5);
    beginShape();
    for (let x = 0; x <= width; x += 12) {
      const y =
        height * 0.72 +
        sin(x * 0.008 + t * 2 + j) * 16 +
        sin(x * 0.018 - t + j) * 7 +
        j * 15;
      vertex(x, y);
    }
    endShape();
  }
}

function drawParticles() {
  noStroke();
  for (const p of particles) {
    p.y -= p.speed;
    p.x += sin(t + p.phase) * 0.4;

    if (p.y < -10) {
      p.y = height + 10;
      p.x = random(width);
    }

    fill(
      180 + 35 * sin(p.phase),
      30, 100,
      35 + 35 * sin(t * 2 + p.phase)
    );
    circle(p.x, p.y, p.r * 2);
  }
}

function drawTitle() {
  noStroke();
  fill(0, 0, 100, 95);
  textAlign(LEFT, TOP);
  textStyle(NORMAL);
  textSize(constrain(width * 0.018, 18, 30));
  text("M I N D S P A C E", 30, 26);

  fill(0, 0, 100, 75);
  textSize(constrain(width * 0.009, 12, 16));
  text(
    "讓想像慢慢長出自己的世界",
    32, 66
  );
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  makeParticles();
}

// ---------- 語音辨識 ----------

function initRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  const button = document.getElementById("micButton");

  if (!SpeechRecognition) {
    button.disabled = true;
    statusText(
      "此瀏覽器不支援語音辨識，請改用電腦版 Chrome"
    );
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "zh-TW";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    listening = true;
    statusText("正在聆聽…說完停頓約 3 秒");
    updateButton();
  };

  recognition.onresult = (event) => {
    let currentFinal = "";
    let currentInterim = "";

    // 每次從全部結果重新組合，避免重複累加
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const words = result[0].transcript;

      if (result.isFinal) {
        currentFinal += words + " ";
      } else {
        currentInterim += words;
      }
    }

    finalized = currentFinal.trim();
    interim = currentInterim.trim();

    transcriptText(
      (finalized + " " + interim).trim()
    );

    clearTimeout(silenceTimer);

    if ((finalized + interim).trim().length >= 2) {
      silenceTimer = setTimeout(
        submitSpeech,
        SILENCE_MS
      );
    }
  };

  recognition.onerror = (event) => {
    clearTimeout(silenceTimer);

    if (event.error === "not-allowed") {
      statusText("請允許瀏覽器使用麥克風");
    } else if (event.error === "no-speech") {
      statusText("沒有聽到聲音，請重新點擊麥克風");
    } else {
      statusText("語音辨識錯誤：" + event.error);
    }

    sessionActive = false;
    listening = false;
    updateButton();
  };

  recognition.onend = () => {
    listening = false;
    updateButton();

    if (sessionActive && !submitted) {
      const text = (finalized + " " + interim).trim();

      if (text.length >= 2) {
        submitSpeech();
      } else {
        sessionActive = false;
        statusText("請重新點擊麥克風說話");
      }
    }
  };

  button.addEventListener("click", () => {
    if (generating) return;

    if (listening) {
      submitSpeech();
      return;
    }

    finalized = "";
    interim = "";
    submitted = false;
    sessionActive = true;
    transcriptText("");

    try {
      recognition.start();
    } catch (e) {
      sessionActive = false;
      statusText("麥克風啟動失敗：" + e.message);
    }
  });
}

function submitSpeech() {
  if (submitted || generating || !sessionActive) {
    return;
  }

  clearTimeout(silenceTimer);

  const idea = (finalized + " " + interim).trim();

  if (idea.length < 2) {
    statusText("請先說出你的想像");
    return;
  }

  submitted = true;
  sessionActive = false;

  if (listening) {
    try {
      recognition.stop();
    } catch (_) {}
  }

  listening = false;
  generateScene(idea);
}

// ---------- Gemini SVG ----------

async function generateScene(idea) {
  generating = true;
  updateButton();

  statusText("AI 正在思考與繪製 SVG，請稍候…");

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      115000
    );

    let response;
    try {
      response = await fetch("/api/generate-svg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ idea }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      throw new Error(
        "伺服器沒有回傳 JSON，請檢查 Render 部署"
      );
    }

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error || `HTTP ${response.status}`
      );
    }

    if (!data.svg || !data.svg.includes("<svg")) {
      throw new Error("AI 回傳內容不是 SVG");
    }

    statusText("正在將 SVG 載入 p5.js…");

    const blob = new Blob([data.svg], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);

    try {
      const loaded = await new Promise(
        (resolve, reject) => {
          loadImage(
            url,
            resolve,
            () => reject(
              new Error("SVG 圖片無法顯示")
            )
          );
        }
      );

      sceneImage = loaded;
    } finally {
      URL.revokeObjectURL(url);
    }

    statusText(
      "✨ 想像世界生成成功！可以再次說話創造新場景"
    );

  } catch (error) {
    console.error("Mindspace:", error);

    statusText(
      error.name === "AbortError"
        ? "等待超過 115 秒，請稍後重試"
        : "生成失敗：" + error.message
    );

  } finally {
    generating = false;
    updateButton();
  }
}
