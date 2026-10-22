// Sky Hop: tap to hop between ledges. Reach a new height band to level up.
var c = document.getElementById("c");
var g = c.getContext("2d");
var y = 500, vy = 0, band = 0, best = 0;

function levelComplete() {
  band += 1;
}

c.addEventListener("pointerdown", function () { vy = -9; });

function loop() {
  vy += 0.4;
  y += vy;
  if (y > 520) { y = 520; vy = 0; }
  var height = Math.floor((520 - y) / 100);
  if (height > best) { best = height; levelComplete(); }
  g.clearRect(0, 0, 360, 540);
  g.fillStyle = "#9be564";
  g.fillRect(170, y, 20, 20);
  g.fillStyle = "#e6edf3";
  g.fillText("BAND " + band, 10, 20);
  requestAnimationFrame(loop);
}
loop();
