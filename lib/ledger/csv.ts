// 공용 CSV 내보내기 — 한글 안 깨지게 BOM 포함, Excel 호환.
// 각 화면의 [엑셀 다운로드] 버튼이 이 함수를 호출한다.

function escapeCell(c: unknown): string {
  const s = c == null ? '' : String(c);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * headers + rows 를 CSV 파일로 즉시 다운로드한다.
 * @param filename 확장자 포함 (예: '재고현황.csv')
 * @param headers 컬럼 헤더 배열
 * @param rows 행 배열 (각 행은 셀 배열)
 */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(','));
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
