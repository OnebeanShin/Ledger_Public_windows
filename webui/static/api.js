/* ── API helpers ─────────────────────────────────────── */

export async function api(path) {
  const resp = await fetch(path);
  if (!resp.ok) {
    // 서버가 JSON 에러 본문을 반환하면 그 메시지를 그대로 사용한다
    let msg = `서버 오류 (HTTP ${resp.status})`;
    try {
      const body = await resp.json();
      if (body?.error) msg = body.error;
    } catch (_) { /* JSON 파싱 실패 시 기본 메시지 유지 */ }
    throw new Error(msg);
  }
  return resp.json();
}
