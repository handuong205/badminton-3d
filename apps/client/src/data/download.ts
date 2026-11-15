/** Lưu một đoạn text thành file trên máy người chơi (dùng cho log .jsonl ở chế độ dev) */
export function downloadText(fileName: string, text: string, mime = 'application/x-ndjson'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
