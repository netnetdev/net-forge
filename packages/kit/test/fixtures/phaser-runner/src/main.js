import Phaser from "phaser";

class Run extends Phaser.Scene {
  create() {
    this.distance = 0;
    this.add.text(10, 10, "RUN", { color: "#fff" });
  }
  update(_time, delta) {
    this.distance += delta / 1000;
    if (this.distance > 30) this.finishStage();
  }
  finishStage() {
    this.distance = 0;
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: 640, height: 360, scene: Run });
