// sketch.js
let particles = [];
let t = 0;
let immersive = false;

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  colorMode(HSB, 360, 100, 100, 100);
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
  drawParticles();
  drawTitle();
  drawControls();
}

function drawWorld() {
  // 深藍到青綠的夢境漸層
  for (let y = 0; y < height; y += 3) {
    let k = y / height;
    let c = lerpColor(
      color(222, 70, 18),
      color(177, 72, 46),
      k
    );
    stroke(c);
    line(0, y, width, y);
  }

  noStroke();

  // 遠方光暈
  for (let i = 0; i < 7; i++) {
    let x = width * (0.15 + i * 0.12);
    let y = height * (0.35 + sin(t + i) * 0.08);
    fill(185 + i * 8, 55, 85, 5);
    circle(x, y, height * (0.4 + sin(t + i) * 0.05));
  }

  // 地平線上的流動光波
  noFill();
  for (let j = 0; j < 4; j++) {
    stroke(180 + j * 12, 40, 90, 25 - j * 4);
    strokeWeight(1.5);
    beginShape();
    for (let x = 0; x <= width; x += 12) {
      let y = height * 0.72
        + sin(x * 0.008 + t * 2 + j) * 16
        + sin(x * 0.018 - t + j) * 7
        + j * 15;
      vertex(x, y);
    }
    endShape();
  }
}

function drawParticles() {
  noStroke();

  for (let p of particles) {
    p.y -= p.speed;
    p.x += sin(t + p.phase) * 0.4;

    if (p.y < -10) {
      p.y = height + 10;
      p.x = random(width);
    }

    let alpha = 35 + 35 * sin(t * 2 + p.phase);
    fill(180 + 35 * sin(p.phase), 30, 100, alpha);
    circle(p.x, p.y, p.r * 2);
  }
}

function drawTitle() {
  fill(0, 0, 100, 95);
  noStroke();
  textAlign(LEFT, TOP);
  textSize(constrain(width * 0.018, 18, 30));
  textStyle(NORMAL);
  text("M I N D S P A C E", 30, 26);

  fill(0, 0, 100, 75);
  textSize(constrain(width * 0.009, 12, 16));
  text("讓想像慢慢長出自己的世界", 32, 66);
}

function drawControls() {
  // 尚未連接相機與麥克風；目前先測試全螢幕舞台。
  let w = min(width * 0.32, 420);
  let h = 56;
  let x = (width - w) / 2;
  let y = height - 95;

  noStroke();
  fill(180, 30, 100, 18);
  rect(x, y, w, h, 28);

  noFill();
  stroke(180, 25, 100, 65);
  strokeWeight(1);
  rect(x, y, w, h, 28);

  noStroke();
  fill(0, 0, 100);
  textAlign(CENTER, CENTER);
  textSize(16);
  text(immersive ? "想像世界已展開" : "點擊畫面，進入想像世界", width / 2, y + h / 2);
}

function mousePressed() {
  if (!immersive) immersive = true;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
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