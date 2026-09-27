// Скачать полученный от API файл. Ручки выгрузки закрыты Bearer-токеном,
// а в <a href> его не положить: ссылка открывала вкладку с 401. Поэтому
// файл тянется обычным запросом, а сохраняется уже из памяти.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Отзываем не сразу: Safari успевает начать скачивание не мгновенно, и
  // отозванный в тот же тик URL даёт пустой файл.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
