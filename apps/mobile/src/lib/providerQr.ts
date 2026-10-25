import createQRCode from 'qrcode-generator';
// ASCII canonical URL only: no SVG text interpolation, external assets or secrets.
export function providerQr(url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/p\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.pathname) || parsed.pathname.length > 83 || url.length > 512) throw new Error('Invalid canonical provider URL.');
  const qr = createQRCode(0, 'M'); qr.addData(url, 'Byte'); qr.make();
  const size = qr.getModuleCount() + 8;
  let path = '';
  for (let y = 0; y < qr.getModuleCount(); y++) for (let x = 0; x < qr.getModuleCount(); x++) if (qr.isDark(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="512" height="512"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>`;
  return { size, path, svg };
}
