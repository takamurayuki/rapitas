const { Jimp } = require("jimp");

async function createIcon() {
  const size = 1024;

  // Create a new image
  const image = new Jimp({ width: size, height: size, color: 0x00000000 });

  // Draw a rounded rectangle with gradient-like effect
  const color1 = 0x6366f1ff; // Indigo
  const color2 = 0x8b5cf6ff; // Purple

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Check if pixel is within rounded rectangle
      const cornerRadius = 200;
      const inCorner =
        (x < cornerRadius &&
          y < cornerRadius &&
          Math.hypot(x - cornerRadius, y - cornerRadius) > cornerRadius) ||
        (x >= size - cornerRadius &&
          y < cornerRadius &&
          Math.hypot(x - (size - cornerRadius), y - cornerRadius) >
            cornerRadius) ||
        (x < cornerRadius &&
          y >= size - cornerRadius &&
          Math.hypot(x - cornerRadius, y - (size - cornerRadius)) >
            cornerRadius) ||
        (x >= size - cornerRadius &&
          y >= size - cornerRadius &&
          Math.hypot(x - (size - cornerRadius), y - (size - cornerRadius)) >
            cornerRadius);

      if (!inCorner) {
        // Gradient from top-left to bottom-right
        const t = (x + y) / (2 * size);
        const r = Math.round(0x63 * (1 - t) + 0x8b * t);
        const g = Math.round(0x66 * (1 - t) + 0x5c * t);
        const b = Math.round(0xf1 * (1 - t) + 0xf6 * t);
        const color = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
        image.setPixelColor(color, x, y);
      }
    }
  }

  // Draw letter "R" in white (simple rectangle-based approximation)
  const letterSize = 500;
  const letterX = (size - letterSize * 0.6) / 2;
  const letterY = (size - letterSize) / 2;
  const white = 0xffffffff;
  const strokeWidth = 80;

  // Vertical bar of R
  for (let y = letterY; y < letterY + letterSize; y++) {
    for (let x = letterX; x < letterX + strokeWidth; x++) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        image.setPixelColor(white, Math.round(x), Math.round(y));
      }
    }
  }

  // Top horizontal bar
  for (let y = letterY; y < letterY + strokeWidth; y++) {
    for (let x = letterX; x < letterX + letterSize * 0.5; x++) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        image.setPixelColor(white, Math.round(x), Math.round(y));
      }
    }
  }

  // Middle horizontal bar
  for (
    let y = letterY + letterSize * 0.4;
    y < letterY + letterSize * 0.4 + strokeWidth;
    y++
  ) {
    for (let x = letterX; x < letterX + letterSize * 0.5; x++) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        image.setPixelColor(white, Math.round(x), Math.round(y));
      }
    }
  }

  // Right curve of R (simplified as vertical bar)
  for (let y = letterY; y < letterY + letterSize * 0.4 + strokeWidth; y++) {
    for (
      let x = letterX + letterSize * 0.5 - strokeWidth;
      x < letterX + letterSize * 0.5;
      x++
    ) {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        image.setPixelColor(white, Math.round(x), Math.round(y));
      }
    }
  }

  // Diagonal leg of R
  for (let i = 0; i < letterSize * 0.6; i++) {
    const baseX = letterX + letterSize * 0.3;
    const baseY = letterY + letterSize * 0.4 + strokeWidth;
    for (let w = 0; w < strokeWidth; w++) {
      const x = Math.round(baseX + i * 0.5 + w * 0.7);
      const y = Math.round(baseY + i);
      if (x >= 0 && x < size && y >= 0 && y < size) {
        image.setPixelColor(white, x, y);
      }
    }
  }

  await image.write("app-icon.png");
  console.log("Icon created: app-icon.png");
}

createIcon().catch(console.error);
